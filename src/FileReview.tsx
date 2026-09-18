import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileRevision } from './shared'
import { Modal } from './Forms'
import { diffLines } from './diff'
import { errorText } from './session'

export function FileReview({ id, path, original, text, disabled, close, saved }: { id: string; path: string; original: string; text: string; disabled: boolean; close: () => void; saved: (text: string) => void }) {
  const [revisions, setRevisions] = useState<FileRevision[]>([])
  const [revision, setRevision] = useState('')
  const [backup, setBackup] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const previous = revisions.find((entry) => entry.id === revision)
  const target = previous?.text ?? text
  const lines = useMemo(() => diffLines(original.replace(/\r\n/g, '\n'), target.replace(/\r\n/g, '\n')), [original, target])
  const changes = lines.filter((line) => line.kind !== 'same')
  const visible = useMemo(() => {
    if (!changes.length) return lines.slice(0, 80)
    const indexes = new Set<number>()
    lines.forEach((line, index) => { if (line.kind !== 'same') for (let neighbor = Math.max(0, index - 2); neighbor <= Math.min(lines.length - 1, index + 2); neighbor++) indexes.add(neighbor) })
    return [...indexes].sort((first, second) => first - second).slice(0, 3000).map((index) => lines[index])
  }, [lines])
  useEffect(() => { let alive = true; window.nodus!.fileRevisions(id, path).then((result) => { if (alive) setRevisions(result) }).catch((failure) => { if (alive) setError(errorText(failure)) }); return () => { alive = false } }, [id, path])
  async function apply() {
    if (pending.current || disabled) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = previous ? await window.nodus!.restoreFileVersion(id, path, previous.id, original) : (await window.nodus!.saveFileVersion(id, path, text, original, backup), text)
      saved(result); close()
    } catch (failure) { setError(errorText(failure)) }
    finally { pending.current = false; setBusy(false) }
  }
  return <Modal title="Dosya karşılaştırma ve geri alma" close={() => { if (!busy) close() }}><div className="modal-form file-review">
    <p className="action-targets">{path}</p><div className="review-history"><label>Sürüm<select aria-label="Karşılaştırılacak sürüm" disabled={busy} value={revision} onChange={(event) => setRevision(event.target.value)}><option value="">Editördeki değişiklikler</option>{revisions.map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.created).toLocaleString('tr-TR')} · Yedek</option>)}</select></label></div>
    <p className="field-hint">Sol numara: sunucudan açılan sürüm. Sağ numara: uygulanacak sürüm. +{changes.filter((line) => line.kind === 'add').length} / −{changes.filter((line) => line.kind === 'remove').length}. En fazla 3000 satır gösterilir; değişmeyen uzak bölümler gizlenir.</p>
    <div className="diff-lines" aria-label="Dosya farkları">{visible.map((line, index) => <div key={index} className={'diff-' + line.kind}><span>{line.before ?? '·'} / {line.after ?? '·'}</span><code>{line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '− ' : '  '}{line.text || ' '}</code></div>)}</div>
    {!previous && <label className="check"><input type="checkbox" checked={backup} disabled={busy} onChange={(event) => setBackup(event.target.checked)} />Kayıttan önce şifreli yerel yedek oluştur</label>}
    <p className="field-hint">Bu cihazda en son değiştirilen 20 dosyanın beşer sürümü tutulur. Geçmiş Drive ile eşlenmez. Geri alma mevcut sunucu içeriğini yedekler; kaydedilmemiş editör değişikliklerini değiştirir.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary" disabled={busy} onClick={close}>Vazgeç</button><button className="primary" disabled={busy || disabled || target === original} onClick={() => void apply()}>{busy ? 'Kaydediliyor…' : previous ? 'Bu sürüme geri dön' : 'Değişiklikleri kaydet'}</button></div>
  </div></Modal>
}
