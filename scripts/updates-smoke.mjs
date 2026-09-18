import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const directory = mkdtempSync(join(root, '.test-data', 'updates-'))
const environment = { ...process.env, NODUS_TEST_DATA: directory }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.NODUS_DEV
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const failures = []
let application

async function emit(state) {
  await application.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0].webContents.send('update:status', payload)
  }, { currentVersion: version, progress: 0, ...state })
}

try {
  application = await electron.launch({ args: [root], env: environment })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => failures.push(error.message))
  await expect(page.getByRole('heading', { name: 'Kendi alanını oluştur.' })).toBeVisible()
  expect(await page.evaluate(() => window.nodus.updateStatus())).toMatchObject({ currentVersion: version, phase: 'disabled' })
  expect((await page.evaluate(() => window.nodus.checkUpdates())).phase).toBe('disabled')
  expect((await page.evaluate(() => window.nodus.installUpdate())).phase).toBe('disabled')
  await page.getByLabel('Kasa parolası', { exact: true }).fill('updates-test-password')
  await page.getByLabel('Parolayı doğrula').fill('updates-test-password')
  await page.getByRole('button', { name: 'Şifreli kasamı oluştur', exact: true }).click()
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Uygulama güncellemeleri' })
  await expect(settings).toContainText('Kurulu sürüm: ' + version)
  await expect(settings.getByRole('button', { name: 'Güncellemeleri kontrol et' })).toBeDisabled()

  await emit({ phase: 'downloading', nextVersion: '0.1.2', progress: 42, message: 'Yeni sürüm indiriliyor.' })
  await expect(settings.getByRole('progressbar')).toHaveAttribute('value', '42')
  await expect(settings.getByRole('button', { name: 'Güncellemeleri kontrol et' })).toBeDisabled()
  await expect(page.getByRole('complementary', { name: 'Yeni sürüm bildirimi' })).toHaveCount(0)
  await emit({ phase: 'ready', nextVersion: '0.1.2', progress: 100, message: 'Güncelleme hazır.' })
  const notice = page.getByRole('complementary', { name: 'Yeni sürüm bildirimi' })
  await expect(notice).toContainText('Nodus 0.1.2 hazır')
  await expect(settings.getByRole('button', { name: 'Yeniden başlat ve güncelle' })).toBeVisible()
  await page.screenshot({ path: join(directory, 'update-ready.png') })
  await notice.getByRole('button', { name: 'Güncellemeyi sonraya bırak' }).click()
  await expect(notice).toHaveCount(0)
  await expect(settings.getByRole('button', { name: 'Yeniden başlat ve güncelle' })).toBeVisible()
  await emit({ phase: 'error', message: 'Güncelleme tamamlanamadı.' })
  await expect(settings.getByRole('button', { name: 'Güncellemeleri kontrol et' })).toBeEnabled()
  await expect(settings.getByRole('status')).toContainText('Güncelleme tamamlanamadı.')
  expect((await page.evaluate(() => window.nodus.openUpdateDownload())).phase).toBe('disabled')
  await application.evaluate(({ ipcMain }) => {
    globalThis.manualDownloadClicks = 0
    globalThis.unexpectedInstalls = 0
    ipcMain.removeHandler('update:download-page')
    ipcMain.handle('update:download-page', () => { globalThis.manualDownloadClicks++; return { phase: 'available', mode: 'manual' } })
    ipcMain.removeHandler('update:install')
    ipcMain.handle('update:install', () => { globalThis.unexpectedInstalls++; throw new Error('Manual update must not install') })
  })
  await emit({ mode: 'manual', phase: 'available', nextVersion: '0.1.4', message: 'Yeni Mac sürümü var. İndirme ve kurulum elle yapılır.' })
  await expect(notice.getByRole('button', { name: 'Mac sürümünü indir' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Mac sürümünü indir' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Güncellemeleri kontrol et' })).toBeEnabled()
  await expect(settings.getByRole('progressbar')).toHaveCount(0)
  await expect(settings.getByRole('button', { name: 'Yeniden başlat ve güncelle' })).toHaveCount(0)
  await notice.getByRole('button', { name: 'Mac sürümünü indir' }).click()
  await expect.poll(() => application.evaluate(() => globalThis.manualDownloadClicks)).toBe(1)
  await expect(page.getByRole('heading', { name: 'Kasanı aç.' })).toHaveCount(0)
  await notice.getByRole('button', { name: 'Güncellemeyi sonraya bırak' }).click()
  await expect(notice).toHaveCount(0)
  await settings.getByRole('button', { name: 'Mac sürümünü indir' }).click()
  await expect.poll(() => application.evaluate(() => globalThis.manualDownloadClicks)).toBe(2)
  expect(await application.evaluate(() => globalThis.unexpectedInstalls)).toBe(0)
  await page.screenshot({ path: join(directory, 'mac-update-manual.png') })
  await page.evaluate(() => window.nodus.lock())
  await expect(page.getByRole('heading', { name: 'Kasanı aç.' })).toBeVisible()
  await emit({ phase: 'ready', nextVersion: '0.1.3', progress: 100, message: 'Güncelleme hazır.' })
  await expect(notice).toContainText('Nodus 0.1.3 hazır')
  expect(failures).toEqual([])
  console.log('PASS: development guards, Windows progress/notice/retry, Mac manual download buttons without installation or locking, and locked-vault notice. UI states simulated; no external download or installation. Screenshots: ' + directory)
} finally {
  await application?.close()
}
