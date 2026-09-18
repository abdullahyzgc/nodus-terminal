import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createHash, verify } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { Server, utils } from 'ssh2'
import { SSHManager } from '../electron/ssh'
import type { Host, SessionEvent } from '../src/shared'
import type { LogEvent } from '../src/shared'

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await delay(20) }
  assert.ok(condition(), 'Expected SSH fixture state within two seconds')
}

test('persistent SSH reconnect preserves ID, verifies keys, gates production input and closes logs', { timeout: 15000 }, async () => {
  const clients = new Set<any>()
  const commands: string[] = []
  const inputs: string[] = []
  let tmux = true
  let verified = 0
  let acceptKey = true
  const server = new Server({ hostKeys: [serverKey] }, (client) => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client))
    client.on('authentication', (context) => context.method === 'password' && context.password === 'fixture-password' ? context.accept() : context.reject(['password']))
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty) => acceptPty?.())
      session.on('window-change', (acceptResize) => acceptResize?.())
      session.on('exec', (acceptExec, _reject, info) => {
        commands.push(info.command)
        const stream = acceptExec()
        stream.on('error', () => {})
        if (info.command === 'command -v tmux') { stream.exit(tmux ? 0 : 127); stream.end(); return }
        if (info.command.startsWith('tmux new-session')) { stream.write('persistent shell\r\n'); stream.on('data', (chunk: Buffer) => inputs.push(chunk.toString())); return }
        if (info.command.startsWith('tail ') || info.command.startsWith('docker logs ')) {
          const bytes = Buffer.from('ERROR Türkçe günlük\n')
          stream.write(bytes.subarray(0, 8)); stream.write(bytes.subarray(8))
          return
        }
        stream.write('fixture result'); stream.exit(0); stream.end()
      })
    }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const host: Host = { id: 'persistent-fixture', name: 'Fixture', hostname: '127.0.0.1', port: address.port, username: 'tester', group: 'Test', color: '#aaaaaa', authType: 'password', password: '', privateKey: '', passphrase: '', favorite: false, initialPath: "/srv/it's here", followDirectory: true, persistentSession: true, production: true }
  const events: SessionEvent[] = []; const logs: LogEvent[] = []
  const manager = new SSHManager((event) => events.push(event), async () => { verified++; return acceptKey })
  try {
    const connection = await manager.connect(host, 'fixture-password')
    assert.equal(host.password, '')
    assert.ok(commands.includes("tmux new-session -A -s 'nodus-persistent-fixture' -c '/srv/it'\\''s here'"))
    assert.equal(manager.hostId(connection.id), host.id)
    assert.equal(manager.production(connection.id), true)
    manager.input(connection.id, 'blocked\r'); await delay(30); assert.equal(inputs.length, 0)
    manager.authorizeTerminal(connection.id); manager.input(connection.id, 'allowed\r')
    await waitFor(() => inputs.includes('allowed\r'))
    assert.ok(events.some((event) => event.type === 'authorized'))
    await assert.rejects(manager.connect(host, 'fixture-password'), /zaten açık/)
    await manager.startLog(connection.id, 'log-one', { kind: 'file', target: '/var/log/app.log' }, (event) => logs.push(event))
    await waitFor(() => logs.some((event) => event.data.includes('günlük')))
    assert.ok(logs.map((event) => event.data).join('').includes('Türkçe'))
    for (const token of ['log-two', 'log-three', 'log-four']) await manager.startLog(connection.id, token, { kind: 'file', target: '/var/log/app.log' }, (event) => logs.push(event))
    await assert.rejects(manager.startLog(connection.id, 'log-five', { kind: 'file', target: '/var/log/app.log' }, () => {}), /dört/)
    manager.stopLog(connection.id, 'log-two')
    await manager.startLog(connection.id, 'log-five', { kind: 'file', target: '/var/log/app.log' }, () => {})
    for (const client of clients) client.end()
    await waitFor(() => !manager.connected(connection.id))
    assert.ok(events.some((event) => event.type === 'closed' && event.id === connection.id))
    await assert.rejects(manager.connect(host, undefined, connection.id), /authentication/i)
    assert.equal(manager.hostId(connection.id), host.id)
    const resumed = await manager.connect(host, 'fixture-password', connection.id)
    assert.equal(resumed.id, connection.id)
    assert.equal(commands.filter((command) => command.startsWith('tmux new-session')).length, 2)
    const before = inputs.length; manager.input(connection.id, 'blocked again\r'); await delay(30); assert.equal(inputs.length, before)
    await manager.startLog(connection.id, 'log-one', { kind: 'docker', target: 'web' }, () => {})
    for (const client of clients) client.end()
    await waitFor(() => !manager.connected(connection.id))
    acceptKey = false
    await assert.rejects(manager.connect(host, 'fixture-password', connection.id), /verification/i)
    acceptKey = true; tmux = false
    await assert.rejects(manager.connect(host, 'fixture-password', connection.id), /tmux/)
    assert.ok(verified >= 4)
    manager.closeAll()
    assert.throws(() => manager.hostId(connection.id), /bulunamadı/)
    await assert.rejects(manager.connect(host, 'fixture-password', connection.id), /uygun değil/)
  } finally {
    manager.closeAll(); for (const client of clients) client.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const serverKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const userKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKey = userKeys.privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'test-key-passphrase' }).toString()
