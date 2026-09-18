import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from '../electron/vault'
import { FileHistory } from '../electron/file-history'
import { createHash } from 'node:crypto'

test('local file history is encrypted, ordered, deduplicated and bounded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-history-'))
  const store = new VaultStore(join(directory, 'vault.nodus'))
  store.unlock('correct horse battery staple', true)
  const path = join(directory, 'history')
  const history = new FileHistory(path, store)
  const identity = JSON.stringify(['host', 'example.com', 22, 'root', '/etc/app.conf'])
  history.add(identity, 'ilk sürüm')
  history.add(identity, 'ilk sürüm')
  history.add(identity, 'ikinci sürüm')
  const entries = history.list(identity)
  assert.deepEqual(entries.map((entry) => entry.text), ['ikinci sürüm', 'ilk sürüm'])
  const raw = readFileSync(join(path, createHash('sha256').update(identity).digest('hex') + '.json'), 'utf8')
  assert.ok(!raw.includes('ikinci sürüm') && !raw.includes('ilk sürüm'))
  for (let index = 0; index < 8; index++) history.add(identity, 'sürüm ' + index)
  assert.equal(history.list(identity).length, 5)
  assert.throws(() => history.add(identity, 'x'.repeat(512 * 1024 + 1)))
  assert.deepEqual(history.list(JSON.stringify(['other'])), [])
  assert.throws(() => new FileHistory(path, new VaultStore(join(directory, 'locked.nodus'))).list(identity))
})

test('file history is keyed per host and path and survives relocking', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-history-keys-'))
  const store = new VaultStore(join(directory, 'vault.nodus'))
  store.unlock('correct horse battery staple', true)
  const history = new FileHistory(join(directory, 'history'), store)
  const first = JSON.stringify(['host', 'one.example', 22, 'root', '/etc/app.conf'])
  const second = JSON.stringify(['host', 'two.example', 22, 'root', '/etc/app.conf'])
  history.add(first, 'birinci')
  history.add(second, 'ikinci')
  assert.deepEqual(history.list(first).map((entry) => entry.text), ['birinci'])
  assert.deepEqual(history.list(second).map((entry) => entry.text), ['ikinci'])
  store.lock()
  assert.throws(() => history.list(first))
  store.unlock('correct horse battery staple', false)
  assert.deepEqual(history.list(first).map((entry) => entry.text), ['birinci'])
  assert.ok(existsSync(join(directory, 'vault.nodus')))
})

test('vault seals local history with authenticated encryption per context', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-seal-'))
  const store = new VaultStore(join(directory, 'vault.nodus'))
  store.unlock('correct horse battery staple', true)
  const sealed = store.sealLocal('gizli içerik', 'context-a')
  assert.ok(!sealed.includes('gizli içerik'))
  assert.equal(store.openLocal(sealed, 'context-a'), 'gizli içerik')
  assert.throws(() => store.openLocal(sealed, 'context-b'))
  assert.throws(() => store.openLocal(sealed.replace(/"data":"[A-Za-z0-9+/=]{4}/, '"data":"AAAA'), 'context-a'))
})
