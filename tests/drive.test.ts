import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DriveSync, type DriveTransport } from '../electron/drive-sync'
import { mergeVaults, portableVault, sameVault } from '../electron/drive-merge'
import { GoogleDrive, parseGoogleConfig, limitedText, type RemoteVault } from '../electron/google-drive'
import { emptyVault, openWithPassword, VaultStore } from '../electron/vault'

const password = 'drive-test-password-only'

class MemoryDrive implements DriveTransport {
  remote?: RemoteVault
  uploads = 0
  downloads = 0
  fail = false
  duringUpload?: () => void
  async account(): Promise<string> { return 'test-client:test-account' }
  async download(): Promise<RemoteVault | undefined> {
    this.downloads++
    if (this.fail) throw new Error('offline')
    return this.remote && { ...this.remote }
  }
  async upload(text: string, remote: RemoteVault | undefined, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    assert.equal(remote?.etag, this.remote?.etag)
    this.remote = { id: 'test-file', etag: '"' + ++this.uploads + '"', text }
    this.duringUpload?.()
  }
}

function device(context: TestContext, transport: DriveTransport, create = true, secret = password) {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-drive-test-'))
  const store = new VaultStore(join(directory, 'vault.nodus'))
  if (create) store.unlock(secret, true)
  let applied = 0
  const sync = new DriveSync(store, directory, () => {}, () => { applied++ })
  store.onChange = () => sync.schedule()
  sync.attach(transport)
  context.after(() => { sync.stop(); store.lock() })
  return { directory, store, sync, applied: () => applied }
}

test('independent vaults with same password merge, send only ciphertext and preserve local settings', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  const second = device(context, remote)
  first.store.update((vault) => {
    vault.snippets.push({ id: 'first', name: 'First', command: 'private-marker', group: '', confirm: false })
    vault.sync = { url: 'https://example.com/file', username: 'local-user', password: 'local-secret' }
  })
  assert.ok((await first.sync.sync()).lastSync)
  assert.ok(!remote.remote!.text.includes('private-marker'))
  assert.equal(openWithPassword(remote.remote!.text, password).sync.password, '')
  second.store.update((vault) => { vault.snippets.push({ id: 'second', name: 'Second', command: 'pwd', group: '', confirm: false }) })
  assert.equal((await second.sync.sync()).conflicts.length, 0)
  await first.sync.sync()
  assert.ok(sameVault(first.store.read(), second.store.read()))
  assert.equal(first.store.read().sync.password, 'local-secret')
  assert.equal(first.store.read().snippets.length, 5)
  assert.ok(first.applied() > 0)
  const backup = readdirSync(first.directory).find((name) => name.startsWith('before-drive-'))!
  assert.equal(openWithPassword(readFileSync(join(first.directory, backup), 'utf8'), password).snippets.length, 4)
  const uploads = remote.uploads
  await first.sync.sync()
  assert.equal(remote.uploads, uploads)
})

test('wrong vault password never overwrites either device or remote', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  await first.sync.sync()
  const second = device(context, remote, true, 'different-password-only')
  const before = second.store.read()
  const ciphertext = remote.remote!.text
  const status = await second.sync.sync()
  assert.match(status.message, /parolası yanlış/)
  assert.equal(status.busy, false)
  assert.equal(remote.remote!.text, ciphertext)
  assert.deepEqual(second.store.read(), before)
})

test('restore checks password before creating local vault and remembers base for later deletion', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  await first.sync.sync()
  const second = device(context, remote, false)
  await assert.rejects(second.sync.restore('wrong-password'), /parolası yanlış/)
  assert.equal(second.store.exists, false)
  await second.sync.restore(password)
  assert.ok(sameVault(first.store.read(), second.store.read()))
  first.store.update((vault) => { vault.snippets.shift() })
  await first.sync.sync()
  await second.sync.sync()
  assert.ok(sameVault(first.store.read(), second.store.read()))
  assert.equal(second.store.read().snippets.length, 2)
  await assert.rejects(second.sync.restore(password), /yalnızca yeni cihazda/)
})

test('conflicting edits stop writes and return usable resolution controls', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  const second = device(context, remote)
  await first.sync.sync(); await second.sync.sync()
  first.store.update((vault) => { vault.snippets[0].command = 'first change' })
  second.store.update((vault) => { vault.snippets[0].command = 'second change' })
  await first.sync.sync()
  const ciphertext = remote.remote!.text
  const status = await second.sync.sync()
  assert.equal(status.busy, false)
  assert.equal(status.conflicts.length, 1)
  assert.equal(remote.remote!.text, ciphertext)
  assert.equal(second.store.read().snippets[0].command, 'second change')
  const resolved = await second.sync.resolve(status.conflicts[0].key, 'remote')
  assert.equal(resolved.busy, false)
  assert.equal(resolved.conflicts.length, 0)
  assert.equal(second.store.read().snippets[0].command, 'first change')
})

test('three-way merge propagates deletions but asks about deletion versus edit', () => {
  const base = emptyVault()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.snippets.shift()
  assert.equal(mergeVaults(base, local, remote).vault.snippets.length, 2)
  remote.snippets[0].command = 'changed remotely'
  const conflict = mergeVaults(base, local, remote)
  assert.equal(conflict.conflicts.length, 1)
  assert.equal(mergeVaults(base, local, remote, { [conflict.conflicts[0].key]: 'remote' }).vault.snippets.length, 3)
  assert.equal(mergeVaults(base, local, remote, { [conflict.conflicts[0].key]: 'local' }).vault.snippets.length, 2)
})

