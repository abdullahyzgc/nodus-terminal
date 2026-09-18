import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { utils } from 'ssh2'
import { VaultStore, parseEnvelope, validateHost, validateSnippet } from './vault'
import { SSHManager, remotePath, joinRemote, shellQuote } from './ssh'
import { synchronize, validateSync } from './sync'
import { DriveService } from './drive'
import { AutoLock, readAutoLockMinutes, saveAutoLockMinutes } from './auto-lock'
import { autoUpdater } from 'electron-updater'
import { UpdateService } from './updates'
import { FileHistory } from './file-history'
import { actionCommand, listCommand, parseManaged } from './operations'
import { renderWorkflow } from '../src/workflows'
import type { Host, Snippet, SyncSettings, LogSource } from '../src/shared'

app.setName('Nodus')
if (process.platform === 'win32') app.setAppUserModelId('private.nodus.ssh')
if (!app.isPackaged && process.env.NODUS_TEST_DATA) app.setPath('userData', process.env.NODUS_TEST_DATA)
const development = !app.isPackaged && process.env.NODUS_DEV === '1'
const entryURL = development ? 'http://127.0.0.1:5173/' : pathToFileURL(join(__dirname, '../dist/index.html')).href
let window: BrowserWindow
let tray: Tray | undefined
function assetPath(name: string): string { if (app.isPackaged) return join(process.resourcesPath, 'assets', name); return join(__dirname, '..', 'assets', name); }

let store: VaultStore
let ssh: SSHManager
let drive: DriveService
let updates: UpdateService
let syncing = false
let syncController: AbortController | undefined
let autoLock: AutoLock
let autoLockMinutes: number
const fileWrites = new Set<string>()
const workflowRuns = new Set<string>()
function sessionHost(id: string): Host {
  const host = store.read().hosts.find((item) => item.id === ssh.hostId(id))
  if (!host) throw new Error('Sunucu kaydı bulunamadı.')
  return host
}
async function protect(id: string, action: string, detail: string, always = false): Promise<void> {
  const generation = epoch
  const host = sessionHost(id)
  const connection = ssh.connectionKey(id)
  if ((always || host.production || ssh.production(id)) && !await confirm((host.production || ssh.production(id) ? 'ÜRETİM · ' : '') + action, host.name + '\n' + host.username + '@' + host.hostname + ':' + host.port + '\n\n' + detail, 'Onayla')) throw new Error('İşlem iptal edildi.')
  if (generation !== epoch || !store.unlocked || !ssh.connected(id) || ssh.connectionKey(id) !== connection) throw new Error('Oturum kapandı. İşlem uygulanmadı.')
}
function historyIdentity(id: string, path: string): string {
  const host = sessionHost(id)
  return JSON.stringify([host.id, host.hostname, host.port, host.username, posix.normalize(remotePath(path))])
}
function fileHistory(): FileHistory { return new FileHistory(join(app.getPath('userData'), 'file-history'), store) }
async function saveVersion(id: string, path: string, text: string, expected: string, backup: boolean): Promise<void> {
  const generation = epoch
  const connection = ssh.connectionKey(id)
  if (typeof text !== 'string' || typeof expected !== 'string' || typeof backup !== 'boolean' || Buffer.byteLength(text) > 512 * 1024 || Buffer.byteLength(expected) > 512 * 1024) throw new Error('Geçersiz dosya içeriği.')
  const identity = historyIdentity(id, path)
  if (fileWrites.has(identity)) throw new Error('Bu dosyada başka kayıt işlemi sürüyor.')
  fileWrites.add(identity)
  try {
    await protect(id, 'Dosya kaydedilsin mi?', path)
    const current = await ssh.readFile(id, path)
    if (generation !== epoch || !store.unlocked || !ssh.connected(id) || ssh.connectionKey(id) !== connection) throw new Error('Oturum kapandı. Dosya yazılmadı.')
    if (current.text !== expected) throw new Error('Dosya sunucuda değişmiş. Üzerine yazılmadı; dosyayı yeniden aç.')
    if (backup) fileHistory().add(identity, current.text)
    store.read()
    await ssh.writeFile(id, path, text)
  } finally { fileWrites.delete(identity) }
}
const autoLockPath = () => join(app.getPath('userData'), 'auto-lock.json')
let epoch = 0
const rememberedPath = () => join(app.getPath('userData'), 'device-key.bin')
const status = () => ({ exists: store.exists, unlocked: store.unlocked, remembered: existsSync(rememberedPath()) })
const authorized = (event: { senderFrame: Electron.WebFrameMain | null; sender: Electron.WebContents }) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === entryURL
const mutable = () => { store.read(); if (syncing) throw new Error('Senkron bitene kadar bekleyin.') }

