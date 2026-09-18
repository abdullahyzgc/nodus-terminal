import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ArrowUp, Check, ChevronDown, Download, File, FilePlus2, Folder, FolderPlus, LoaderCircle, MoreHorizontal, Pencil, RefreshCw, Save, Search, Shield, Trash2, Upload, X } from 'lucide-react'
import type { Entry } from './shared'
import { Modal } from './Forms'
import { FileReview } from './FileReview'
import { errorText, joinPath } from './session'

type Action = { type: 'file' | 'folder' | 'rename' | 'delete' | 'chmod' | 'archive' | 'extract'; directory: string; entries: Entry[] }
type Editor = { path: string; text: string; original: string; ending: string }
const validName = (name: string) => !!name.trim() && name !== '.' && name !== '..' && !/[\/\x00-\x1f\x7f]/.test(name) && new TextEncoder().encode(name).length <= 255
const isArchive = (name: string) => /\.(zip|tar|gz|tgz|bz2|tbz2|xz|txz)$/i.test(name)
const sizeLabel = (size: number) => size < 1024 ? size + ' B' : size < 1048576 ? (size / 1024).toFixed(1) + ' KB' : (size / 1048576).toFixed(1) + ' MB'

export function FilePanel({ id, cwd, followDefault, disabled, notify, close }: { id: string; cwd: string; followDefault: boolean; disabled: boolean; notify: (text: string) => void; close: () => void }) {
  const [path, setPath] = useState('.')
  const [address, setAddress] = useState('.')
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'size' | 'modified'>('name')
  const [follow, setFollow] = useState(followDefault)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ left: number; top: number; entries: Entry[] } | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [review, setReview] = useState(false)
  const [discard, setDiscard] = useState<(() => void) | null>(null)
  const request = useRef(0)
  const lock = useRef(false)
  const anchor = useRef('')
  const menuRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const visible = entries.filter((entry) => entry.name.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))).sort((first, second) => {
    const folders = Number(second.kind === 'directory') - Number(first.kind === 'directory')
    return folders || (sort === 'name' ? 0 : second[sort] - first[sort]) || first.name.localeCompare(second.name, 'tr', { numeric: true })
  })
  const chosen = entries.filter((entry) => selected.includes(entry.name))
  const dirty = editor !== null && editor.text !== editor.original
  async function load(target: string) {
    if (disabled) return
    const version = ++request.current
    setLoading(true); setError(''); setMenu(null)
    try {
      const result = await window.nodus!.list(id, target)
      if (version !== request.current) return
      setPath(result.path); setAddress(result.path); setEntries(result.entries); setSelected([])
    } catch (failure) { if (version === request.current) setError(errorText(failure)) }
    finally { if (version === request.current) setLoading(false) }
  }
  useEffect(() => { void load(cwd); return () => { request.current++ } }, [id, disabled])
  useEffect(() => { if (follow && !editor && !action && !busy && !disabled) void load(cwd) }, [cwd, follow])
  useEffect(() => { if (disabled) { setMenu(null); setAction(null) } }, [disabled])
  useEffect(() => {
    if (!menu) return
    const element = menuRef.current!
    const bounds = element.getBoundingClientRect()
    element.style.left = Math.max(8, Math.min(menu.left, window.innerWidth - bounds.width - 8)) + 'px'
    element.style.top = Math.max(8, Math.min(menu.top, window.innerHeight - bounds.height - 8)) + 'px'
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: Event) => { if (!element.contains(event.target as Node)) setMenu(null) }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', keyboard)
    window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', keyboard); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss) }
  }, [menu])
  async function perform(task: () => Promise<void>) {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError('')
    try { await task() } catch (failure) { setError(errorText(failure)) }
    finally { lock.current = false; setBusy(false) }
  }
  function guard(task: () => void) { if (dirty) setDiscard(() => task); else task() }
  function select(entry: Entry, event: MouseEvent) {
    if (event.shiftKey && anchor.current) {
      const start = visible.findIndex((item) => item.name === anchor.current)
      const end = visible.indexOf(entry)
      if (start >= 0) { setSelected(visible.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.name)); return }
    }
    anchor.current = entry.name
    setSelected((current) => event.ctrlKey || event.metaKey ? current.includes(entry.name) ? current.filter((name) => name !== entry.name) : [...current, entry.name] : [entry.name])
  }
  function context(event: MouseEvent, entry?: Entry) {
    event.preventDefault(); event.stopPropagation()
    if (disabled || busy || loading) return
    const targets = entry ? selected.includes(entry.name) ? chosen : [entry] : []
    if (entry && !selected.includes(entry.name)) setSelected([entry.name])
    setMenu({ left: event.clientX, top: event.clientY, entries: targets })
  }
  function open(entry: Entry) {
    if (entry.kind === 'directory') { setFollow(false); void load(joinPath(path, entry.name)); return }
    guard(() => void perform(async () => {
      const target = joinPath(path, entry.name)
      const result = await window.nodus!.readFile(id, target)
      const ending = result.text.includes('\r\n') ? '\r\n' : '\n'
      const text = result.text.replace(/\r\n/g, '\n')
      setEditor({ path: target, text, original: text, ending })
    }))
  }
  function choose(type: Action['type'], targets = chosen) { setMenu(null); setAction({ type, entries: targets, directory: path }) }
  async function saveEditor() {
    if (editor && dirty) setReview(true)
  }
  const blocked = busy || loading || disabled
  return <aside className="file-panel" aria-label="SFTP dosyaları">
    <div className="panel-heading"><div><Folder size={16} /><strong>SFTP</strong>{busy && <LoaderCircle size={14} className="spin" />}</div><button className="icon-button" title="Dosya panelini daralt" aria-label="Dosya panelini daralt" disabled={busy} onClick={() => guard(close)}><X size={16} /></button></div>
    <form className="pathbar" onSubmit={(event) => { event.preventDefault(); setFollow(false); void load(address) }}><button type="button" className="icon-button" title="Üst klasör" aria-label="Üst klasör" disabled={blocked || !!editor} onClick={() => { setFollow(false); void load(joinPath(path, '..')) }}><ArrowUp size={15} /></button><input aria-label="Uzak dizin" value={address} disabled={blocked || !!editor} onChange={(event) => setAddress(event.target.value)} /><button className="icon-button" title="Dizine git" aria-label="Dizine git" disabled={blocked || !!editor}><Check size={14} /></button></form>
    <div className="file-tools"><button title="Dosya yükle" aria-label="Dosya yükle" disabled={blocked} onClick={() => void perform(async () => { await window.nodus!.upload(id, path); await load(path) })}><Upload size={16} /></button><button title="Yeni klasör oluştur" aria-label="Yeni klasör oluştur" disabled={blocked} onClick={() => choose('folder', [])}><FolderPlus size={16} /></button><button title="Yeni dosya oluştur" aria-label="Yeni dosya oluştur" disabled={blocked} onClick={() => choose('file', [])}><FilePlus2 size={16} /></button><button title="Seçilenleri arşivle" aria-label="Seçilenleri arşivle" disabled={blocked || !chosen.length || !!editor} onClick={() => choose('archive')}><Archive size={16} /></button><button title="Dosyaları yenile" aria-label="Dosyaları yenile" disabled={blocked} onClick={() => void load(path)}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div>
    {error && <div role="alert" className="file-error">{error}<button className="icon-button" aria-label="Hatayı kapat" onClick={() => setError('')}><X size={14} /></button></div>}
    {editor ? <div className="inline-editor">
      <button className="text-button" disabled={busy || disabled} onClick={() => setReview(true)}>Fark / Geçmiş</button>
      <div className="editor-heading"><span title={editor.path}>{editor.path.split('/').at(-1)}{dirty ? ' •' : ''}</span><button className="icon-button" title="Kaydet (Ctrl+S)" aria-label="Dosyayı kaydet" disabled={busy || disabled || !dirty} onClick={() => void saveEditor()}><Save size={16} /></button><button className="icon-button" title="Editörü kapat" aria-label="Editörü kapat" disabled={busy} onClick={() => guard(() => setEditor(null))}><X size={16} /></button></div>
      <div className="editor-code"><div ref={lineRef} className="editor-lines" aria-hidden="true">{Array.from({ length: editor.text.split('\n').length }, (_, index) => index + 1).join('\n')}</div><textarea aria-label="Dosya içeriği" autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" disabled={busy || disabled} value={editor.text} onScroll={(event) => { if (lineRef.current) lineRef.current.scrollTop = event.currentTarget.scrollTop }} onChange={(event) => setEditor({ ...editor, text: event.target.value })} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveEditor() }
        if (event.key === 'Tab') {
          event.preventDefault(); const input = event.currentTarget; const start = input.selectionStart; const end = input.selectionEnd
          setEditor({ ...editor, text: editor.text.slice(0, start) + '  ' + editor.text.slice(end) })
          requestAnimationFrame(() => { input.selectionStart = input.selectionEnd = start + 2 })
        }
      }} /></div><div className="editor-status"><span>UTF-8 · {editor.ending === '\r\n' ? 'CRLF' : 'LF'} · {editor.text.split('\n').length} satır</span><span>{dirty ? 'Kaydedilmedi' : 'Kaydedildi'}</span></div>
    </div> : <>
      <div className="file-filter"><Search size={14} /><input aria-label="Dosya ara" placeholder="Bu klasörde ara…" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Dosya sıralaması" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="name">Ad</option><option value="size">Boyut</option><option value="modified">Tarih</option></select></div>
      <div className="file-columns"><input type="checkbox" aria-label="Görünen dosyaları seç" disabled={blocked || !visible.length} checked={!!visible.length && visible.every((entry) => selected.includes(entry.name))} onChange={(event) => setSelected(event.target.checked ? visible.map((entry) => entry.name) : [])} /><span>Ad</span><span>Boyut</span><span>Yetki</span></div>
      <div className="file-list" role="list" aria-label="Uzak dosya listesi" onContextMenu={(event) => context(event)}>
        {visible.map((entry) => <div key={entry.name} role="listitem" className={'file-row ' + (selected.includes(entry.name) ? 'selected' : '')} onClick={(event) => select(entry, event)} onContextMenu={(event) => context(event, entry)}>
          <input type="checkbox" aria-label={entry.name + ' seç'} checked={selected.includes(entry.name)} disabled={blocked} onClick={(event) => event.stopPropagation()} onChange={(event) => { anchor.current = entry.name; setSelected((current) => event.target.checked ? [...current, entry.name] : current.filter((name) => name !== entry.name)) }} />
          <button className="file-name" disabled={blocked} title={entry.name + '\nDeğiştirilme: ' + new Date(entry.modified * 1000).toLocaleString('tr-TR')} onDoubleClick={() => open(entry)} onKeyDown={(event) => { if (event.key === 'Enter') open(entry); if (event.key === 'F2') choose('rename', [entry]) }}>{entry.kind === 'directory' ? <Folder className="folder-icon" size={16} /> : isArchive(entry.name) ? <Archive size={16} /> : <File size={16} />}<span>{entry.name}{entry.kind === 'link' ? ' ↗' : ''}</span></button>
          <span className="file-size">{entry.kind === 'directory' ? '—' : sizeLabel(entry.size)}</span><span className="file-mode">{(entry.mode & 0o7777).toString(8).padStart(3, '0')}</span><button className="icon-button file-action" disabled={blocked} aria-label={entry.name + ' işlemleri'} title="Dosya işlemleri" onClick={(event) => context(event, entry)}><MoreHorizontal size={15} /></button>
        </div>)}
        {!visible.length && <div className="file-empty">{loading ? 'Dosyalar yükleniyor…' : query ? 'Eşleşen dosya yok.' : 'Klasör boş.'}</div>}
      </div>
    </>}
    <div className="file-panel-footer"><span>{entries.length} öğe{selected.length ? ' · ' + selected.length + ' seçili' : ''}</span><label className="check"><input type="checkbox" checked={follow} disabled={!!editor} onChange={(event) => setFollow(event.target.checked)} />Terminali izle</label></div>
    {menu && createPortal(<div className="file-context-menu" ref={menuRef} role="menu" aria-label="Dosya işlemleri" style={{ left: menu.left, top: menu.top }} onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }}>
      {menu.entries.length === 1 && <><button role="menuitem" onClick={() => { open(menu.entries[0]); setMenu(null) }}><Pencil size={15} />{menu.entries[0].kind === 'directory' ? 'Klasörü aç' : 'Düzenle'}</button><button role="menuitem" onClick={() => choose('rename', menu.entries)}><Pencil size={15} />Yeniden adlandır</button>{menu.entries[0].kind !== 'directory' && <button role="menuitem" onClick={() => { const target = joinPath(path, menu.entries[0].name); setMenu(null); void perform(async () => { await window.nodus!.download(id, target) }) }}><Download size={15} />İndir</button>}</>}
      {!!menu.entries.length && <><button role="menuitem" onClick={() => choose('chmod', menu.entries)}><Shield size={15} />Yetkileri düzenle</button><button role="menuitem" onClick={() => choose('archive', menu.entries)}><Archive size={15} />Arşivle ({menu.entries.length})</button>{menu.entries.length === 1 && menu.entries[0].kind !== 'directory' && isArchive(menu.entries[0].name) && <button role="menuitem" onClick={() => choose('extract', menu.entries)}><ChevronDown size={15} />Arşivi aç</button>}<button role="menuitem" className="danger-hover" onClick={() => choose('delete', menu.entries)}><Trash2 size={15} />Sil ({menu.entries.length})</button><hr /></>}
      <button role="menuitem" onClick={() => choose('folder', [])}><FolderPlus size={15} />Yeni klasör</button><button role="menuitem" onClick={() => choose('file', [])}><FilePlus2 size={15} />Yeni dosya</button>
    </div>, document.body)}
    {review && editor && <FileReview id={id} path={editor.path} original={editor.original.replace(/\n/g, editor.ending)} text={editor.text.replace(/\n/g, editor.ending)} disabled={disabled} close={() => setReview(false)} saved={(text) => { const normalized = text.replace(/\r\n/g, '\n'); setEditor({ ...editor, text: normalized, original: normalized, ending: text.includes('\r\n') ? '\r\n' : '\n' }); notify('Dosya kaydedildi.'); void load(path) }} />}
    {action && <FileAction id={id} action={action} close={() => setAction(null)} done={async () => { setAction(null); await load(path) }} />}
    {discard && <Modal title="Kaydedilmemiş değişiklikler" close={() => setDiscard(null)}><div className="modal-form"><p>Değişiklikler kaydedilmedi. Devam edersen bu düzenlemeler kaybolacak.</p><div className="modal-footer"><button className="secondary" onClick={() => setDiscard(null)}>Düzenlemeye dön</button><button className="primary" onClick={() => { const proceed = discard; setDiscard(null); setEditor(null); proceed() }}>Değişiklikleri bırak</button></div></div></Modal>}
  </aside>
}

