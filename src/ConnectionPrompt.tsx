import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Host } from './shared'
import { observeTerminalAppearance, terminalAppearance } from './appearance'
import { installTerminalClipboard } from './terminal-clipboard'
import '@xterm/xterm/css/xterm.css'

export function ConnectionPrompt({ host, active, phase, message, submit, close }: { host: Host; active: boolean; phase: 'connecting' | 'password' | 'failed'; message?: string; submit: (password?: string) => void; close: () => void }) {
  const element = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const inputRef = useRef('')
  const [clipboardError, setClipboardError] = useState('')
  const current = useRef({ phase, submit, close })
  current.current = { phase, submit, close }
  useEffect(() => {
    const terminal = new Terminal({ cursorBlink: true, ...terminalAppearance() })
    const fit = new FitAddon()
    terminal.loadAddon(fit); terminal.open(element.current!); terminalRef.current = terminal
    const stopClipboard = installTerminalClipboard(terminal, window.nodus!, setClipboardError, () => current.current.phase === 'password')
    const resize = () => { if (element.current?.clientWidth && element.current?.clientHeight) fit.fit() }
    const stopAppearance = observeTerminalAppearance(terminal, resize)
    const observer = new ResizeObserver(resize)
    observer.observe(element.current!)
    terminal.writeln(host.username + '@' + host.hostname + ':' + host.port)
    const listener = terminal.onData((data) => {
      if (data === '\x03') { inputRef.current = ''; current.current.close(); return }
      if (current.current.phase !== 'password') return
      if (data.startsWith('\x1b')) return
      for (const character of data) {
        if (character === '\r' || character === '\n') {
          if (inputRef.current) {
            const password = inputRef.current; inputRef.current = ''
            current.current = { ...current.current, phase: 'connecting' }
            terminal.write('\r\n'); current.current.submit(password)
          }
          break
        }
        if (character === '\x7f' || character === '\b') inputRef.current = Array.from(inputRef.current).slice(0, -1).join('')
        else if (character === '\x15') inputRef.current = ''
        else if (character >= ' ' && inputRef.current.length < 4096) inputRef.current += character
      }
    })
    return () => { stopClipboard(); stopAppearance(); inputRef.current = ''; listener.dispose(); observer.disconnect(); terminal.dispose(); terminalRef.current = null }
  }, [])
  useEffect(() => {
    inputRef.current = ''
    setClipboardError('')
    const terminal = terminalRef.current
    terminal?.write('\r\n')
    if (message) terminal?.writeln(message.replace(/[\x00-\x1f\x7f]/g, ' '))
    if (phase === 'password') {
      terminal?.writeln('Parola görünmez; bu giriş kasaya kaydedilmez. İptal: Ctrl+C')
      terminal?.write('Parola: ')
    } else if (phase === 'connecting') terminal?.writeln('SSH bağlantısı kuruluyor…')
    if (active) terminal?.focus()
  }, [phase, message])
  useEffect(() => { if (active) terminalRef.current?.focus() }, [active])
  return <section className={'workspace ' + (active ? '' : 'inactive')} aria-label={host.name + ' bağlantı ekranı'}>
    <div className="workspace-toolbar"><strong>{host.username}@{host.hostname}</strong><span role="status">{phase === 'password' ? 'Parola bekleniyor' : phase === 'connecting' ? 'Bağlanıyor…' : 'Bağlantı kurulamadı'}</span></div>
    <div ref={element} className="terminal-surface connection-prompt" data-testid="password-terminal" />
    {clipboardError && <div className="file-error" role="alert">{clipboardError}</div>}
    {phase === 'failed' && <div className="disconnected"><span>{message}</span><button className="secondary" onClick={() => submit()}>Yeniden dene</button></div>}
  </section>
}