function handle(channel: string, listener: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!authorized(event)) throw new Error('İzin verilmeyen istek.')
    autoLock.check()
    return listener(...args)
  })
}
async function confirm(message: string, detail: string, action: string): Promise<boolean> {
  const result = await dialog.showMessageBox(window, { type: 'warning', message, detail, buttons: ['Vazgeç', action], defaultId: 0, cancelId: 0, noLink: true })
  return result.response === 1
}
function forget(): void { if (existsSync(rememberedPath())) unlinkSync(rememberedPath()) }
function lock(): void {
  autoLock.stop(); syncController?.abort(); drive.stop(); epoch++; ssh.closeAll(); store.lock()
  try { forget() }
  finally { if (window && !window.isDestroyed()) window.webContents.send('vault:locked', status()) }
}

function registerHandlers(): void {
  handle('clipboard:read', () => {
    store.read()
    const text = clipboard.readText()
    if (text.length > 1024 * 1024) throw new Error('Pano metni en fazla 1.048.576 karakter olabilir.')
    return text
  })
  handle('clipboard:write', (text: string) => {
    store.read()
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('Geçersiz pano metni.')
    clipboard.writeText(text)
  })
  handle('update:status', () => updates.status())
  handle('update:check', () => updates.check())
  handle('update:install', () => updates.install())
  handle('vault:status', status)
  handle('vault:read', () => store.read())
  handle('vault:auto-lock', () => { store.read(); return autoLockMinutes })
  handle('vault:auto-lock:set', (minutes: number) => {
    store.read()
    autoLockMinutes = saveAutoLockMinutes(autoLockPath(), minutes)
    autoLock.configure(autoLockMinutes)
    return autoLockMinutes
  })
  ipcMain.on('vault:activity', (event) => { if (authorized(event) && store.unlocked) autoLock.activity() })
  handle('vault:unlock', (password: string, remember: boolean, create: boolean) => {
    if (drive.status().busy) throw new Error('Drive işlemi bitene kadar bekleyin.')
    if (typeof remember !== 'boolean' || typeof create !== 'boolean') throw new Error('Geçersiz kasa isteği.')
    if (remember && !safeStorage.isEncryptionAvailable()) throw new Error('İşletim sistemi güvenli saklama hizmeti kullanılamıyor. Hatırlamayı kapatın.')
    const vault = store.unlock(password, create)
    try {
      if (remember) writeFileSync(rememberedPath(), safeStorage.encryptString(password), { mode: 0o600 })
      else forget()
    } catch (error) { store.lock(); throw error }
    autoLock.start(); drive.sync.start()
    return vault
  })
  handle('vault:lock', lock)
  handle('drive:status', () => drive.status())
  handle('drive:configure', async () => {
    if (store.exists) store.read()
    const result = await dialog.showOpenDialog(window, { title: 'Google Masaüstü OAuth JSON dosyasını seç', properties: ['openFile'], filters: [{ name: 'Google OAuth', extensions: ['json'] }] })
    if (result.canceled) return drive.status()
    if (store.exists) store.read()
    if (statSync(result.filePaths[0]).size > 65536) throw new Error('OAuth dosyası 64 KB sınırını aşıyor.')
    return drive.configure(readFileSync(result.filePaths[0], 'utf8'))
  })
  handle('drive:connect', () => { if (store.exists) store.read(); return drive.connect((url) => shell.openExternal(url)) })
  handle('drive:disconnect', () => { if (store.exists) store.read(); return drive.disconnect() })
  handle('drive:sync', () => { store.read(); return drive.sync.sync() })
  handle('drive:resolve', (key: string, option: string) => drive.sync.resolve(key, option))
  handle('drive:restore', async (password: string, remember: boolean) => {
    if (typeof remember !== 'boolean') throw new Error('Geçersiz kasa isteği.')
    if (remember && !safeStorage.isEncryptionAvailable()) throw new Error('Güvenli saklama hizmeti kullanılamıyor. Hatırlamayı kapatın.')
    const vault = await drive.sync.restore(password)
    try {
      if (remember) writeFileSync(rememberedPath(), safeStorage.encryptString(password), { mode: 0o600 })
      else forget()
    } catch (error) { store.lock(); throw error }
    autoLock.start(); drive.sync.start()
    return vault
  })
  handle('host:save', (host: Host) => {
    mutable(); validateHost(host)
    const previous = store.read().hosts.find((item) => item.id === host.id)
    if (host.authType === 'key') {
      const key = utils.parseKey(host.privateKey, host.passphrase || undefined)
      if (key instanceof Error) throw new Error('SSH anahtarı veya anahtar parolası geçersiz: ' + key.message)
      host.password = ''
    } else { host.privateKey = ''; host.passphrase = '' }
    const result = store.update((vault) => { const index = vault.hosts.findIndex((item) => item.id === host.id); if (index < 0) vault.hosts.push(host); else vault.hosts[index] = host })
    if (previous && ['hostname', 'port', 'username', 'production', 'persistentSession'].some((key) => previous[key as keyof Host] !== host[key as keyof Host])) ssh.disconnectHost(host.id)
    return result
  })
  handle('host:delete', (id: string) => { mutable(); const result = store.update((vault) => { vault.hosts = vault.hosts.filter((host) => host.id !== id) }); ssh.disconnectHost(id); return result })
  handle('snippet:save', (snippet: Snippet) => {
    mutable(); validateSnippet(snippet)
    return store.update((vault) => { const index = vault.snippets.findIndex((item) => item.id === snippet.id); if (index < 0) vault.snippets.push(snippet); else vault.snippets[index] = snippet })
  })
  handle('snippet:delete', (id: string) => { mutable(); return store.update((vault) => { vault.snippets = vault.snippets.filter((snippet) => snippet.id !== id) }) })
  handle('ssh:connect', async (id: string, password?: string) => {
    mutable()
    const generation = epoch
    const host = store.read().hosts.find((item) => item.id === id)
    if (!host) throw new Error('Sunucu bulunamadı.')
    if (password !== undefined && (typeof password !== 'string' || !password || password.length > 4096)) throw new Error('Geçersiz parola.')
    const connection = await ssh.connect(host, password)
    if (generation !== epoch || !store.unlocked) { ssh.disconnect(connection.id); throw new Error('Kasa kilitlendi.') }
    store.update((vault) => { const current = vault.hosts.find((item) => item.id === id); if (current) current.lastConnected = new Date().toISOString() })
    return connection
  })
  handle('ssh:disconnect', (id: string) => ssh.disconnect(id))
  handle('ssh:reconnect', async (id: string, password?: string) => {
    mutable()
    const generation = epoch
    const host = sessionHost(id)
    if (password !== undefined && (typeof password !== 'string' || !password || password.length > 4096)) throw new Error('Geçersiz parola.')
    const connection = await ssh.connect(host, password, id)
    if (generation !== epoch || !store.unlocked) { ssh.disconnect(id); throw new Error('Kasa kilitlendi.') }
    return connection
  })
  handle('ssh:authorize', async (id: string) => {
    await protect(id, 'Terminal girdisi açılsın mı?', 'Bu oturumdaki elle yazılan veya yapıştırılan komutlar tek tek denetlenmez. Üretim sunucusunda çalıştığınızı doğrulayın.')
    ssh.authorizeTerminal(id)
    return true
  })
  handle('ops:list', async (id: string, kind: 'docker' | 'service') => {
    store.read()
    const result = await ssh.exec(id, listCommand(kind))
    if (result.code !== 0) throw new Error(result.stderr || 'Liste alınamadı. Araç kurulumunu ve erişim yetkisini kontrol edin.')
    return parseManaged(kind, result.stdout)
  })
  handle('ops:action', async (id: string, kind: 'docker' | 'service', target: string, action: string) => {
    const command = actionCommand(kind, target, action)
    await protect(id, 'Servis işlemi uygulansın mı?', command, true)
    return ssh.exec(id, command, 60000)
  })
  handle('ops:workflow', async (id: string, snippetId: string, values: Record<string, string>) => {
    const snippet = store.read().snippets.find((item) => item.id === snippetId && item.workflow)
    if (!snippet) throw new Error('Komut akışı bulunamadı.')
    if (workflowRuns.has(id)) throw new Error('Bu oturumda komut akışı zaten çalışıyor.')
    const command = renderWorkflow(snippet.command, values)
    workflowRuns.add(id)
    const invocation = 'sh -c ' + shellQuote(command)
    if (invocation.length > 8192) { workflowRuns.delete(id); throw new Error('Komut akışı çok uzun.') }
    try { await protect(id, 'Komut akışı çalıştırılsın mı?', snippet.name + '\n\n' + command, true); return await ssh.exec(id, invocation, 180000) }
    finally { workflowRuns.delete(id) }
  })
  handle('ops:log:start', (id: string, token: string, source: LogSource) => { store.read(); return ssh.startLog(id, token, source, (event) => { if (store.unlocked && !window.isDestroyed()) window.webContents.send('ops:log', event) }) })
  handle('ops:log:stop', (id: string, token: string) => { store.read(); ssh.stopLog(id, token) })
  handle('sftp:version:list', (id: string, path: string) => fileHistory().list(historyIdentity(id, path)))
  handle('sftp:version:save', saveVersion)
  handle('sftp:version:restore', async (id: string, path: string, revision: string, expected: string) => {
    const entry = fileHistory().list(historyIdentity(id, path)).find((item) => item.id === revision)
    if (!entry) throw new Error('Dosya yedeği bulunamadı.')
    await protect(id, 'Dosya eski sürüme döndürülsün mü?', path + '\n' + entry.created, true)
    await saveVersion(id, path, entry.text, expected, true)
    return entry.text
  })
  handle('ssh:quick', async (input: { hostname: string; port: number; username: string; password: string }) => {
    mutable()
    if (!input || typeof input.hostname !== 'string' || !Number.isInteger(input.port) || typeof input.username !== 'string' || typeof input.password !== 'string') throw new Error('Hızlı bağlantı isteği.')
    const host: Host = { id: randomUUID(), name: (input.username || 'root') + '@' + input.hostname, hostname: input.hostname.trim(), port: input.port, username: input.username.trim() || 'root', group: 'Diğer', color: '#8aacf2', authType: 'password', password: input.password, privateKey: '', passphrase: '', favorite: false, initialPath: '', followDirectory: false }
    validateHost(host)
    const connection = await ssh.connect(host)
    return { connection, host }
  })
  handle('ssh:stats', (id: string) => { store.read(); return ssh.stats(id) })
  handle('sftp:read', (id: string, path: string) => { store.read(); return ssh.readFile(id, path) })
  handle('sftp:write', async (id: string, path: string, text: string, create = false) => { await protect(id, 'Dosya yazılsın mı?', path); if (typeof text !== 'string' || typeof create !== 'boolean') throw new Error('Geçersiz dosya isteği.'); return ssh.writeFile(id, path, text, create) })
  handle('sftp:remove', async (id: string, paths: string[]) => { await protect(id, 'Dosyalar silinsin mi?', Array.isArray(paths) ? paths.join('\n') : 'Geçersiz hedef'); return ssh.remove(id, paths) })
  handle('sftp:chmod', async (id: string, path: string, mode: number) => { await protect(id, 'Dosya yetkileri değişsin mi?', path); return ssh.chmod(id, path, mode) })
  handle('sftp:archive', async (id: string, dir: string, name: string, format: string, items: string[]) => { await protect(id, 'Arşiv oluşturulsun mu?', dir + '/' + name); return ssh.archive(id, dir, name, format, items) })
  handle('sftp:extract', async (id: string, path: string) => { await protect(id, 'Arşiv açılsın mı?', path); return ssh.extract(id, path) })
  ipcMain.on('ssh:input', (event, id, data) => { if (authorized(event)) { autoLock.check(); if (store.unlocked) ssh.input(id, data) } })
  ipcMain.on('ssh:resize', (event, id, cols, rows) => { if (authorized(event) && store.unlocked) ssh.resize(id, cols, rows) })
  handle('sftp:list', (id: string, path: string) => { store.read(); return ssh.list(id, path) })
  handle('sftp:mkdir', async (id: string, path: string) => { await protect(id, 'Klasör oluşturulsun mu?', path); return ssh.mkdir(id, path) })
  handle('sftp:rename', async (id: string, from: string, to: string) => { await protect(id, 'Dosya yeniden adlandırılsın mı?', from + '\n' + to); return ssh.rename(id, from, to) })
  handle('sftp:upload', async (id: string, path: string) => {
    store.read(); remotePath(path)
    const files = await dialog.showOpenDialog(window, { title: 'Sunucuya dosya yükle', properties: ['openFile', 'multiSelections'] })
    if (files.canceled) return []
    await protect(id, 'Dosyalar yüklensin mi?', path + '\n' + files.filePaths.map((file) => basename(file)).join('\n'))
    const sftp = await ssh.sftp(id)
    const uploaded: string[] = []
    for (const file of files.filePaths) {
      const target = joinRemote(path, basename(file))
      const exists = await new Promise<boolean>((resolve, reject) => sftp.lstat(target, (error) => {
        if (!error) resolve(true)
        else if ((error as Error & { code?: number }).code === 2) resolve(false)
        else reject(error)
      }))
      if (exists && !await confirm('Uzak dosyanın üzerine yazılsın mı?', target, 'Üzerine yaz')) continue
      await new Promise<void>((resolve, reject) => sftp.fastPut(file, target, (error) => error ? reject(error) : resolve()))
      uploaded.push(basename(file))
    }
    return uploaded
  })
  handle('sftp:download', async (id: string, path: string) => {
    store.read(); remotePath(path)
    const result = await dialog.showSaveDialog(window, { title: 'Dosyayı indir', defaultPath: posix.basename(path).replace(/[<>:"/\\|?*]/g, '_') })
    if (result.canceled || !result.filePath) return false
    const sftp = await ssh.sftp(id)
    const temporary = result.filePath + '.nodus-part-' + Date.now()
    try {
      await new Promise<void>((resolve, reject) => sftp.fastGet(path, temporary, (error) => error ? reject(error) : resolve()))
      renameSync(temporary, result.filePath)
      return true
    } finally { if (existsSync(temporary)) unlinkSync(temporary) }
  })
  handle('key:read', async () => {
    store.read()
    const result = await dialog.showOpenDialog(window, { title: 'Özel SSH anahtarını seç', properties: ['openFile'] })
    if (result.canceled) return null
    if (statSync(result.filePaths[0]).size > 65536) throw new Error('Anahtar dosyası 64 KB sınırını aşıyor.')
    return readFileSync(result.filePaths[0], 'utf8')
  })
  handle('sync:settings', (settings: SyncSettings) => {
    mutable(); validateSync(settings)
    return store.update((vault) => { vault.sync = { url: settings.url, username: settings.username, password: settings.password, etag: settings.url === vault.sync.url ? vault.sync.etag : undefined, lastSync: settings.url === vault.sync.url ? vault.sync.lastSync : undefined } })
  })
  handle('sync:run', async (direction: 'push' | 'pull') => {
    mutable()
    if (drive.status().connected) throw new Error('WebDAV kullanmadan önce Google Drive bağlantısını kesin.')
    if (!['push', 'pull'].includes(direction)) throw new Error('Geçersiz yön.')
    syncing = true
    const controller = new AbortController()
    syncController = controller
    try {
      if (direction === 'pull') {
        if (!await confirm('Uzak kasa bu cihazdaki kayıtların yerini alacak.', 'Yerel sunucular ve kestirmeler değişir. Mevcut kasanın şifreli yedeği cihazda saklanır. Oturumlar kapatılır.', 'Yedekle ve indir')) return store.read()
        controller.signal.throwIfAborted()
        writeFileSync(join(app.getPath('userData'), 'before-sync-' + Date.now() + '.nodus'), store.encrypted(), { mode: 0o600 })
        epoch++; ssh.closeAll()
      }
      await synchronize(store, direction, controller.signal)
      return store.read()
    } finally { syncing = false; syncController = undefined }
  })
  handle('vault:export', async () => {
    store.read()
    const result = await dialog.showSaveDialog(window, { title: 'Şifreli kasa yedeği', defaultPath: 'Nodus-kasa.nodus', filters: [{ name: 'Nodus şifreli kasa', extensions: ['nodus'] }] })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, store.encrypted(), { mode: 0o600 })
    return true
  })
  handle('vault:import', async () => {
    if (drive.status().busy) throw new Error('Drive işlemi bitene kadar bekleyin.')
    if (store.exists) throw new Error('İçe aktarma yalnızca yeni cihazda, kasa oluşturmadan önce kullanılabilir.')
    const result = await dialog.showOpenDialog(window, { title: 'Şifreli kasa yedeğini seç', properties: ['openFile'], filters: [{ name: 'Nodus şifreli kasa', extensions: ['nodus'] }] })
    if (result.canceled) return status()
    if (statSync(result.filePaths[0]).size > 16 * 1024 * 1024) throw new Error('Kasa çok büyük.')
    const content = readFileSync(result.filePaths[0], 'utf8')
    parseEnvelope(content)
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(store.path, content, { flag: 'wx', mode: 0o600 })
    return status()
  })
  ipcMain.on('window:action', (event, action) => {
    if (!authorized(event)) return
    if (action === 'minimize') window.minimize()
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    if (action === 'close') { window.hide(); return }
  })
}

function setupTray(): void {
  try {
    // Setup system tray
    const trayIcon = nativeImage.createFromPath(assetPath('tray.png'))
    if (trayIcon.isEmpty()) throw new Error('Sistem tepsisi simgesi bulunamadi.')
    tray = new Tray(trayIcon)
    tray.setToolTip('Nodus')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Nodus', enabled: false },
      { type: 'separator' },
      { label: 'Göster', click: () => { window.show(); window.focus() } },
      { type: 'separator' },
      { label: 'Çıkış', click: () => { app.quit() } },
    ]))
    tray.on('double-click', () => { window.show(); window.focus() })
  } catch (error) { console.error('Tepsi simgesi olusturulamadi:', error) }
}

