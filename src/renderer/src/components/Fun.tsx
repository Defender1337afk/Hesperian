import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Instance } from '../../../shared/types'
import { onEvent } from '../bridge'
import { useStore } from '../store'

export function Snow(): ReactNode {
  const animations = useStore((s) => s.settings?.animations ?? true)
  const month = new Date().getMonth()
  const flakes = useMemo(
    () => Array.from({ length: 36 }, (_, i) => ({ left: Math.random() * 100, delay: -Math.random() * 12, dur: 8 + Math.random() * 8, size: 2 + Math.random() * 3, key: i })),
    []
  )
  if (!animations || (month > 1 && month < 11)) return null
  return (
    <div className="snow" aria-hidden>
      {flakes.map((f) => (
        <i key={f.key} style={{ left: `${f.left}%`, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s`, width: f.size, height: f.size }} />
      ))}
    </div>
  )
}

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a']
const MILESTONES = [3600, 10 * 3600, 50 * 3600, 100 * 3600]
const MILESTONE_NAMES = ['Первый час', 'Десять часов', 'Полсотни часов', 'Сто часов']

export function FunHooks(): ReactNode {
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    let keys: string[] = []
    let typed = ''
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const k = e.key.toLowerCase()
      keys = [...keys, k].slice(-KONAMI.length)
      if (keys.join() === KONAMI.join()) {
        keys = []
        const root = document.querySelector('.app, .crystal') ?? document.body
        root.classList.add('party')
        useStore.getState().toast('info', 'Режим вечеринки!')
        setTimeout(() => root.classList.remove('party'), 10000)
      }
      if (k.length === 1) {
        typed = (typed + k).slice(-7)
        if (typed === 'creeper') {
          typed = ''
          setFlash(Date.now())
          useStore.getState().toast('warn', 'Ссссссс…')
        }
      }
    }
    window.addEventListener('keydown', onKey)

    const before = new Map<string, number>()
    const off = onEvent<{ instanceId: string; state: string }>('game:state', (e) => {
      const instance = useStore.getState().instances.find((i: Instance) => i.id === e.instanceId)
      if (!instance) return
      if (e.state === 'launching' || e.state === 'running') {
        if (!before.has(e.instanceId)) before.set(e.instanceId, instance.playTimeSec)
        return
      }
      const was = before.get(e.instanceId)
      before.delete(e.instanceId)
      if (was === undefined) return
      setTimeout(() => {
        const now = useStore.getState().instances.find((i: Instance) => i.id === e.instanceId)?.playTimeSec ?? was
        MILESTONES.forEach((m, i) => {
          if (was < m && now >= m) useStore.getState().toast('info', `Достижение получено: «${MILESTONE_NAMES[i]}» в «${instance.name}»`)
        })
      }, 1500)
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [])
  return flash ? <div key={flash} className="creeper-flash" onAnimationEnd={() => setFlash(0)} /> : null
}
