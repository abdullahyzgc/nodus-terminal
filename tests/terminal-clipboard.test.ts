import test from 'node:test'
import assert from 'node:assert/strict'
import { installTerminalClipboard } from '../src/terminal-clipboard'

function fixture() {
  let handler: (event: KeyboardEvent) => boolean = () => true
  let selection = ''
  let allowed = true
  const copies: string[] = []
  const pastes: string[] = []
  const errors: string[] = []
  const clipboard = {
    readClipboard: async () => 'Türkçe içerik\nikinci satır',
    writeClipboard: async (text: string) => { copies.push(text) },
  }
  const stop = installTerminalClipboard({
    attachCustomKeyEventHandler: (listener) => { handler = listener },
    hasSelection: () => !!selection,
    getSelection: () => selection,
    paste: (text) => { pastes.push(text) },
  }, clipboard, (message) => errors.push(message), () => allowed)
  function press(key: string, modifiers: Partial<KeyboardEvent> = {}) {
    let prevented = false; let stopped = false
    const event = { key, type: 'keydown', ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false, ...modifiers, preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true } } as KeyboardEvent
    const passThrough = handler(event)
    return { passThrough, prevented, stopped }
  }
  return { clipboard, copies, pastes, errors, stop, press, select: (text: string) => { selection = text }, allow: (value: boolean) => { allowed = value } }
}

test('Ctrl+C copies selected terminal text but otherwise preserves SIGINT', () => {
  const terminal = fixture()
  assert.deepEqual(terminal.press('c', { ctrlKey: true }), { passThrough: true, prevented: false, stopped: false })
  terminal.select('echo Türkçe')
  assert.deepEqual(terminal.press('c', { ctrlKey: true }), { passThrough: false, prevented: true, stopped: true })
  assert.deepEqual(terminal.copies, ['echo Türkçe'])
  terminal.press('C', { ctrlKey: true, shiftKey: true })
  terminal.press('c', { metaKey: true })
  assert.equal(terminal.copies.length, 3)
  terminal.select('')
  assert.equal(terminal.press('C', { ctrlKey: true, shiftKey: true }).passThrough, false)
  assert.equal(terminal.press('c', { metaKey: true }).passThrough, false)
  assert.equal(terminal.copies.length, 3)
})

test('paste shortcuts use terminal.paste once without native paste or control bytes', async () => {
  for (const [key, modifiers] of [
    ['v', { ctrlKey: true }], ['V', { ctrlKey: true, shiftKey: true }],
    ['v', { metaKey: true }], ['Insert', { shiftKey: true }],
  ] as const) {
    const terminal = fixture()
    assert.deepEqual(terminal.press(key, modifiers), { passThrough: false, prevented: true, stopped: true })
    terminal.press(key, { ...modifiers, repeat: true })
    terminal.press(key, { ...modifiers, type: 'keyup' })
    await Promise.resolve()
    assert.deepEqual(terminal.pastes, ['Türkçe içerik\nikinci satır'])
  }
})

test('normal typing, AltGr, and non-clipboard control keys are untouched', () => {
  const terminal = fixture()
  for (const [key, modifiers] of [
    ['v', {}], ['c', {}], ['a', { ctrlKey: true }], ['Insert', {}],
    ['v', { ctrlKey: true, altKey: true }], ['c', { metaKey: true, altKey: true }],
  ] as const) assert.equal(terminal.press(key, modifiers).passThrough, true)
  assert.deepEqual(terminal.copies, [])
  assert.deepEqual(terminal.pastes, [])
})

test('pending paste is discarded when terminal closes or is no longer writable', async () => {
  for (const dispose of [false, true]) {
    const terminal = fixture()
    let resolveRead!: (text: string) => void
    terminal.clipboard.readClipboard = () => new Promise<string>((resolve) => { resolveRead = resolve })
    terminal.press('v', { ctrlKey: true })
    if (dispose) terminal.stop(); else terminal.allow(false)
    resolveRead('must not be sent')
    await Promise.resolve()
    assert.deepEqual(terminal.pastes, [])
  }
  const terminal = fixture()
  let reads = 0
  terminal.clipboard.readClipboard = async () => { reads++; return '' }
  terminal.allow(false)
  terminal.press('v', { ctrlKey: true })
  assert.equal(reads, 0)
})

test('clipboard errors are reported without leaking content', async () => {
  const terminal = fixture()
  terminal.clipboard.readClipboard = async () => { throw new Error('private text') }
  terminal.clipboard.writeClipboard = async () => { throw new Error('private text') }
  terminal.press('v', { ctrlKey: true })
  terminal.select('selected secret'); terminal.press('c', { ctrlKey: true })
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(terminal.errors.sort(), ['Pano okunamadı.', 'Panoya kopyalanamadı.'])
})
