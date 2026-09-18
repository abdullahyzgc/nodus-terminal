import test from 'node:test'
import assert from 'node:assert/strict'
import { MacUpdateService, fetchMacRelease, macRelease } from '../electron/mac-updates'
import type { UpdateStatus } from '../src/shared'

const repository = 'https://github.com/abdullahyzgc/nodus-terminal'
function release(version = '0.1.4', arch = 'arm64') {
  const name = `Nodus-${version}-mac-${arch}.dmg`
  return { tag_name: 'v' + version, draft: false, prerelease: false, assets: [{ name, state: 'uploaded', size: 1000, browser_download_url: `${repository}/releases/download/v${version}/${name}` }] }
}

test('Mac releases require a newer stable version and a matching uploaded DMG', () => {
  assert.deepEqual(macRelease(release(), '0.1.3', 'arm64'), { version: '0.1.4', url: repository + '/releases/tag/v0.1.4' })
  assert.equal(macRelease(release(), '0.1.3', 'x64'), null)
  assert.ok(macRelease(release('0.1.4', 'x64'), '0.1.3', 'x64'))
  for (const arch of ['arm64', 'x64']) assert.ok(macRelease(release('0.1.4', 'universal'), '0.1.3', arch))
  assert.ok(macRelease(release('0.1.10'), '0.1.9', 'arm64'))
  for (const version of ['0.1.4', '0.2.0', '1.0.0']) assert.equal(macRelease(release(), version, 'arm64'), null)
  assert.equal(macRelease({ ...release(), draft: true }, '0.1.3', 'arm64'), null)
  assert.equal(macRelease({ ...release(), prerelease: true }, '0.1.3', 'arm64'), null)
  assert.equal(macRelease({ ...release(), assets: [] }, '0.1.3', 'arm64'), null)
  assert.equal(macRelease(release(), '0.1.3', 'ia32'), null)
  for (const tag of ['v0.1.4-beta.1', 'v01.1.4', 'v999999999999999999.0.0', 'other', 'v0.1.4/../../evil']) {
    assert.throws(() => macRelease({ ...release(), tag_name: tag }, '0.1.3', 'arm64'))
  }
})

test('untrusted asset links never become download destinations', () => {
  for (const browser_download_url of ['file:///tmp/test.dmg', 'https://example.com/test.dmg', 'https://github.com/other/repo/releases/download/v0.1.4/test.dmg', repository + '/releases/download/v0.1.4/Nodus-0.1.4-mac-arm64.dmg?other=1']) {
    const data = release()
    data.assets[0].browser_download_url = browser_download_url
    assert.equal(macRelease(data, '0.1.3', 'arm64'), null)
  }
  for (const change of [{ state: 'new' }, { size: 0 }, { name: 'Nodus-0.1.4-Setup.exe' }]) {
    const data = release()
    Object.assign(data.assets[0], change)
    assert.equal(macRelease(data, '0.1.3', 'arm64'), null)
  }
  assert.throws(() => macRelease(null, '0.1.3', 'arm64'))
  assert.throws(() => macRelease({ ...release(), assets: null }, '0.1.3', 'arm64'))
})

test('manual updates notify without downloading or installing; only click opens trusted page', async () => {
  const states: UpdateStatus[] = []
  const opened: string[] = []
  let checks = 0
  const updates = new MacUpdateService('0.1.3', 'arm64', (state) => states.push(state), async (url) => { opened.push(url) }, async () => { checks++; return release() })
  assert.equal(updates.status().mode, 'manual')
  await updates.openDownload(); await updates.install()
  assert.equal(checks, 0)
  assert.equal(opened.length, 0)
  assert.equal((await updates.check()).phase, 'available')
  assert.deepEqual(states.map((state) => state.phase), ['checking', 'available'])
  assert.equal(opened.length, 0)
  await updates.install()
  assert.equal(opened.length, 0)
  await updates.openDownload()
  assert.deepEqual(opened, [repository + '/releases/tag/v0.1.4'])
  assert.equal(updates.status().phase, 'available')
  await updates.check()
  assert.equal(checks, 2)
  updates.stop(); await updates.openDownload(); await updates.check()
  assert.equal(checks, 2); assert.equal(opened.length, 1)
})

