import type { LogSource, ManagedItem } from '../src/shared'

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
export function managedTarget(kind: 'docker' | 'service', target: string): string {
  if (!['docker', 'service'].includes(kind) || typeof target !== 'string' || target.length > 255 || !(kind === 'docker' ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/ : /^[a-zA-Z0-9_][a-zA-Z0-9_.@:\\-]*\.service$/).test(target)) throw new Error('Geçersiz Docker veya servis hedefi.')
  return quote(target)
}
export function listCommand(kind: 'docker' | 'service'): string {
  if (kind === 'docker') return "docker ps -a --no-trunc --format '{{json .}}'"
  if (kind === 'service') return 'LC_ALL=C systemctl list-units --type=service --all --no-legend --no-pager --plain'
  throw new Error('Geçersiz yönetim türü.')
}
export function actionCommand(kind: 'docker' | 'service', target: string, action: string): string {
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Geçersiz işlem.')
  return (kind === 'docker' ? 'docker ' : 'systemctl --no-ask-password ') + action + ' -- ' + managedTarget(kind, target)
}
export function parseManaged(kind: 'docker' | 'service', text: string): ManagedItem[] {
  return text.split('\n').filter((line) => line.trim()).slice(0, 2000).map((line) => {
    if (kind === 'docker') {
      const item = JSON.parse(line)
      if (typeof item.ID !== 'string' || typeof item.Names !== 'string') throw new Error('Docker yanıtı okunamadı.')
      return { id: item.ID, name: item.Names, state: String(item.State ?? item.Status ?? ''), detail: String(item.Image ?? '') }
    }
    const parts = line.trim().split(/\s+/)
    return { id: parts[0], name: parts[0], state: parts[2] + ' / ' + parts[3], detail: parts.slice(4).join(' ') }
  })
}
export function logCommand(source: LogSource): string {
  if (!source || typeof source.target !== 'string') throw new Error('Geçersiz günlük kaynağı.')
  if (source.kind === 'docker') return 'docker logs --follow --tail 200 --timestamps -- ' + managedTarget('docker', source.target)
  if (source.kind === 'service') return 'journalctl --follow --lines=200 --no-pager --output=short-iso --unit=' + managedTarget('service', source.target)
  if (source.kind !== 'file' || !source.target.startsWith('/') || source.target.length > 4096 || /[\x00-\x1f\x7f]/.test(source.target)) throw new Error('Günlük için mutlak dosya yolu gir.')
  return 'tail -n 200 -F -- ' + quote(source.target)
}
