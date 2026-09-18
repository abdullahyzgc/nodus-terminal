import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DriveStatus, Vault } from '../src/shared'
import { DriveSync } from './drive-sync'
import { authorizeGoogle, GoogleDrive, parseGoogleConfig, type GoogleConfig, type GoogleTokens } from './google-drive'
import type { VaultStore } from './vault'

export class DriveService {
  readonly sync: DriveSync
  private config?: GoogleConfig
  private tokens?: GoogleTokens
  private authorization?: AbortController
  private notice = ''
  private readonly path: string
  constructor(store: VaultStore, private directory: string, private changed: (status: DriveStatus) => void, vaultChanged: (vault: Vault) => void, canRun: () => boolean) {
    this.path = join(directory, 'google-drive.bin')
    this.sync = new DriveSync(store, directory, () => this.emit(), vaultChanged, canRun)
  }
  status(): DriveStatus {
    const status = this.sync.status()
    return { ...status, busy: status.busy || !!this.authorization, message: this.authorization ? 'Tarayıcıda Google hesabını seçip izin verin…' : this.notice || status.message }
  }
  private emit(): void { this.changed(this.status()) }
  private persist(config: GoogleConfig, tokens?: GoogleTokens): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Google bağlantısı için işletim sisteminin güvenli saklama hizmeti gerekli.')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    writeFileSync(this.path + '.tmp', safeStorage.encryptString(JSON.stringify({ config, tokens })), { mode: 0o600 })
    renameSync(this.path + '.tmp', this.path)
  }
  private attach(): void {
    const config = this.config!
    this.sync.attach(new GoogleDrive(config, this.tokens!, (tokens) => { this.persist(config, tokens); this.tokens = tokens }))
  }
  initialize(): void {
    if (!existsSync(this.path)) return
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Google bağlantısı için güvenli saklama hizmeti kullanılamıyor.')
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(this.path)))
      this.config = parseGoogleConfig(JSON.stringify({ installed: saved.config }))
      this.sync.configure(true)
      if (saved.tokens) {
        if (typeof saved.tokens.refresh_token !== 'string' || !saved.tokens.refresh_token || typeof saved.tokens.access_token !== 'string' || !Number.isFinite(saved.tokens.expires_at)) throw new Error('Kayıtlı Google oturumu geçersiz. Yeniden bağlanın.')
        this.tokens = saved.tokens
        this.attach()
      }
    } catch (error) { this.notice = error instanceof Error ? error.message : 'Google bağlantısı açılamadı.'; this.emit() }
  }
  configure(text: string): DriveStatus {
    if (this.status().busy || this.status().connected) throw new Error('OAuth ayarını değiştirmeden önce Google bağlantısını kesin.')
    const config = parseGoogleConfig(text)
    this.persist(config)
    this.config = config; this.tokens = undefined; this.notice = ''
    this.sync.configure(true)
    return this.status()
  }
  async connect(openBrowser: (url: string) => Promise<void>): Promise<DriveStatus> {
    if (!this.config) throw new Error('Önce Google OAuth JSON dosyasını seçin.')
    if (this.status().busy) throw new Error('Devam eden Google işlemini bekleyin.')
    if (this.status().connected) return this.status()
    const controller = new AbortController()
    this.authorization = controller; this.notice = ''; this.emit()
    try {
      const tokens = await authorizeGoogle(this.config, openBrowser, controller.signal)
      controller.signal.throwIfAborted()
      this.persist(this.config, tokens); this.tokens = tokens
      this.attach()
    } finally { this.authorization = undefined; this.emit() }
    return this.status()
  }
  disconnect(): DriveStatus {
    if (this.sync.status().busy) throw new Error('Devam eden senkron işlemini bekleyin.')
    this.authorization?.abort()
    if (this.config) this.persist(this.config)
    this.tokens = undefined; this.notice = ''; this.sync.detach()
    return this.status()
  }
  stop(): void { this.authorization?.abort(); this.sync.stop() }
}
