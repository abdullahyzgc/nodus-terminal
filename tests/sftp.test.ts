import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { SFTPWrapper } from 'ssh2'
import { SSHManager, shellQuote } from '../electron/ssh'

function fixture(methods: Record<string, unknown>) {
  const manager = new SSHManager(() => {}, async () => true)
  manager.sftp = async () => methods as unknown as SFTPWrapper
  return manager
}

test('SFTP editor preserves UTF-8 and rejects binary, oversized and non-file input', async () => {
  let content = Buffer.from('\ufeffTürkçe metin\r\n')
  let size = content.length
  let isFile = true
  const manager = fixture({
    stat: (_path: string, done: Function) => done(null, { size, isFile: () => isFile }),
    createReadStream: () => Readable.from([content]),
  })
  assert.equal((await manager.readFile('session', '/test.txt')).text, '\ufeffTürkçe metin\r\n')
  content = Buffer.from([0xff, 0xfe])
  await assert.rejects(manager.readFile('session', '/test.txt'), /UTF-8/)
  content = Buffer.from('binary\0data')
  await assert.rejects(manager.readFile('session', '/test.txt'), /Ikili/)
  content = Buffer.alloc(512 * 1024 + 1, 65)
  await assert.rejects(manager.readFile('session', '/test.txt'), /512 KB/)
  size = content.length
  await assert.rejects(manager.readFile('session', '/test.txt'), /512 KB/)
  size = 0; isFile = false
  await assert.rejects(manager.readFile('session', '/directory'), /normal dosyalar/)
})

test('SFTP new files use exclusive creation; chmod preserves special bits', async () => {
  const writes: { path: string; content: Buffer; flag: string }[] = []
  const modes: number[] = []
  const manager = fixture({
    writeFile: (path: string, content: Buffer, options: { flag: string }, done: Function) => {
      writes.push({ path, content, flag: options.flag }); done(null)
    },
    chmod: (_path: string, mode: number, done: Function) => { modes.push(mode); done(null) },
  })
  await manager.writeFile('session', '/new.txt', '', true)
  await manager.writeFile('session', '/edit.txt', 'Türkçe')
  assert.deepEqual(writes.map((write) => write.flag), ['wx', 'w'])
  assert.equal(writes[1].content.toString('utf8'), 'Türkçe')
  await assert.rejects(manager.writeFile('session', '/large.txt', 'ü'.repeat(300000)), /512 KB/)
  await manager.chmod('session', '/dir', 0o2755)
  assert.deepEqual(modes, [0o2755])
  await assert.rejects(manager.chmod('session', '/dir', 0o10000), /yetkisi/)
  await assert.rejects(manager.chmod('session', '/dir', -1), /yetkisi/)
})

test('SFTP deletion validates entire batch before writes and never follows directory symlinks', async () => {
  const removed: string[] = []
  const manager = fixture({
    lstat: (path: string, done: Function) => done(null, { isDirectory: () => path === '/data/folder' }),
    readdir: (_path: string, done: Function) => done(null, [{ filename: 'link' }, { filename: 'file.txt' }]),
    unlink: (path: string, done: Function) => { removed.push(path); done(null) },
    rmdir: (path: string, done: Function) => { removed.push(path); done(null) },
  })
  for (const invalid of ['/', '/data/..', '/data/../outside', '.']) {
    await assert.rejects(manager.remove('session', ['/data/good.txt', invalid]), /silinemez/)
    assert.deepEqual(removed, [])
  }
  await manager.remove('session', ['/data/folder'])
  assert.deepEqual(removed, ['/data/folder/link', '/data/folder/file.txt', '/data/folder'])
})

test('SFTP archive commands quote names, guard collisions and cover supported formats', async () => {
  const commands: string[] = []
  const manager = fixture({})
  manager.exec = async (_id, command) => { commands.push(command); return { code: 0, stdout: '', stderr: '' } }
  for (const format of ['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'gz']) {
    const output = await manager.archive('session', "/data/it's here", 'backup', format, ["file'; touch bad; '"])
    assert.equal(output, 'backup.' + format)
    assert.ok(commands.at(-1)!.includes(shellQuote("/data/it's here")))
    assert.ok(commands.at(-1)!.includes(shellQuote("./file'; touch bad; '")))
    assert.ok(commands.at(-1)!.includes('[ -e '))
    assert.ok(commands.at(-1)!.includes('[ -L '))
  }
  const count = commands.length
  await assert.rejects(manager.archive('session', '/data', 'bad', '7z', ['file']))
  await assert.rejects(manager.archive('session', '/data', 'bad', 'zip', ['../outside']))
  await assert.rejects(manager.archive('session', '/data', 'bad', 'gz', ['one', 'two']))
  await assert.rejects(manager.archive('session', '/data', 'backup.zip', 'zip', ['backup.zip']))
  assert.equal(commands.length, count)
  for (const extension of ['zip', 'tar.gz', 'tgz', 'tar', 'bz2', 'xz', 'gz', 'tar.bz2', 'tar.xz']) {
    assert.equal(await manager.extract('session', '/data/backup.' + extension), '/data/backup.' + extension + '.extracted')
    assert.ok(commands.at(-1)!.includes('&& mkdir -- '))
  }
  await assert.rejects(manager.extract('session', '/data/file.txt'), /Desteklenmeyen/)
  manager.exec = async () => ({ code: 1, stdout: '', stderr: 'missing archive tool' })
  await assert.rejects(manager.archive('session', '/data', 'backup', 'zip', ['file']), /missing archive tool/)
  await assert.rejects(manager.extract('session', '/data/backup.zip'), /missing archive tool/)
})