function FileAction({ id, action, close, done }: { id: string; action: Action; close: () => void; done: () => Promise<void> }) {
  const [name, setName] = useState(action.type === 'rename' ? action.entries[0].name : action.type === 'archive' ? 'arsiv' : '')
  const [format, setFormat] = useState('zip')
  const [mode, setMode] = useState((action.entries[0]?.mode & 0o7777).toString(8).padStart(3, '0'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titles = { file: 'Yeni dosya', folder: 'Yeni klasör', rename: 'Yeniden adlandır', delete: 'Seçilenleri sil', chmod: 'Dosya yetkileri', archive: 'Arşiv oluştur', extract: 'Arşivi aç' }
  const hasName = ['file', 'folder', 'rename', 'archive'].includes(action.type)
  const numericMode = /^[0-7]{3,4}$/.test(mode) ? parseInt(mode, 8) : 0
  async function submit() {
    setBusy(true); setError('')
    try {
      const api = window.nodus!
      if (hasName && !validName(name)) throw new Error('Geçerli bir ad gir. / ve kontrol karakterleri kullanılamaz.')
      const target = joinPath(action.directory, name)
      const paths = action.entries.map((entry) => joinPath(action.directory, entry.name))
      if (action.type === 'folder') await api.mkdir(id, target)
      if (action.type === 'file') await api.writeFile(id, target, '', true)
      if (action.type === 'rename') {
        const listing = await api.list(id, action.directory)
        if (listing.entries.some((entry) => entry.name === name)) throw new Error('Aynı adlı öğe zaten var.')
        await api.rename(id, paths[0], target)
      }
      if (action.type === 'delete') await api.remove(id, paths)
      if (action.type === 'chmod') {
        if (!/^[0-7]{3,4}$/.test(mode)) throw new Error('Yetki 3 veya 4 basamaklı sekizlik sayı olmalı (ör. 644, 0755).')
        for (const path of paths) await api.chmod(id, path, parseInt(mode, 8))
      }
      if (action.type === 'archive') await api.archive(id, action.directory, name, format, action.entries.map((entry) => entry.name))
      if (action.type === 'extract') await api.extract(id, paths[0])
      await done()
    } catch (failure) { setError(errorText(failure)) }
    finally { setBusy(false) }
  }
  return <Modal title={titles[action.type]} close={() => { if (!busy) close() }}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void submit() }}><fieldset disabled={busy}>
    {!!action.entries.length && <p className="action-targets">{action.entries.length > 5 ? action.entries.length + ' öğe seçili' : action.entries.map((entry) => entry.name).join(', ')}</p>}
    {hasName && <label>Ad<input autoFocus required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} /></label>}
    {action.type === 'archive' && <><label>Arşiv biçimi<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="zip">ZIP</option><option value="tar.gz">TAR.GZ</option><option value="tar">TAR</option><option value="tar.bz2">TAR.BZ2</option><option value="tar.xz">TAR.XZ</option>{action.entries.length === 1 && action.entries[0].kind === 'file' && <option value="gz">GZ (tek dosya)</option>}</select></label><p className="field-hint">Uzantı otomatik eklenir. Aynı adlı dosyanın üzerine yazılmaz. Gerekli arşiv programı sunucuda kurulu olmalı.</p></>}
    {action.type === 'delete' && <p className="inline-error">Seçilen dosyalar ve klasörlerin tüm içeriği sunucudan kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>}
    {action.type === 'extract' && <p>Arşiv aynı dizinde yeni bir “{action.entries[0].name}.extracted” klasörüne açılacak. Yalnızca güvendiğin arşivleri aç. Gerekli açma programı sunucuda kurulu olmalı.</p>}
    {action.type === 'chmod' && <><label>Sekizlik yetki<input autoFocus value={mode} pattern="[0-7]{3,4}" maxLength={4} onChange={(event) => setMode(event.target.value)} /></label><div className="permission-grid"><span /><strong>Oku</strong><strong>Yaz</strong><strong>Çalıştır</strong>{['Sahip', 'Grup', 'Diğer'].map((label, row) => <div className="permission-row" key={label}><span>{label}</span>{[4, 2, 1].map((bit, column) => { const mask = bit << ((2 - row) * 3); return <input key={bit} type="checkbox" aria-label={label + ' ' + ['oku', 'yaz', 'çalıştır'][column]} checked={!!(numericMode & mask)} onChange={(event) => setMode((event.target.checked ? numericMode | mask : numericMode & ~mask).toString(8).padStart(3, '0'))} /> })}</div>)}</div><p className="field-hint">Seçilen öğelere uygulanır; alt klasörlere yayılmaz. 4. basamak özel izinleri korur.</p></>}
  </fieldset>{error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={close}>Vazgeç</button><button className="primary" disabled={busy}>{busy ? 'İşleniyor…' : action.type === 'delete' ? 'Kalıcı olarak sil' : 'Uygula'}</button></div></form></Modal>
}
