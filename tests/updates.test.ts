import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { UpdateService } from '../electron/updates'
import type { UpdateStatus } from '../src/shared'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checks = 0
  downloads = 0
  installations: boolean[][] = []
  available = true
  checkFailure = false
  downloadFailure = false
  installFailure = false
  async checkForUpdates() {
    this.checks++
    if (this.checkFailure) throw new Error('Network unavailable')
    this.emit(this.available ? 'update-available' : 'update-not-available', { version: '0.1.2' })
  }
  async downloadUpdate() {
    this.downloads++
    this.emit('download-progress', { percent: 42.4 })
    if (this.downloadFailure) { this.emit('error', new Error('Invalid checksum')); throw new Error('Invalid checksum') }
    this.emit('update-downloaded', { version: '0.1.2' })
  }
  quitAndInstall(silent = false, forceRun = false) {
    if (this.installFailure) { this.emit('error', new Error('Cannot start installer')); return }
    this.installations.push([silent, forceRun])
  }
}

test('new stable update downloads automatically but installs only after consent and preparation', async () => {
  const engine = new FakeUpdater()
  const states: UpdateStatus[] = []
  let prepared = false
  let accepted = false
  const updates = new UpdateService(engine, '0.1.1', true, (state) => states.push(state), async () => accepted, () => { prepared = true })
  assert.equal(engine.autoDownload, false)
  assert.equal(engine.autoInstallOnAppQuit, false)
  assert.equal(engine.allowPrerelease, false)
  assert.equal(engine.allowDowngrade, false)
  await updates.install()
  assert.equal(prepared, false)
  assert.equal((await updates.check()).phase, 'ready')
  assert.equal(engine.checks, 1)
  assert.equal(engine.downloads, 1)
  assert.deepEqual(states.map((state) => state.phase), ['checking', 'downloading', 'downloading', 'ready'])
  assert.equal(states[2].progress, 42)
  assert.equal(updates.status().nextVersion, '0.1.2')
  await updates.check()
  assert.equal(engine.checks, 1)
  await updates.install()
  assert.equal(prepared, false)
  assert.equal(engine.installations.length, 0)
  accepted = true
  assert.equal((await updates.install()).phase, 'installing')
  assert.equal(prepared, true)
  assert.deepEqual(engine.installations, [[false, true]])
  await updates.install()
  assert.equal(engine.installations.length, 1)
})

test('development and unsupported platforms never check, download or install', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const engine = new FakeUpdater()
  const updates = new UpdateService(engine, '0.1.1', false, () => {}, async () => true, () => assert.fail('Must not prepare'))
  updates.start()
  context.mock.timers.tick(12 * 60 * 60 * 1000)
  await updates.check()
  await updates.install()
  assert.equal(updates.status().phase, 'disabled')
  assert.equal(engine.checks, 0)
  assert.equal(engine.downloads, 0)
  assert.equal(engine.installations.length, 0)
  updates.stop()
})

test('no update and transient network or checksum failures can be retried', async () => {
  const engine = new FakeUpdater()
  const updates = new UpdateService(engine, '0.1.1', true, () => {}, async () => true, () => {})
  engine.available = false
  assert.equal((await updates.check()).phase, 'idle')
  assert.equal(engine.downloads, 0)
  engine.checkFailure = true
  assert.equal((await updates.check()).phase, 'error')
  engine.checkFailure = false
  engine.available = true
  engine.downloadFailure = true
  assert.equal((await updates.check()).phase, 'error')
  await updates.install()
  assert.equal(engine.installations.length, 0)
  engine.downloadFailure = false
  assert.equal((await updates.check()).phase, 'ready')
})

test('failed backup prevents installation and remains retryable', async () => {
  const engine = new FakeUpdater()
  let writable = false
  const updates = new UpdateService(engine, '0.1.1', true, () => {}, async () => true, () => { if (!writable) throw new Error('Disk full') })
  await updates.check()
  assert.equal((await updates.install()).phase, 'ready')
  assert.equal(engine.installations.length, 0)
  writable = true
  await updates.install()
  assert.equal(engine.installations.length, 1)
})

test('installer errors leave a visible retryable state', async () => {
  const engine = new FakeUpdater()
  const updates = new UpdateService(engine, '0.1.1', true, () => {}, async () => true, () => {})
  await updates.check()
  engine.installFailure = true
  assert.equal((await updates.install()).phase, 'error')
  assert.equal(engine.installations.length, 0)
  engine.installFailure = false
  await updates.check()
  await updates.install()
  assert.equal(engine.installations.length, 1)
})

test('concurrent checks and repeated installation clicks are deduplicated', async () => {
  const engine = new FakeUpdater()
  let finishCheck!: () => void
  engine.checkForUpdates = async () => {
    engine.checks++
    await new Promise<void>((resolve) => { finishCheck = resolve })
    engine.emit('update-available', { version: '0.1.2' })
  }
  let consent!: (value: boolean) => void
  let prompts = 0
  const updates = new UpdateService(engine, '0.1.1', true, () => {}, () => { prompts++; return new Promise((resolve) => { consent = resolve }) }, () => {})
  const pending = updates.check()
  await updates.check()
  assert.equal(engine.checks, 1)
  finishCheck()
  await pending
  const installation = updates.install()
  await updates.install()
  assert.equal(prompts, 1)
  consent(true)
  await installation
  assert.equal(engine.installations.length, 1)
})

test('startup and periodic checks run once and stop at shutdown', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const engine = new FakeUpdater()
  engine.available = false
  const updates = new UpdateService(engine, '0.1.1', true, () => {}, async () => false, () => {})
  context.after(() => updates.stop())
  updates.start(); updates.start()
  context.mock.timers.tick(9999)
  assert.equal(engine.checks, 0)
  context.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(engine.checks, 1)
  context.mock.timers.tick(6 * 60 * 60 * 1000 - 10000)
  await Promise.resolve()
  assert.equal(engine.checks, 2)
  updates.stop()
  context.mock.timers.tick(12 * 60 * 60 * 1000)
  assert.equal(engine.checks, 2)
})
