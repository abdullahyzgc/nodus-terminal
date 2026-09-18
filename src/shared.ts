export type Host = {
  protocol?: 'ssh' | 'rdp'; rdp?: { fullscreen: boolean; clipboard: boolean }
  id: string; name: string; hostname: string; port: number; username: string
  group: string; color: string; authType: 'password' | 'key'; password: string
  privateKey: string; passphrase: string; favorite: boolean; initialPath: string
  followDirectory: boolean; lastConnected?: string; persistentSession?: boolean; production?: boolean
}
export type Snippet = { id: string; name: string; command: string; group: string; confirm: boolean; workflow?: boolean }
export type ExecResult = { code: number; stdout: string; stderr: string }
export type ManagedItem = { id: string; name: string; state: string; detail: string }
export type LogSource = { kind: 'file' | 'docker' | 'service'; target: string }
export type LogEvent = { id: string; token: string; type: 'data' | 'closed' | 'error'; data: string }
export type FileRevision = { id: string; created: string; text: string }
export type SyncSettings = { url: string; username: string; password: string; etag?: string; lastSync?: string }
export type Vault = { version: 1; hosts: Host[]; snippets: Snippet[]; knownHosts: Record<string, string>; sync: SyncSettings }
export type Entry = { name: string; kind: 'directory' | 'file' | 'link'; size: number; modified: number; mode: number }
export type SessionEvent = { id: string; type: 'data' | 'cwd' | 'closed' | 'error' | 'ready' | 'authorized'; data: string; persistentSession?: boolean }
export type Status = { exists: boolean; unlocked: boolean; remembered: boolean }
export type Connection = { id: string; hostId: string; name: string; persistentSession?: boolean }
export type ServerStats = { load1: number; cpuTotal: number; cpuIdle: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number; netRx: number; netTx: number }
export type QuickHost = { hostname: string; port: number; username: string; password: string }
export type DriveConflict = { key: string; label: string; options: { id: string; label: string }[] }
export type DriveStatus = { configured: boolean; connected: boolean; busy: boolean; message: string; lastSync?: string; conflicts: DriveConflict[] }

export type UpdateStatus = { currentVersion: string; mode?: 'automatic' | 'manual'; phase: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error' | 'available'; nextVersion?: string; progress: number; message: string }

export interface NodusAPI {
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  updateStatus(): Promise<UpdateStatus>
  checkUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<UpdateStatus>
  openUpdateDownload(): Promise<UpdateStatus>
  onUpdate(listener: (state: UpdateStatus) => void): () => void
  status(): Promise<Status>
  unlock(password: string, remember: boolean, create: boolean): Promise<Vault>
  read(): Promise<Vault>
  saveHost(host: Host): Promise<Vault>
  deleteHost(id: string): Promise<Vault>
  saveSnippet(snippet: Snippet): Promise<Vault>
  deleteSnippet(id: string): Promise<Vault>
  lock(): Promise<void>
  autoLockMinutes(): Promise<number>
  setAutoLockMinutes(minutes: number): Promise<number>
  onLocked(listener: (status: Status) => void): () => void
  connect(hostId: string, password?: string): Promise<Connection>
  openRdp(hostId: string): Promise<boolean>
  reconnect(id: string, password?: string): Promise<Connection>
  authorizeTerminal(id: string): Promise<boolean>
  managedList(id: string, kind: 'docker' | 'service'): Promise<ManagedItem[]>
  managedAction(id: string, kind: 'docker' | 'service', target: string, action: 'start' | 'stop' | 'restart'): Promise<ExecResult>
  runWorkflow(id: string, snippetId: string, values: Record<string, string>): Promise<ExecResult>
  startLog(id: string, token: string, source: LogSource): Promise<void>
  stopLog(id: string, token: string): Promise<void>
  onLog(listener: (event: LogEvent) => void): () => void
  saveFileVersion(id: string, path: string, text: string, expected: string, backup: boolean): Promise<void>
  fileRevisions(id: string, path: string): Promise<FileRevision[]>
  restoreFileVersion(id: string, path: string, revision: string, expected: string): Promise<string>
  quick(input: QuickHost): Promise<{ connection: Connection; host: Host }>
  stats(id: string): Promise<ServerStats>
  disconnect(id: string): Promise<void>
  input(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  list(id: string, path: string): Promise<{ path: string; entries: Entry[] }>
  upload(id: string, path: string): Promise<string[]>
  download(id: string, path: string): Promise<boolean>
  mkdir(id: string, path: string): Promise<void>
  rename(id: string, from: string, to: string): Promise<void>
  readFile(id: string, path: string): Promise<{ text: string; size: number }>
  writeFile(id: string, path: string, text: string, create?: boolean): Promise<void>
  remove(id: string, paths: string[]): Promise<void>
  chmod(id: string, path: string, mode: number): Promise<void>
  archive(id: string, dir: string, name: string, format: string, items: string[]): Promise<string>
  extract(id: string, path: string): Promise<string>
  readKey(): Promise<string | null>
  syncSettings(settings: SyncSettings): Promise<Vault>
  sync(direction: 'push' | 'pull'): Promise<Vault>
  exportVault(): Promise<boolean>
  importVault(): Promise<Status>
  driveStatus(): Promise<DriveStatus>
  driveConfigure(): Promise<DriveStatus>
  driveConnect(): Promise<DriveStatus>
  driveDisconnect(): Promise<DriveStatus>
  driveSync(): Promise<DriveStatus>
  driveRestore(password: string, remember: boolean): Promise<Vault>
  driveResolve(key: string, option: string): Promise<DriveStatus>
  onVault(listener: (vault: Vault) => void): () => void
  onDrive(listener: (status: DriveStatus) => void): () => void
  onSession(listener: (event: SessionEvent) => void): () => void
  window(action: 'minimize' | 'maximize' | 'close'): void
}
declare global { interface Window { nodus?: NodusAPI } }
