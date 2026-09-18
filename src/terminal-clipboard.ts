import type { Terminal } from '@xterm/xterm'
import type { NodusAPI } from './shared'

type ClipboardTerminal = Pick<Terminal, 'attachCustomKeyEventHandler' | 'hasSelection' | 'getSelection' | 'paste'>
type ClipboardAPI = Pick<NodusAPI, 'readClipboard' | 'writeClipboard'>

export function installTerminalClipboard(terminal: ClipboardTerminal, clipboard: ClipboardAPI, notify: (message: string) => void, canPaste: () => boolean = () => true): () => void {
  let disposed = false
  terminal.attachCustomKeyEventHandler((event) => {
    if (disposed || event.altKey) return true
    const key = event.key.toLowerCase()
    const shortcut = event.ctrlKey || event.metaKey
    const copy = shortcut && key === 'c' && (event.shiftKey || event.metaKey || terminal.hasSelection())
    const paste = (shortcut && key === 'v') || (event.shiftKey && key === 'insert' && !shortcut)
    if (!copy && !paste) return true
    event.preventDefault()
    event.stopPropagation()
    if (event.type !== 'keydown' || event.repeat) return false
    if (copy) {
      const text = terminal.getSelection()
      if (text) void clipboard.writeClipboard(text).catch(() => { if (!disposed) notify('Panoya kopyalanamadı.') })
    } else if (canPaste()) {
      void clipboard.readClipboard().then((text) => {
        if (!disposed && canPaste()) terminal.paste(text)
      }).catch(() => { if (!disposed) notify('Pano okunamadı.') })
    }
    return false
  })
  return () => { disposed = true }
}
