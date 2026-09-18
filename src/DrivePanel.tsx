import { useEffect, useState } from 'react'
import { Cloud, Download, RefreshCw } from 'lucide-react'
import type { DriveStatus, Vault } from './shared'
import { errorText } from './session'

export function DrivePanel({ ready, disabled = false }: { ready?: (vault: Vault) => void; disabled?: boolean }) {
  const [status, setStatus] = useState<DriveStatus>({ configured: false, connected: false, busy: false, message: 'Google Drive durumu alınıyor…', conflicts: [] })
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  useEffect(() => {
    let active = true
    const unsubscribe = window.nodus!.onDrive((next) => { if (active) setStatus(next) })
    window.nodus!.driveStatus().then((next) => { if (active) setStatus(next) }).catch((failure) => { if (active) setError(errorText(failure)) })
    return () => { active = false; unsubscribe() }
  }, [])
  async function action(operation: () => Promise<DriveStatus>) {
    setWorking(true); setError('')
    try { setStatus(await operation()) }
    catch (failure) { setError(errorText(failure)) }
    finally { setWorking(false) }
  }
  const busy = disabled || working || status.busy
  return <section className="settings-card drive-panel">
    <div className="settings-title"><div className="feature-icon"><Cloud size={22} /></div><div><h2>Google Drive</h2><p>Şifreli kasa, cihazların arasında otomatik eşleme.</p></div><span className="tiny-badge">OTOMATİK</span></div>
    <div className="info-box">Aynı Google hesabı, aynı OAuth uygulaması ve aynı kasa parolasıyla eşlenir. Değişiklikler kısa süre sonra gönderilir; kasa açıkken 30 saniyede bir kontrol edilir. Uzak kayıtlar uygulanırken açık SSH oturumları kapatılır ve yerel yedek alınır.</div>
    <details className="drive-help"><summary>İlk bağlantı için Google ayarı</summary><p>Google Cloud Console içinde bir proje oluştur, Google Drive API hizmetini etkinleştir. Google Auth Platform içinde izin ekranını ayarla; uygulama test durumundaysa hesabını test kullanıcılarına ekle. OAuth istemcisi türünü <strong>Masaüstü uygulaması</strong> seçip JSON dosyasını indir.</p><p>Her cihazda aynı OAuth JSON dosyasını seç. Nodus yalnızca Drive içindeki kendine ait gizli uygulama verisine erişim ister; diğer dosyalarını okuyamaz. Google uygulaması test durumundayken izin süresi dolabilir; gerekirse yeniden bağlan.</p></details>
    <div className="settings-actions">
      <button type="button" className="secondary" disabled={busy || status.connected} onClick={() => void action(() => window.nodus!.driveConfigure())}>{status.configured ? 'OAuth JSON değiştir' : 'OAuth JSON seç'}</button>
      {!status.connected ? <button type="button" className="primary" disabled={busy || !status.configured} onClick={() => void action(() => window.nodus!.driveConnect())}>Google hesabına bağlan</button> : <>
        {!ready && <button type="button" className="primary" disabled={busy} onClick={() => void action(() => window.nodus!.driveSync())}><RefreshCw size={15} />Şimdi eşle</button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => void action(() => window.nodus!.driveDisconnect())}>Bağlantıyı kes</button>
      </>}
    </div>
    <p className="field-hint" role="status">{status.message}</p>
    {status.lastSync && <p className="field-hint">Son başarılı eşleme: {new Date(status.lastSync).toLocaleString('tr-TR')}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {status.conflicts.map((conflict) => <div className="info-box" key={conflict.key}><strong>{conflict.label}</strong><p>İki sürüm farklı. Korunacak kaydı seç; seçim tamamlanana kadar üzerine yazılmaz.</p><div className="settings-actions">{conflict.options.map((option) => <button className="secondary" type="button" key={option.id} disabled={busy} onClick={() => void action(() => window.nodus!.driveResolve(conflict.key, option.id))}>{option.label}</button>)}</div></div>)}
    {ready && <form onSubmit={async (event) => {
      event.preventDefault(); setWorking(true); setError('')
      try { const vault = await window.nodus!.driveRestore(password, remember); setPassword(''); ready(vault) }
      catch (failure) { setError(errorText(failure)) }
      finally { setWorking(false) }
    }}><fieldset disabled={busy || !status.connected}><label>Drive kasasının parolası<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Bu cihazda hatırla</label><button className="primary full"><Download size={16} />Drive kasasını aç</button></fieldset><p className="field-hint">Yeni cihazda boş kasa oluşturmadan, mevcut kasanı aynı parolayla aç.</p></form>}
  </section>
}
