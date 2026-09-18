import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
export type GoogleConfig = { client_id: string; client_secret: string }
export type GoogleTokens = { refresh_token: string; access_token: string; expires_at: number }
export type RemoteVault = { id: string; etag: string; text: string }
const API = 'https://www.googleapis.com/drive/v3'
const FILE_NAME = 'nodus-vault-v1.nodus'

export function parseGoogleConfig(text: string): GoogleConfig {
  const config = JSON.parse(text)?.installed
  if (!config || typeof config.client_id !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.client_id) || typeof config.client_secret !== 'string' || !config.client_secret || config.client_secret.length > 4096) throw new Error('Google Cloud üzerinden indirilen Masaüstü uygulaması OAuth JSON dosyasını seçin.')
  return { client_id: config.client_id, client_secret: config.client_secret }
}

export async function limitedText(response: Response, limit = 16 * 1024 * 1024): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Drive yanıtı çok büyük.') }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Drive boş yanıt döndürdü.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > limit) throw new Error('Drive yanıtı çok büyük.')
      chunks.push(result.value)
    }
  } catch (error) { await reader.cancel(); throw error }
  return Buffer.concat(chunks).toString('utf8')
}

export async function authorizeGoogle(config: GoogleConfig, openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<GoogleTokens> {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  void codePromise.catch(() => {})
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET' || url.pathname !== '/oauth/callback' || url.searchParams.get('state') !== state) { response.writeHead(400).end('Geçersiz OAuth yanıtı.'); return }
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.has('error')) { response.end('Google bağlantısı iptal edildi. Nodus uygulamasına dönebilirsiniz.'); rejectCode(new Error('Google bağlantısı iptal edildi.')); return }
    response.end('Google izni alındı. Nodus uygulamasına dönebilirsiniz.')
    resolveCode(code)
  })
  const abort = () => rejectCode(new Error('Google bağlantısı iptal edildi veya zaman aşımına uğradı.'))
  const timer = setTimeout(abort, 180000)
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/callback`
    const params = new URLSearchParams({ client_id: config.client_id, redirect_uri: redirect, response_type: 'code', scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
    await openBrowser('https://accounts.google.com/o/oauth2/v2/auth?' + params)
    const code = await codePromise
    return exchangeTokens(config, { code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }, signal)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    server.closeAllConnections()
    server.close()
  }
}

async function exchangeTokens(config: GoogleConfig, values: Record<string, string>, signal: AbortSignal): Promise<GoogleTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ ...config, ...values }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
  const result = JSON.parse(await limitedText(response, 65536))
  if (!response.ok) throw new Error(result.error === 'invalid_grant' ? 'Google izni sona erdi. Bağlantıyı kesip yeniden bağlanın.' : 'Google oturumu alınamadı: HTTP ' + response.status)
  if (result.scope && !result.scope.split(' ').includes(DRIVE_SCOPE)) throw new Error('Google Drive uygulama verisi izni verilmedi.')
  const refresh = result.refresh_token || values.refresh_token
  if (typeof result.access_token !== 'string' || typeof refresh !== 'string' || !refresh || !Number.isFinite(result.expires_in)) throw new Error('Google geçerli oturum bilgisi döndürmedi.')
  return { access_token: result.access_token, refresh_token: refresh, expires_at: Date.now() + result.expires_in * 1000 }
}

export class GoogleDrive {
  constructor(private config: GoogleConfig, private tokens: GoogleTokens, private saveTokens: (tokens: GoogleTokens) => void) {}
  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted()
      if (this.tokens.expires_at < Date.now() + 60000) {
        const tokens = await exchangeTokens(this.config, { grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token }, signal)
        signal.throwIfAborted()
        this.saveTokens(tokens); this.tokens = tokens
      }
      const headers = new Headers(init.headers)
      headers.set('Authorization', 'Bearer ' + this.tokens.access_token)
      const response = await fetch(path, { ...init, headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); this.tokens.expires_at = 0; continue }
      if (response.status === 409 || response.status === 412) { await response.body?.cancel(); throw new Error('Drive başka cihazda değişti. Sonraki kontrolde yeniden birleştirilecek; üzerine yazılmadı.') }
      if (!response.ok) { await response.body?.cancel(); throw new Error('Google Drive yanıtı: HTTP ' + response.status) }
      return response
    }
    throw new Error('Google bağlantısını yenileyin.')
  }
  async account(signal: AbortSignal): Promise<string> {
    const response = await this.request(API + '/about?fields=user(permissionId)', {}, signal)
    const result = JSON.parse(await limitedText(response, 65536))
    if (typeof result.user?.permissionId !== 'string' || !result.user.permissionId) throw new Error('Google hesap kimliği alınamadı.')
    return this.config.client_id + ':' + result.user.permissionId
  }
  async download(signal: AbortSignal): Promise<RemoteVault | undefined> {
    const params = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${FILE_NAME}' and trashed = false`, fields: 'files(id,md5Checksum),nextPageToken', pageSize: '100' })
    const list = JSON.parse(await limitedText(await this.request(API + '/files?' + params, {}, signal), 65536))
    if (!Array.isArray(list.files)) throw new Error('Geçersiz Drive dosya listesi.')
    if (list.files.length > 1 || list.nextPageToken) throw new Error('Drive üzerinde birden fazla Nodus kasası var. Veri kaybını önlemek için senkron durduruldu; kasaları önce yedekleyip tek kasaya indirin.')
    if (!list.files.length) return undefined
    const id = list.files[0].id
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Geçersiz Drive dosya kimliği.')
    const md5 = list.files[0].md5Checksum
    if (typeof md5 !== 'string' || !/^[a-f0-9]{32}$/.test(md5)) throw new Error('Drive dosya saglamatoplami alinamadi; guvenli senkron yapilamiyor.')
    const response = await this.request(API + '/files/' + id + '?alt=media', {}, signal)
    return { id, etag: md5, text: await limitedText(response) }
  }
  async upload(text: string, remote: RemoteVault | undefined, signal: AbortSignal): Promise<void> {
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Kasa çok büyük.')
    if (remote) {
      const chkP = new URLSearchParams({ spaces: 'appDataFolder', q: "name = '" + FILE_NAME + "' and trashed = false", fields: 'files(id,md5Checksum)', pageSize: '2' })
      const chkL = JSON.parse(await limitedText(await this.request(API + '/files?' + chkP, {}, signal), 65536))
      const curMd5 = Array.isArray(chkL.files) && chkL.files.find((f: { id: string }) => f.id === remote.id)?.md5Checksum
      if (curMd5 !== remote.etag) throw new Error('Drive başka cihazda değişti. Sonraki kontrolde yeniden birleştirilecek; üzerine yazılmadı.')
      const response = await this.request('https://www.googleapis.com/upload/drive/v3/files/' + remote.id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }, signal)
      await response.body?.cancel()
    } else {
      const boundary = 'nodus-' + randomBytes(24).toString('hex')
      const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' })
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--\r\n`
      const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body }, signal)
      await response.body?.cancel()
    }
  }
}


