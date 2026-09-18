import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VaultStore, emptyVault, encryptVault, decryptVault, parseEnvelope } from '../electron/vault'
import { CwdTracker, remotePath, shellQuote } from '../electron/ssh'
import { synchronize, validateSync } from '../electron/sync'

test('authenticated encryption rejects wrong keys and modified ciphertext', () => {
  const key = randomBytes(32)
  const encrypted = encryptVault(emptyVault(), key, randomBytes(16))
  assert.deepEqual(decryptVault(encrypted, key), emptyVault())
  assert.throws(() => decryptVault(encrypted, randomBytes(32)))
  const envelope = parseEnvelope(encrypted)
  const ciphertext = Buffer.from(envelope.data, 'base64')
  ciphertext[0] ^= 1
  assert.throws(() => decryptVault(JSON.stringify({ ...envelope, data: ciphertext.toString('base64') }), key))
  assert.notEqual(encryptVault(emptyVault(), key, randomBytes(16)), encrypted)
})

test('vault persists encrypted, locks, rejects bad passwords and invalid updates', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'nodus-test-')), 'vault.nodus')
  const store = new VaultStore(path)
  assert.throws(() => store.unlock('short', true))
  store.unlock('test-vault-password', true)
  store.update((vault) => { vault.snippets[0].command = 'private-marker-secret' })
  assert.ok(!readFileSync(path, 'utf8').includes('private-marker-secret'))
  assert.throws(() => store.update((vault) => { vault.snippets.push(vault.snippets[0]) }))
  assert.equal(store.read().snippets.length, 3)
  store.lock()
  assert.throws(() => store.read())
  assert.throws(() => store.unlock('wrong-password', false))
  assert.equal(store.unlocked, false)
  assert.equal(store.unlock('test-vault-password', false).snippets[0].command, 'private-marker-secret')
  store.lock()
})

test('export excludes WebDAV credentials and imports on second device', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-test-'))
  const first = new VaultStore(join(directory, 'first.nodus'))
  first.unlock('test-vault-password', true)
  first.update((vault) => { vault.sync = { url: 'https://example.com/vault', username: 'private-user', password: 'private-token' } })
  const secondPath = join(directory, 'second.nodus')
  writeFileSync(secondPath, first.encrypted())
  const second = new VaultStore(secondPath)
  assert.equal(second.unlock('test-vault-password', false).sync.password, '')
  second.update((vault) => { vault.snippets[0].name = 'Changed on second device' })
  first.replaceEncrypted(second.encrypted())
  assert.equal(first.read().snippets[0].name, 'Changed on second device')
  assert.equal(first.read().sync.password, 'private-token')
  const unrelated = new VaultStore(join(directory, 'unrelated.nodus'))
  unrelated.unlock('test-vault-password', true)
  assert.throws(() => first.replaceEncrypted(unrelated.encrypted()))
  first.lock(); second.lock(); unrelated.lock()
})

test('directory tracking handles every byte boundary and rejects control characters', () => {
  const sequence = '\x1b]7;file://localhost/home/my%20project\x07'
  for (let boundary = 0; boundary <= sequence.length; boundary++) {
    const tracker = new CwdTracker()
    assert.deepEqual([...tracker.accept(sequence.slice(0, boundary)), ...tracker.accept(sequence.slice(boundary))], ['/home/my project'])
  }
  const tracker = new CwdTracker()
  assert.deepEqual(tracker.accept('\x1b]7;file://localhost/home\x1b\\'), ['/home'])
  assert.deepEqual(tracker.accept('\x1b]7;file://localhost/bad%0apath\x07'), [])
  assert.equal(shellQuote("/home/user's project"), "'/home/user'\\''s project'")
  assert.throws(() => remotePath('/tmp/\ncommand'))
})

test('sync requires HTTPS and prevents blind overwrites with conditional requests', async (context) => {
  assert.throws(() => validateSync({ url: 'http://example.com/vault', username: '', password: '' }))
  assert.throws(() => validateSync({ url: 'https://user:pass@example.com/vault', username: '', password: '' }))
  const store = new VaultStore(join(mkdtempSync(join(tmpdir(), 'nodus-test-')), 'vault.nodus'))
  store.unlock('test-vault-password', true)
  store.update((vault) => { vault.sync.url = 'https://example.com/vault' })
  const requests: RequestInit[] = []
  const mock = context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(init)
    return new Response(null, { status: 201, headers: { ETag: '"revision-1"' } })
  })
  await synchronize(store, 'push')
  assert.equal(new Headers(requests[0].headers).get('If-None-Match'), '*')
  await synchronize(store, 'push')
  assert.equal(new Headers(requests[1].headers).get('If-Match'), '"revision-1"')
  assert.equal(requests[0].redirect, 'error')
  mock.mock.mockImplementation(async () => new Response(null, { status: 412 }))
  await assert.rejects(synchronize(store, 'push'), /üzerine yazılmadı/)
  mock.mock.mockImplementation(async () => new Response('invalid-vault', { status: 200 }))
  const previous = store.read()
  await assert.rejects(synchronize(store, 'pull'))
  assert.deepEqual(store.read(), previous)
  store.lock()
})

test('locking aborts WebDAV before it can update a newly unlocked vault', async (context) => {
  const store = new VaultStore(join(mkdtempSync(join(tmpdir(), 'nodus-test-')), 'vault.nodus'))
  store.unlock('test-vault-password', true)
  store.update((vault) => { vault.sync.url = 'https://example.com/vault' })
  const controller = new AbortController()
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    controller.abort()
    assert.equal(init.signal?.aborted, true)
    store.lock()
    store.unlock('test-vault-password', false)
    return new Response(null, { status: 201, headers: { ETag: '"unexpected"' } })
  })
  await assert.rejects(synchronize(store, 'push', controller.signal), { name: 'AbortError' })
  assert.equal(store.read().sync.etag, undefined)
  assert.equal(store.read().sync.lastSync, undefined)
  store.lock()
})