const publicKey = utils.parseKey(privateKey, 'test-key-passphrase')

test('SSH password and encrypted key authentication, terminal, SFTP and host rejection', { timeout: 20000 }, async () => {
  const clients = new Set<any>()
  const server = new Server({ hostKeys: [serverKey] }, (client) => {
    clients.add(client)
    client.on('error', () => {})
    client.on('close', () => clients.delete(client))
    client.on('authentication', (context) => {
      if (context.username !== 'tester') return context.reject()
      if (context.method === 'password' && context.password === 'test-ssh-password') return context.accept()
      if (context.method === 'publickey' && !(publicKey instanceof Error) && !Array.isArray(publicKey) && publicKey.getPublicSSH().equals(context.key.data)) {
        if (!context.signature || verify(context.hashAlgo!, context.blob!, userKeys.publicKey, context.signature)) return context.accept()
      }
      context.reject()
    })
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty) => acceptPty?.())
      session.on('window-change', (acceptResize) => acceptResize?.())
      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        stream.write('connected\r\n\x1b]7;file://localhost/home/tester\x07')
        stream.on('data', (data: Buffer) => stream.write('received:' + data.toString()))
      })
      session.on('sftp', (acceptSftp) => {
        const sftp = acceptSftp()
        let listed = false
        sftp.on('REALPATH', (request) => sftp.name(request, [{ filename: '/home/tester', longname: '', attrs: { mode: 0o40755, size: 0, uid: 1000, gid: 1000, atime: 0, mtime: 0 } }]))
        sftp.on('OPENDIR', (request) => { listed = false; sftp.handle(request, Buffer.from('directory')) })
        sftp.on('READDIR', (request) => {
          if (listed) { sftp.status(request, 1); return }
          listed = true
          sftp.name(request, [
            { filename: 'project', longname: '', attrs: { mode: 0o40755, size: 0, uid: 1000, gid: 1000, atime: 0, mtime: 0 } },
            { filename: 'readme.txt', longname: '', attrs: { mode: 0o100644, size: 42, uid: 1000, gid: 1000, atime: 0, mtime: 0 } },
          ])
        })
        sftp.on('CLOSE', (request) => sftp.status(request, 0))
        sftp.on('MKDIR', (request) => sftp.status(request, 0))
        sftp.on('RENAME', (request) => sftp.status(request, 0))
      })
    }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const host: Host = { id: 'test-host', name: 'Local fixture', hostname: '127.0.0.1', port: address.port, username: 'tester', group: 'Test', color: '#a8d5b5', authType: 'password', password: 'test-ssh-password', privateKey: '', passphrase: '', favorite: false, initialPath: '', followDirectory: false }
  const events: SessionEvent[] = []
  const parsedServerKey = utils.parseKey(serverKey)
  assert.ok(!(parsedServerKey instanceof Error) && !Array.isArray(parsedServerKey))
  const fingerprint = createHash('sha256').update(parsedServerKey.getPublicSSH()).digest('hex')
  const manager = new SSHManager((event) => events.push(event), async (_host, actual) => actual === fingerprint)
  const denied = new SSHManager(() => {}, async () => false)
  try {
    for (const authType of ['password', 'key'] as const) {
      const connection = await manager.connect({ ...host, authType, privateKey, passphrase: 'test-key-passphrase' })
      const listing = await manager.list(connection.id, '.')
      assert.equal(listing.path, '/home/tester')
      assert.deepEqual(listing.entries.map((entry) => [entry.name, entry.kind]), [['project', 'directory'], ['readme.txt', 'file']])
      manager.input(connection.id, 'pwd\r')
      manager.resize(connection.id, 120, 35)
      await manager.mkdir(connection.id, '/home/tester/new')
      await manager.rename(connection.id, '/home/tester/new', '/home/tester/renamed')
      assert.ok(events.some((event) => event.id === connection.id && event.type === 'cwd' && event.data === '/home/tester'))
      assert.ok(events.some((event) => event.id === connection.id && event.type === 'data' && event.data.includes('received:pwd')))
      manager.disconnect(connection.id)
    }
    await assert.rejects(denied.connect(host), /verification/i)
    await assert.rejects(manager.connect({ ...host, password: 'wrong-password' }), /authentication/i)
    const changedHost = { ...host, password: 'old-password' }
    const recovered = await manager.connect(changedHost, 'test-ssh-password')
    assert.equal(changedHost.password, 'old-password')
    manager.disconnect(recovered.id)
    const manualHost = { ...host, password: '' }
    const manual = await manager.connect(manualHost, 'test-ssh-password')
    assert.equal(manualHost.password, '')
    manager.disconnect(manual.id)
  } finally {
    manager.closeAll(); denied.closeAll()
    for (const client of clients) client.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
