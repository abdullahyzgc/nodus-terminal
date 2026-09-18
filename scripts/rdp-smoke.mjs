import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('RDP integration test requires Windows.')
const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const directory = mkdtempSync(join(root, '.test-data', 'rdp-'))
const environment = { ...process.env, NODUS_TEST_DATA: directory }
delete environment.NODUS_DEV; delete environment.ELECTRON_RUN_AS_NODE
let application
try {
  application = await electron.launch({ args: [root], env: environment })
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await application.evaluate(({ dialog }) => {
    const childProcess = process.getBuiltinModule('node:child_process')
    const { EventEmitter } = process.getBuiltinModule('node:events')
    const { readFileSync } = process.getBuiltinModule('node:fs')
    const { basename } = process.getBuiltinModule('node:path')
    globalThis.rdpTest = { launches: [], children: [], approvals: [], accept: false, hold: false, resolve: null }
    globalThis.originalRdpSpawn = childProcess.spawn
    childProcess.spawn = (executable, args, options) => {
      if (basename(executable).toLowerCase() !== 'mstsc.exe') throw new Error('Unexpected process in RDP test')
      const child = new EventEmitter()
      child.unref = () => {}
      globalThis.rdpTest.launches.push({ executable, args, options, profile: readFileSync(args[0], 'utf16le') })
      globalThis.rdpTest.children.push(child)
      queueMicrotask(() => child.emit('spawn'))
      return child
    }
    dialog.showMessageBox = async (_window, options) => {
      globalThis.rdpTest.approvals.push(options)
      if (globalThis.rdpTest.hold) return new Promise((resolve) => { globalThis.rdpTest.resolve = resolve })
      return { response: globalThis.rdpTest.accept ? 1 : 0, checkboxChecked: false }
    }
  })
  expect(await page.evaluate(() => window.nodus.openRdp('unknown').then(() => 'unexpected', () => 'locked'))).toBe('locked')
  await page.evaluate(() => window.nodus.unlock('isolated-rdp-test-password', false, true))
  await page.reload()
  await page.getByRole('button', { name: 'Yeni sunucu', exact: true }).click()
  const form = page.getByRole('dialog')
  await expect(form.getByLabel('Bağlantı türü', { exact: true })).toHaveValue('ssh')
  await form.getByLabel('Sunucu parolası', { exact: true }).fill('ssh-secret-not-for-rdp')
  await form.getByLabel('Bağlantı türü', { exact: true }).selectOption('rdp')
  await expect(form.getByLabel('Port', { exact: true })).toHaveValue('3389')
  await expect(form.getByLabel('Kullanıcı', { exact: true })).toHaveValue('Administrator')
  await expect(form.getByLabel('Sunucu parolası', { exact: true })).toHaveCount(0)
  await expect(form.getByLabel('Kesintiye dayanıklı oturum (tmux)', { exact: true })).toHaveCount(0)
  await expect(form.getByLabel('Uzak bilgisayarla panoyu paylaş', { exact: true })).not.toBeChecked()
  await form.getByLabel('Sunucu adı', { exact: true }).fill('RDP test sunucusu')
  await form.getByLabel('Adres', { exact: true }).fill('192.0.2.25')
  await form.getByLabel('Kullanıcı', { exact: true }).fill('DOMAIN\\tester')
  await form.getByLabel('Tam ekran aç', { exact: true }).check()
  await form.getByLabel('Canlı sunucu:', { exact: false }).check()
  await page.screenshot({ path: join(directory, 'rdp-form.png') })
  await form.getByRole('button', { name: 'Sunucuyu kaydet', exact: true }).click()
  await expect(form).toHaveCount(0)
  const saved = (await page.evaluate(() => window.nodus.read())).hosts[0]
  expect(saved).toMatchObject({ protocol: 'rdp', port: 3389, username: 'DOMAIN\\tester', password: '', privateKey: '', passphrase: '', initialPath: '', followDirectory: false, persistentSession: false, rdp: { fullscreen: true, clipboard: false } })
  const card = page.locator('.host-card').filter({ hasText: 'RDP test sunucusu' })
  await expect(card).toContainText('RDP')
  await card.getByRole('button', { name: 'Uzak Masaüstü aç', exact: true }).click()
  await expect.poll(() => application.evaluate(() => globalThis.rdpTest.approvals.length)).toBe(1)
  expect(await application.evaluate(() => globalThis.rdpTest.launches.length)).toBe(0)
  await expect(page.getByTestId('password-terminal')).toHaveCount(0)
  await expect(page.locator('.session-tab')).toHaveCount(0)
  await application.evaluate(() => { globalThis.rdpTest.accept = true })
  await card.getByRole('button', { name: 'Uzak Masaüstü aç', exact: true }).click()
  await expect.poll(() => application.evaluate(() => globalThis.rdpTest.launches.length)).toBe(1)
  const launch = await application.evaluate(() => globalThis.rdpTest.launches[0])
  expect(launch.args).toHaveLength(1)
  expect(launch.options.shell).toBe(false)
  expect(launch.options.detached).toBe(true)
  expect(launch.profile).toContain('full address:s:192.0.2.25:3389\r\n')
  expect(launch.profile).toContain('username:s:DOMAIN\\tester\r\n')
  expect(launch.profile).toContain('screen mode id:i:2\r\n')
  expect(launch.profile).toContain('redirectclipboard:i:0\r\n')
  expect(launch.profile).not.toContain('ssh-secret-not-for-rdp')
  const approval = await application.evaluate(() => globalThis.rdpTest.approvals.at(-1))
  expect(approval.message).toContain('ÜRETİM')
  expect(approval.detail).toContain('RDP penceresi açık kalır')
  await expect(page.locator('.session-tab')).toHaveCount(0)
  await page.getByRole('button', { name: 'RDP test sunucusu düzenle', exact: true }).click()
  await expect(form.getByLabel('Bağlantı türü', { exact: true })).toHaveValue('rdp')
  await expect(form.getByLabel('Tam ekran aç', { exact: true })).toBeChecked()
  await form.getByLabel('Port', { exact: true }).fill('3390')
  await form.getByLabel('Uzak bilgisayarla panoyu paylaş', { exact: true }).check()
  await form.getByRole('button', { name: 'Kaydet ve bağlan', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect.poll(() => application.evaluate(() => globalThis.rdpTest.launches.length)).toBe(2)
  expect(await application.evaluate(() => globalThis.rdpTest.launches[1].profile)).toContain('full address:s:192.0.2.25:3390')
  expect(await application.evaluate(() => globalThis.rdpTest.approvals.at(-1).detail)).toContain('Pano paylaşımı açık')
  expect(await page.evaluate((id) => window.nodus.connect(id).then(() => 'unexpected', (error) => error.message), saved.id)).toContain('RDP')
  await page.screenshot({ path: join(directory, 'rdp-card.png') })
  await application.evaluate(() => { globalThis.rdpTest.hold = true })
  await page.evaluate((id) => { window.rdpPending = window.nodus.openRdp(id).then(() => 'unexpected', (error) => error.message) }, saved.id)
  await expect.poll(() => application.evaluate(() => typeof globalThis.rdpTest.resolve)).toBe('function')
  expect(await page.evaluate((id) => window.nodus.openRdp(id).then(() => 'unexpected', (error) => error.message), saved.id)).toContain('zaten açılıyor')
  await page.evaluate(() => window.nodus.lock())
  await application.evaluate(() => globalThis.rdpTest.resolve({ response: 1 }))
  expect(await page.evaluate(() => window.rdpPending)).toContain('Kasa kilitlendi')
  expect(await application.evaluate(() => globalThis.rdpTest.launches.length)).toBe(2)
  await expect(page.getByLabel('Kasa parolası', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  console.log('PASS: RDP form/defaults, encrypted record, SSH isolation, cancel/open, UTF-16 profile, fullscreen/clipboard, repeated launch and lock during confirmation. mstsc launch mocked; no remote connection. Screenshots: ' + directory)
} finally {
  if (application) {
    await application.evaluate(() => {
      for (const child of globalThis.rdpTest?.children ?? []) child.emit('exit', 0)
      if (globalThis.originalRdpSpawn) process.getBuiltinModule('node:child_process').spawn = globalThis.originalRdpSpawn
    }).catch(() => {})
    await application.close()
  }
}
