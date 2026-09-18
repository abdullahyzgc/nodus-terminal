import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Host, Snippet, Vault } from '../src/shared'

type Envelope = { version: 1; salt: string; iv: string; tag: string; data: string }
export const emptyVault = (): Vault => ({
  version: 1, hosts: [], knownHosts: {}, sync: { url: '', username: '', password: '' },
  snippets: [
    { id: 'laravel-clear', name: 'Laravel önbellek temizle', command: 'php artisan optimize:clear', group: 'Laravel', confirm: false },
    { id: 'disk-usage', name: 'Disk kullanımını göster', command: 'df -h', group: 'Sistem', confirm: false },
    { id: 'docker-status', name: 'Çalışan container’lar', command: 'docker ps', group: 'Docker', confirm: false },
  ],
})

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}
export function parseEnvelope(text: string): Envelope {
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Kasa dosyası çok büyük.')
  const envelope = JSON.parse(text)
  if (!envelope || envelope.version !== 1 || !['salt', 'iv', 'tag', 'data'].every((field) => typeof envelope[field] === 'string')) throw new Error('Geçersiz kasa biçimi.')
  if (Buffer.from(envelope.salt, 'base64').length !== 16 || Buffer.from(envelope.iv, 'base64').length !== 12 || Buffer.from(envelope.tag, 'base64').length !== 16) throw new Error('Geçersiz kasa başlığı.')
  return envelope
}
export function encryptVault(vault: Vault, key: Buffer, salt: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('nodus-vault-v1'))
  const data = Buffer.concat([cipher.update(JSON.stringify(vault), 'utf8'), cipher.final()])
  return JSON.stringify({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
}
export function validateHost(host: Host): void {
  if (host && ((host.production !== undefined && typeof host.production !== 'boolean') || (host.persistentSession !== undefined && typeof host.persistentSession !== 'boolean'))) throw new Error('Geçersiz sunucu koruma ayarı.')
  if (!host || typeof host.id !== 'string' || !/^[\w-]{1,80}$/.test(host.id)) throw new Error('Geçersiz sunucu kimliği.')
  for (const field of ['name', 'hostname', 'username', 'group', 'color', 'password', 'privateKey', 'passphrase', 'initialPath'] as const) {
    if (typeof host[field] !== 'string' || host[field].length > (field === 'privateKey' ? 65536 : 4096)) throw new Error('Geçersiz sunucu alanı: ' + field)
  }
  if (!host.name.trim() || !host.hostname.trim() || !host.username.trim() || /[\x00-\x20]/.test(host.hostname) || /[\x00\r\n]/.test(host.username)) throw new Error('Sunucu adı, adresi ve kullanıcı gerekli.')
  if (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535 || !['password', 'key'].includes(host.authType)) throw new Error('Port veya giriş yöntemi geçersiz.')
  if (typeof host.favorite !== 'boolean' || typeof host.followDirectory !== 'boolean' || /[\x00-\x1f\x7f]/.test(host.initialPath)) throw new Error('Geçersiz sunucu seçeneği.')
}
export function validateSnippet(snippet: Snippet): void {
  if (snippet && snippet.workflow !== undefined && typeof snippet.workflow !== 'boolean') throw new Error('Geçersiz akış ayarı.')
  if (!snippet || typeof snippet.id !== 'string' || !/^[\w-]{1,80}$/.test(snippet.id) || typeof snippet.name !== 'string' || !snippet.name.trim() || snippet.name.length > 200 || typeof snippet.command !== 'string' || !snippet.command.trim() || snippet.command.length > 16384 || typeof snippet.group !== 'string' || snippet.group.length > 200 || typeof snippet.confirm !== 'boolean') throw new Error('Geçersiz kestirme.')
}
export function validateVault(value: Vault): Vault {
  if (!value || value.version !== 1 || !Array.isArray(value.hosts) || !Array.isArray(value.snippets) || value.hosts.length > 5000 || value.snippets.length > 5000) throw new Error('Geçersiz kasa içeriği.')
  value.hosts.forEach(validateHost)
  value.snippets.forEach(validateSnippet)
  if (new Set(value.hosts.map((host) => host.id)).size !== value.hosts.length || new Set(value.snippets.map((snippet) => snippet.id)).size !== value.snippets.length) throw new Error('Kasa içinde yinelenen kimlik.')
  if (!value.knownHosts || typeof value.knownHosts !== 'object' || Array.isArray(value.knownHosts) || Object.entries(value.knownHosts).some(([hostname, fingerprint]) => hostname.length > 1000 || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint))) throw new Error('Geçersiz sunucu parmak izi.')
  if (!value.sync || ['url', 'username', 'password'].some((field) => typeof value.sync[field as keyof typeof value.sync] !== 'string')) throw new Error('Geçersiz senkron ayarı.')
  return value
}
export function decryptVault(text: string, key: Buffer): Vault {
  const envelope = parseEnvelope(text)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from('nodus-vault-v1'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return validateVault(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')))
}
export class VaultStore {
  private key?: Buffer
  private salt?: Buffer
  private content?: Vault
  private password?: string
  onChange?: () => void
  constructor(readonly path: string) {}
  get exists(): boolean { return existsSync(this.path) }
  get unlocked(): boolean { return !!this.content }
  unlock(password: string, create: boolean): Vault {
    if (this.unlocked) throw new Error('Kasa zaten açık.')
    if (create && this.exists) throw new Error('Kasa zaten var.')
    if (typeof password !== 'string' || password.length > 4096 || (create && password.length < 12)) throw new Error('Kasa parolası en az 12 karakter olmalı.')
    if (!create && !this.exists) throw new Error('Kasa bulunamadı.')
    const text = create ? '' : readFileSync(this.path, 'utf8')
    const salt = create ? randomBytes(16) : Buffer.from(parseEnvelope(text).salt, 'base64')
    const key = deriveKey(password, salt)
    let content: Vault
    try { content = create ? emptyVault() : decryptVault(text, key) }
    catch { key.fill(0); throw new Error('Kasa parolası yanlış veya dosya hasarlı.') }
    this.salt = salt; this.key = key; this.content = content; this.password = password
    if (create) { try { this.save() } catch (error) { this.lock(); throw error } }
    return this.read()
  }
  read(): Vault {
    if (!this.content || !this.key) throw new Error('Kasa kilitli.')
    return structuredClone(this.content)
  }
  update(mutate: (vault: Vault) => void): Vault {
    const next = this.read()
    mutate(next); validateVault(next); this.save(next); this.content = next; this.onChange?.()
    return this.read()
  }
  private save(content = this.content): void {
    if (!content || !this.key || !this.salt) throw new Error('Kasa kilitli.')
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = this.path + '.tmp'
    writeFileSync(temporary, encryptVault(content, this.key, this.salt), { mode: 0o600 })
    renameSync(temporary, this.path)
  }
  encrypted(): string {
    const content = this.read()
    content.sync = { url: '', username: '', password: '' }
    return encryptVault(content, this.key!, this.salt!)
  }
  replaceEncrypted(text: string): Vault {
    this.read()
    const envelope = parseEnvelope(text)
    if (!timingSafeEqual(Buffer.from(envelope.salt, 'base64'), this.salt!)) throw new Error('Farklı kasa. Yeni cihazda önce aynı kasa yedeğini içe aktarın.')
    const incoming = decryptVault(text, this.key!)
    incoming.sync = this.read().sync
    return this.update((vault) => Object.assign(vault, incoming))
  }
  seal(content: Vault): string {
    this.read()
    return encryptVault(validateVault(content), this.key!, this.salt!)
  }
  sealLocal(text: string, context: string): string {
    this.read()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key!, iv)
    cipher.setAAD(Buffer.from('nodus-local-v1:' + context))
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
  }
  openLocal(text: string, context: string): string {
    this.read()
    const envelope = JSON.parse(text)
    const decipher = createDecipheriv('aes-256-gcm', this.key!, Buffer.from(envelope.iv, 'base64'))
    decipher.setAAD(Buffer.from('nodus-local-v1:' + context))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')
  }
  open(text: string): Vault {
    this.read()
    const salt = Buffer.from(parseEnvelope(text).salt, 'base64')
    if (timingSafeEqual(salt, this.salt!)) return decryptVault(text, this.key!)
    return openWithPassword(text, this.password!)
  }
  lock(): void { this.key?.fill(0); this.key = undefined; this.salt = undefined; this.content = undefined; this.password = undefined }
}

export function openWithPassword(text: string, password: string): Vault {
  if (typeof password !== 'string' || !password.length || password.length > 4096) throw new Error('Geçersiz kasa parolası.')
  const key = deriveKey(password, Buffer.from(parseEnvelope(text).salt, 'base64'))
  try { return decryptVault(text, key) }
  catch { throw new Error('Kasa parolası yanlış veya dosya hasarlı.') }
  finally { key.fill(0) }
}
