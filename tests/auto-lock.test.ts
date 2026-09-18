import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutoLock, defaultAutoLockMinutes, readAutoLockMinutes, saveAutoLockMinutes, validateAutoLockMinutes } from '../electron/auto-lock'

test('auto lock defaults to exactly 15 minutes and locks only once', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  let locks = 0
  const idle = new AutoLock(() => { locks++ })
  context.after(() => idle.stop())
  assert.equal(defaultAutoLockMinutes, 15)
  idle.start()
  context.mock.timers.tick(15 * 60000 - 1)
  assert.equal(locks, 0)
  context.mock.timers.tick(1)
  assert.equal(locks, 1)
  idle.activity()
  context.mock.timers.tick(30 * 60000)
  assert.equal(locks, 1)
})

test('user activity resets the deadline but read-only checks do not', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  let locks = 0
  const idle = new AutoLock(() => { locks++ })
  context.after(() => idle.stop())
  idle.start()
  context.mock.timers.tick(14 * 60000)
  idle.activity()
  context.mock.timers.tick(14 * 60000)
  assert.equal(idle.check(), false)
  assert.equal(locks, 0)
  context.mock.timers.tick(60000)
  assert.equal(locks, 1)
})

test('longer deadlines, disabled mode, re-enabling and a fresh unlock work', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  let locks = 0
  const idle = new AutoLock(() => { locks++ })
  context.after(() => idle.stop())
  idle.start()
  idle.configure(60)
  context.mock.timers.tick(59 * 60000)
  assert.equal(locks, 0)
  idle.configure(0)
  context.mock.timers.tick(48 * 60 * 60000)
  assert.equal(idle.check(), false)
  idle.activity()
  assert.equal(locks, 0)
  idle.configure(15)
  context.mock.timers.tick(15 * 60000)
  assert.equal(locks, 1)
  idle.start()
  context.mock.timers.tick(15 * 60000)
  assert.equal(locks, 2)
})

test('resume and late input cannot revive an expired session before its timer runs', () => {
  let now = 0
  let locks = 0
  const idle = new AutoLock(() => { locks++ }, () => now)
  try {
    idle.start()
    now = 16 * 60000
    assert.equal(idle.check(), true)
    assert.equal(locks, 1)
    idle.start()
    now += 15 * 60000
    idle.activity()
    assert.equal(locks, 2)
    assert.equal(idle.check(), false)
  } finally { idle.stop() }
})

test('stopping the timer clears the session until the next unlock', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  let locks = 0
  const idle = new AutoLock(() => { locks++ })
  context.after(() => idle.stop())
  idle.activity()
  idle.configure(1)
  context.mock.timers.tick(60000)
  assert.equal(locks, 0)
  idle.start()
  idle.stop()
  idle.activity()
  context.mock.timers.tick(60000)
  assert.equal(locks, 0)
  idle.start()
  context.mock.timers.tick(60000)
  assert.equal(locks, 1)
})

test('device preference persists, rejects invalid values and defaults safely', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'nodus-auto-lock-')), 'auto-lock.json')
  assert.equal(readAutoLockMinutes(path), 15)
  assert.equal(saveAutoLockMinutes(path, 120), 120)
  assert.equal(readAutoLockMinutes(path), 120)
  saveAutoLockMinutes(path, 0)
  assert.equal(readAutoLockMinutes(path), 0)
  const previous = readFileSync(path, 'utf8')
  for (const value of [-1, 1441, 1.5, NaN, Infinity, '15', null, {}, true, undefined]) {
    assert.throws(() => validateAutoLockMinutes(value))
    assert.throws(() => saveAutoLockMinutes(path, value))
  }
  assert.equal(readFileSync(path, 'utf8'), previous)
  for (const contents of ['invalid', '{}', 'null', '{"minutes":-1}', '{"minutes":"0"}']) {
    writeFileSync(path, contents)
    assert.equal(readAutoLockMinutes(path), 15)
  }
  assert.equal(validateAutoLockMinutes(1), 1)
  assert.equal(validateAutoLockMinutes(1440), 1440)
})
