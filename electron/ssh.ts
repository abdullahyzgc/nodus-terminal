import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { posix } from 'node:path'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type { Entry, Host, ServerStats, SessionEvent, LogEvent, LogSource } from '../src/shared'
import { logCommand } from './operations'

export const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'"
export function remotePath(value: string): string {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Geçersiz uzak dosya yolu.')
  return value || '.'
}

export class CwdTracker {
  private pending = ''
  accept(text: string): string[] {
    this.pending += text
    const paths: string[] = []
    const pattern = /\x1b\]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(this.pending))) {
      try {
        const path = decodeURIComponent(match[1])
        if (path.startsWith('/') && !/[\x00-\x1f\x7f]/.test(path)) paths.push(path)
      } catch { }
    }
    const start = this.pending.lastIndexOf('\x1b]7;')
    if (start >= 0 && !/[\x07]/.test(this.pending.slice(start)) && !this.pending.slice(start).includes('\x1b\\')) {
      this.pending = this.pending.length - start <= 16384 ? this.pending.slice(start) : ''
    } else {
      const prefix = '\x1b]7;'
      this.pending = [3, 2, 1].map((length) => prefix.slice(0, length)).find((part) => this.pending.endsWith(part)) ?? ''
    }
    return paths
  }
}

type Session = { client: Client; shell?: ClientChannel; sftp?: SFTPWrapper; sftpPending?: Promise<SFTPWrapper>; cwdTimer?: ReturnType<typeof setTimeout> }
export class SSHManager {
  private sessions = new Map<string, Session>()
  private records = new Map<string, { hostId: string; persistent: boolean; production: boolean; terminalAllowed: boolean }>()
  private logs = new Map<string, { id: string; channel?: ClientChannel }>()
  constructor(private emit: (event: SessionEvent) => void, private verify: (host: Host, fingerprint: string) => Promise<boolean>) {}
  async connect(host: Host, passwordOverride?: string, resumeId?: string): Promise<{ id: string; hostId: string; name: string; persistentSession: boolean }> {
    if (host.protocol === 'rdp') throw new Error('RDP sunucusu SSH terminaliyle açılamaz. Uzak Masaüstü bağlantısını kullanın.')
    if (!resumeId && this.records.size >= 16) throw new Error('En fazla 16 açık oturum destekleniyor.')
    if (resumeId && (this.records.get(resumeId)?.hostId !== host.id || this.sessions.has(resumeId))) throw new Error('Oturum yeniden bağlanmaya uygun değil.')
    if (host.persistentSession && [...this.records].some(([key, record]) => key !== resumeId && record.hostId === host.id && record.persistent)) throw new Error('Bu sunucu için kalıcı oturum zaten açık.')
    const id = resumeId ?? randomUUID()
    this.records.set(id, { hostId: host.id, persistent: !!host.persistentSession, production: !!host.production, terminalAllowed: !host.production })
    const client = new Client()
    const session: Session = { client }
    this.sessions.set(id, session)
    const decoder = new StringDecoder('utf8')
    const tracker = new CwdTracker()
    let persistentSession = false
    try {
      await new Promise<void>((resolve, reject) => {
        const openingTimer = setTimeout(() => { reject(new Error('SSH oturum açma zaman aşımı.')); client.destroy() }, 30000)
        const finish = () => { clearTimeout(openingTimer); resolve() }
        client.once('error', () => clearTimeout(openingTimer))
        client.once('close', () => clearTimeout(openingTimer))
        client.on('error', (error: Error) => { this.emit({ id, type: 'error', data: error.message }); reject(error) })
        client.on('close', () => { clearTimeout(session.cwdTimer); if (this.sessions.get(id) === session) { this.sessions.delete(id); this.stopLogs(id); this.emit({ id, type: 'closed', data: '' }) } reject(new Error('SSH bağlantısı kapandı.')) })
        client.once('ready', () => {
        const opened = (error: Error | undefined, shell: ClientChannel) => {
            if (error) { reject(error); return }
            if (this.sessions.get(id) !== session) { shell.close(); reject(new Error('Oturum kapandı.')); return }
            session.shell = shell
            shell.on('data', (chunk: Buffer) => {
              const data = decoder.write(chunk)
              this.emit({ id, type: 'data', data })
              for (const path of tracker.accept(data)) this.emit({ id, type: 'cwd', data: path })
            })
            shell.stderr.on('data', (chunk: Buffer) => this.emit({ id, type: 'data', data: chunk.toString('utf8') }))
            shell.on('close', () => client.end())
            shell.on('error', (failure: Error) => this.emit({ id, type: 'error', data: failure.message }))
            const commands: string[] = []
            if (host.initialPath && !persistentSession) commands.push('cd -- ' + shellQuote(host.initialPath))
            if (host.followDirectory && !persistentSession) {
              const report = "__nodus_cwd() { printf '\\033]7;file://localhost%s\\007' \"${PWD//%/%25}\"; }; "
              const bash = report + 'if declare -p PROMPT_COMMAND 2>/dev/null | grep -q "declare -a"; then PROMPT_COMMAND+=(__nodus_cwd); else PROMPT_COMMAND="__nodus_cwd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"; fi; __nodus_cwd'
              const zsh = report + 'precmd_functions+=(__nodus_cwd); __nodus_cwd'
              commands.push('if [ -n "$BASH_VERSION" ]; then eval ' + shellQuote(bash) + '; elif [ -n "$ZSH_VERSION" ]; then eval ' + shellQuote(zsh) + '; fi')
            }
            if (commands.length) shell.write(commands.join('; ') + '\r')
            this.emit({ id, type: 'ready', data: '', persistentSession })
            if (host.followDirectory && persistentSession) this.trackTmuxDirectory(id, session, host.id)
            finish()
          }
          if (host.persistentSession) {
            client.exec('command -v tmux', (error, probe) => {
              if (error) { reject(error); return }
              probe.resume(); probe.stderr.resume()
              probe.on('error', reject)
              probe.on('close', (code: number) => {
                if (this.sessions.get(id) !== session) { reject(new Error('Oturum kapandı.')); return }
                if (code === 1 || code === 127) {
                  this.records.get(id)!.persistent = false
                  client.shell({ term: 'xterm-256color', cols: 110, rows: 32 }, opened)
                  return
                }
                if (code !== 0) { reject(new Error('Sunucuda tmux kullanılabilirliği denetlenemedi.')); return }
                persistentSession = true
                const command = 'tmux new-session -A -s ' + shellQuote('nodus-' + host.id) + (host.initialPath ? ' -c ' + shellQuote(host.initialPath) : '')
                client.exec(command, { pty: { term: 'xterm-256color', cols: 110, rows: 32 } }, opened)
              })
            })
          } else client.shell({ term: 'xterm-256color', cols: 110, rows: 32 }, opened)
        })
        client.connect({
          host: host.hostname, port: host.port, username: host.username,
          ...(host.authType === 'key' ? { privateKey: host.privateKey, passphrase: host.passphrase || undefined } : { password: passwordOverride !== undefined ? passwordOverride : host.password }),
          hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => { this.verify(host, createHash('sha256').update(key).digest('hex')).then(callback, () => callback(false)) },
          readyTimeout: 30000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        })
      })
      return { id, hostId: host.id, name: host.name, persistentSession }
    } catch (error) { client.destroy(); if (this.sessions.get(id) === session) this.sessions.delete(id); if (!resumeId) this.records.delete(id); throw error }
  }
  private trackTmuxDirectory(id: string, session: Session, hostId: string): void {
    let previous = ''
    const poll = async () => {
      if (this.sessions.get(id) !== session) return
      try {
        const result = await this.exec(id, 'tmux display-message -p -t ' + shellQuote('=nodus-' + hostId + ':') + ' ' + shellQuote('#{pane_current_path}'), 5000)
        if (this.sessions.get(id) !== session) return
        const path = result.stdout.replace(/\r?\n$/, '')
        if (result.code === 0 && path.startsWith('/') && path !== previous) {
          remotePath(path)
          previous = path
          this.emit({ id, type: 'cwd', data: path })
        }
      } catch {}
      finally {
        if (this.sessions.get(id) === session) session.cwdTimer = setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
  }
  hostId(id: string): string { const record = this.records.get(id); if (!record) throw new Error('Oturum bulunamadı.'); return record.hostId }
  connected(id: string): boolean { return !!this.sessions.get(id)?.shell }
  connectionKey(id: string): object { return this.session(id) }
  production(id: string): boolean { return !!this.records.get(id)?.production }
  authorizeTerminal(id: string): void { const record = this.records.get(id); if (!record || !this.connected(id)) throw new Error('Oturum kapalı.'); record.terminalAllowed = true; this.emit({ id, type: 'authorized', data: '' }) }
  disconnectHost(hostId: string): void { for (const [id, record] of this.records) if (record.hostId === hostId) this.disconnect(id) }
  private session(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new Error('Oturum kapalı. Yeniden bağlanın.')
    return session
  }
  input(id: string, data: string): void {
    if (!this.records.get(id)?.terminalAllowed) return
    if (typeof data !== 'string' || data.length > 1024 * 1024) return
    this.sessions.get(id)?.shell?.write(data)
  }
  resize(id: string, cols: number, rows: number): void {
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols < 1000 && rows < 1000) this.sessions.get(id)?.shell?.setWindow(rows, cols, 0, 0)
  }
  disconnect(id: string): void { this.stopLogs(id); this.records.delete(id); const session = this.sessions.get(id); clearTimeout(session?.cwdTimer); this.sessions.delete(id); session?.client.destroy(); this.emit({ id, type: 'closed', data: '' }) }
  closeAll(): void { for (const id of this.records.keys()) this.disconnect(id) }
  async startLog(id: string, token: string, source: LogSource, emit: (event: LogEvent) => void): Promise<void> {
    const command = logCommand(source)
    if (typeof token !== 'string' || !/^[\w-]{1,80}$/.test(token) || this.logs.has(token) || [...this.logs.values()].filter((item) => item.id === id).length >= 4) throw new Error('En fazla dört günlük akışı açılabilir; kimlik benzersiz olmalı.')
    const session = this.session(id)
    const record: { id: string; channel?: ClientChannel } = { id }
    this.logs.set(token, record)
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.stopLog(id, token); reject(new Error('Günlük bağlantısı zaman aşımına uğradı.')) }, 15000)
        session.client.exec(command, (error, channel) => {
          clearTimeout(timer)
          if (error) { reject(error); return }
          if (this.logs.get(token) !== record || this.sessions.get(id) !== session) { channel.close(); reject(new Error('Günlük iptal edildi.')); return }
          record.channel = channel
          const stdout = new StringDecoder('utf8'); const stderr = new StringDecoder('utf8')
          const send = (data: string) => { if (this.logs.get(token) === record) emit({ id, token, type: 'data', data }) }
          channel.on('data', (chunk: Buffer) => send(stdout.write(chunk)))
          channel.stderr.on('data', (chunk: Buffer) => send(stderr.write(chunk)))
          channel.on('error', (failure: Error) => { if (this.logs.get(token) === record) { emit({ id, token, type: 'error', data: failure.message }); this.stopLog(id, token) } })
          channel.on('close', () => { if (this.logs.get(token) === record) { send(stdout.end() + stderr.end()); this.logs.delete(token); emit({ id, token, type: 'closed', data: '' }) } })
          resolve()
        })
      })
    } catch (error) { if (this.logs.get(token) === record) this.logs.delete(token); throw error }
  }
  stopLog(id: string, token: string): void { const record = this.logs.get(token); if (record?.id !== id) return; this.logs.delete(token); record.channel?.close() }
  private stopLogs(id: string): void { for (const [token, record] of this.logs) if (record.id === id) this.stopLog(id, token) }
  async sftp(id: string): Promise<SFTPWrapper> {
    const session = this.session(id)
    if (session.sftp) return session.sftp
    if (!session.sftpPending) session.sftpPending = new Promise<SFTPWrapper>((resolve, reject) => {
      session.client.sftp((error, sftp) => {
        if (error) { session.sftpPending = undefined; reject(error); return }
        session.sftp = sftp
        sftp.on('error', () => { session.sftp = undefined; session.sftpPending = undefined })
        sftp.on('close', () => { session.sftp = undefined; session.sftpPending = undefined })
        resolve(sftp)
      })
    })
    return session.sftpPending
  }
  async list(id: string, path: string): Promise<{ path: string; entries: Entry[] }> {
    const sftp = await this.sftp(id)
    const canonical = await new Promise<string>((resolve, reject) => sftp.realpath(remotePath(path), (error, result) => error ? reject(error) : resolve(result)))
    const entries = await new Promise<Entry[]>((resolve, reject) => sftp.readdir(canonical, (error, result) => {
      if (error) { reject(error); return }
      resolve(result.filter((entry) => entry.filename !== '.' && entry.filename !== '..' && !entry.filename.includes('/') && !/[\x00-\x1f\x7f]/.test(entry.filename)).map((entry): Entry => ({
        name: entry.filename, kind: entry.attrs.isDirectory() ? 'directory' : entry.attrs.isSymbolicLink() ? 'link' : 'file',
        size: entry.attrs.size, modified: entry.attrs.mtime, mode: entry.attrs.mode,
      })).sort((first, second) => Number(second.kind === 'directory') - Number(first.kind === 'directory') || first.name.localeCompare(second.name)))
    }))
    return { path: canonical, entries }
  }
  async mkdir(id: string, path: string): Promise<void> {
    const sftp = await this.sftp(id)
    await new Promise<void>((resolve, reject) => sftp.mkdir(remotePath(path), (error) => error ? reject(error) : resolve()))
  }
  async rename(id: string, from: string, to: string): Promise<void> {
    const sftp = await this.sftp(id)
    await new Promise<void>((resolve, reject) => sftp.rename(remotePath(from), remotePath(to), (error) => error ? reject(error) : resolve()))
  }
  async exec(id: string, command: string, timeoutMs = 30000): Promise<{ code: number; stdout: string; stderr: string }> {
    if (typeof command !== "string" || !command || command.length > 8192) throw new Error("Gecersiz uzak komut.")
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw new Error("Gecersiz komut suresi.")
    const session = this.session(id)
    return new Promise((resolve, reject) => {
      let channelRef: ClientChannel | undefined
      let settled = false
      const timer = setTimeout(() => { settled = true; channelRef?.close(); reject(new Error('Komut zaman asimina ugradi.')) }, timeoutMs)
      session.client.exec(command, (error, channel) => {
        if (error) { clearTimeout(timer); reject(error); return }
        if (settled || this.sessions.get(id) !== session) { clearTimeout(timer); channel.close(); reject(new Error('Oturum kapandı.')); return }
        channelRef = channel
        let stdout = ""
        let stderr = ""
        const outputDecoder = new StringDecoder('utf8'); const errorDecoder = new StringDecoder('utf8')
        channel.on("data", (chunk: Buffer) => { stdout += outputDecoder.write(chunk).slice(0, Math.max(0, 262144 - stdout.length)) })
        channel.stderr.on("data", (chunk: Buffer) => { stderr += errorDecoder.write(chunk).slice(0, Math.max(0, 65536 - stderr.length)) })
        channel.on("close", (code: number) => { settled = true; clearTimeout(timer); resolve({ code: Number.isInteger(code) ? code : -1, stdout: stdout + outputDecoder.end().slice(0, Math.max(0, 262144 - stdout.length)), stderr: stderr + errorDecoder.end().slice(0, Math.max(0, 65536 - stderr.length)) }) })
        channel.on("error", (failure: Error) => { clearTimeout(timer); reject(failure) })
      })
    })
  }
  async stats(id: string): Promise<ServerStats> {
    const script = "export LC_ALL=C; echo __NODUS_CPU__; head -n 1 /proc/stat; echo __NODUS_LOAD__; cat /proc/loadavg; echo __NODUS_MEM__; free -b | sed -n 2p; echo __NODUS_DISK__; df -P -B1 / | tail -1; echo __NODUS_NET__; cat /proc/net/dev"
    let stdout = ""
    try {
      const result = await this.exec(id, script, 15000)
      stdout = result.stdout
      if (result.code !== 0 || !stdout) throw new Error("stats")
    } catch { throw new Error("Bu sunucuda sistem bilgisi alinamadi.") }
    return parseStats(stdout)
  }
  static validName(name: string): boolean {
    return typeof name === "string" && !!name && name.length <= 255 && name !== "." && name !== ".." && !name.includes("/") && !/[\x00-\x1f\x7f]/.test(name)
  }
  async readFile(id: string, path: string): Promise<{ text: string; size: number }> {
    const sftp = await this.sftp(id)
    const target = remotePath(path)
    const attrs = await new Promise<{ size: number; isFile(): boolean }>((resolve, reject) => sftp.stat(target, (error, result) => error ? reject(error) : resolve(result)))
    const size = Number(attrs.size)
    if (!Number.isFinite(size) || size > 512 * 1024) throw new Error("Dosya duzenleme icin cok buyuk (en fazla 512 KB).")
    if (!attrs.isFile()) throw new Error('Yalnızca normal dosyalar düzenlenebilir.')
    const content = await new Promise<Buffer>((resolve, reject) => {
      const stream = sftp.createReadStream(target, { start: 0, end: 512 * 1024 })
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    })
    if (content.length > 512 * 1024) throw new Error('Dosya düzenleme sınırı 512 KB.')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) }
    catch { throw new Error('Editör yalnızca UTF-8 metin dosyalarını destekler.') }
    if (text.includes("\0")) throw new Error("Ikili dosya duzenlenemez.")
    return { text, size }
  }
  async writeFile(id: string, path: string, text: string, create = false): Promise<void> {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 512 * 1024) throw new Error("Dosya cok buyuk (en fazla 512 KB).")
    const sftp = await this.sftp(id)
    await new Promise<void>((resolve, reject) => sftp.writeFile(remotePath(path), Buffer.from(text, 'utf8'), { flag: create ? 'wx' : 'w' }, (error) => error ? reject(error) : resolve()))
  }
  async remove(id: string, paths: string[]): Promise<void> {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error("En fazla 100 oge silinebilir.")
    const targets = paths.map((raw) => {
      const target = posix.normalize(remotePath(raw))
      if (!target.startsWith('/') || target === '/' || /(?:^|\/)\.\.(?:\/|$)/.test(raw)) throw new Error('Bu dizin silinemez.')
      return target
    })
    const sftp = await this.sftp(id)
    for (const target of targets) {
      await this.removeOne(sftp, target)
    }
  }
  private async removeOne(sftp: SFTPWrapper, target: string): Promise<void> {
    const attrs = await new Promise<{ isDirectory: () => boolean }>((resolve, reject) => sftp.lstat(target, (error, result) => error ? reject(error) : resolve(result)))
    if (!attrs.isDirectory()) {
      await new Promise<void>((resolve, reject) => sftp.unlink(target, (error) => error ? reject(error) : resolve()))
      return
    }
    const children = await new Promise<string[]>((resolve, reject) => sftp.readdir(target, (error, result) => error ? reject(error) : resolve(result.filter((entry) => SSHManager.validName(entry.filename)).map((entry) => entry.filename))))
    for (const child of children) await this.removeOne(sftp, posix.join(target, child))
    await new Promise<void>((resolve, reject) => sftp.rmdir(target, (error) => error ? reject(error) : resolve()))
  }
  async chmod(id: string, path: string, mode: number): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new Error('Geçersiz dosya yetkisi.')
    const sftp = await this.sftp(id)
    await new Promise<void>((resolve, reject) => sftp.chmod(remotePath(path), mode, (error) => error ? reject(error) : resolve()))
  }
  async archive(id: string, dir: string, name: string, format: string, items: string[]): Promise<string> {
    const directory = remotePath(dir)
    if (!SSHManager.validName(name) || !Array.isArray(items) || !items.length || items.length > 100 || !items.every((item) => SSHManager.validName(item))) throw new Error("Gecersiz arsiv istegi.")
    if (!['zip', 'tar.gz', 'tar', 'tar.bz2', 'tar.xz', 'gz'].includes(format)) throw new Error('Desteklenmeyen arşiv biçimi.')
    if (format === 'gz' && items.length !== 1) throw new Error('GZ için tek dosya seç. Klasörler için TAR.GZ kullan.')
    const archiveName = name.toLowerCase().endsWith('.' + format) ? name : name + '.' + format
    if (!SSHManager.validName(archiveName) || items.includes(archiveName)) throw new Error('Geçersiz arşiv adı.')
    const output = shellQuote('./' + archiveName)
    const quoted = items.map((item) => shellQuote('./' + item)).join(' ')
    const flags: Record<string, string> = { tar: '-cf', 'tar.gz': '-czf', 'tar.bz2': '-cjf', 'tar.xz': '-cJf' }
    const pack = format === 'zip' ? 'zip -qr ' + output + ' -- ' + quoted : format === 'gz' ? 'test -f ' + quoted + ' && gzip -c -- ' + quoted + ' > ' + output : 'tar ' + flags[format] + ' ' + output + ' -- ' + quoted
    const command = 'cd -- ' + shellQuote(directory) + ' && (if [ -e ' + output + ' ] || [ -L ' + output + ' ]; then printf "%s" "Aynı adlı dosya zaten var." >&2; exit 1; fi; ' + pack + ')'
    const result = await this.exec(id, command, 120000)
    if (result.code !== 0) throw new Error(result.stderr.trim().slice(0, 300) || "Arsiv olusturulamadi.")
    return archiveName
  }
  async extract(id: string, path: string): Promise<string> {
    const target = remotePath(path)
    const lower = target.toLowerCase()
    const directory = posix.dirname(target)
    const name = posix.basename(target)
    const destination = name + '.extracted'
    if (!SSHManager.validName(destination)) throw new Error('Arşiv adı çok uzun.')
    const source = shellQuote('./' + name)
    const output = shellQuote('./' + destination)
    let unpack: string
    if (lower.endsWith('.zip')) unpack = 'unzip -n -q ' + source + ' -d ' + output
    else if (/\.(tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/.test(lower)) unpack = 'tar --no-same-owner --no-same-permissions --keep-old-files -xf ' + source + ' -C ' + output
    else if (/\.(gz|bz2|xz)$/.test(lower)) {
      const tool = lower.endsWith('.gz') ? 'gzip' : lower.endsWith('.bz2') ? 'bzip2' : 'xz'
      unpack = tool + ' -dc -- ' + source + ' > ' + shellQuote('./' + destination + '/' + name.replace(/\.(gz|bz2|xz)$/i, ''))
    } else throw new Error('Desteklenmeyen arşiv biçimi.')
    const command = 'cd -- ' + shellQuote(directory) + ' && mkdir -- ' + output + ' && ' + unpack
    const result = await this.exec(id, command, 120000)
    if (result.code !== 0) throw new Error(result.stderr.trim().slice(0, 300) || "Arsiv acilamadi.")
    return posix.join(directory, destination)
  }
}
export function parseStats(output: string): ServerStats {
  const fail = (): never => { throw new Error("Bu sunucuda sistem bilgisi alinamadi.") }
  const section = (name: string): string => {
    const parts = output.split("__NODUS_" + name + "__")
    if (parts.length < 2) fail()
    return parts[1].split(/__NODUS_[A-Z]+__/)[0]
  }
  const number = (value: string): number => {
    const parsed = Number(value)
    if (!value || !Number.isFinite(parsed) || parsed < 0) fail()
    return parsed
  }
  const cpuFields = section('CPU').trim().split(/\s+/)
  if (cpuFields[0] !== 'cpu' || cpuFields.length < 5) fail()
  const cpuCounters = cpuFields.slice(1, 9).map(number)
  const cpuTotal = cpuCounters.reduce((total, counter) => total + counter, 0)
  const cpuIdle = cpuCounters[3] + (cpuCounters[4] ?? 0)
  const loadFields = section("LOAD").trim().split(/\s+/)
  const load1 = Number(loadFields[0])
  if (!Number.isFinite(load1) || load1 < 0) fail()
  const memFields = section("MEM").trim().split(/\s+/)
  if (memFields[0] !== "Mem:" || memFields.length < 7) fail()
  const memTotal = number(memFields[1])
  const memUsed = memTotal - number(memFields[6])
  if (memUsed < 0 || !memTotal) fail()
  const diskFields = section("DISK").trim().split(/\s+/)
  if (diskFields.length < 5) fail()
  const diskTotal = number(diskFields[1])
  const diskUsed = number(diskFields[2])
  if (!diskTotal || diskUsed > diskTotal) fail()
  let netRx = 0
  let netTx = 0
  for (const line of section("NET").split("\n")) {
    const match = /^\s*([^:]+):\s*(.+)$/.exec(line)
    if (!match || match[1].trim() === "lo" || match[1].trim().startsWith("Inter") || match[1].trim().startsWith("face")) continue
    const fields = match[2].trim().split(/\s+/)
    if (fields.length < 9) continue
    const rx = Number(fields[0])
    const tx = Number(fields[8])
    if (!Number.isFinite(rx) || !Number.isFinite(tx) || rx < 0 || tx < 0) fail()
    netRx += rx
    netTx += tx
  }
  return { load1, cpuTotal, cpuIdle, memUsed, memTotal, diskUsed, diskTotal, netRx, netTx }
}

export const joinRemote = (directory: string, name: string): string => posix.join(remotePath(directory), name)
