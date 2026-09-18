import { _electron as electron, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'

const root = resolve('.')
mkdirSync(join(root, '.test-data'), { recursive: true })
const directory = mkdtempSync(join(root, '.test-data', 'host-form-'))
const environment = { ...process.env, NODUS_TEST_DATA: directory }
delete environment.NODUS_DEV; delete environment.ELECTRON_RUN_AS_NODE
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const clients = new Set()
const commands = []
const inputs = []
const passwords = []
let hasTmux = false
let currentPath = '/srv/first'
const server = new ssh2.Server({ hostKeys: [key] }, (client) => {
  clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client))
  client.on('authentication', (context) => {
    if (context.method === 'password') passwords.push(context.password)
    if (context.method === 'password' && context.password === 'host-form-fixture-password') context.accept()
    else context.reject(['password'])
  })
  client.on('ready', () => client.on('session', (accept) => {
    const session = accept()
    session.on('pty', (acceptPty) => acceptPty?.()); session.on('window-change', (acceptResize) => acceptResize?.())
    session.on('shell', (acceptShell) => {
      const stream = acceptShell(); stream.on('error', () => {})
      stream.write('STANDARD_FIXTURE_READY\r\n')
      stream.on('data', (chunk) => {
        inputs.push(chunk.toString())
        if (chunk.toString().includes('__nodus_cwd')) stream.write('\x1b]7;file://localhost/srv/standard\x07')
      })
    })
    session.on('exec', (acceptExec, rejectExec, info) => {
      commands.push(info.command)
      if (info.command === 'command -v tmux') { const stream = acceptExec(); stream.exit(hasTmux ? 0 : 127); stream.end(); return }
      if (info.command.startsWith('tmux new-session')) { const stream = acceptExec(); stream.on('error', () => {}); stream.on('data', (chunk) => inputs.push(chunk.toString())); stream.write('TMUX_FIXTURE_READY\r\n'); return }
      if (info.command.startsWith('tmux display-message')) { const stream = acceptExec(); stream.write(currentPath + '\n'); stream.exit(0); stream.end(); return }
      rejectExec()
    })
    session.on('sftp', (acceptSftp) => {
      const sftp = acceptSftp()
      sftp.on('REALPATH', (request, path) => sftp.name(request, [{ filename: path === '.' ? '/home/tester' : path, longname: '', attrs: { mode: 0o40755, size: 0, uid: 1000, gid: 1000, atime: 0, mtime: 0 } }]))
      sftp.on('OPENDIR', (request) => sftp.handle(request, Buffer.from('dir')))
      sftp.on('READDIR', (request) => sftp.status(request, 1))
      sftp.on('CLOSE', (request) => sftp.status(request, 0))
    })
  }))
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
let application
try {
  application = await electron.launch({ args: [root], env: environment })
  const page = await application.firstWindow()
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await page.evaluate(() => window.nodus.unlock('isolated-host-form-vault', false, true))
  await page.reload()
  await page.getByRole('button', { name: 'Yeni sunucu', exact: true }).click()
  const form = page.getByRole('dialog')
  await expect(form.getByRole('checkbox', { name: 'Parolayı kasaya kaydet', exact: true })).toHaveCount(0)
  await expect(form.getByLabel('Başlangıç dizini (isteğe bağlı)', { exact: true })).toHaveCount(0)
  await expect(form.getByLabel('Dosya paneli terminal dizinini izlesin', { exact: true })).toHaveCount(0)
  await expect(form.getByLabel('Kesintiye dayanıklı oturum (tmux)', { exact: true })).toBeChecked()
  await expect(form.getByLabel(/Canlı sunucu:/)).not.toBeChecked()
  await form.getByLabel('Sunucu adı', { exact: true }).fill('Kaydedilen sunucu')
  await form.getByLabel('Adres', { exact: true }).fill('127.0.0.1')
  await form.getByLabel('Port', { exact: true }).fill(String(server.address().port))
  await form.getByLabel('Sunucu parolası', { exact: true }).fill('host-form-fixture-password')
  await page.screenshot({ path: join(directory, 'simplified-host-form.png') })
  await form.getByRole('button', { name: 'Sunucuyu kaydet', exact: true }).click()
  await expect(form).toHaveCount(0)
  const saved = (await page.evaluate(() => window.nodus.read())).hosts[0]
  expect(saved).toMatchObject({ password: 'host-form-fixture-password', initialPath: '', followDirectory: true, persistentSession: true })
  expect(readFileSync(join(directory, 'vault.nodus'), 'utf8')).not.toContain('host-form-fixture-password')
  await page.locator('.host-card').filter({ hasText: 'Kaydedilen sunucu' }).getByRole('button', { name: 'Bağlan', exact: true }).click()
  const workspace = page.locator('.workspace:not(.inactive)')
  await expect(workspace.getByTestId('terminal')).toContainText('STANDARD_FIXTURE_READY')
  await expect(workspace.locator('.session-controls')).toContainText('Standart oturum · Sunucuda tmux yok')
  expect(passwords).toEqual(['host-form-fixture-password'])
  expect(inputs.some((input) => input.includes('__nodus_cwd'))).toBe(true)
  await workspace.getByRole('button', { name: 'Dosya panelini aç veya kapat', exact: true }).click()
  await expect(workspace.getByRole('checkbox', { name: 'Terminali izle', exact: true })).toBeChecked()
  await expect(workspace.getByLabel('Uzak dizin', { exact: true })).toHaveValue('/srv/standard')
  await page.getByRole('button', { name: 'Kaydedilen sunucu sekmesini kapat', exact: true }).click()
  await form.getByRole('button', { name: 'Bağlantıyı kapat', exact: true }).click()
  await expect(workspace).toHaveCount(0)
  await page.getByRole('button', { name: 'Kaydedilen sunucu düzenle', exact: true }).click()
  await expect(form.getByLabel('Sunucu parolası', { exact: true })).toHaveValue('host-form-fixture-password')
  await form.getByLabel('Kesintiye dayanıklı oturum (tmux)', { exact: true }).uncheck()
  await form.getByRole('button', { name: 'Sunucuyu kaydet', exact: true }).click()
  await expect(form).toHaveCount(0)
  await page.getByRole('button', { name: 'Kaydedilen sunucu düzenle', exact: true }).click()
  await expect(form.getByLabel('Kesintiye dayanıklı oturum (tmux)', { exact: true })).not.toBeChecked()
  await form.getByRole('button', { name: 'Vazgeç', exact: true }).click()
  hasTmux = true
  const beforeTmux = inputs.length
  await page.getByRole('button', { name: 'Hızlı Bağlantı', exact: true }).click()
  await expect(form.getByRole('checkbox', { name: 'Parolayı kasaya kaydet', exact: true })).toHaveCount(0)
  await form.getByLabel('Sunucu adresi', { exact: true }).fill('127.0.0.1')
  await form.getByLabel('Port', { exact: true }).fill(String(server.address().port))
  await form.getByLabel('Parola (isteğe bağlı)', { exact: true }).fill('host-form-fixture-password')
  await form.getByRole('button', { name: 'Bağlan', exact: true }).click()
  await expect(workspace.getByTestId('terminal')).toContainText('TMUX_FIXTURE_READY')
  await expect(workspace.locator('.session-controls')).toContainText('tmux kalıcı oturum')
  const quick = (await page.evaluate(() => window.nodus.read())).hosts.find((host) => host.name === '127.0.0.1')
  expect(quick).toMatchObject({ password: 'host-form-fixture-password', followDirectory: true, persistentSession: true, initialPath: '' })
  await workspace.getByRole('button', { name: 'Dosya panelini aç veya kapat', exact: true }).click()
  await expect(workspace.getByLabel('Uzak dizin', { exact: true })).toHaveValue('/srv/first')
  currentPath = '/srv/second path'
  await expect(workspace.getByLabel('Uzak dizin', { exact: true })).toHaveValue('/srv/second path')
  expect(inputs.slice(beforeTmux).some((input) => input.includes('__nodus_cwd'))).toBe(false)
  expect(commands.some((command) => command.startsWith('tmux display-message'))).toBe(true)
  await page.evaluate(() => window.nodus.lock())
  await expect(page.getByLabel('Kasa parolası', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  console.log('PASS: simplified host form, encrypted password by default, edit preference, standard fallback, quick connection defaults and tmux directory tracking. Screenshot: ' + directory)
} finally {
  await application?.close(); for (const client of clients) client.end()
  await new Promise((resolveClose) => server.close(resolveClose))
}
