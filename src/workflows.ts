export function workflowParameters(command: string): string[] {
  return [...new Set([...command.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]{0,39})\}\}/g)].map((match) => match[1]))]
}

export function renderWorkflow(command: string, values: Record<string, string>): string {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Geçersiz parametreler.')
  for (const name of workflowParameters(command)) {
    if (!Object.hasOwn(values, name) || typeof values[name] !== 'string' || values[name].length > 4096 || /[\x00-\x1f\x7f]/.test(values[name])) throw new Error('Geçersiz parametre: ' + name)
  }
  const lines = command.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim())
  if (!lines.length || lines.length > 30) throw new Error('Akış 1–30 tek satırlık adım içermeli.')
  for (const line of lines) {
    if (/^\s*(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|set|exec|exit|return|eval|source|\.)\b/.test(line)) throw new Error('Akış adımı basit komut olmalı; kabuk kontrol yapıları desteklenmiyor.')
    let quote = ''
    let escaped = false
    for (let index = 0; index < line.length; index++) {
      const character = line[index]
      if (line.slice(index).startsWith('{{')) {
        const match = /^\{\{([A-Za-z_][A-Za-z0-9_]{0,39})\}\}/.exec(line.slice(index))
        if (!match || quote || escaped || (index > 0 && !/[\s=]/.test(line[index - 1])) || (index + match[0].length < line.length && !/[\s;|&)]/.test(line[index + match[0].length]))) throw new Error('Parametreyi tırnaksız, ayrı argüman olarak kullan: {{ad}}')
        index += match[0].length - 1
        continue
      }
      if (escaped) { escaped = false; continue }
      if (!quote && /[;|&(){}]/.test(character)) throw new Error('Her satır tek komut olmalı; zincirleme ve arka plan işlemleri desteklenmiyor.')
      if (character === '\\' && quote !== "'") { escaped = true; continue }
      if (character === "'" || character === '"') quote = quote === character ? '' : quote || character
      if (character === '`' || (character === '$' && line[index + 1] === '(') || line.slice(index, index + 2) === '<<') throw new Error('Akışlarda komut ikamesi ve here-document desteklenmiyor.')
    }
    if (quote || escaped) throw new Error('Her adım bağımsız, tek satırlık komut olmalı.')
  }
  const script = 'set -e\n' + lines.map((line) => line.replace(/\{\{([A-Za-z_][A-Za-z0-9_]{0,39})\}\}/g, (_match, name: string) => "'" + values[name].replace(/'/g, "'\\''") + "'")).join('\n')
  if (script.length > 8192) throw new Error('Doldurulmuş akış 8192 karakteri aşamaz.')
  return script
}
