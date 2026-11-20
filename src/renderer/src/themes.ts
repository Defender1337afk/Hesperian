import { flushSync } from 'react-dom'
import type { Settings } from '../../shared/types'
import { useStore } from './store'

export const THEMES = [
  { id: 'grove', name: 'Legacy', bg: '#0b100d', panel: '#111814', fg: '#e3ece5' },
  { id: 'bloom', name: 'New', bg: '#121411', panel: '#1d211b', fg: '#eef0ea' }
]

export const ACCENTS = [145, 165, 190, 215, 250, 280, 320, 350, 25, 45]

export const GRADIENTS: { id: string; name: string; stops: string[]; ink: string }[] = [
  { id: 'aurora', name: 'Аврора', stops: ['#8fd8ff', '#c3a6ff', '#ffb0d8'], ink: '#c3a6ff' },
  { id: 'sunset', name: 'Закат', stops: ['#ffc46b', '#ff8a7a', '#ff6fa8'], ink: '#ff9a7e' },
  { id: 'ocean', name: 'Океан', stops: ['#62f0dc', '#5aa8ff', '#6f7cff'], ink: '#62c6f5' },
  { id: 'lime', name: 'Лайм', stops: ['#e2fb7a', '#8ee79c', '#4fd1c5'], ink: '#9ae6a0' },
  { id: 'neon', name: 'Неон', stops: ['#ff5fd2', '#a46bff', '#5f8bff'], ink: '#b07aff' },
  { id: 'gold', name: 'Золото', stops: ['#fff1a8', '#f3c45c', '#e0913b'], ink: '#f0c060' },
  { id: 'cherry', name: 'Вишня', stops: ['#ff9a9e', '#f45c8a', '#c1407c'], ink: '#f2708f' },
  { id: 'mint', name: 'Мята', stops: ['#d6fff1', '#7fe0c2', '#3fb8a8'], ink: '#7fe0c2' }
]

export function hexHue(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}

function saveBootPalette(s: Settings): void {
  let p: Record<string, string>
  if (s.accentMode === 'white') p = { a: '#f2f2f2', fill: '#f2f2f2', on: '#111111', s1: '#ffffff', s2: '#bdbdbd' }
  else if (s.accentMode === 'black') p = { a: '#ededed', fill: '#0d0d0d', on: '#f4f4f4', s1: '#5a5a5a', s2: '#1a1a1a' }
  else if (s.accentMode === 'gradient') {
    const g = GRADIENTS.find((x) => x.id === s.accentGradient) ?? GRADIENTS[0]
    p = { a: g.ink, fill: gradientCss(g.stops), on: '#151018', s1: g.stops[0], s2: g.stops[g.stops.length - 1] }
  } else {
    const h = s.accentHue
    p = { a: `hsl(${h} 62% 70%)`, fill: `hsl(${h} 62% 70%)`, on: `hsl(${h} 60% 9%)`, s1: `hsl(${h} 70% 80%)`, s2: `hsl(${h} 55% 50%)` }
  }
  try {
    localStorage.setItem('bootPalette', JSON.stringify(p))
  } catch {
    return
  }
}

export const gradientCss = (stops: string[]): string => `linear-gradient(120deg, ${stops.join(', ')})`

const ACCENT_VARS = ['--accent', '--accent-fill', '--on-accent', '--accent-soft']

function applyAccent(root: HTMLElement, s: Settings, mode: 'dark' | 'light' | 'black'): void {
  const light = mode === 'light'
  const set = (vars: Record<string, string>): void => {
    for (const k of ACCENT_VARS) root.style.removeProperty(k)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  }
  if (s.accentMode === 'white') {
    set({ '--accent': light ? '#2a2a2a' : '#f4f4f4', '--accent-fill': light ? '#ffffff' : '#f4f4f4', '--on-accent': '#121212', '--accent-soft': light ? 'rgba(0, 0, 0, .06)' : 'rgba(255, 255, 255, .1)' })
    root.dataset.accent = 'white'
  } else if (s.accentMode === 'black') {
    set({ '--accent': light ? '#111111' : '#e6e6e6', '--accent-fill': '#0d0d0d', '--on-accent': '#f4f4f4', '--accent-soft': light ? 'rgba(0, 0, 0, .07)' : 'rgba(255, 255, 255, .08)' })
    root.dataset.accent = 'black'
  } else if (s.accentMode === 'gradient') {
    const g = GRADIENTS.find((x) => x.id === s.accentGradient) ?? GRADIENTS[0]
    set({ '--accent': light ? `color-mix(in srgb, ${g.ink} 70%, black)` : g.ink, '--accent-fill': gradientCss(g.stops), '--on-accent': '#151018', '--accent-soft': `color-mix(in srgb, ${g.ink} 15%, transparent)` })
    root.dataset.accent = 'gradient'
  } else {
    set({})
    root.dataset.accent = 'hue'
  }
}

export const isBloom = (theme: string | undefined): boolean => theme === 'bloom'
export const themeId = (theme: string | undefined): string => (THEMES.some((t) => t.id === theme) ? theme! : 'grove')

let lastCss = ''
let lastSettings: Settings | null = null
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
darkQuery?.addEventListener('change', () => {
  if (lastSettings?.appearance === 'system') applySettings(lastSettings)
})

export const resolveMode = (appearance: Settings['appearance'] | undefined): 'dark' | 'light' | 'black' =>
  appearance === 'system' ? (darkQuery && !darkQuery.matches ? 'light' : 'dark') : (appearance ?? 'dark')

export function applySettings(s: Settings): void {
  const root = document.documentElement
  lastSettings = s
  root.dataset.theme = themeId(s.theme)
  root.dataset.mode = resolveMode(s.appearance)
  root.dataset.streamer = s.streamerMode ? 'on' : 'off'
  applyAccent(root, s, resolveMode(s.appearance))
  saveBootPalette(s)
  const tintHue =
    s.accentMode === 'gradient'
      ? hexHue((GRADIENTS.find((g) => g.id === s.accentGradient) ?? GRADIENTS[0]).ink)
      : s.accentMode === 'white' || s.accentMode === 'black'
        ? null
        : s.accentHue
  const style = s.iconStyle === 'accent' && tintHue === null ? 'mono' : (s.iconStyle ?? 'original')
  root.dataset.icons = style
  root.style.setProperty('--icon-rotate', `${((tintHue ?? 0) - 38 + 360) % 360}deg`)
  root.dataset.density = s.density
  root.dataset.motion = s.animations ? 'on' : 'off'
  root.style.setProperty('--accent-h', String(s.accentHue))
  root.style.setProperty('--radius', `${s.radius}px`)
  root.style.setProperty('--ui-size', `${s.uiSize}px`)

  if (s.customCss !== lastCss) {
    lastCss = s.customCss
    let tag = document.getElementById('user-css')
    if (!tag) {
      tag = document.createElement('style')
      tag.id = 'user-css'
      document.head.append(tag)
    }
    tag.textContent = s.customCss
  }
}

export function switchTheme(theme: string, ev?: { clientX: number; clientY: number }): void {
  const { settings, patchSettings } = useStore.getState()
  const run = (): void => flushSync(() => void patchSettings({ theme }))
  if (!document.startViewTransition || !settings?.animations) {
    run()
    return
  }
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${ev ? ev.clientX : innerWidth / 2}px`)
  root.style.setProperty('--vt-y', `${ev ? ev.clientY : innerHeight / 2}px`)
  document.startViewTransition(run)
}
