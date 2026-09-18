import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'

const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const directory = mkdtempSync(join(root, '.test-data', 'navigation-'))
const environment = { ...process.env, NODUS_TEST_DATA: directory }
delete environment.NODUS_DEV; delete environment.ELECTRON_RUN_AS_NODE
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const clients = new Set()
let connected = 0
const server = new ssh2.Server({ hostKeys: [key] }, (client) => {
  clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client))
  client.on('authentication', (context) => context.method === 'password' && context.password === 'navigation-fixture-password' ? context.accept() : context.reject(['password']))
  client.on('ready', () => client.on('session', (accept) => {
    const session = accept()
    session.on('pty', (acceptPty) => acceptPty?.())
    session.on('window-change', (acceptResize) => acceptResize?.())
    session.on('exec', (_acceptExec, reject) => reject())
    session.on('shell', (acceptShell) => {
      connected++
      const stream = acceptShell(); stream.on('error', () => {}); stream.on('data', () => {})
      stream.write('NAVIGATION_FIXTURE_READY\r\n')
    })
  }))
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
let application
try {
  application = await electron.launch({ args: [root], env: environment })
  const page = await application.firstWindow()
  const failures = []; page.on('pageerror', (error) => failures.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await page.evaluate(async (port) => {
    await window.nodus.unlock('isolated-navigation-vault', false, true)
    for (const [id, name, group, favorite] of [['navigation-one', 'Test sunucusu', 'Test grubu', true], ['navigation-two', 'Diğer sunucu', 'Diğer grup', false]]) {
      await window.nodus.saveHost({ id, name, group, favorite, hostname: '127.0.0.1', port, username: 'tester', color: '#8aacf2', authType: 'password', password: 'navigation-fixture-password', privateKey: '', passphrase: '', initialPath: '', followDirectory: false })
    }
  }, server.address().port)
  await page.reload()
  const rail = page.getByRole('navigation', { name: 'Hızlı gezinme' })
  const sidebar = page.locator('#workspace-sidebar')
  const toggle = rail.getByRole('button', { name: 'Menüyü aç', exact: true })
  const resize = async (width, height = 650) => {
    await application.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height), [width, height])
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
  }
  const fits = async () => {
    const bounds = await rail.boundingBox()
    expect(bounds.x).toBe(0); expect(bounds.width).toBe(65)
    await expect.poll(async () => (await page.locator('.main-content').boundingBox()).x).toBe(65)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(sidebar).toBeVisible()
  await expect(rail).toBeHidden()
  for (const width of [950, 800, 760]) {
    await resize(width, 560)
    await expect(rail).toBeVisible(); await expect(sidebar).toBeHidden(); await fits()
    for (const label of ['Menüyü aç', 'Sunucular', 'Favoriler', 'Kestirmeler', 'Hızlı erişim', 'Ayarlar', 'Kasayı kilitle']) {
      const button = rail.getByRole('button', { name: label, exact: true })
      await expect(button).toBeInViewport()
      await expect(button).toHaveAttribute('title', /.+/)
    }
    await toggle.click()
    await expect(sidebar).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => (await sidebar.boundingBox()).x).toBe(65)
    await sidebar.getByRole('button', { name: 'Menüyü kapat', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(sidebar).toBeHidden(); await expect(toggle).toBeFocused()
  }
  await rail.getByRole('button', { name: 'Favoriler', exact: true }).click()
  await expect(page.locator('.host-card')).toHaveCount(1)
  await expect(rail.getByRole('button', { name: 'Favoriler', exact: true })).toHaveAttribute('aria-current', 'page')
  await rail.getByRole('button', { name: 'Kestirmeler', exact: true }).click()
  await expect(page.locator('.snippets-page')).toBeVisible()
  await rail.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.locator('.settings-page')).toBeVisible()
  await rail.getByRole('button', { name: 'Hızlı erişim', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape')
  await toggle.click()
  await page.getByRole('button', { name: 'Menü dışına tıklayarak kapat' }).click({ position: { x: 450, y: 80 } })
  await expect(sidebar).toBeHidden(); await expect(toggle).toBeFocused()
  await toggle.click()
  await sidebar.getByRole('button', { name: /^Test grubu/ }).click()
  await expect(page.locator('.host-card')).toHaveCount(1)
  await expect(page.locator('.host-card')).toContainText('Test sunucusu')
  await expect(sidebar).toBeHidden()
  await rail.getByRole('button', { name: 'Sunucular', exact: true }).click()
  await expect(page.locator('.host-card')).toHaveCount(2)
  await page.screenshot({ path: join(directory, 'compact-hosts.png') })
  await toggle.click()
  await page.screenshot({ path: join(directory, 'compact-menu.png') })
  await resize(1100, 750)
  await expect(rail).toBeHidden(); await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await sidebar.boundingBox()).x).toBe(0)
  await expect.poll(async () => (await page.locator('.main-content').boundingBox()).x).toBe(210)
  await resize(1440, 930)
  await expect.poll(async () => (await page.locator('.main-content').boundingBox()).x).toBe(230)
  await resize(800, 650)
  await rail.getByRole('button', { name: 'Sunucular', exact: true }).click()
  await page.locator('.host-card').filter({ hasText: 'Test sunucusu' }).getByRole('button', { name: 'Bağlan', exact: true }).click()
  const terminal = page.getByTestId('terminal')
  await expect(terminal).toContainText('NAVIGATION_FIXTURE_READY')
  const terminalElement = await terminal.locator('.xterm').elementHandle()
  await fits()
  await toggle.click()
  await page.mouse.move(700, 350)
  await expect(sidebar).toBeVisible()
  await page.keyboard.press('Escape'); await expect(sidebar).toBeHidden()
  await rail.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.locator('.settings-page')).toBeVisible()
  await page.locator('.session-tab').getByRole('button', { name: 'Test sunucusu', exact: true }).click()
  await expect(terminal).toBeVisible()
  expect(await terminalElement.evaluate((element) => element.isConnected)).toBe(true)
  for (const width of [1440, 950, 760]) { await resize(width); await expect(terminal).toContainText('NAVIGATION_FIXTURE_READY') }
  await expect(rail).toBeVisible(); await fits(); expect(connected).toBe(1)
  await page.screenshot({ path: join(directory, 'compact-terminal.png') })
  await rail.getByRole('button', { name: 'Kasayı kilitle', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Kasa kilitlensin mi?')
  await page.getByRole('dialog').getByRole('button', { name: 'Kasayı kilitle', exact: true }).click()
  await expect(page.getByLabel('Kasa parolası', { exact: true })).toBeVisible()
  await expect(rail).toBeHidden()
  expect(failures).toEqual([])
  console.log('PASS: compact rail at 760/800/950px, navigation, groups, scrim/Escape focus, wide layout, preserved SSH terminal and vault lock. Screenshots: ' + directory)
} finally {
  await application?.close(); for (const client of clients) client.end()
  await new Promise((resolveClose) => server.close(resolveClose))
}