test('offline edits survive and removed remote vault is not recreated silently', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  await first.sync.sync()
  remote.fail = true
  first.store.update((vault) => { vault.snippets[0].command = 'offline edit' })
  assert.match((await first.sync.sync()).message, /offline/)
  remote.fail = false
  await first.sync.sync()
  assert.equal(openWithPassword(remote.remote!.text, password).snippets[0].command, 'offline edit')
  remote.remote = undefined
  assert.match((await first.sync.sync()).message, /kaldırılmış/)
  assert.equal(remote.remote, undefined)
})

test('local edits during upload remain intact and sync can be retried', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  await first.sync.sync()
  first.store.update((vault) => { vault.snippets[0].command = 'upload snapshot' })
  remote.duringUpload = () => { first.store.update((vault) => { vault.snippets[1].command = 'edit during upload' }); remote.duringUpload = undefined }
  assert.equal((await first.sync.sync()).busy, false)
  assert.equal(first.store.read().snippets[1].command, 'edit during upload')
  await first.sync.sync()
  assert.equal(openWithPassword(remote.remote!.text, password).snippets[1].command, 'edit during upload')
})

test('editing the uploading record again does not create a false conflict', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  await first.sync.sync()
  first.store.update((vault) => { vault.snippets[0].command = 'upload snapshot' })
  remote.duringUpload = () => {
    first.store.update((vault) => { vault.snippets[0].command = 'newer local edit' })
    remote.duringUpload = undefined
  }
  await first.sync.sync()
  assert.equal(first.store.read().snippets[0].command, 'newer local edit')
  assert.equal((await first.sync.sync()).conflicts.length, 0)
  assert.equal(openWithPassword(remote.remote!.text, password).snippets[0].command, 'newer local edit')
})

test('upload-time edits preserve remote changes and deletions on retry', async (context) => {
  const remote = new MemoryDrive()
  const first = device(context, remote)
  await first.sync.sync()
  const second = device(context, remote)
  await second.sync.sync()
  second.store.update((vault) => {
    vault.snippets[1].command = 'remote edit'
    vault.snippets.splice(2, 1)
  })
  await second.sync.sync()
  first.store.update((vault) => { vault.snippets[0].command = 'upload snapshot' })
  remote.duringUpload = () => {
    first.store.update((vault) => { vault.snippets[0].command = 'newer local edit' })
    remote.duringUpload = undefined
  }
  await first.sync.sync()
  assert.equal((await first.sync.sync()).conflicts.length, 0)
  const merged = openWithPassword(remote.remote!.text, password)
  assert.equal(merged.snippets[0].command, 'newer local edit')
  assert.equal(merged.snippets[1].command, 'remote edit')
  assert.equal(merged.snippets.length, 2)
  assert.ok(sameVault(first.store.read(), merged))
})

test('automatic sync debounces edits, polls each 30 seconds and stops while locked', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const remote = new MemoryDrive()
  const first = device(context, remote)
  const settle = async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve() }
  context.mock.timers.tick(1500); await settle()
  assert.equal(remote.uploads, 1)
  first.store.update((vault) => { vault.snippets[0].command = 'automatic change' })
  context.mock.timers.tick(1000)
  first.store.update((vault) => { vault.snippets[0].command = 'last automatic change' })
  context.mock.timers.tick(1499); await settle()
  assert.equal(remote.uploads, 1)
  context.mock.timers.tick(1); await settle()
  assert.equal(remote.uploads, 2)
  const downloads = remote.downloads
  context.mock.timers.tick(30000); await settle()
  assert.ok(remote.downloads > downloads)
  first.sync.stop(); first.store.lock()
  const stopped = remote.downloads
  context.mock.timers.tick(60000); await settle()
  assert.equal(remote.downloads, stopped)
})

test('Google config accepts only desktop OAuth and responses have size limits', async () => {
  const config = { client_id: 'test.apps.googleusercontent.com', client_secret: 'test-secret' }
  assert.deepEqual(parseGoogleConfig(JSON.stringify({ installed: config })), config)
  assert.throws(() => parseGoogleConfig(JSON.stringify({ web: config })))
  await assert.rejects(limitedText(new Response('too long'), 3), /çok büyük/)
  await assert.rejects(limitedText(new Response('short', { headers: { 'content-length': '9999' } }), 100), /çok büyük/)
})

test('Google transport uses appDataFolder, conditional writes and rejects duplicate vaults', async (context) => {
  const requests: { url: string; init: RequestInit }[] = []
  let duplicate = false
  let conflict = false
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    requests.push({ url, init })
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer access')
    if (init.method === 'PATCH') return new Response('', { status: 200 })
    if (url.includes('alt=media')) return new Response('encrypted')
    if (url.includes('/about?')) return Response.json({ user: { permissionId: 'account' } })
    return Response.json({ files: duplicate ? [{ id: 'first', md5Checksum: 'a' + 'b'.repeat(31) }, { id: 'second', md5Checksum: 'c' + 'd'.repeat(31) }] : [{ id: 'first', md5Checksum: conflict ? 'changed' + '0'.repeat(25) : 'a'.repeat(32) }] })
  })
  const drive = new GoogleDrive({ client_id: 'test.apps.googleusercontent.com', client_secret: 'secret' }, { access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 3600000 }, () => {})
  const signal = new AbortController().signal
  assert.equal(await drive.account(signal), 'test.apps.googleusercontent.com:account')
  const remote = await drive.download(signal)
  assert.equal(remote!.text, 'encrypted')
  assert.equal(new URL(requests[1].url).searchParams.get('spaces'), 'appDataFolder')
  await drive.upload('new ciphertext', remote, signal)
  conflict = true
  await assert.rejects(drive.upload('stale ciphertext', remote, signal), /üzerine yazılmadı/)
  duplicate = true
  await assert.rejects(drive.download(signal), /birden fazla/)
})


