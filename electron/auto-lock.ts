import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const defaultAutoLockMinutes = 15

export function validateAutoLockMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1440) throw new Error('Kilit süresi 1–1440 dakika veya kapatmak için 0 olmalı.')
  return value
}

export function readAutoLockMinutes(path: string): number {
  try { return validateAutoLockMinutes(JSON.parse(readFileSync(path, 'utf8')).minutes) }
  catch { return defaultAutoLockMinutes }
}

export function saveAutoLockMinutes(path: string, value: unknown): number {
  const minutes = validateAutoLockMinutes(value)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify({ minutes }), { mode: 0o600 })
  renameSync(path + '.tmp', path)
  return minutes
}

export class AutoLock {
  private timer?: ReturnType<typeof setTimeout>
  private lastActivity?: number
  private minutes = defaultAutoLockMinutes

  constructor(private readonly lock: () => void, private readonly now = () => Date.now()) {}

  start(): void { this.lastActivity = this.now(); this.schedule() }
  stop(): void { clearTimeout(this.timer); this.timer = undefined; this.lastActivity = undefined }
  configure(minutes: number): void {
    this.minutes = validateAutoLockMinutes(minutes)
    if (this.lastActivity !== undefined) this.start()
  }
  activity(): void {
    if (this.lastActivity === undefined || this.check()) return
    this.start()
  }
  check(): boolean {
    if (this.lastActivity === undefined || this.minutes === 0) return false
    if (this.now() - this.lastActivity < this.minutes * 60000) return false
    this.stop()
    this.lock()
    return true
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (this.lastActivity === undefined || this.minutes === 0) return
    this.timer = setTimeout(() => { if (!this.check()) this.schedule() }, Math.max(1, this.minutes * 60000 - (this.now() - this.lastActivity)))
    this.timer.unref()
  }
}
