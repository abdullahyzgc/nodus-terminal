import type { UpdateStatus } from '../src/shared'

const repository = 'https://github.com/abdullahyzgc/nodus-terminal'
const latestReleaseAPI = 'https://api.github.com/repos/abdullahyzgc/nodus-terminal/releases/latest'

function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Geçersiz sürüm.')
  const parts = version.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error('Geçersiz sürüm.')
  return parts
}

export function macRelease(release: unknown, currentVersion: string, arch: string): { version: string; url: string } | null {
  if (!release || typeof release !== 'object' || Array.isArray(release)) throw new Error('Sürüm bilgisi okunamadı.')
  const data = release as Record<string, unknown>
  if (data.draft !== false || data.prerelease !== false) return null
  if (typeof data.tag_name !== 'string' || !data.tag_name.startsWith('v')) throw new Error('Geçersiz sürüm etiketi.')
  const version = data.tag_name.slice(1)
  const next = versionParts(version)
  const current = versionParts(currentVersion)
  const difference = next.map((part, index) => part - current[index]).find((part) => part !== 0) ?? 0
  if (difference <= 0 || !['arm64', 'x64'].includes(arch)) return null
  if (!Array.isArray(data.assets)) throw new Error('Paket listesi okunamadı.')
  const names = [`Nodus-${version}-mac-${arch}.dmg`, `Nodus-${version}-mac-universal.dmg`]
  const compatible = data.assets.some((asset: unknown) => {
    if (!asset || typeof asset !== 'object') return false
    const file = asset as Record<string, unknown>
    return names.includes(String(file.name)) && file.state === 'uploaded' && typeof file.size === 'number' && file.size > 0 && file.browser_download_url === `${repository}/releases/download/v${version}/${file.name}`
  })
  return compatible ? { version, url: `${repository}/releases/tag/v${version}` } : null
}

export async function fetchMacRelease(signal: AbortSignal, request: typeof fetch = fetch): Promise<unknown | null> {
  const response = await request(latestReleaseAPI, {
    signal, redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nodus', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (response.status === 404) { await response.body?.cancel(); return null }
  if (!response.ok) { await response.body?.cancel(); throw new Error('GitHub sürüm bilgisi alınamadı.') }
  if (Number(response.headers.get('content-length')) > 1024 * 1024) { await response.body?.cancel(); throw new Error('Sürüm yanıtı çok büyük.') }
  if (!response.body) throw new Error('Boş sürüm yanıtı.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > 1024 * 1024) throw new Error('Sürüm yanıtı çok büyük.')
      chunks.push(result.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export class MacUpdateService {
  private state: UpdateStatus
  private startup?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>
  private pending?: AbortController
  private stopped = false
  private downloadURL?: string
  private opening = false

  constructor(version: string, private readonly arch: string, private readonly changed: (state: UpdateStatus) => void, private readonly openExternal: (url: string) => Promise<void>, private readonly load: (signal: AbortSignal) => Promise<unknown | null> = fetchMacRelease) {
    this.state = { currentVersion: version, mode: 'manual', phase: 'idle', progress: 0, message: 'Yeni Mac sürümleri kontrol edilir; indirme ve kurulum elle yapılır.' }
  }
  status(): UpdateStatus { return { ...this.state } }
  private set(change: Partial<UpdateStatus>): void { this.state = { ...this.state, ...change }; this.changed(this.status()) }
  start(): void {
    if (this.interval) return
    this.stopped = false
    this.startup = setTimeout(() => { void this.check() }, 10000)
    this.interval = setInterval(() => { void this.check() }, 6 * 60 * 60 * 1000)
    this.startup.unref(); this.interval.unref()
  }
  stop(): void {
    this.stopped = true; this.pending?.abort()
    clearTimeout(this.startup); clearInterval(this.interval)
    this.startup = undefined; this.interval = undefined
  }
  async check(): Promise<UpdateStatus> {
    if (this.stopped || this.pending || this.opening) return this.status()
    const controller = new AbortController()
    this.pending = controller; this.downloadURL = undefined
    const timeout = setTimeout(() => controller.abort(), 15000)
    this.set({ phase: 'checking', nextVersion: undefined, message: 'Yeni Mac sürümü kontrol ediliyor…' })
    try {
      const release = await this.load(controller.signal)
      controller.signal.throwIfAborted()
      const available = release === null ? null : macRelease(release, this.state.currentVersion, this.arch)
      if (available) {
        this.downloadURL = available.url
        this.set({ phase: 'available', nextVersion: available.version, message: 'Yeni Mac sürümü var. İndirme sayfasından uygun DMG paketini indirip elle kurabilirsin.' })
      } else this.set({ phase: 'idle', message: 'Bu Mac için yayımlanmış daha yeni bir DMG paketi bulunamadı.' })
    } catch {
      if (!this.stopped) this.set({ phase: 'error', nextVersion: undefined, message: 'Mac sürümü kontrol edilemedi. İnternet bağlantısını kontrol edip tekrar dene; GitHub istek sınırına ulaşılmış olabilir.' })
    } finally { clearTimeout(timeout); if (this.pending === controller) this.pending = undefined }
    return this.status()
  }
  async openDownload(): Promise<UpdateStatus> {
    if (this.stopped || this.opening || this.state.phase !== 'available' || !this.downloadURL) return this.status()
    this.opening = true
    try {
      await this.openExternal(this.downloadURL)
      if (!this.stopped) this.set({ message: 'İndirme sayfası açıldı. DMG içinden Nodus’u Uygulamalar’a taşı. Değiştirmeden önce çalışmalarını kaydet ve Nodus’tan çık.' })
    } catch { if (!this.stopped) this.set({ message: 'İndirme sayfası açılamadı. İndir düğmesiyle tekrar deneyebilirsin.' }) }
    finally { this.opening = false }
    return this.status()
  }
  async install(): Promise<UpdateStatus> { return this.status() }
}
