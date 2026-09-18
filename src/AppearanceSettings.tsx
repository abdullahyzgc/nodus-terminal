import { useState } from 'react'
import { Palette, RotateCcw } from 'lucide-react'
import { defaultAppearance, palettes, saveAppearance, terminalFonts, uiFonts, useAppearance, type Appearance } from './appearance'

export function AppearanceSettings() {
  const appearance = useAppearance()
  const [error, setError] = useState('')
  function update(change: Partial<Appearance>) {
    setError(saveAppearance({ ...appearance, ...change }) ? '' : 'Görünüm uygulandı ancak bu cihazda kaydedilemedi.')
  }
  return <section className="settings-card appearance-settings" aria-label="Görünüm ayarları">
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="settings-title"><div className="feature-icon"><Palette size={22} /></div><div><h2>Tema ve yazı tipi</h2><p>Anında uygulanır. Bu cihazda saklanır; açık bağlantılar korunur.</p></div></div>
    <div className="appearance-mode" role="group" aria-label="Tema modu">{([['dark', 'Koyu'], ['light', 'Açık'], ['system', 'Sistem']] as const).map(([mode, label]) => <button key={mode} className="secondary" aria-pressed={appearance.mode === mode} onClick={() => update({ mode })}>{label}</button>)}</div>
    <div className="theme-grid" role="group" aria-label="Renk paletleri">{palettes.map((palette) => <button key={palette.id} className="theme-card" aria-label={palette.name + ' paleti'} aria-pressed={appearance.palette === palette.id} onClick={() => update({ palette: palette.id })}><span className="theme-swatches" aria-hidden="true">{[palette.dark.base[0], palette.dark.base[2], palette.dark.accent, palette.light.soft].map((color, index) => <i key={index} style={{ background: color }} />)}</span><strong>{palette.name}</strong><small>{palette.description}</small></button>)}</div>
    <div className="form-grid appearance-fonts"><label>Arayüz yazı tipi<select aria-label="Arayüz yazı tipi" value={appearance.uiFont} onChange={(event) => update({ uiFont: event.target.value })}>{Object.entries(uiFonts).map(([key, font]) => <option key={key} value={key}>{font.name}</option>)}</select></label><label>Terminal ve editör yazı tipi<select aria-label="Terminal ve editör yazı tipi" value={appearance.terminalFont} onChange={(event) => update({ terminalFont: event.target.value })}>{Object.entries(terminalFonts).map(([key, font]) => <option key={key} value={key}>{font.name}</option>)}</select></label><label>Yazı boyutu · {appearance.fontSize} px<input type="range" min="11" max="24" step="1" aria-label="Terminal yazı boyutu" value={appearance.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label><label>Satır aralığı · {appearance.lineHeight.toFixed(1)}<input type="range" min="1.1" max="1.8" step="0.1" aria-label="Terminal satır aralığı" value={appearance.lineHeight} onChange={(event) => update({ lineHeight: Number(event.target.value) })} /></label></div>
    <div className="appearance-preview" aria-label="Terminal önizlemesi"><span>root@nodus:~$</span> ls -la<br /><span>drwxr-xr-x</span> projeler/<br />Türkçe: ğ ü ş ı ö ç · 0123456789</div>
    <div className="appearance-footer"><p className="field-hint">Seçilen font kurulu değilse yedek sistem fontu kullanılır.</p><button className="secondary" onClick={() => update(defaultAppearance)}><RotateCcw size={14} />Varsayılana dön</button></div>
  </section>
}
