import { useSyncExternalStore } from 'react'

type Colors = { base: string[]; text: string[]; accent: string; solid: string; hover: string; soft: string; border: string; strong: string; terminal: string }
export type Appearance = { palette: string; mode: 'dark' | 'light' | 'system'; uiFont: string; terminalFont: string; fontSize: number; lineHeight: number }
export const uiFonts = {
  system: { name: 'Sistem', value: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif' },
  arial: { name: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  trebuchet: { name: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  verdana: { name: 'Verdana', value: 'Verdana, sans-serif' },
}
export const terminalFonts = {
  cascadia: { name: 'Cascadia Code', value: '"Cascadia Code", "SFMono-Regular", Consolas, monospace' },
  consolas: { name: 'Consolas', value: 'Consolas, "SFMono-Regular", monospace' },
  jetbrains: { name: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
  fira: { name: 'Fira Code', value: '"Fira Code", Consolas, monospace' },
  courier: { name: 'Courier New', value: '"Courier New", monospace' },
}
const dark = (base: string[], accent: string, solid: string, soft: string, border: string, text = ['#ededf0', '#c4c4cc', '#9d9da7', '#80808b']): Colors => ({ base, text, accent, solid, hover: solid, soft, border, strong: text[3], terminal: base[0] })
const light = (base: string[], accent: string, soft: string, border: string): Colors => ({ base, text: ['#202632', '#3d495c', '#58657a', '#65738a'], accent, solid: accent, hover: accent, soft, border, strong: '#8a98ae', terminal: base[2] })
export const palettes = [
  { id: 'nodus', name: 'Nodus', description: 'Klasik mavi', dark: { ...dark(['#0b0b0d', '#101012', '#161618', '#1d1d20', '#262629', '#0f0f11'], '#8aacf2', '#315fc3', '#1a2438', '#2a2a30'), strong: '#414149', hover: '#3b6dd8', terminal: '#09090b' }, light: light(['#f2f5fb', '#e9eef8', '#ffffff', '#f5f7fc', '#e2eafa', '#ffffff'], '#315fc3', '#e1eaff', '#cbd5e5') },
  { id: 'nord', name: 'Nord', description: 'Kuzey mavisi', dark: dark(['#202630', '#252c37', '#2e3440', '#353e4e', '#414c5e', '#242a34'], '#8fbcdb', '#365f83', '#293d51', '#475469', ['#eceff4', '#d8dee9', '#aab7ca', '#8798b0']), light: light(['#edf2f6', '#e2eaf0', '#f9fcff', '#edf4f9', '#dce8f0', '#ffffff'], '#326386', '#d8eaf5', '#c1d2df') },
  { id: 'dracula', name: 'Dracula', description: 'Mor ve pembe', dark: dark(['#1d1e29', '#232431', '#282a36', '#333546', '#3d4055', '#21222e'], '#bd93f9', '#7142a2', '#392b50', '#474359'), light: light(['#f6f0fc', '#efe4f7', '#fffbff', '#f7effb', '#eadcf3', '#ffffff'], '#7745a5', '#ecdef8', '#dac9e5') },
  { id: 'forest', name: 'Orman', description: 'Yumuşak yeşil', dark: dark(['#0d1713', '#111e18', '#18271f', '#203329', '#2a4134', '#101d17'], '#9ccd9e', '#346540', '#233c2b', '#354c3c'), light: light(['#f0f5ef', '#e6efe3', '#fcfff9', '#f2f8ed', '#e0edd9', '#ffffff'], '#35643d', '#dfedd9', '#c7d6c2') },
  { id: 'ocean', name: 'Okyanus', description: 'Turkuaz ve lacivert', dark: dark(['#081820', '#0c202a', '#112b35', '#193541', '#21434f', '#0a1d26'], '#6fd6db', '#246b75', '#153e49', '#2c505d'), light: light(['#edf7f9', '#dfeef2', '#faffff', '#eff9fb', '#d9edf1', '#ffffff'], '#176877', '#d6eef2', '#bcd8df') },
  { id: 'amber', name: 'Kehribar', description: 'Sıcak altın', dark: dark(['#19150e', '#211b13', '#2b2319', '#352c20', '#443726', '#1e180f'], '#e8c07b', '#805823', '#3d2e19', '#51422e'), light: light(['#faf5e9', '#f3ead7', '#fffdf7', '#fbf4e5', '#efe1c5', '#ffffff'], '#80551b', '#f6e5bf', '#dfcfaf') },
  { id: 'rose', name: 'Gül', description: 'Bordo ve gül kurusu', dark: dark(['#1b1117', '#231820', '#2d2029', '#392a34', '#463541', '#20151c'], '#e8a7bf', '#914560', '#422737', '#573e4c'), light: light(['#fbf1f5', '#f4e4ec', '#fffafd', '#fcf0f6', '#f1dfe8', '#ffffff'], '#934362', '#f5deea', '#e1c8d5') },
  { id: 'slate', name: 'Grafit', description: 'Sade gri', dark: dark(['#141619', '#1b1e22', '#23272c', '#2c3137', '#383f46', '#191c20'], '#b4c5da', '#4c627b', '#2c3847', '#424b56'), light: light(['#f1f3f5', '#e5e9ee', '#ffffff', '#f5f7f9', '#dfe5ec', '#ffffff'], '#486079', '#e1e8ef', '#c9d1db') },
]
export const defaultAppearance: Appearance = { palette: 'nodus', mode: 'dark', uiFont: 'system', terminalFont: 'cascadia', fontSize: 13, lineHeight: 1.5 }
const own = (object: object, key: unknown): key is string => typeof key === 'string' && Object.hasOwn(object, key)
export function normalizeAppearance(input: unknown): Appearance {
  const value = input && typeof input === 'object' ? input as Partial<Appearance> : {}
  const bounded = (number: unknown, fallback: number, minimum: number, maximum: number) => typeof number === 'number' && Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
  return {
    palette: palettes.some((palette) => palette.id === value.palette) ? value.palette! : defaultAppearance.palette,
    mode: ['dark', 'light', 'system'].includes(value.mode ?? '') ? value.mode! : defaultAppearance.mode,
    uiFont: own(uiFonts, value.uiFont) ? value.uiFont : defaultAppearance.uiFont,
    terminalFont: own(terminalFonts, value.terminalFont) ? value.terminalFont : defaultAppearance.terminalFont,
    fontSize: Math.round(bounded(value.fontSize, 13, 11, 24)),
    lineHeight: Math.round(bounded(value.lineHeight, 1.5, 1.1, 1.8) * 10) / 10,
  }
}
export function themeTokens(appearance: Appearance, systemLight = false) {
  const mode = appearance.mode === 'system' ? systemLight ? 'light' : 'dark' : appearance.mode
  const palette = palettes.find((item) => item.id === appearance.palette) ?? palettes[0]
  const colors = palette[mode]
  const tokens: Record<string, string> = {
    '--bg': colors.base[0], '--surface-low': colors.base[1], '--surface': colors.base[2], '--surface-raised': colors.base[3], '--surface-hover': colors.base[4], '--input': colors.base[5],
    '--text': colors.text[0], '--text-secondary': colors.text[1], '--muted': colors.text[2], '--faint': colors.text[3],
    '--accent': colors.accent, '--accent-solid': colors.solid, '--accent-hover': colors.hover, '--accent-soft': colors.soft, '--on-accent': '#ffffff',
    '--border': colors.border, '--border-strong': colors.strong, '--terminal-bg': colors.terminal, '--selection': colors.accent + (mode === 'dark' ? '45' : '35'),
    '--success': mode === 'dark' ? '#80b89c' : '#267249', '--warning': mode === 'dark' ? '#d4b57b' : '#7d561b', '--warning-surface': mode === 'dark' ? '#292419' : '#fff1d5',
    '--danger': mode === 'dark' ? '#e5a0a6' : '#a52c43', '--danger-surface': mode === 'dark' ? '#2c1c21' : '#fff0f2', '--danger-border': mode === 'dark' ? '#654049' : '#db9caa',
    '--ui-font': uiFonts[appearance.uiFont as keyof typeof uiFonts].value,
    '--terminal-font': terminalFonts[appearance.terminalFont as keyof typeof terminalFonts].value,
    '--terminal-font-size': appearance.fontSize + 'px', '--terminal-line-height': String(appearance.lineHeight),
  }
  return { tokens, mode }
}
const storageKey = 'nodus-appearance-v1'
let current = defaultAppearance
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const useAppearance = () => useSyncExternalStore(subscribe, () => current)
function apply() {
  const { tokens, mode } = themeTokens(current, matchMedia('(prefers-color-scheme: light)').matches)
  for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value)
  document.documentElement.style.colorScheme = mode
  document.documentElement.dataset.theme = current.palette
  document.documentElement.dataset.mode = mode
  for (const listener of listeners) listener()
}
export function initializeAppearance() {
  try { current = normalizeAppearance(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) } catch { current = defaultAppearance }
  apply()
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', apply)
}
export function saveAppearance(value: Appearance): boolean {
  current = normalizeAppearance(value)
  let saved = true
  try { localStorage.setItem(storageKey, JSON.stringify(current)) } catch { saved = false }
  apply()
  return saved
}
export function terminalAppearance() {
  const { tokens, mode } = themeTokens(current, matchMedia('(prefers-color-scheme: light)').matches)
  const color = (name: string) => tokens['--' + name]
  const darkMode = mode === 'dark'
  return {
    fontFamily: color('terminal-font'), fontSize: current.fontSize, lineHeight: current.lineHeight,
    theme: {
      background: color('terminal-bg'), foreground: color('text'), cursor: color('text-secondary'), cursorAccent: color('terminal-bg'), selectionBackground: color('selection'),
      black: darkMode ? '#3e3e46' : '#202632', red: darkMode ? '#df858d' : '#a42e42', green: darkMode ? '#80b89c' : '#287249', yellow: darkMode ? '#d4b57b' : '#805e14',
      blue: darkMode ? '#8aacf2' : '#315fc3', magenta: darkMode ? '#b6a0cf' : '#7745a5', cyan: darkMode ? '#88b8c5' : '#176877', white: darkMode ? '#d4d4dc' : '#61708a',
      brightBlack: darkMode ? '#80808b' : '#58657a', brightRed: darkMode ? '#efadb3' : '#b32d3d', brightGreen: darkMode ? '#a6d2b9' : '#247042', brightYellow: darkMode ? '#e6cf9f' : '#805000',
      brightBlue: darkMode ? '#adc6f7' : '#244fac', brightMagenta: darkMode ? '#cfbce5' : '#803e9c', brightCyan: darkMode ? '#aed3dd' : '#086e7c', brightWhite: darkMode ? '#f5f5f7' : '#384452',
    },
  }
}
export function observeTerminalAppearance(terminal: import('@xterm/xterm').Terminal, resize: () => void) {
  const update = () => { Object.assign(terminal.options, terminalAppearance()); resize() }
  update()
  return subscribe(update)
}
