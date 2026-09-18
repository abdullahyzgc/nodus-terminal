import type { SessionEvent } from './shared'

type Snapshot = { output: string; cwd: string; closed: boolean }
const snapshots = new Map<string, Snapshot>()
const listeners = new Map<string, Set<(event: SessionEvent) => void>>()
const forgotten = new Set<string>()
let unsubscribe: (() => void) | undefined

export function startSessions(): void {
  if (unsubscribe || !window.nodus) return
  unsubscribe = window.nodus.onSession((event) => {
    if (forgotten.has(event.id)) return
    const snapshot = snapshots.get(event.id) ?? { output: '', cwd: '.', closed: false }
    if (event.type === 'data') snapshot.output = (snapshot.output + event.data).slice(-512 * 1024)
    if (event.type === 'cwd') snapshot.cwd = event.data
    if (event.type === 'closed') snapshot.closed = true
    if (event.type === 'ready') snapshot.closed = false
    snapshots.set(event.id, snapshot)
    if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value!)
    listeners.get(event.id)?.forEach((listener) => listener(event))
  })
}
export function sessionSnapshot(id: string): Snapshot { return snapshots.get(id) ?? { output: '', cwd: '.', closed: false } }
export function subscribeSession(id: string, listener: (event: SessionEvent) => void): () => void {
  const subscriptions = listeners.get(id) ?? new Set()
  subscriptions.add(listener); listeners.set(id, subscriptions)
  return () => { subscriptions.delete(listener); if (!subscriptions.size) listeners.delete(id) }
}
export function forgetSession(id: string): void {
  forgotten.add(id); snapshots.delete(id); listeners.delete(id)
  if (forgotten.size > 128) forgotten.delete(forgotten.values().next().value!)
}
export function clearSessions(): void { for (const id of snapshots.keys()) forgetSession(id) }
export const quotePath = (path: string): string => "'" + path.replace(/'/g, "'\\''") + "'"
export const joinPath = (directory: string, name: string): string => (directory === '/' ? '' : directory.replace(/\/$/, '')) + '/' + name
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
