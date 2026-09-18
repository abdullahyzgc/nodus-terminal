import test from 'node:test'
import assert from 'node:assert/strict'
import { actionCommand, listCommand, logCommand, managedTarget, parseManaged } from '../electron/operations'
import { renderWorkflow, workflowParameters } from '../src/workflows'
import { diffLines } from '../src/diff'

test('managed service and container targets are validated and quoted', () => {
  assert.equal(managedTarget('docker', 'web-1'), "'web-1'")
  assert.equal(managedTarget('service', 'nginx.service'), "'nginx.service'")
  assert.equal(actionCommand('docker', 'web-1', 'restart'), "docker restart -- 'web-1'")
  assert.equal(actionCommand('service', 'nginx.service', 'stop'), "systemctl --no-ask-password stop -- 'nginx.service'")
  for (const target of ['; rm -rf /', 'a b', '$(id)', 'web/../../etc', '', 5, 'x'.repeat(256)]) assert.throws(() => managedTarget('docker', target as string))
  for (const target of ['nginx', 'a b.service', '-flag.service', 'x;y.service']) assert.throws(() => managedTarget('service', target))
  assert.throws(() => actionCommand('docker', 'web', 'rm'))
  assert.throws(() => listCommand('podman' as 'docker'))
})

test('docker, systemd and file log commands stay read-only and shell-safe', () => {
  assert.equal(listCommand('docker'), "docker ps -a --no-trunc --format '{{json .}}'")
  assert.match(listCommand('service'), /^LC_ALL=C systemctl list-units/)
  assert.equal(logCommand({ kind: 'docker', target: 'web-1' }), "docker logs --follow --tail 200 --timestamps -- 'web-1'")
  assert.equal(logCommand({ kind: 'service', target: 'nginx.service' }), 'journalctl --follow --lines=200 --no-pager --output=short-iso --unit=' + "'nginx.service'")
  assert.equal(logCommand({ kind: 'file', target: "/var/log/it's.log" }), "tail -n 200 -F -- '/var/log/it'\\''s.log'")
  for (const target of ['relative.log', '/var/log/ok.log\nrm -rf /', '', '/x'.repeat(3000)]) assert.throws(() => logCommand({ kind: 'file', target }))
  assert.equal(logCommand({ kind: 'file', target: '/var/log/app;v1.log' }), "tail -n 200 -F -- '/var/log/app;v1.log'")
})

test('docker and systemd listings map to bounded records', () => {
  const containers = parseManaged('docker', JSON.stringify({ ID: 'a'.repeat(64), Names: 'web-1', State: 'running', Status: 'Up', Image: 'nginx:latest' }))
  assert.deepEqual(containers, [{ id: 'a'.repeat(64), name: 'web-1', state: 'running', detail: 'nginx:latest' }])
  assert.throws(() => parseManaged('docker', '{"ID":"x"}'))
  const services = parseManaged('service', 'nginx.service loaded active running A high performance web server')
  assert.deepEqual(services, [{ id: 'nginx.service', name: 'nginx.service', state: 'active / running', detail: 'A high performance web server' }])
  assert.equal(parseManaged('service', Array.from({ length: 2100 }, (_value, index) => 's' + index + '.service loaded active running x').join('\n')).length, 2000)
})

test('workflow parameters are detected, quoted and unsafe syntax is rejected', () => {
  assert.deepEqual(workflowParameters('git checkout -- {{dal}}\ngit pull origin {{dal}}\necho {{dal}}'), ['dal'])
  assert.equal(renderWorkflow('git checkout -- {{dal}}\nprintf %s {{mesaj}}', { dal: 'feature/özel', mesaj: 'a b' }), "set -e\ngit checkout -- 'feature/özel'\nprintf %s 'a b'")
  assert.equal(renderWorkflow("echo {{x}}", { x: "it's" }), "set -e\necho 'it'\\''s'")
  assert.equal(renderWorkflow('echo sabit', {}), 'set -e\necho sabit')
  assert.equal(renderWorkflow('\n\necho iki\n\n', {}), 'set -e\necho iki')
  assert.throws(() => renderWorkflow('echo {{dal}}', { dal: 'a\nb' }))
  assert.equal(renderWorkflow('echo {{dal}}', { dal: '$(id)' }), "set -e\necho '$(id)'")
  assert.throws(() => renderWorkflow('echo {{dal}}', {}))
  assert.throws(() => renderWorkflow('echo "{{dal}}"', { dal: 'x' }))
  assert.throws(() => renderWorkflow('echo {{dal}}x', { dal: 'x' }))
  assert.throws(() => renderWorkflow('echo $(id)', {}))
  assert.throws(() => renderWorkflow('cat <<EOF', {}))
  assert.throws(() => renderWorkflow('echo `id`', {}))
  for (const command of ['false; echo continued', 'false | true', 'sleep 10 &', 'false && echo skipped', 'set +e', 'if true', 'echo (subshell)']) assert.throws(() => renderWorkflow(command, {}))
  assert.throws(() => renderWorkflow('echo "unterminated', {}))
  assert.throws(() => renderWorkflow(Array.from({ length: 31 }, (_value, index) => 'echo ' + index).join('\n'), {}))
  assert.throws(() => renderWorkflow('echo {{' + 'a'.repeat(45) + '}}', { ['a'.repeat(45)]: 'x' }))
})

test('diff produces minimal edits for insertions, deletions and replacements', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nb\nc').map((line) => line.kind), ['same', 'same', 'same'])
  assert.deepEqual(diffLines('a\nb', 'a\nx\nb').map((line) => [line.kind, line.text]), [['same', 'a'], ['add', 'x'], ['same', 'b']])
  const removed = diffLines('a\nb\nc', 'a\nc')
  assert.deepEqual(removed.map((line) => line.kind), ['same', 'remove', 'same'])
  assert.deepEqual(removed[1].before, 2)
  const replaced = diffLines('bir\niki', 'bir\nüç')
  assert.equal(replaced.filter((line) => line.kind === 'remove').length, 1)
  assert.equal(replaced.filter((line) => line.kind === 'add').length, 1)
  assert.equal(replaced[0].after, 1)
  assert.deepEqual(diffLines('', '').map((line) => line.kind), ['same'])
  assert.equal(diffLines('x'.repeat(10) + '\n' + 'y'.repeat(10), 'x'.repeat(10) + '\n' + 'z'.repeat(10)).length, 3)
})

test('large diffs stay bounded and handle insertions without argument overflow', () => {
  const before = Array.from({ length: 7000 }, (_value, index) => 'old ' + index).join('\n')
  const after = Array.from({ length: 7000 }, (_value, index) => 'new ' + index).join('\n')
  const result = diffLines(before, after)
  assert.equal(result.length, 14000)
  assert.equal(result[0].kind, 'remove')
  assert.equal(result[7000].kind, 'add')
})
