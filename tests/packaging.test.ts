import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('CI and release workflows only invoke defined npm scripts', () => {
  assert.equal(manifest.scripts['source:check'], 'node scripts/public-source.mjs')
  for (const name of ['ci.yml', 'release.yml']) {
    const workflow = readFileSync(new URL('../.github/workflows/' + name, import.meta.url), 'utf8')
    for (const match of workflow.matchAll(/\bnpm run ([\w:-]+)/g)) {
      assert.ok(Object.hasOwn(manifest.scripts, match[1]), name + ' invokes missing script: ' + match[1])
    }
  }
})

test('Windows package edits executable icons without requiring code signing', () => {
  assert.equal(manifest.build.win.signAndEditExecutable, true)
  assert.equal(manifest.build.win.signExecutable, false)
  assert.equal(manifest.build.win.icon, 'assets/icon.ico')
  for (const field of ['installerIcon', 'uninstallerIcon', 'installerHeaderIcon']) assert.equal(manifest.build.nsis[field], manifest.build.win.icon)
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  assert.ok(main.includes("app.setAppUserModelId('" + manifest.build.appId + "')"))
})

test('Windows icon includes small shortcuts and high-resolution desktop sizes', () => {
  const icon = readFileSync(new URL('../' + manifest.build.win.icon, import.meta.url))
  assert.equal(icon.readUInt16LE(0), 0)
  assert.equal(icon.readUInt16LE(2), 1)
  const count = icon.readUInt16LE(4)
  assert.ok(icon.length >= 6 + count * 16)
  const sizes = new Set<number>()
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16
    const width = icon[entry] || 256
    const height = icon[entry + 1] || 256
    assert.equal(width, height)
    assert.ok(icon.readUInt32LE(entry + 12) >= 6 + count * 16)
    assert.ok(icon.readUInt32LE(entry + 12) + icon.readUInt32LE(entry + 8) <= icon.length)
    sizes.add(width)
  }
  for (const size of [16, 32, 48, 256]) assert.ok(sizes.has(size), 'Missing icon size: ' + size)
})
