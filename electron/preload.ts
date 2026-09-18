import { contextBridge, ipcRenderer } from 'electron'
import type { NodusAPI, SessionEvent, DriveStatus, Status, UpdateStatus, Vault } from '../src/shared'

const api: NodusAPI = {
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (listener) => {
    const handler = (_event: unknown, state: UpdateStatus) => listener(state)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  status: () => ipcRenderer.invoke('vault:status'),
  unlock: (password, remember, create) => ipcRenderer.invoke('vault:unlock', password, remember, create),
  read: () => ipcRenderer.invoke('vault:read'),
  saveHost: (host) => ipcRenderer.invoke('host:save', host),
  deleteHost: (id) => ipcRenderer.invoke('host:delete', id),
  saveSnippet: (snippet) => ipcRenderer.invoke('snippet:save', snippet),
  deleteSnippet: (id) => ipcRenderer.invoke('snippet:delete', id),
  lock: () => ipcRenderer.invoke('vault:lock'),
  autoLockMinutes: () => ipcRenderer.invoke('vault:auto-lock'),
  setAutoLockMinutes: (minutes) => ipcRenderer.invoke('vault:auto-lock:set', minutes),
  onLocked: (listener) => {
    const handler = (_event: unknown, payload: Status) => listener(payload)
    ipcRenderer.on('vault:locked', handler)
    return () => ipcRenderer.removeListener('vault:locked', handler)
  },
  connect: (id, password) => ipcRenderer.invoke('ssh:connect', id, password),
  reconnect: (id, password) => ipcRenderer.invoke('ssh:reconnect', id, password),
  authorizeTerminal: (id) => ipcRenderer.invoke('ssh:authorize', id),
  managedList: (id, kind) => ipcRenderer.invoke('ops:list', id, kind),
  managedAction: (id, kind, target, action) => ipcRenderer.invoke('ops:action', id, kind, target, action),
  runWorkflow: (id, snippetId, values) => ipcRenderer.invoke('ops:workflow', id, snippetId, values),
  startLog: (id, token, source) => ipcRenderer.invoke('ops:log:start', id, token, source),
  stopLog: (id, token) => ipcRenderer.invoke('ops:log:stop', id, token),
  onLog: (listener) => {
    const handler = (_event: unknown, payload: import('../src/shared').LogEvent) => listener(payload)
    ipcRenderer.on('ops:log', handler)
    return () => ipcRenderer.removeListener('ops:log', handler)
  },
  saveFileVersion: (id, path, text, expected, backup) => ipcRenderer.invoke('sftp:version:save', id, path, text, expected, backup),
  fileRevisions: (id, path) => ipcRenderer.invoke('sftp:version:list', id, path),
  restoreFileVersion: (id, path, revision, expected) => ipcRenderer.invoke('sftp:version:restore', id, path, revision, expected),
  quick: (input) => ipcRenderer.invoke('ssh:quick', input),
  stats: (id) => ipcRenderer.invoke('ssh:stats', id),
  disconnect: (id) => ipcRenderer.invoke('ssh:disconnect', id),
  input: (id, data) => ipcRenderer.send('ssh:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('ssh:resize', id, cols, rows),
  list: (id, path) => ipcRenderer.invoke('sftp:list', id, path),
  upload: (id, path) => ipcRenderer.invoke('sftp:upload', id, path),
  download: (id, path) => ipcRenderer.invoke('sftp:download', id, path),
  mkdir: (id, path) => ipcRenderer.invoke('sftp:mkdir', id, path),
  rename: (id, from, to) => ipcRenderer.invoke('sftp:rename', id, from, to),
  readFile: (id, path) => ipcRenderer.invoke('sftp:read', id, path),
  writeFile: (id, path, text, create) => ipcRenderer.invoke('sftp:write', id, path, text, create),
  remove: (id, paths) => ipcRenderer.invoke('sftp:remove', id, paths),
  chmod: (id, path, mode) => ipcRenderer.invoke('sftp:chmod', id, path, mode),
  archive: (id, dir, name, format, items) => ipcRenderer.invoke('sftp:archive', id, dir, name, format, items),
  extract: (id, path) => ipcRenderer.invoke('sftp:extract', id, path),
  readKey: () => ipcRenderer.invoke('key:read'),
  syncSettings: (settings) => ipcRenderer.invoke('sync:settings', settings),
  sync: (direction) => ipcRenderer.invoke('sync:run', direction),
  exportVault: () => ipcRenderer.invoke('vault:export'),
  importVault: () => ipcRenderer.invoke('vault:import'),
  driveStatus: () => ipcRenderer.invoke('drive:status'),
  driveConfigure: () => ipcRenderer.invoke('drive:configure'),
  driveConnect: () => ipcRenderer.invoke('drive:connect'),
  driveDisconnect: () => ipcRenderer.invoke('drive:disconnect'),
  driveSync: () => ipcRenderer.invoke('drive:sync'),
  driveRestore: (password, remember) => ipcRenderer.invoke('drive:restore', password, remember),
  driveResolve: (key, option) => ipcRenderer.invoke('drive:resolve', key, option),
  onVault: (listener) => {
    const handler = (_event: unknown, payload: Vault) => listener(payload)
    ipcRenderer.on('vault:changed', handler)
    return () => ipcRenderer.removeListener('vault:changed', handler)
  },
  onDrive: (listener) => {
    const handler = (_event: unknown, payload: DriveStatus) => listener(payload)
    ipcRenderer.on('drive:status', handler)
    return () => ipcRenderer.removeListener('drive:status', handler)
  },
  onSession: (listener) => {
    const handler = (_event: unknown, payload: SessionEvent) => listener(payload)
    ipcRenderer.on('ssh:event', handler)
    return () => ipcRenderer.removeListener('ssh:event', handler)
  },
  window: (action) => ipcRenderer.send('window:action', action),
}
contextBridge.exposeInMainWorld('nodus', api)

let lastMotion = 0
for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
  window.addEventListener(type, (event) => {
    if (!event.isTrusted) return
    const now = performance.now()
    if ((type === 'pointermove' || type === 'wheel') && now - lastMotion < 1000) return
    lastMotion = now
    ipcRenderer.send('vault:activity')
  }, { capture: true, passive: true })
}
