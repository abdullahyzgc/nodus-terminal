import { _electron as electron, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'
import { testPersonalization } from './personalization-smoke.mjs'

const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const directory = mkdtempSync(join(root, '.test-data', 'features-'))
const environment = { ...process.env, NODUS_TEST_DATA: directory }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.NODUS_DEV
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const clients = new Set()
const passwords = []
const server = new ssh2.Server({ hostKeys: [key] }, (client) => {
  clients.add(client)
  client.on('error', () => {})
  client.on('close', () => clients.delete(client))
  client.on('authentication', (context) => {
    if (context.method === 'password') passwords.push(context.password)
    if (context.username === 'root' && context.method === 'password' && context.password === 'replacement-password') context.accept()
    else context.reject(['password'])
  })
  client.on('ready', () => client.on('session', (accept) => {
    const session = accept()
    session.on('pty', (acceptPty) => acceptPty?.())
    session.on('window-change', (acceptResize) => acceptResize?.())
    session.on('shell', (acceptShell) => {
      const stream = acceptShell()
      stream.write('Fixture connected\r\n')
      stream.on('data', () => {})
    })
  }))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
const failures = []
let application
try {
  application = await electron.launch({ args: [root], env: environment })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => failures.push(error.message))
  await page.getByLabel('Kasa parolası', { exact: true }).fill('isolated-test-vault-password')
  await page.getByLabel('Parolayı doğrula').fill('isolated-test-vault-password')
  await page.getByRole('button', { name: 'Şifreli kasamı oluştur' }).click()
  await expect(page.getByRole('button', { name: 'Hızlı sunucu', exact: true })).toBeVisible()
  for (const text of ['Şifreli kasa açık', 'Veriler bu cihazda korunur', 'Cihazlarını bağla']) await expect(page.getByText(text, { exact: true })).toHaveCount(0)
  await application.evaluate(({ dialog, ipcMain }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    const files = new Map([
      ['/fixture/readme.txt', { text: 'Merhaba\r\n', mode: 0o100644 }],
      ['/fixture/folder', { text: '', mode: 0o40755 }],
      ['/fixture/backup.zip', { text: 'fixture', mode: 0o100644 }],
    ])
    globalThis.featureFixture = { files }
    const handle = (channel, callback) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, ...args) => callback(...args)) }
    handle('sftp:list', (_id, path) => ({ path: path === '.' ? '/fixture' : path, entries: [...files].filter(([name]) => name.slice(0, name.lastIndexOf('/')) === (path === '.' ? '/fixture' : path)).map(([name, entry]) => ({ name: name.split('/').at(-1), kind: entry.mode & 0o40000 ? 'directory' : 'file', mode: entry.mode, size: Buffer.byteLength(entry.text), modified: 1700000000 })) }))
    handle('sftp:read', (_id, path) => ({ text: files.get(path).text, size: Buffer.byteLength(files.get(path).text) }))
    handle('sftp:write', (_id, path, text, create) => {
      if (create && files.has(path)) throw new Error('Already exists')
      files.set(path, { text, mode: files.get(path)?.mode ?? 0o100644 })
    })
    const revisions = new Map()
    handle('sftp:version:list', (_id, path) => revisions.get(path) ?? [])
    handle('sftp:version:save', (_id, path, text, expected, backup) => {
      if (files.get(path).text !== expected) throw new Error('Dosya sunucuda değişmiş.')
      if (backup) revisions.set(path, [{ id: 'fixture-revision', created: new Date().toISOString(), text: expected }, ...(revisions.get(path) ?? [])].slice(0, 5))
      files.get(path).text = text
    })
    handle('sftp:version:restore', (_id, path, revision, expected) => {
      if (files.get(path).text !== expected) throw new Error('Dosya sunucuda değişmiş.')
      const entry = revisions.get(path)?.find((item) => item.id === revision)
      if (!entry) throw new Error('Yedek bulunamadı.')
      files.get(path).text = entry.text
      return entry.text
    })
    handle('sftp:mkdir', (_id, path) => files.set(path, { text: '', mode: 0o40755 }))
    handle('sftp:rename', (_id, from, to) => { files.set(to, files.get(from)); files.delete(from) })
    handle('sftp:remove', (_id, paths) => { for (const path of paths) files.delete(path) })
    handle('sftp:chmod', (_id, path, mode) => { files.get(path).mode = (files.get(path).mode & ~0o7777) | mode })
    handle('sftp:archive', (_id, path, name, format, items) => {
      if (items.length !== 2) throw new Error('Expected two selected items')
      files.set(path + '/' + name + '.' + format, { text: '', mode: 0o100644 }); return name + '.' + format
    })
    handle('sftp:extract', (_id, path) => { files.set(path + '.extracted', { text: '', mode: 0o40755 }); return path + '.extracted' })
    let sample = 0
    handle('ssh:stats', () => { sample++; return { cpuTotal: sample * 100, cpuIdle: sample * 25, load1: 0.25, memUsed: 1024, memTotal: 4096, diskUsed: 1024, diskTotal: 8192, netRx: sample * 500, netTx: sample * 1000 } })
  })
  await page.getByRole('button', { name: 'Hızlı sunucu', exact: true }).click()
  await page.getByLabel('Sunucu adresi', { exact: true }).fill('127.0.0.1')
  await expect(page.getByLabel('Kullanıcı', { exact: true })).toHaveValue('root')
  await page.getByLabel('Port', { exact: true }).fill(String(port))
  await page.getByRole('dialog').getByRole('button', { name: 'Bağlan', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Parola bekleniyor' })).toBeVisible()
  expect((await page.evaluate(() => window.nodus.read())).hosts[0]).toMatchObject({ name: '127.0.0.1', group: 'Diğer', username: 'root', password: '' })
  expect(passwords).toEqual([])
  const passwordTerminal = page.getByTestId('password-terminal')
  async function enterPassword(password) {
    await passwordTerminal.locator('textarea').focus()
    await page.keyboard.type(password); await page.keyboard.press('Enter')
  }
  await enterPassword('wrong-password')
  await expect(passwordTerminal).toContainText('Parola kabul edilmedi', { timeout: 15000 })
  await expect(passwordTerminal).not.toContainText('wrong-password')
  await enterPassword('replacement-password')
  const panel = page.locator('.workspace:not(.inactive)').getByRole('complementary', { name: 'SFTP dosyaları' })
  await expect(panel).toBeVisible({ timeout: 15000 })
  expect((await page.evaluate(() => window.nodus.read())).hosts[0].password).toBe('')
  expect(passwords).toEqual(['wrong-password', 'replacement-password'])
  await expect(page.locator('.statsbar')).toContainText('RAM')
  await expect(page.locator('.statsbar')).toContainText('75%', { timeout: 12000 })
  const fileRow = (name) => panel.locator('.file-row').filter({ has: page.getByRole('checkbox', { name: name + ' seç', exact: true }) })
  await expect(fileRow('readme.txt')).toBeVisible()
  const before = await panel.boundingBox()
  const separator = page.getByRole('separator', { name: 'SFTP panel genişliği' })
  const bounds = await separator.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x - 180, bounds.y + bounds.height / 2, { steps: 10 })
  await page.mouse.up()
  expect((await panel.boundingBox()).width).toBeGreaterThan(before.width + 100)
  for (const label of ['Yeni klasör oluştur', 'Yeni dosya oluştur', 'Dosya yükle', 'Dosyaları yenile']) await expect(panel.getByRole('button', { name: label, exact: true })).toHaveAttribute('title', label)
  await fileRow('readme.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Düzenle', exact: true }).click()
  await expect(page.getByLabel('Dosya içeriği')).toHaveValue('Merhaba\n')
  await page.getByLabel('Dosya içeriği').fill('Güncel Türkçe\nİkinci satır\n')
  await page.getByLabel('Dosya içeriği').press('Control+s')
  await expect(page.getByLabel('Dosya farkları')).toContainText('İkinci satır')
  await page.screenshot({ path: join(directory, 'file-review.png') })
  await page.getByRole('button', { name: 'Değişiklikleri kaydet', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Kaydedildi')
  expect(await application.evaluate(() => globalThis.featureFixture.files.get('/fixture/readme.txt').text)).toBe('Güncel Türkçe\r\nİkinci satır\r\n')
  await panel.getByRole('button', { name: 'Fark / Geçmiş', exact: true }).click()
  await page.getByLabel('Karşılaştırılacak sürüm').selectOption('fixture-revision')
  await page.getByRole('button', { name: 'Bu sürüme geri dön', exact: true }).click()
  await expect(page.getByLabel('Dosya içeriği')).toHaveValue('Merhaba\n')
  await page.getByLabel('Dosya içeriği').fill('Kaydedilmemiş değişiklik')
  await panel.getByRole('button', { name: 'Editörü kapat', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Kaydedilmemiş değişiklikler')
  await page.getByRole('button', { name: 'Düzenlemeye dön', exact: true }).click()
  await panel.getByRole('button', { name: 'Editörü kapat', exact: true }).click()
  await page.getByRole('button', { name: 'Değişiklikleri bırak', exact: true }).click()
  await fileRow('readme.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Yetkileri düzenle', exact: true }).click()
  await page.getByLabel('Sekizlik yetki').fill('640')
  await page.getByRole('button', { name: 'Uygula', exact: true }).click()
  await expect(fileRow('readme.txt')).toContainText('640')
  for (const [label, name] of [['Yeni klasör oluştur', 'new-folder'], ['Yeni dosya oluştur', 'new.txt']]) {
    await panel.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('dialog').getByLabel('Ad', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Uygula', exact: true }).click()
    await expect(fileRow(name)).toBeVisible()
  }
  await fileRow('new.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Yeniden adlandır', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Ad', { exact: true }).fill('renamed.txt')
  await page.getByRole('button', { name: 'Uygula', exact: true }).click()
  await expect(fileRow('renamed.txt')).toBeVisible()
  await panel.getByRole('checkbox', { name: 'new-folder seç', exact: true }).check()
  await panel.getByRole('checkbox', { name: 'renamed.txt seç', exact: true }).check()
  await fileRow('renamed.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Arşivle (2)', exact: true }).click()
  await page.getByLabel('Arşiv biçimi').selectOption('tar.gz')
  await page.getByRole('button', { name: 'Uygula', exact: true }).click()
  await expect(fileRow('arsiv.tar.gz')).toBeVisible()
  await fileRow('backup.zip').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Arşivi aç', exact: true }).click()
  await page.getByRole('button', { name: 'Uygula', exact: true }).click()
  await expect(fileRow('backup.zip.extracted')).toBeVisible()
  await fileRow('renamed.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Sil (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click()
  await expect(fileRow('renamed.txt')).toBeVisible()
  await fileRow('renamed.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Sil (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Kalıcı olarak sil', exact: true }).click()
  await expect(fileRow('renamed.txt')).toHaveCount(0)
  await page.screenshot({ path: join(directory, 'sftp.png') })
  await panel.getByRole('button', { name: 'Dosya panelini daralt', exact: true }).click()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: 'Dosya panelini aç veya kapat', exact: true }).click()
  await expect(panel).toBeVisible()
  await testPersonalization(application, page, directory)
  for (const [name, password] of [['Saved outdated password', 'old-password'], ['Manual password', '']]) {
    await page.getByRole('button', { name: 'Sunucular', exact: true }).click()
    await page.getByRole('button', { name: 'Yeni sunucu', exact: true }).click()
    await page.getByLabel('Sunucu adı', { exact: true }).fill(name)
    await page.getByLabel('Adres', { exact: true }).fill('127.0.0.1')
    await page.getByLabel('Port', { exact: true }).fill(String(port))
    if (password) {
      await page.getByLabel('Sunucu parolası', { exact: true }).fill(password)
      await page.getByLabel('Parolayı kasaya kaydet', { exact: true }).check()
    }
    await page.getByRole('button', { name: 'Kaydet ve bağlan', exact: true }).click()
    await expect(passwordTerminal).toContainText(password ? 'Parola kabul edilmedi' : 'Parola:', { timeout: 15000 })
    await enterPassword('replacement-password')
    await expect(panel).toBeVisible({ timeout: 15000 })
    expect(await page.evaluate((hostName) => window.nodus.read().then((vault) => vault.hosts.find((host) => host.name === hostName).password), name)).toBe(password)
  }
  await page.evaluate(async () => {
    const vault = await window.nodus.read()
    for (const snippet of vault.snippets) await window.nodus.deleteSnippet(snippet.id)
    for (let index = 1; index <= 62; index++) await window.nodus.saveSnippet({ id: crypto.randomUUID(), name: 'Komut ' + index, command: 'echo ' + index, group: index % 2 ? 'Sistem' : 'Proje', confirm: true })
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nodus-appearance-v1')).fontSize)).toBe(16)
  await page.getByRole('button', { name: 'Kestirmeler', exact: true }).click()
  await expect(page.locator('.snippet-table tbody tr')).toHaveCount(25)
  await page.getByRole('button', { name: 'Sonraki sayfa', exact: true }).click()
  await expect(page.locator('.snippet-pagination')).toContainText('26–50 / 62')
  await page.getByLabel('Sayfadaki kestirme sayısı').selectOption('50')
  await expect(page.locator('.snippet-table tbody tr')).toHaveCount(50)
  await page.getByLabel('Kestirme grubu').selectOption('Sistem')
  await expect(page.locator('.snippet-table tbody tr')).toHaveCount(31)
  await page.getByLabel('Kestirme ara').fill('Komut 61')
  await expect(page.locator('.snippet-table tbody tr')).toHaveCount(1)
  await page.getByLabel('Kestirme ara').fill('')
  await page.screenshot({ path: join(directory, 'snippets.png') })
  expect(failures).toEqual([])
  console.log('PASS: actual SSH password retry, quick/manual/saved auth; fixture SFTP menus/editor/permissions/create/rename/delete/archive/extract; panel resize; stats; 62 snippets. Screenshots: ' + directory)
} finally {
  await application?.close()
  for (const client of clients) client.end()
  await new Promise((resolveClose) => server.close(resolveClose))
}
