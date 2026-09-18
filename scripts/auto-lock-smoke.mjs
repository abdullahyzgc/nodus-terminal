import { _electron as electron, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const directory = mkdtempSync(join(root, '.test-data', 'auto-lock-'))
const environment = { ...process.env, NODUS_TEST_DATA: directory }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.NODUS_DEV
const password = 'auto-lock-test-password'
const failures = []
let application
let page

async function launch() {
  application = await electron.launch({ args: [root], env: environment })
  page = await application.firstWindow()
  page.on('pageerror', (error) => failures.push(error.message))
  await application.evaluate(() => {
    const originalNow = Date.now
    globalThis.nodusTestOffset = 0
    Date.now = () => originalNow() + globalThis.nodusTestOffset
  })
}

async function advance(minutes) {
  await application.evaluate((_electron, value) => { globalThis.nodusTestOffset += value * 60000 }, minutes)
}

async function unlock() {
  await page.getByLabel('Kasa parolası', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Kasanın kilidini aç', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ayarlar', exact: true })).toBeVisible()
}

try {
  await launch()
  await page.getByLabel('Kasa parolası', { exact: true }).fill(password)
  await page.getByLabel('Parolayı doğrula').fill(password)
  await page.getByRole('button', { name: 'Şifreli kasamı oluştur', exact: true }).click()
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByLabel('Kilit süresi (dakika)')).toHaveValue('15')
  expect(existsSync(join(directory, 'device-key.bin'))).toBe(true)

  await advance(14)
  await page.getByLabel('Kilit süresi (dakika)').click()
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(100)
  await advance(2)
  expect((await page.evaluate(() => window.nodus.status())).unlocked).toBe(true)

  await page.getByLabel('Kilit süresi (dakika)').fill('45')
  await page.getByRole('button', { name: 'Kilit ayarını kaydet' }).click()
  await expect(page.getByRole('region', { name: 'Otomatik kilit ayarları' }).getByRole('status')).toContainText('45 dakika')
  await advance(20)
  expect((await page.evaluate(() => window.nodus.status())).unlocked).toBe(true)

  await page.getByLabel('Hareketsizlikte kasayı otomatik kilitle').uncheck()
  await page.getByRole('button', { name: 'Kilit ayarını kaydet' }).click()
  await expect(page.getByRole('region', { name: 'Otomatik kilit ayarları' }).getByRole('status')).toContainText('Otomatik kilit kapatıldı.')
  await advance(2 * 1440)
  expect((await page.evaluate(() => window.nodus.status())).unlocked).toBe(true)
  await application.close()
  await launch()
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByLabel('Hareketsizlikte kasayı otomatik kilitle')).not.toBeChecked()
  expect(await page.evaluate(() => window.nodus.autoLockMinutes())).toBe(0)

  await page.getByLabel('Hareketsizlikte kasayı otomatik kilitle').check()
  await page.getByLabel('Kilit süresi (dakika)').fill('15')
  await page.getByRole('button', { name: 'Kilit ayarını kaydet' }).click()
  await expect(page.getByRole('region', { name: 'Otomatik kilit ayarları' }).getByRole('status')).toContainText('15 dakika')
  await page.screenshot({ path: join(directory, 'auto-lock-settings.png') })
  await page.getByRole('button', { name: 'Sunucular', exact: true }).click()
  await page.getByRole('button', { name: 'Sunucu ekle', exact: true }).first().click()
  await expect(page.locator('dialog[open]')).toBeVisible()
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await advance(16)
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
  await expect(page.getByRole('heading', { name: 'Kasanı aç.' })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  expect(await page.evaluate(() => window.nodus.status())).toMatchObject({ unlocked: false, remembered: false })
  expect(existsSync(join(directory, 'device-key.bin'))).toBe(false)
  expect(await page.evaluate(() => window.nodus.read().then(() => false, () => true))).toBe(true)
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); BrowserWindow.getAllWindows()[0].focus() })
  await page.screenshot({ path: join(directory, 'auto-locked.png') })
  await page.getByLabel('Kasa parolası', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Kasanın kilidini aç', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Kasa parolası yanlış')
  await unlock()
  await advance(16)
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kasanı aç.' })).toBeVisible()
  await application.close()
  await launch()
  await expect(page.getByRole('heading', { name: 'Kasanı aç.' })).toBeVisible()
  await unlock()
  expect(await page.evaluate(() => window.nodus.autoLockMinutes())).toBe(15)
  expect(failures).toEqual([])
  console.log('PASS: default timeout, user activity, longer duration, disabled setting, restart persistence, hidden/resume lock, modal cleanup, forgotten password, password challenge, expired input. Screenshots: ' + directory)
} finally {
  await application?.close()
}
