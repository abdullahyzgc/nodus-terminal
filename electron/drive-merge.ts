import { isDeepStrictEqual } from 'node:util'
import type { DriveConflict, Host, Snippet, Vault } from '../src/shared'
import { validateVault } from './vault'

export function portableVault(vault: Vault): Vault {
  return {
    version: 1,
    hosts: vault.hosts.map(({ lastConnected: _lastConnected, ...host }) => host),
    snippets: structuredClone(vault.snippets),
    knownHosts: { ...vault.knownHosts },
    sync: { url: '', username: '', password: '' },
  }
}

export function sameVault(first: Vault, second: Vault): boolean {
  const normalize = (vault: Vault): Vault => {
    const content = portableVault(vault)
    content.hosts.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    content.snippets.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    return content
  }
  return isDeepStrictEqual(normalize(first), normalize(second))
}

export function mergeVaults(base: Vault | undefined, local: Vault, remote: Vault, choices: Record<string, string> = {}): { vault: Vault; conflicts: DriveConflict[] } {
  const conflicts: DriveConflict[] = []
  const choose = <Value>(key: string, label: string, previous: Value | undefined, current: Value | undefined, incoming: Value | undefined): Value | undefined => {
    if (isDeepStrictEqual(current, incoming)) return current
    if (base && isDeepStrictEqual(current, previous)) return incoming
    if (base && isDeepStrictEqual(incoming, previous)) return current
    if (!base && current === undefined) return incoming
    if (!base && incoming === undefined) return current
    if (choices[key] === 'local') return current
    if (choices[key] === 'remote') return incoming
    conflicts.push({ key, label, options: [
      { id: 'local', label: current === undefined ? 'Bu cihazdaki silmeyi koru' : 'Bu cihazdaki kaydı koru' },
      { id: 'remote', label: incoming === undefined ? 'Drive üzerindeki silmeyi koru' : 'Drive üzerindeki kaydı koru' },
    ] })
    return current
  }
  const records = <Value extends Host | Snippet>(kind: 'hosts' | 'snippets', previous: Value[], current: Value[], incoming: Value[]): Value[] => {
    const previousMap = new Map(previous.map((item) => [item.id, item]))
    const currentMap = new Map(current.map((item) => [item.id, item]))
    const incomingMap = new Map(incoming.map((item) => [item.id, item]))
    const result: Value[] = []
    for (const id of new Set([...currentMap.keys(), ...incomingMap.keys(), ...previousMap.keys()])) {
      const item = choose(kind + ':' + id, (kind === 'hosts' ? 'Sunucu: ' : 'Kestirme: ') + (currentMap.get(id)?.name ?? incomingMap.get(id)?.name ?? id), previousMap.get(id), currentMap.get(id), incomingMap.get(id))
      if (item) result.push(structuredClone(item))
    }
    return result
  }
  const previous = base && portableVault(base)
  const current = portableVault(local)
  const incoming = portableVault(remote)
  const knownHosts: Record<string, string> = Object.create(null)
  for (const hostname of new Set([...Object.keys(previous?.knownHosts ?? {}), ...Object.keys(current.knownHosts), ...Object.keys(incoming.knownHosts)])) {
    const fingerprint = choose('knownHosts:' + hostname, 'Sunucu kimliği: ' + hostname, previous?.knownHosts[hostname], current.knownHosts[hostname], incoming.knownHosts[hostname])
    if (fingerprint !== undefined) knownHosts[hostname] = fingerprint
  }
  return { vault: validateVault({ version: 1, hosts: records('hosts', previous?.hosts ?? [], current.hosts, incoming.hosts), snippets: records('snippets', previous?.snippets ?? [], current.snippets, incoming.snippets), knownHosts, sync: current.sync }), conflicts }
}
