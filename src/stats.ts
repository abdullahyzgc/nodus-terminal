import type { ServerStats } from './shared'

export function usageBetween(previous: ServerStats, next: ServerStats, seconds: number) {
  const total = next.cpuTotal - previous.cpuTotal
  const idle = next.cpuIdle - previous.cpuIdle
  const cpu = total > 0 && idle >= 0 && idle <= total ? Math.round((1 - idle / total) * 100) : null
  const rx = seconds > 0 ? Math.max(0, (next.netRx - previous.netRx) / seconds) : 0
  const tx = seconds > 0 ? Math.max(0, (next.netTx - previous.netTx) / seconds) : 0
  return { cpu, rx, tx }
}
