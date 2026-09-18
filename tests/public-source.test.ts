import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const load = () => import('../scripts/' + 'public-source.mjs')

test('public source guard rejects keys, tokens and home paths without exposing their contents', async () => {
  const { scanText, forbiddenPath } = await load()
  const examples = ['ghp_' + 'a'.repeat(36), 'GOCSPX-' + 'a'.repeat(28), 'C:' + '/Users/' + 'sample/Documents', '-----BEGIN ' + 'PRIVATE KEY-----\n' + 'A'.repeat(64)]
  for (const secret of examples) {
    const findings = scanText(secret)
    assert.ok(findings.length)
    assert.ok(!JSON.stringify(findings).includes(secret))
  }
  assert.deepEqual(scanText('const server = "127.0.0.1";'), [])
  for (const path of ['vault.nodus', 'vault.nodus.tmp', '.env.local', 'test/client_secret_1.json', '.test-data/state', 'release/setup.exe', 'id_ed25519', 'google-drive.bin.tmp']) assert.ok(forbiddenPath(path), path)
  assert.ok(!forbiddenPath('package-lock.json'))
})

test('source export uses exact manifest, preserves private originals and refuses traversal', async () => {
  const { collectSource, exportSource } = await load()
  const root = mkdtempSync(join(tmpdir(), 'nodus-source-test-'))
  writeFileSync(join(root, 'public-files.json'), JSON.stringify({ files: ['public-files.json', 'README.md'] }))
  writeFileSync(join(root, 'README.md'), '# Fixture')
  writeFileSync(join(root, 'vault.nodus'), 'private fixture')
  const destination = exportSource(root)
  assert.deepEqual(readdirSync(destination).sort(), ['README.md', 'public-files.json'])
  assert.equal(readFileSync(join(root, 'vault.nodus'), 'utf8'), 'private fixture')
  assert.notEqual(exportSource(root), destination)
  writeFileSync(join(root, 'public-files.json'), JSON.stringify({ files: ['public-files.json', '../outside'] }))
  assert.throws(() => collectSource(root), /manifest/)
})

test('Git tracked sensitive files cannot bypass the manifest through ignore rules', async () => {
  const { collectSource } = await load()
  const root = mkdtempSync(join(tmpdir(), 'nodus-source-git-'))
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0)
  writeFileSync(join(root, 'public-files.json'), JSON.stringify({ files: ['public-files.json', '.gitignore'] }))
  writeFileSync(join(root, '.gitignore'), '*.nodus\n')
  writeFileSync(join(root, 'private.nodus'), 'fixture')
  assert.equal(collectSource(root).length, 2)
  assert.equal(spawnSync('git', ['add', '-f', 'private.nodus'], { cwd: root }).status, 0)
  assert.throws(() => collectSource(root), /manifest dışı/)
})

test('staged secrets are rejected even when the working file has already been cleaned', async () => {
  const { collectSource } = await load()
  const root = mkdtempSync(join(tmpdir(), 'nodus-source-index-'))
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0)
  writeFileSync(join(root, 'public-files.json'), JSON.stringify({ files: ['public-files.json', 'README.md'] }))
  writeFileSync(join(root, 'README.md'), 'ghp_' + 'a'.repeat(36))
  assert.equal(spawnSync('git', ['add', 'README.md'], { cwd: root }).status, 0)
  writeFileSync(join(root, 'README.md'), '# Clean file')
  assert.throws(() => collectSource(root), /Git index: README.md:1 \[github-token\]/)
  assert.equal(spawnSync('git', ['add', 'README.md'], { cwd: root }).status, 0)
  assert.equal(collectSource(root).length, 2)
})

test('Windows short paths and drive casing identify the same source repository', { skip: process.platform !== 'win32' }, async (context) => {
  const { collectSource, exportSource } = await load()
  const root = mkdtempSync(join(tmpdir(), 'nodus-source-windows-'))
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0)
  writeFileSync(join(root, 'public-files.json'), JSON.stringify({ files: ['public-files.json', 'README.md', '.gitignore'] }))
  writeFileSync(join(root, 'README.md'), '# Fixture')
  writeFileSync(join(root, '.gitignore'), '.public-export/\n')
  const shortPath = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:NODUS_SHORT_PATH_ROOT).ShortPath'], {
    env: { ...process.env, NODUS_SHORT_PATH_ROOT: root }, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(shortPath.status, 0, shortPath.stderr)
  const alias = shortPath.stdout.trim()
  assert.ok(alias)
  assert.equal(realpathSync.native(alias), realpathSync.native(root))
  if (alias === root) context.diagnostic('8.3 short names unavailable; drive casing is still checked.')
  for (const path of [alias, root[0].toLowerCase() + root.slice(1)]) {
    assert.equal(collectSource(path).length, 3)
    const destination = exportSource(path)
    assert.deepEqual(readdirSync(destination).sort(), ['.gitignore', 'README.md', 'public-files.json'])
  }
})

test('source collection still rejects a subdirectory of another Git repository', async () => {
  const { collectSource } = await load()
  const root = mkdtempSync(join(tmpdir(), 'nodus-source-parent-'))
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0)
  const nested = join(root, 'nested')
  mkdirSync(nested)
  writeFileSync(join(nested, 'public-files.json'), JSON.stringify({ files: ['public-files.json'] }))
  assert.throws(() => collectSource(nested), /bağımsız kaynak deposunun kökünde/)
})
