import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RdpLauncher, rdpFile, validateRdpHost } from '../electron/rdp'
import { VaultStore, validateHost, emptyVault } from '../electron/vault'
import { portableVault, mergeVaults } from '../electron/drive-merge'
import { SSHManager } from '../electron/ssh'
import type { Host } from '../src/shared'

const host: Host = { id: 'rdp-fixture', name: 'Windows fixture', hostname: '192.0.2.25', port: 3389, username: 'DOMAIN\\tester', group: 'Windows', color: '#8aacf2', authType: 'password', password: '', privateKey: '', passphrase: '', favorite: true, initialPath: '', followDirectory: false, persistentSession: false, protocol: 'rdp', rdp: { fullscreen: false, clipboard: false } }

test('RDP profile is Unicode, includes explicit security settings and never embeds passwords', () => {
  const bytes = rdpFile({ ...host, password: 'must-not-leak', privateKey: 'must-not-leak-key' })
  assert.equal(bytes.readUInt16LE(0), 0xfeff)
  const text = bytes.toString('utf16le')
  assert.ok(text.includes('full address:s:192.0.2.25:3389\r\n'))
  assert.ok(text.includes('username:s:DOMAIN\\tester\r\n'))
  for (const value of ['prompt for credentials:i:1', 'authentication level:i:1', 'enablecredsspsupport:i:1', 'redirectclipboard:i:0', 'redirectprinters:i:0', 'drivestoredirect:s:', 'devicestoredirect:s:', 'screen mode id:i:1']) assert.ok(text.includes(value + '\r\n'), value)
  assert.ok(!text.includes('must-not-leak') && !text.includes('password 51'))
  const enabled = rdpFile({ ...host, hostname: '2001:db8::25', port: 3390, username: 'Örnek\\kullanıcı', rdp: { fullscreen: true, clipboard: true } }).toString('utf16le')
  assert.ok(enabled.includes('full address:s:[2001:db8::25]:3390\r\n'))
  assert.ok(enabled.includes('username:s:Örnek\\kullanıcı\r\n'))
  assert.ok(enabled.includes('screen mode id:i:2\r\n'))
  assert.ok(enabled.includes('redirectclipboard:i:1\r\n'))
})

test('RDP fields reject profile injection, command switches and invalid ports', () => {
  for (const hostname of ['server\r\nredirectclipboard:i:1', '/v:other', 'server:3389', 'https://server', 'server & whoami', 'server\\path', '', 'a'.repeat(254)]) assert.throws(() => validateRdpHost({ ...host, hostname }))
  for (const username of ['\r\nremoteapplicationprogram:s:bad', '\0', 'a\tb', 'a'.repeat(257), '']) assert.throws(() => validateRdpHost({ ...host, username }))
  for (const port of [0, -1, 65536, 3389.5, NaN]) assert.throws(() => validateRdpHost({ ...host, port }))
  for (const hostname of ['server', 'server.example.com', '127.0.0.1', '::1']) assert.doesNotThrow(() => validateRdpHost({ ...host, hostname }))
  assert.throws(() => validateHost({ ...host, protocol: 'vnc' as 'rdp' }))
  for (const change of [{ password: 'secret' }, { authType: 'key' as const }, { privateKey: 'secret' }, { persistentSession: true }, { followDirectory: true }]) assert.throws(() => validateHost({ ...host, ...change }))
  assert.throws(() => validateHost({ ...host, rdp: { fullscreen: true, clipboard: 'yes' as unknown as boolean } }))
})

test('RDP records persist encrypted, sync intact, and old SSH records remain valid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-rdp-vault-'))
  const store = new VaultStore(join(directory, 'vault.nodus'))
  store.unlock('rdp-test-vault-passphrase', true)
  store.update((vault) => { vault.hosts.push(host) })
  assert.ok(!readFileSync(store.path, 'utf8').includes(host.hostname))
  const exported = store.encrypted()
  const other = new VaultStore(join(directory, 'other.nodus'))
  writeFileSync(other.path, exported)
  assert.deepEqual(other.unlock('rdp-test-vault-passphrase', false).hosts[0], host)
  const portable = portableVault(store.read())
  assert.deepEqual(portable.hosts[0], host)
  assert.deepEqual(mergeVaults(undefined, emptyVault(), portable).vault.hosts[0], host)
  assert.doesNotThrow(() => validateHost({ ...host, protocol: undefined, rdp: undefined, port: 22, followDirectory: true, password: 'ssh password' }))
  store.lock(); other.lock()
})

test('RDP hosts cannot accidentally connect through SSH', async () => {
  const manager = new SSHManager(() => assert.fail('Must not emit SSH events'), async () => assert.fail('Must not connect'))
  await assert.rejects(manager.connect(host), /RDP/)
})

test('RDP launcher passes only a profile path, detaches, and removes profile on exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-rdp-launch-'))
  const child = new EventEmitter() as ChildProcess
  let detached = false
  child.unref = () => { detached = true }
  let profile = ''
  const launcher = new RdpLauncher(directory, process.execPath, 'win32', (executable, args) => {
    assert.equal(executable, process.execPath)
    assert.equal(args.length, 1)
    profile = args[0]
    assert.ok(profile.startsWith(directory))
    assert.ok(profile.endsWith('.rdp'))
    assert.ok(readFileSync(profile, 'utf16le').includes('DOMAIN\\tester'))
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  await launcher.open(host)
  assert.ok(detached && existsSync(profile))
  child.emit('exit', 0)
  assert.ok(!existsSync(profile))
})

test('RDP launch failures clean profiles and non-Windows systems never launch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodus-rdp-failure-'))
  for (const failure of ['throw', 'error'] as const) {
    const launcher = new RdpLauncher(directory, process.execPath, 'win32', () => {
      if (failure === 'throw') throw new Error('fixture failure')
      const child = new EventEmitter() as ChildProcess
      queueMicrotask(() => child.emit('error', new Error('fixture failure')))
      return child
    })
    await assert.rejects(launcher.open(host))
    assert.deepEqual(readdirSync(directory), [])
  }
  await assert.rejects(new RdpLauncher(directory, join(directory, 'missing.exe'), 'win32').open(host), /bulunamadı/)
  await assert.rejects(new RdpLauncher(directory, process.execPath, 'darwin', () => { throw new Error('Must not launch') }).open(host), /Windows/)
})
