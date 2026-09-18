import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStats } from '../electron/ssh'
import { usageBetween } from '../src/stats'

const output = `__NODUS_CPU__
cpu 100 20 30 400 50 6 7 8 90 10
__NODUS_LOAD__
0.25 0.50 0.75 1/100 123
__NODUS_MEM__
Mem: 10000 3500 2000 500 4500 6000
__NODUS_DISK__
/dev/sda1 20000 8000 12000 40% /
__NODUS_NET__
lo: 9999 0 0 0 0 0 0 0 9999 0 0 0 0 0 0 0
eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0
eth1: 500 0 0 0 0 0 0 0 700 0 0 0 0 0 0 0
`

test('stats parse CPU without double-counting guests, available memory, root disk and non-loopback traffic', () => {
  assert.deepEqual(parseStats(output), { cpuTotal: 621, cpuIdle: 450, load1: 0.25, memTotal: 10000, memUsed: 4000, diskTotal: 20000, diskUsed: 8000, netRx: 1500, netTx: 2700 })
  for (const invalid of ['', output.replace('cpu 100', 'cpu invalid'), output.replace('20000 8000', '20000 30000'), output.replace('6000', '11000')]) assert.throws(() => parseStats(invalid), /sistem bilgisi/)
})

test('rates use sample intervals and tolerate counters resetting', () => {
  const previous = parseStats(output)
  const next = { ...previous, cpuTotal: previous.cpuTotal + 100, cpuIdle: previous.cpuIdle + 25, netRx: previous.netRx + 500, netTx: previous.netTx + 1000 }
  assert.deepEqual(usageBetween(previous, next, 5), { cpu: 75, rx: 100, tx: 200 })
  assert.deepEqual(usageBetween(next, previous, 5), { cpu: null, rx: 0, tx: 0 })
  assert.deepEqual(usageBetween(previous, previous, 0), { cpu: null, rx: 0, tx: 0 })
})
