import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultAppearance, normalizeAppearance, palettes, themeTokens } from '../src/appearance'

test('appearance rejects invalid settings and bounds terminal dimensions', () => {
  for (const value of [null, [], 'invalid', { palette: 'missing', mode: 'invalid', uiFont: '__proto__', terminalFont: 'constructor', fontSize: NaN, lineHeight: Infinity }]) {
    assert.deepEqual(normalizeAppearance(value), defaultAppearance)
  }
  assert.deepEqual(normalizeAppearance({ palette: 'ocean', mode: 'system', uiFont: 'arial', terminalFont: 'consolas', fontSize: 100, lineHeight: -1 }), { palette: 'ocean', mode: 'system', uiFont: 'arial', terminalFont: 'consolas', fontSize: 24, lineHeight: 1.1 })
  assert.equal(normalizeAppearance({ fontSize: 0 }).fontSize, 11)
})

test('eight palettes provide complete dark/light colors and system mode follows OS', () => {
  assert.equal(palettes.length, 8)
  assert.equal(new Set(palettes.map((palette) => palette.id)).size, 8)
  const keys = Object.keys(themeTokens(defaultAppearance).tokens)
  for (const palette of palettes) {
    for (const mode of ['dark', 'light'] as const) {
      const result = themeTokens({ ...defaultAppearance, palette: palette.id, mode })
      assert.equal(result.mode, mode)
      assert.deepEqual(Object.keys(result.tokens), keys)
      for (const [key, value] of Object.entries(result.tokens)) {
        assert.ok(value, key)
        if (!key.includes('font') && !key.includes('line-height')) assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i)
      }
      assert.notEqual(result.tokens['--bg'], result.tokens['--text'])
    }
  }
  assert.equal(themeTokens({ ...defaultAppearance, mode: 'system' }, true).mode, 'light')
  assert.equal(themeTokens({ ...defaultAppearance, mode: 'system' }, false).mode, 'dark')
})
