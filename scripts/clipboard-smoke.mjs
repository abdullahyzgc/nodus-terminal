import { _electron as electron, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'

const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const environment = { ...process.env, NODUS_TEST_DATA: mkdtempSync(join(root, '.test-data', 'clipboard-')) }
delete environment.NODUS_DEV; delete environment.ELECTRON_RUN_AS_NODE
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const clients = new Set()
const received = []
const passwords = []
let channel
const server = new ssh2.Server({ hostKeys: [key] }, (client) => {
  clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client))
  client.on('authentication', (context) => {
    if (context.method === 'password') passwords.push(context.password)
    if (context.method === 'password' && context.password === 'clipboard-fixture-password') context.accept()
    else context.reject(['password'])
  })
  client.on('ready', () => client.on('session', (accept) => {
    const session = accept()
    session.on('pty', (acceptPty) => acceptPty?.())
    session.on('window-change', (acceptResize) => acceptResize?.())
    session.on('exec', (_acceptExec, reject) => reject())
    session.on('shell', (acceptShell) => {
      channel = acceptShell(); channel.on('error', () => {})
      channel.write('\x1b[2J\x1b[HNODUS_COPY_FIXTURE\r\n')
      channel.on('data', (chunk) => received.push(chunk.toString('utf8')))
    })
  }))
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
let application
try {
  application = await electron.launch({ args: [root], env: environment })
  const page = await application.firstWindow()
  const failures = []; page.on('pageerror', (error) => failures.push(error.message))
  await application.evaluate(({ clipboard, dialog }) => {
    globalThis.originalClipboardText = clipboard.readText()
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  const writeClipboard = (text) => application.evaluate(({ clipboard }, text) => clipboard.writeText(text), text)
  const readClipboard = () => application.evaluate(({ clipboard }) => clipboard.readText())
  expect(await page.evaluate(() => window.nodus.readClipboard().then(() => 'unexpected success', () => 'locked'))).toBe('locked')
  await page.evaluate(async (port) => {
    await window.nodus.unlock('isolated-clipboard-vault', false, true)
    await window.nodus.saveHost({ id: 'clipboard-fixture', name: 'Clipboard fixture', hostname: '127.0.0.1', port, username: 'tester', group: 'Test', color: '#8aacf2', authType: 'password', password: '', privateKey: '', passphrase: '', favorite: false, initialPath: '', followDirectory: false })
  }, server.address().port)
  await page.reload()
  await page.locator('.host-card').filter({ hasText: 'Clipboard fixture' }).getByRole('button', { name: 'Bağlan', exact: true }).click()
  const prompt = page.getByTestId('password-terminal')
  await expect(prompt).toContainText('Parola:')
  await writeClipboard('clipboard-fixture-password')
  await prompt.locator('textarea').focus(); await page.keyboard.press('Control+v')
  await expect(prompt).not.toContainText('clipboard-fixture-password')
  await page.keyboard.press('Enter')
  const terminal = page.getByTestId('terminal')
  await expect(terminal).toContainText('NODUS_COPY_FIXTURE')
  expect(passwords).toEqual(['clipboard-fixture-password'])
  expect((await page.evaluate(() => window.nodus.read())).hosts[0].password).toBe('')
  const screen = terminal.locator('.xterm-screen')
  await screen.dblclick({ position: { x: 25, y: 8 } })
  await expect(terminal.locator('.xterm-selection div')).not.toHaveCount(0)
  const countBeforeCopy = received.join('').length
  await page.keyboard.press('Control+c')
  await expect.poll(readClipboard).toBe('NODUS_COPY_FIXTURE')
  expect(received.join('').length).toBe(countBeforeCopy)
  await page.keyboard.press('Control+Shift+c')
  await expect.poll(readClipboard).toBe('NODUS_COPY_FIXTURE')
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 600))
  await screen.click({ position: { x: 400, y: 120 } })
  await terminal.locator('textarea').focus(); await page.keyboard.press('Control+c')
  await expect.poll(() => received.join('').slice(countBeforeCopy)).toBe('\x03')
  for (const [shortcut, text] of [
    ['Control+v', 'echo Türkçe içerik'],
    ['Control+Shift+v', 'second paste'],
    ['Shift+Insert', 'third paste'],
  ]) {
    await writeClipboard(text)
    const before = received.join('').length
    await terminal.locator('textarea').focus(); await page.keyboard.press(shortcut)
    await expect.poll(() => received.join('').slice(before)).toBe(text)
  }
  channel.write('\x1b[?2004hBRACKETED_READY\r\n')
  await expect(terminal).toContainText('BRACKETED_READY')
  await writeClipboard('line one\nline two')
  const beforeBracketed = received.join('').length
  await page.keyboard.press('Control+v')
  await expect.poll(() => received.join('').slice(beforeBracketed)).toBe('\x1b[200~line one\rline two\x1b[201~')
  await writeClipboard('x'.repeat(1024 * 1024 + 1))
  const beforeLargePaste = received.join('').length
  await page.keyboard.press('Control+v')
  await expect(page.getByRole('status').filter({ hasText: 'Pano okunamadı.' })).toBeVisible()
  expect(received.join('').length).toBe(beforeLargePaste)
  await page.evaluate(() => window.nodus.lock())
  await expect(page.getByLabel('Kasa parolası', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.nodus.readClipboard().then(() => 'unexpected success', () => 'locked'))).toBe('locked')
  expect(await page.evaluate(() => window.nodus.writeClipboard('blocked').then(() => 'unexpected success', () => 'locked'))).toBe('locked')
  expect(failures).toEqual([])
  console.log('PASS: password paste without echo/storage; selected Ctrl+C; SIGINT without selection; Ctrl+V, Ctrl+Shift+C/V, Shift+Insert; bracketed paste; clipboard limits and vault lock.')
} finally {
  if (application) {
    await application.evaluate(({ clipboard }) => { if (typeof globalThis.originalClipboardText === 'string') clipboard.writeText(globalThis.originalClipboardText) }).catch(() => {})
    await application.close()
  }
  for (const client of clients) client.end()
  await new Promise((resolveClose) => server.close(resolveClose))
}