test('missing packages, transient failures and failed browser opens remain recoverable', async () => {
  let data: unknown = null
  let fail = false
  let browserFail = true
  let opened = 0
  const updates = new MacUpdateService('0.1.3', 'arm64', () => {}, async () => { if (browserFail) throw new Error('browser'); opened++ }, async () => { if (fail) throw new Error('network'); return data })
  assert.equal((await updates.check()).phase, 'idle')
  fail = true
  assert.equal((await updates.check()).phase, 'error')
  fail = false; data = release()
  assert.equal((await updates.check()).phase, 'available')
  assert.match((await updates.openDownload()).message, /açılamadı/)
  browserFail = false
  assert.equal((await updates.openDownload()).phase, 'available')
  assert.equal(opened, 1)
  fail = true
  assert.equal((await updates.check()).phase, 'error')
  await updates.openDownload()
  assert.equal(opened, 1)
})

test('concurrent checks deduplicate and shutdown cancels late notifications', async () => {
  let finish!: (value: unknown) => void
  let checks = 0
  let signal!: AbortSignal
  const states: UpdateStatus[] = []
  const updates = new MacUpdateService('0.1.3', 'arm64', (state) => states.push(state), async () => {}, async (value) => { signal = value; checks++; return new Promise((resolve) => { finish = resolve }) })
  const pending = updates.check()
  await updates.check()
  assert.equal(checks, 1)
  updates.stop()
  assert.equal(signal.aborted, true)
  finish(release()); await pending
  assert.deepEqual(states.map((state) => state.phase), ['checking'])
})

test('Mac checks run at startup and six-hour intervals and stop cleanly', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let checks = 0
  const updates = new MacUpdateService('0.1.3', 'arm64', () => {}, async () => {}, async () => { checks++; return release() })
  context.after(() => updates.stop())
  updates.start(); updates.start()
  context.mock.timers.tick(9999); assert.equal(checks, 0)
  context.mock.timers.tick(1); await Promise.resolve(); assert.equal(checks, 1)
  context.mock.timers.tick(6 * 60 * 60 * 1000 - 10000); await Promise.resolve(); assert.equal(checks, 2)
  updates.stop(); context.mock.timers.tick(12 * 60 * 60 * 1000); assert.equal(checks, 2)
})

test('stalled Mac checks time out and can retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let stall = true
  const updates = new MacUpdateService('0.1.3', 'arm64', () => {}, async () => {}, async (signal) => {
    if (!stall) return release()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  const pending = updates.check()
  context.mock.timers.tick(15000)
  assert.equal((await pending).phase, 'error')
  stall = false
  assert.equal((await updates.check()).phase, 'available')
})

test('GitHub transport uses a fixed endpoint, handles 404 and bounds response size', async () => {
  const controller = new AbortController()
  const fake = (response: Response) => (async () => response) as typeof fetch
  const data = await fetchMacRelease(controller.signal, (async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/abdullahyzgc/nodus-terminal/releases/latest')
    assert.equal(options?.signal, controller.signal)
    assert.equal(options?.redirect, 'error')
    return new Response(JSON.stringify(release()))
  }) as typeof fetch)
  assert.deepEqual(data, release())
  assert.equal(await fetchMacRelease(controller.signal, fake(new Response('', { status: 404 }))), null)
  await assert.rejects(fetchMacRelease(controller.signal, fake(new Response('', { status: 403 }))))
  await assert.rejects(fetchMacRelease(controller.signal, fake(new Response('invalid JSON'))))
  await assert.rejects(fetchMacRelease(controller.signal, fake(new Response('x'.repeat(1024 * 1024 + 1)))), /büyük/)
  await assert.rejects(fetchMacRelease(controller.signal, fake(new Response('{}', { headers: { 'Content-Length': '2000000' } }))), /büyük/)
})
