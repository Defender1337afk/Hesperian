import { useEffect, useRef, useState, type ReactNode } from 'react'
import { onEvent } from '../bridge'
import { useStore } from '../store'

const BODY = '#d97757'
const EYE = '#161311'
const PX = 5

const SPRITE = ['..XXXXXXXXX..', '..XEXXXXXEX..', 'XXXEXXXXXEXXX', 'XXXXXXXXXXXXX', '..XXXXXXXXX..']
const LEGS_A = [2, 4, 8, 10]
const LEGS_B = [3, 5, 7, 9]

const PHRASES = [
  'Привет! Я Clawd.',
  'Я тут поживу, ладно?',
  'Не забудь бэкап мира. Я серьёзно.',
  'Ctrl+Shift+P, там всё.',
  'Пиксели это моё всё.',
  'Собрал тебе сборку… шучу, сам собирай.',
  'А ты пробовал Fabric с Sodium?',
  'Тут тепло и много вкладок.',
  'Хочешь секрет? …Нет, не скажу.',
  'Крипер за спиной! Ладно, это шутка.',
  'Я бы поиграл, но у меня лапки.',
  'Сервер с друзьями в один клик, кстати.',
  'Мне нравится, как ты всё настроил.',
  'Пойду поброжу.'
]

const GAME_PHRASES = ['Удачной игры!', 'Возвращайся с алмазами.', 'Я посторожу лаунчер.']

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

function Sprite({ step, blink, look, flip }: { step: boolean; blink: boolean; look: number; flip: boolean }): ReactNode {
  const body: ReactNode[] = []
  const eyes: ReactNode[] = []
  SPRITE.forEach((row, y) => {
    ;[...row].forEach((c, x) => {
      if (c === '.') return
      body.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={BODY} />)
      if (c === 'E' && !(blink && y === 1)) eyes.push(<rect key={`e${x}-${y}`} x={x + look} y={y} width={1} height={1} fill={EYE} />)
    })
  })
  for (const x of step ? LEGS_A : LEGS_B) body.push(<rect key={`l${x}`} x={x} y={5} width={1} height={1} fill={BODY} />)
  return (
    <svg width={13 * PX} height={6 * PX} viewBox="0 0 13 6" shapeRendering="crispEdges" style={{ transform: flip ? 'scaleX(-1)' : undefined }}>
      {body}
      {eyes}
    </svg>
  )
}

export function Clawd(): ReactNode {
  const on = useStore((s) => s.clawd)
  const [x, setX] = useState(() => window.innerWidth * 0.7)
  const [dir, setDir] = useState(-1)
  const [step, setStep] = useState(false)
  const [blink, setBlink] = useState(false)
  const [look, setLook] = useState(0)
  const [hop, setHop] = useState(false)
  const [say, setSay] = useState<string | null>(null)
  const state = useRef({ x: window.innerWidth * 0.7, dir: -1, pauseUntil: 0, last: 0 })
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const speak = (text: string, ms = 3200): void => {
    setSay(text)
    if (sayTimer.current) clearTimeout(sayTimer.current)
    sayTimer.current = setTimeout(() => setSay(null), ms)
  }

  useEffect(() => {
    if (!on) return
    speak('Привет! Я Clawd.')
    let frame = 0
    let tick = 0
    const loop = (t: number): void => {
      const s = state.current
      const dt = Math.min(64, t - (s.last || t))
      s.last = t
      if (t > s.pauseUntil) {
        s.x += s.dir * dt * 0.035
        const max = window.innerWidth - 13 * PX - 24
        if (s.x < 60 || s.x > max) {
          s.dir *= -1
          s.x = Math.max(60, Math.min(max, s.x))
          setDir(s.dir)
        }
        if (Math.random() < 0.002) {
          s.pauseUntil = t + 1500 + Math.random() * 3500
        }
        if (++tick % 9 === 0) setStep((v) => !v)
        setX(s.x)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    const blinker = setInterval(() => {
      setBlink(true)
      setTimeout(() => setBlink(false), 140)
    }, 3800)
    const chatter = setInterval(() => {
      if (Math.random() < 0.35) speak(pick(PHRASES))
    }, 26000)
    const onMove = (e: MouseEvent): void => {
      const center = state.current.x + (13 * PX) / 2
      const facing = state.current.dir < 0 ? -1 : 1
      const side = e.clientX < center - 20 ? -1 : e.clientX > center + 20 ? 1 : 0
      setLook(side === 0 ? 0 : side * facing > 0 ? 1 : -1)
    }
    window.addEventListener('mousemove', onMove)
    const offGame = onEvent<{ state: string }>('game:state', (e) => {
      if (e.state === 'running') speak(pick(GAME_PHRASES))
    })
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(blinker)
      clearInterval(chatter)
      window.removeEventListener('mousemove', onMove)
      offGame()
    }
  }, [on])

  if (!on) return null
  return (
    <div className={`clawd ${hop ? 'hop' : ''}`} style={{ transform: `translateX(${x}px)` }}>
      {say && <div className={`clawd-say ${dir > 0 ? 'right' : ''}`}>{say}</div>}
      <button
        className="clawd-body"
        aria-label="Clawd"
        onClick={() => {
          setHop(true)
          setTimeout(() => setHop(false), 420)
          state.current.pauseUntil = performance.now() + 2500
          speak(pick(PHRASES))
        }}
      >
        <Sprite step={step} blink={blink} look={look} flip={dir > 0} />
      </button>
    </div>
  )
}
