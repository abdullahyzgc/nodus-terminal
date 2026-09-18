import { useEffect, useRef, useState } from 'react'
import type { Host } from './shared'
import { errorText } from './session'

export function SessionControls({ id, host, closed, close, allowed, allow }: { id: string; host: Host; closed: boolean; close: () => void; allowed: boolean; allow: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [automatic, setAutomatic] = useState(!!host.persistentSession)
  const [attempt, setAttempt] = useState(0)
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (!closed) { setAttempt(0); setError(''); setPassword(''); setNeedsPassword(false) } }, [closed])
  async function reconnect(manual = false) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setAttempt((value) => value + 1)
    const secret = manual && password ? password : undefined
    setPassword('')
    try { await window.nodus!.reconnect(id, secret) }
    catch (failure) {
      if (alive.current) { setError(errorText(failure)); if (/authenticat|all configured|wrong password|permission denied/i.test(errorText(failure))) { setNeedsPassword(host.authType === 'password'); setAutomatic(false) } if (/verification|parmak|bulunamadı|tmux/i.test(errorText(failure))) setAutomatic(false) }
    } finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    if (!closed || !automatic || busy || attempt >= 3 || needsPassword) return
    const timer = setTimeout(() => void reconnect(), [2000, 5000, 10000][attempt])
    return () => clearTimeout(timer)
  }, [closed, automatic, busy, attempt, needsPassword])
  if (!closed && !host.production && !host.persistentSession) return null
  return <div className={'session-controls ' + (host.production ? 'production-note' : '')}>
    <span>{host.production ? 'ÜRETİM · ' : ''}{host.persistentSession ? 'tmux kalıcı oturum' : 'Standart oturum'}{closed ? ' · Bağlantı kapalı' : ''}</span>
    {!closed && host.production && !allowed && <button className="secondary" onClick={() => { void window.nodus!.authorizeTerminal(id).then((accepted) => { if (accepted) allow() }).catch((failure) => setError(errorText(failure))) }}>Üretim terminalini aç</button>}
    {!closed && host.production && allowed && <span>Terminal girdisi açık; komutlar tek tek denetlenmez.</span>}
    {closed && <><label className="check"><input type="checkbox" checked={automatic} onChange={(event) => { setAutomatic(event.target.checked); setAttempt(0) }} />Otomatik yeniden bağlan (en fazla 3 deneme)</label>{needsPassword && <input aria-label="Yeniden bağlantı parolası" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />}<button className="secondary" disabled={busy || (needsPassword && !password)} onClick={() => void reconnect(true)}>{busy ? 'Bağlanıyor…' : 'Yeniden bağlan'}</button><button className="secondary" onClick={close}>Sekmeyi kapat</button></>}
    {closed && !host.persistentSession && <small>Yeni kabuk açılır; önceki işlemler otomatik tekrarlanmaz.</small>}{error && <span role="alert">{error}</span>}
  </div>
}
