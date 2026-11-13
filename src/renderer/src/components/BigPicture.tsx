import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../bridge'
import { formatPlayTime } from './common'
import { useStore } from '../store'
import { openPacks } from './menus'

interface Action {
  id: string
  label: string
  hint?: string
  run: () => void
  disabled?: boolean
}

function LinesBackground({ animated }: { animated: boolean }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9fd8ae'
    let frame = 0
    const lines = Array.from({ length: 58 }, (_, i) => ({
      x: i / 58 + (Math.random() - 0.5) * 0.02,
      speed: 0.004 + Math.random() * 0.012,
      phase: Math.random() * Math.PI * 2,
      bend: 0.012 + Math.random() * 0.05,
      alpha: 0.1 + Math.random() * 0.26,
      width: 0.6 + Math.random() * 1.1,
      bright: Math.random() < 0.11
    }))
    const draw = (time: number): void => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const t = time / 1000
      const slant = h * 0.42
      ctx.lineCap = 'round'
      for (const line of lines) {
        const base = ((line.x + t * line.speed) % 1.25) - 0.12
        ctx.beginPath()
        for (let i = 0; i <= 26; i++) {
          const v = i / 26
          const wave = Math.sin(v * 4.2 + line.phase + t * 0.32) * line.bend * w
          const px = base * (w + slant) + (1 - v) * slant - slant + wave
          const py = v * h
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.strokeStyle = line.bright ? accent : `rgba(255,255,255,${line.alpha})`
        ctx.globalAlpha = line.bright ? 0.5 : 1
        ctx.lineWidth = line.width
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      if (animated) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [animated])
  return <canvas ref={ref} className="bp-lines" />
}

function PanoramaBackground({ faces }: { faces: string[] }): ReactNode {
  return (
    <div className="bp-pano">
      <div className="bp-cube">
        {faces.map((src, i) => <img key={i} className={`bp-face f${i}`} src={src} alt="" draggable={false} />)}
      </div>
    </div>
  )
}

function Clock(): ReactNode {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const date = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <>
      <div className="bp-time">{now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="bp-date">{date.charAt(0).toUpperCase() + date.slice(1)}</div>
    </>
  )
}

export function BigPicture(): ReactNode {
  const active = useStore((s) => s.bigPicture)
  const hidden = useStore((s) => s.bigPictureHidden)
  const instances = useStore((s) => s.instances)
  const games = useStore((s) => s.games)
  const settings = useStore((s) => s.settings)
  const dialogOpen = useStore((s) => Boolean(s.newInstanceOpen || s.promptRequest || s.confirmRequest || s.loginOpen || s.palette))
  const [view, setView] = useState<'main' | 'instances'>('main')
  const [focus, setFocus] = useState(0)
  const [faces, setFaces] = useState<string[] | null>(null)

  useEffect(() => {
    if (active) void api.panoramaFaces().then(setFaces).catch(() => setFaces(null))
    else setView('main')
  }, [active])

  const last = useMemo(() => [...instances].sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt))[0], [instances])
  const state = last ? games[last.id] : undefined
  const busy = state === 'launching' || state === 'running'
  const background = faces && settings?.bigPictureBackground !== 'lines' ? 'panorama' : 'lines'

  const s = useStore.getState()
  const leaveTo = (open: () => void): void => {
    useStore.setState({ bigPictureHidden: true })
    open()
  }
  const main: Action[] = [
    {
      id: 'play',
      label: last ? (state === 'launching' ? 'Запускается...' : state === 'running' ? 'Игра запущена' : 'Играть') : 'Играть',
      hint: last ? last.name : 'Сначала создайте сборку',
      disabled: !last || busy,
      run: () => last && void s.play(last.id)
    },
    { id: 'instances', label: 'Сборки', hint: instances.length ? `Всего: ${instances.length}` : undefined, run: () => { setView('instances'); setFocus(0) } },
    { id: 'new', label: 'Новая сборка', run: () => useStore.setState({ newInstanceOpen: true }) },
    { id: 'packs', label: 'Модпаки', hint: 'Готовые сборки в один клик', run: () => leaveTo(openPacks) },
    { id: 'mods', label: 'Моды', hint: 'Магазин модов и текстур', run: () => leaveTo(() => s.openSidebar('store')) },
    { id: 'settings', label: 'Настройки', run: () => leaveTo(() => s.openSettings()) },
    {
      id: 'background',
      label: `Фон: ${background === 'panorama' ? 'панорама' : 'линии'}`,
      hint: faces ? undefined : 'Панорама появится, когда скачается любая версия игры',
      disabled: !faces,
      run: () => void s.patchSettings({ bigPictureBackground: background === 'panorama' ? 'lines' : 'panorama' })
    },
    { id: 'exit', label: 'Выйти из Big Picture', run: () => void s.exitBigPicture() },
    { id: 'quit', label: 'Закрыть лаунчер', run: () => void api.winClose() }
  ]
  const list: Action[] = [
    ...instances.map((i) => ({
      id: i.id,
      label: i.name,
      hint: `${i.engine === 'horizon' ? 'Horizon' : i.mcVersion}${i.playTimeSec > 0 ? ` · ${formatPlayTime(i.playTimeSec)}` : ''}${games[i.id] === 'running' ? ' · запущена' : ''}`,
      disabled: games[i.id] === 'running' || games[i.id] === 'launching',
      run: () => void s.play(i.id)
    })),
    { id: 'back', label: 'Назад', run: () => { setView('main'); setFocus(1) } }
  ]
  const actions = view === 'main' ? main : list
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const focusRef = useRef(focus)
  focusRef.current = Math.min(focus, actions.length - 1)

  const move = (delta: number): void => {
    const count = actionsRef.current.length
    let next = focusRef.current
    for (let i = 0; i < count; i++) {
      next = (next + delta + count) % count
      if (!actionsRef.current[next].disabled) break
    }
    setFocus(next)
  }
  const activate = (): void => {
    const action = actionsRef.current[focusRef.current]
    if (action && !action.disabled) action.run()
  }
  const back = (): void => {
    if (useStore.getState().bigPictureHidden) useStore.setState({ bigPictureHidden: false })
    else if (view === 'instances') {
      setView('main')
      setFocus(1)
    } else void useStore.getState().exitBigPicture()
  }
  const backRef = useRef(back)
  backRef.current = back

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      if (st.newInstanceOpen || st.promptRequest || st.confirmRequest || st.loginOpen || st.palette) return
      if (st.bigPictureHidden) {
        if (e.key === 'Escape') {
          e.preventDefault()
          backRef.current()
        }
        return
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'ы') move(1)
      else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'ц') move(-1)
      else if (e.key === 'Enter' || e.key === ' ') activate()
      else if (e.key === 'Escape') backRef.current()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  useEffect(() => {
    if (!active) return
    let frame = 0
    let held = ''
    let repeatAt = 0
    const poll = (time: number): void => {
      frame = requestAnimationFrame(poll)
      const st = useStore.getState()
      if (st.newInstanceOpen || st.promptRequest || st.confirmRequest || st.loginOpen || st.palette) {
        held = ''
        return
      }
      const pad = [...navigator.getGamepads()].find(Boolean)
      if (!pad) return
      const axis = pad.axes[1] ?? 0
      let now = ''
      if (pad.buttons[12]?.pressed || axis < -0.55) now = 'up'
      else if (pad.buttons[13]?.pressed || axis > 0.55) now = 'down'
      else if (pad.buttons[0]?.pressed) now = 'a'
      else if (pad.buttons[1]?.pressed) now = 'b'
      const repeat = (now === 'up' || now === 'down') && now === held && time > repeatAt
      if (now && (now !== held || repeat)) {
        repeatAt = time + (now === held ? 130 : 380)
        if (st.bigPictureHidden) {
          if (now === 'b') backRef.current()
        } else if (now === 'up') move(-1)
        else if (now === 'down') move(1)
        else if (now === 'a') activate()
        else if (now === 'b') backRef.current()
      }
      held = now
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [active])

  if (!active) return null
  if (hidden) {
    return (
      <button className="bp-return" onClick={() => useStore.setState({ bigPictureHidden: false })}>
        Вернуться в Big Picture <kbd>Esc</kbd>
      </button>
    )
  }
  const shown = Math.min(focus, actions.length - 1)
  return (
    <div className={`bp ${dialogOpen ? 'bp-dim' : ''}`}>
      {background === 'panorama' && faces ? <PanoramaBackground faces={faces} /> : <LinesBackground animated={settings?.animations !== false} />}
      <div className="bp-shade" />
      <div className="bp-left">
        <Clock />
        {last && <div className="bp-last">{busy ? `Сейчас: ${last.name}` : `Последняя сборка: ${last.name}`}</div>}
      </div>
      <nav className="bp-right">
        {view === 'instances' && <div className="bp-title">Сборки</div>}
        {actions.map((action, i) => (
          <button
            key={action.id}
            className={`bp-btn ${i === shown ? 'on' : ''}`}
            disabled={action.disabled}
            onMouseMove={(e) => (e.movementX || e.movementY) && !action.disabled && i !== shown && setFocus(i)}
            onClick={() => action.run()}
          >
            <b>{action.label}</b>
            {action.hint && <small>{action.hint}</small>}
          </button>
        ))}
      </nav>
      <div className="bp-help">
        <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span>
        <span><kbd>Enter</kbd> или <kbd>A</kbd> открыть</span>
        <span><kbd>Esc</kbd> или <kbd>B</kbd> назад</span>
      </div>
    </div>
  )
}
