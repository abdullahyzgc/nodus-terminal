import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DriveStatus, Vault } from '../src/shared'
import type { RemoteVault } from './google-drive'
import { mergeVaults, portableVault, sameVault } from './drive-merge'
import { openWithPassword, VaultStore } from './vault'

export interface DriveTransport {
  account(signal: AbortSignal): Promise<string>
  download(signal: AbortSignal): Promise<RemoteVault | undefined>
  upload(text: string, remote: RemoteVault | undefined, signal: AbortSignal): Promise<void>
}

export class DriveSync {
  private transport?: DriveTransport
  private controller?: AbortController
  private interval?: ReturnType<typeof setInterval>
  private debounce?: ReturnType<typeof setTimeout>
  private pending?: { local: Vault; remote: Vault; choices: Record<string, string> }
  private applying = false
  private state: DriveStatus = { configured: false, connected: false, busy: false, message: 'Google Drive bağlı değil.', conflicts: [] }
  constructor(private store: VaultStore, private directory: string, private changed: (status: DriveStatus) => void, private vaultChanged: (vault: Vault) => void, private canRun = () => true) {}
  status(): DriveStatus { return structuredClone(this.state) }
  configure(configured: boolean): void { this.state.configured = configured; this.emit() }
  attach(transport: DriveTransport): void {
    this.stop()
    this.transport = transport
    this.state.connected = true
    this.state.message = 'Google Drive bağlı. Kasa açıldığında otomatik eşlenir.'
    this.emit()
    this.start()
  }
  detach(): void {
    this.stop()
    this.transport = undefined
    this.state.connected = false
    this.state.lastSync = undefined
    this.state.message = 'Google bağlantısı bu cihazdan kaldırıldı. Drive verisi korunuyor.'
    this.emit()
  }
  start(): void {
    if (!this.transport || !this.store.unlocked) return
    if (!this.interval) this.interval = setInterval(() => { void this.sync() }, 30000)
    this.schedule()
  }
  stop(): void {
    this.controller?.abort()
    clearInterval(this.interval); clearTimeout(this.debounce)
    this.interval = undefined; this.debounce = undefined
    this.pending = undefined; this.state.conflicts = []
    this.state.message = 'Otomatik senkron duraklatıldı.'
    this.emit()
  }
  schedule(): void {
    if (this.applying || !this.transport || !this.store.unlocked) return
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => { void this.sync() }, 1500)
  }
  private emit(): void { this.changed(this.status()) }
  private checkpoint(account: string): string { return join(this.directory, 'drive-base-' + createHash('sha256').update(account).digest('hex') + '.nodus') }
  private saveBase(path: string, vault: Vault): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    writeFileSync(path + '.tmp', this.store.seal(portableVault(vault)), { mode: 0o600 })
    renameSync(path + '.tmp', path)
  }
  async sync(): Promise<DriveStatus> {
    if (this.state.busy || !this.transport || !this.store.unlocked || !this.canRun()) return this.status()
    const transport = this.transport
    const controller = new AbortController()
    this.controller = controller; this.state.busy = true; this.state.message = 'Google Drive kontrol ediliyor…'; this.emit()
    try {
      const account = await transport.account(controller.signal)
      const remote = await transport.download(controller.signal)
      controller.signal.throwIfAborted()
      const basePath = this.checkpoint(account)
      const base = existsSync(basePath) ? this.store.open(readFileSync(basePath, 'utf8')) : undefined
      if (!remote && base) throw new Error('Drive kasası kaldırılmış. Yanlışlıkla yeniden oluşturmayı önlemek için senkron durduruldu. Drive verisini geri yükleyin.')
      const local = this.store.read()
      const incoming = remote ? this.store.open(remote.text) : undefined
      if (this.pending && (!sameVault(local, this.pending.local) || !incoming || !sameVault(incoming, this.pending.remote))) this.pending = undefined
      const result = incoming ? mergeVaults(base, local, incoming, this.pending?.choices) : { vault: portableVault(local), conflicts: [] }
      this.state.conflicts = result.conflicts
      if (result.conflicts.length) {
        this.pending = { local, remote: incoming!, choices: this.pending?.choices ?? {} }
        this.state.message = 'Aynı kayıt farklı değiştirilmiş. Ayarlar bölümünden korunacak sürümü seçin; hiçbir kaydın üzerine yazılmadı.'
        return { ...this.status(), busy: false }
      }
      if (!incoming || !sameVault(result.vault, incoming)) await transport.upload(this.store.seal(result.vault), remote, controller.signal)
      controller.signal.throwIfAborted()
      if (!sameVault(local, this.store.read())) {
        this.saveBase(basePath, local)
        this.pending = undefined
        this.state.message = 'Senkron sırasında yerel kayıt değişti. Yeniden kontrol ediliyor…'
        this.schedule()
        return { ...this.status(), busy: false }
      }
      if (!sameVault(local, result.vault)) {
        mkdirSync(this.directory, { recursive: true, mode: 0o700 })
        writeFileSync(join(this.directory, 'before-drive-' + Date.now() + '.nodus'), this.store.encrypted(), { mode: 0o600, flag: 'wx' })
        this.applying = true
        try {
          const vault = this.store.update((current) => {
            const lastConnected = new Map(current.hosts.map((host) => [host.id, host.lastConnected]))
            current.hosts = result.vault.hosts.map((host) => ({ ...host, lastConnected: lastConnected.get(host.id) }))
            current.snippets = result.vault.snippets; current.knownHosts = result.vault.knownHosts
          })
          this.vaultChanged(vault)
        } finally { this.applying = false }
      }
      this.saveBase(basePath, result.vault)
      this.pending = undefined; this.state.conflicts = []
      this.state.lastSync = new Date().toISOString()
      this.state.message = 'Google Drive ile eşlendi. Değişiklikler otomatik gönderilir; 30 saniyede bir kontrol edilir.'
    } catch (error) {
      if (!controller.signal.aborted) this.state.message = error instanceof Error ? error.message : 'Google Drive senkronu başarısız.'
    } finally {
      this.state.busy = false
      if (this.controller === controller) this.controller = undefined
      this.emit()
    }
    return this.status()
  }
  async resolve(key: string, option: string): Promise<DriveStatus> {
    this.store.read()
    if (this.state.busy || !this.pending || !this.state.conflicts.some((conflict) => conflict.key === key && conflict.options.some((choice) => choice.id === option))) throw new Error('Çakışma değişti. Önce yeniden eşleyin.')
    this.pending.choices[key] = option
    return this.sync()
  }
  async restore(password: string): Promise<Vault> {
    if (this.store.exists) throw new Error('Drive üzerinden geri yükleme yalnızca yeni cihazda kullanılabilir.')
    if (this.state.busy || !this.transport) throw new Error('Önce Google Drive hesabına bağlanın ve devam eden işlemin bitmesini bekleyin.')
    const controller = new AbortController()
    this.controller = controller; this.state.busy = true; this.emit()
    try {
      const account = await this.transport.account(controller.signal)
      const remote = await this.transport.download(controller.signal)
      controller.signal.throwIfAborted()
      if (!remote) throw new Error('Bu Google hesabında Nodus kasası bulunamadı.')
      openWithPassword(remote.text, password)
      if (this.store.exists) throw new Error('Bu cihazda kasa zaten oluşturuldu.')
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      writeFileSync(this.store.path, remote.text, { mode: 0o600, flag: 'wx' })
      const vault = this.store.unlock(password, false)
      this.saveBase(this.checkpoint(account), vault)
      return vault
    } finally { this.state.busy = false; this.controller = undefined; this.emit() }
  }
}
