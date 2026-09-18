import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Host } from '../src/shared'

export function validateRdpHost(host: Host): void {
  if (typeof host.hostname !== 'string' || host.hostname.length > 253 || !(isIP(host.hostname) || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host.hostname))) throw new Error('RDP adresi yalnızca IP adresi veya sunucu adı olmalı; portu ayrı alana gir.')
  if (typeof host.username !== 'string' || !host.username.trim() || host.username.length > 256 || /[\x00-\x1f\x7f]/.test(host.username)) throw new Error('Geçersiz RDP kullanıcı adı.')
  if (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535) throw new Error('Geçersiz RDP portu.')
  if (host.rdp !== undefined && (!host.rdp || typeof host.rdp.fullscreen !== 'boolean' || typeof host.rdp.clipboard !== 'boolean')) throw new Error('Geçersiz RDP ekran veya pano ayarı.')
}

export function rdpFile(host: Host): Buffer {
  if (host.protocol !== 'rdp') throw new Error('Bu kayıt RDP bağlantısı değil.')
  validateRdpHost(host)
  const address = isIP(host.hostname) === 6 ? '[' + host.hostname + ']' : host.hostname
  const lines = [
    'full address:s:' + address + ':' + host.port,
    'username:s:' + host.username,
    'screen mode id:i:' + (host.rdp?.fullscreen ? 2 : 1),
    'desktopwidth:i:1280',
    'desktopheight:i:800',
    'session bpp:i:32',
    'smart sizing:i:1',
    'prompt for credentials:i:1',
    'authentication level:i:1',
    'enablecredsspsupport:i:1',
    'redirectclipboard:i:' + (host.rdp?.clipboard ? 1 : 0),
    'redirectprinters:i:0',
    'redirectcomports:i:0',
    'redirectsmartcards:i:0',
    'redirectwebauthn:i:0',
    'drivestoredirect:s:',
    'devicestoredirect:s:',
    'usbdevicestoredirect:s:',
    'audiomode:i:2',
    'audiocapturemode:i:0',
    'disableconnectionsharing:i:1',
  ]
  return Buffer.from('\ufeff' + lines.join('\r\n') + '\r\n', 'utf16le')
}

export type RdpLaunch = (executable: string, args: string[]) => ChildProcess
const launchClient: RdpLaunch = (executable, args) => spawn(executable, args, { shell: false, windowsHide: false, detached: true, stdio: 'ignore' })

export class RdpLauncher {
  constructor(private readonly directory: string, private readonly executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'mstsc.exe'), private readonly platform: NodeJS.Platform = process.platform, private readonly launch: RdpLaunch = launchClient) {}
  async open(host: Host): Promise<void> {
    if (this.platform !== 'win32') throw new Error('RDP açma şu anda yalnızca Windows üzerinde destekleniyor.')
    if (!existsSync(this.executable)) throw new Error('Windows Uzak Masaüstü istemcisi (mstsc.exe) bulunamadı.')
    const content = rdpFile(host)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const path = join(this.directory, randomUUID() + '.rdp')
    const cleanup = () => { try { unlinkSync(path) } catch {} }
    try {
      writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
      await new Promise<void>((resolve, reject) => {
        const child = this.launch(this.executable, [path])
        child.once('error', () => { cleanup(); reject(new Error('Uzak Masaüstü penceresi açılamadı.')) })
        child.once('exit', cleanup)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    } catch (error) { cleanup(); throw error }
  }
}