function createWindow(): void {
  window = new BrowserWindow({ width: 1440, height: 930, minWidth: 760, minHeight: 560, title: 'Nodus', icon: assetPath('icon.ico'), frame: false, backgroundColor: '#0b0b0d', show: false, webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
  if (development) {
    window.webContents.on('before-input-event', (event, input) => {
      const toggleTools = input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')
      if (!toggleTools) return
      event.preventDefault()
      if (input.type !== 'keyDown' || input.isAutoRepeat) return
      if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools()
      else window.webContents.openDevTools({ mode: 'right' })
    })
    window.webContents.on('context-menu', (_event, params) => {
      Menu.buildFromTemplate([
        { label: 'İncele', click: () => { window.webContents.openDevTools({ mode: 'right' }); window.webContents.inspectElement(params.x, params.y) } },
      ]).popup({ window })
    })
  }
  window.once('ready-to-show', () => window.show())
  window.webContents.on('render-process-gone', () => { lock() })
  void window.loadURL(entryURL)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } })
  app.whenReady().then(() => {
    store = new VaultStore(join(app.getPath('userData'), 'vault.nodus'))
    if (store.exists && existsSync(rememberedPath()) && safeStorage.isEncryptionAvailable()) {
      try { store.unlock(safeStorage.decryptString(readFileSync(rememberedPath())), false) } catch { forget() }
    }
    ssh = new SSHManager((event) => { if (window && !window.isDestroyed()) window.webContents.send('ssh:event', event) }, async (host, fingerprint) => {
      const generation = epoch
      const key = host.hostname.toLowerCase() + ':' + host.port
      const known = store.read().knownHosts[key]
      if (known) {
        if (known !== fingerprint) await dialog.showMessageBox(window, { type: 'error', message: 'Sunucu kimliği değişti. Bağlantı engellendi.', detail: 'Olası araya girme saldırısı veya yeniden kurulum. Sunucu anahtarını bağımsız kanaldan doğrulayın.\n\nYeni SHA256: ' + Buffer.from(fingerprint, 'hex').toString('base64').replace(/=+$/, '') })
        return known === fingerprint
      }
      const accepted = await confirm('Bu sunucuya ilk bağlantı', host.username + '@' + host.hostname + ':' + host.port + '\n\nSHA256:' + Buffer.from(fingerprint, 'hex').toString('base64').replace(/=+$/, '') + '\n\nBu parmak izini sunucu yöneticisiyle veya sağlayıcının konsoluyla karşılaştırın. Yalnızca eşleşiyorsa güvenin.', 'Güven ve bağlan')
      if (!accepted || generation !== epoch || !store.unlocked) return false
      store.update((vault) => { vault.knownHosts[key] = fingerprint })
      return true
    })
    drive = new DriveService(store, app.getPath('userData'), (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('drive:status', state)
    }, (vault) => {
      epoch++; ssh.closeAll()
      if (window && !window.isDestroyed()) window.webContents.send('vault:changed', vault)
    }, () => !syncing)
    store.onChange = () => drive.sync.schedule()
    drive.initialize()
    autoLockMinutes = readAutoLockMinutes(autoLockPath())
    autoLock = new AutoLock(() => { try { lock() } catch { console.error('Kasa kilitlendi ancak otomatik açma kaydı silinemedi.') } })
    autoLock.configure(autoLockMinutes)
    if (store.unlocked) autoLock.start()
    powerMonitor.on('resume', () => autoLock.check())
    updates = new UpdateService(autoUpdater, app.getVersion(), app.isPackaged && process.platform === 'win32', (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('update:status', state)
    }, () => confirm('Güncelleme kurulsun mu?', 'Uygulama yeniden başlatılacak. Açık SSH oturumları ve aktarımlar kapanır; kaydedilmemiş editör değişiklikleri kaybolabilir. Önce çalışmalarını kaydet. Kasa dosyan ve cihaz ayarların korunur; varsa şifreli kasa yedeği alınır.', 'Yeniden başlat ve güncelle'), () => {
      if (store.exists) {
        const backup = join(app.getPath('userData'), 'before-update-' + Date.now() + '-' + randomUUID() + '.nodus')
        writeFileSync(backup, readFileSync(store.path), { mode: 0o600, flag: 'wx' })
      }
      lock()
    })
    registerHandlers(); createWindow(); setupTray(); updates.start()
  }).catch((error: Error) => { dialog.showErrorBox('Nodus başlatılamadı', error.message); app.quit() })
  app.on('window-all-closed', () => {
    // Do not quit  minimize to tray instead
  })
  app.on('before-quit', () => { updates?.stop(); autoLock?.stop(); syncController?.abort(); drive?.stop(); epoch++; ssh?.closeAll(); store?.lock() })


}
