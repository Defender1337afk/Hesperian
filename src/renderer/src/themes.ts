import { flushSync } from 'react-dom'
import type { Settings } from '../../shared/types'
import { useStore } from './store'

export const THEMES = [
  { id: 'grove', name: 'Legacy', bg: '#0b100d', panel: '#111814', fg: '#e3ece5' },
  { id: 'bloom', name: 'New', bg: '#121411', panel: '#1d211b', fg: '#eef0ea' }
]

export const ACCENTS = [145, 165, 190, 215, 250, 280, 320, 350, 25, 45]

export const isBloom = (theme: string | undefined): boolean => theme === 'bloom'
export const themeId = (theme: string | undefined): string => (THEMES.some((t) => t.id === theme) ? theme! : 'grove')

let lastCss = ''

export function applySettings(s: Settings): void {
  const root = document.documentElement
  root.dataset.theme = themeId(s.theme)
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
