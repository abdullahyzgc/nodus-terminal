import type { UpdateStatus } from '../src/shared'

export interface UpdateEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export class UpdateService {
  private state: UpdateStatus
  private busy = false
  private confirming = false
  private startup?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>

  constructor(private readonly engine: UpdateEngine, version: string, enabled: boolean, private readonly changed: (state: UpdateStatus) => void, private readonly confirm: () => Promise<boolean>, private readonly prepare: () => void) {
    this.state = { currentVersion: version, phase: enabled ? 'idle' : 'disabled', progress: 0, message: enabled ? 'Yeni sürümler otomatik kontrol edilir.' : 'Otomatik güncelleme yalnızca kurulu Windows sürümünde kullanılabilir.' }
    engine.autoDownload = false
    engine.autoInstallOnAppQuit = false
    engine.allowPrerelease = false
    engine.allowDowngrade = false
    engine.on('update-available', (info: { version: string }) => {
      if (this.state.phase === 'checking') this.set({ phase: 'downloading', nextVersion: info.version, progress: 0, message: 'Yeni sürüm indiriliyor. Çalışmaya devam edebilirsin.' })
    })
    engine.on('update-not-available', () => {
      if (this.state.phase === 'checking') this.set({ phase: 'idle', nextVersion: undefined, message: 'En güncel sürüm kullanılıyor.' })
    })
    engine.on('download-progress', (info: { percent: number }) => {
      if (this.state.phase === 'downloading' && Number.isFinite(info.percent)) this.set({ progress: Math.max(0, Math.min(100, Math.round(info.percent))) })
    })
    engine.on('update-downloaded', (info: { version: string }) => {
      if (this.state.phase === 'downloading') this.set({ phase: 'ready', nextVersion: info.version, progress: 100, message: 'Güncelleme hazır. Uygulamak için yeniden başlat.' })
    })
    engine.on('error', () => this.fail())
  }

  status(): UpdateStatus { return { ...this.state } }
  private set(change: Partial<UpdateStatus>): void { this.state = { ...this.state, ...change }; this.changed(this.status()) }
  private fail(): void {
    if (this.state.phase !== 'disabled') this.set({ phase: 'error', progress: 0, message: 'Güncelleme tamamlanamadı. İnternet bağlantısını ve yayımlanmış sürümü kontrol edip yeniden dene.' })
  }
  start(): void {
    if (this.state.phase === 'disabled' || this.interval) return
    this.startup = setTimeout(() => { void this.check() }, 10000)
    this.interval = setInterval(() => { void this.check() }, 6 * 60 * 60 * 1000)
    this.startup.unref(); this.interval.unref()
  }
  stop(): void { clearTimeout(this.startup); clearInterval(this.interval); this.startup = undefined; this.interval = undefined }
  async check(): Promise<UpdateStatus> {
    if (this.busy || !['idle', 'error'].includes(this.state.phase)) return this.status()
    this.busy = true
    this.set({ phase: 'checking', nextVersion: undefined, progress: 0, message: 'Yeni sürüm kontrol ediliyor…' })
    try {
      await this.engine.checkForUpdates()
      if (this.status().phase === 'downloading') await this.engine.downloadUpdate()
      if (['checking', 'downloading'].includes(this.status().phase)) this.fail()
    } catch { this.fail() }
    finally { this.busy = false }
    return this.status()
  }
  async install(): Promise<UpdateStatus> {
    if (this.state.phase !== 'ready' || this.confirming) return this.status()
    this.confirming = true
    try {
      if (!await this.confirm() || this.status().phase !== 'ready') return this.status()
      this.prepare()
      this.set({ phase: 'installing', message: 'Güncelleme kuruluyor; uygulama yeniden açılacak.' })
      this.engine.quitAndInstall(false, true)
    } catch {
      this.set({ phase: 'ready', message: 'Kurulum başlatılamadı. Yedek için boş alanı ve dosya izinlerini kontrol edip yeniden dene.' })
    } finally { this.confirming = false }
    return this.status()
  }
}
