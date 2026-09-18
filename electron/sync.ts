import type { SyncSettings } from '../src/shared'
import { VaultStore } from './vault'

export function validateSync(settings: SyncSettings): void {
  if (!settings || ['url', 'username', 'password'].some((field) => typeof settings[field as keyof SyncSettings] !== 'string' || settings[field as keyof SyncSettings]!.length > 8192)) throw new Error('Geçersiz senkron ayarı.')
  if (!settings.url) return
  const url = new URL(settings.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Senkron için kullanıcı bilgisi içermeyen HTTPS dosya adresi gerekli.')
}
export async function synchronize(store: VaultStore, direction: 'push' | 'pull', signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const settings = store.read().sync
  validateSync(settings)
  if (!settings.url) throw new Error('Önce WebDAV dosya adresini kaydedin.')
  if (!['push', 'pull'].includes(direction)) throw new Error('Geçersiz senkron yönü.')
  const headers: Record<string, string> = {}
  if (settings.username || settings.password) headers.Authorization = 'Basic ' + Buffer.from(settings.username + ':' + settings.password).toString('base64')
  if (direction === 'push') {
    headers['Content-Type'] = 'application/json'
    if (settings.etag) headers['If-Match'] = settings.etag
    else headers['If-None-Match'] = '*'
  }
  const response = await fetch(settings.url, {
    method: direction === 'push' ? 'PUT' : 'GET', headers,
    body: direction === 'push' ? store.encrypted() : undefined,
    redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  })
  signal?.throwIfAborted()
  if (response.status === 412 || response.status === 409) throw new Error('Uzak kasa değişmiş veya zaten var. Önce indirip karşılaştırın; üzerine yazılmadı.')
  if (!response.ok) throw new Error('WebDAV yanıtı: HTTP ' + response.status)
  if (direction === 'pull') {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Sunucu boş kasa döndürdü.')
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const result = await reader.read()
      signal?.throwIfAborted()
      if (result.done) break
      size += result.value.byteLength
      if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('Uzak kasa çok büyük.') }
      chunks.push(result.value)
    }
    store.replaceEncrypted(Buffer.concat(chunks).toString('utf8'))
  } else { await response.body?.cancel() }
  const etag = response.headers.get('etag')
  signal?.throwIfAborted()
  store.update((vault) => { vault.sync.etag = etag && !etag.startsWith('W/') ? etag : undefined; vault.sync.lastSync = new Date().toISOString() })
}
