import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileRevision } from '../src/shared'
import type { VaultStore } from './vault'

export class FileHistory {
  constructor(private directory: string, private store: VaultStore) {}
  private key(identity: string): string { return createHash('sha256').update(identity).digest('hex') }
  list(identity: string): FileRevision[] {
    const key = this.key(identity)
    const path = join(this.directory, key + '.json')
    if (!existsSync(path)) return []
    if (statSync(path).size > 8 * 1024 * 1024) throw new Error('Dosya geçmişi boyut sınırını aşıyor.')
    return JSON.parse(this.store.openLocal(readFileSync(path, 'utf8'), key))
  }
  add(identity: string, text: string): void {
    if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Yedek 512 KB sınırını aşıyor.')
    const key = this.key(identity)
    const entries = this.list(identity)
    if (entries[0]?.text === text) return
    entries.unshift({ id: randomUUID(), created: new Date().toISOString(), text })
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const path = join(this.directory, key + '.json')
    writeFileSync(path + '.tmp', this.store.sealLocal(JSON.stringify(entries.slice(0, 5)), key), { mode: 0o600 })
    renameSync(path + '.tmp', path)
    const files = readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => ({ path: join(this.directory, name), modified: statSync(join(this.directory, name)).mtimeMs })).sort((first, second) => second.modified - first.modified)
    for (const file of files.slice(20)) unlinkSync(file.path)
  }
}
