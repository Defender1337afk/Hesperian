import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentItem, Instance } from '../../../shared/types'
import { api } from '../bridge'
import { Snow } from '../components/Fun'
import { LOADER_NAMES, RunButton } from '../components/common'
import { I } from '../components/icons'
import { useStore } from '../store'
import { secret } from './Welcome'

const rise = (i: number): React.CSSProperties => ({ '--i': i }) as React.CSSProperties

const hours = (sec: number): string => {
  if (sec < 60) return 'ещё не играли'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

const when = (t?: number): string => {
  if (!t) return 'ещё не запускалась'
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function Mods({ instance }: { instance: Instance }): ReactNode {
  const [mods, setMods] = useState<ContentItem[] | null>(null)
  useEffect(() => {
    let alive = true
    setMods(null)
    if (instance.loader === 'vanilla') return
    void api.listContent(instance.id, 'mod').then((list: ContentItem[]) => alive && setMods(list.filter((m) => m.enabled)))
    return () => {
      alive = false
    }
  }, [instance.id, instance.loader])
  if (instance.loader === 'vanilla') {
    return (
      <div className="nh-mods empty">
        <span className="nh-label">Моды</span>
        <small>Ванильная сборка без модов</small>
      </div>
    )
  }
  return (
    <div className="nh-mods">
      <span className="nh-label">Моды{mods ? <em>{mods.length}</em> : null}</span>
      {mods && mods.length === 0 && <small>Модов пока нет</small>}
      <div className="nh-mod-list">
        {(mods ?? []).slice(0, 40).map((m) => (
          <div key={m.file} className="nh-mod" title={m.title}>
            {m.iconUrl ? <img src={m.iconUrl} alt="" loading="lazy" /> : <span className="nh-mod-ph"><I.cube size={11} /></span>}
            <span>{m.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const MAX_TILT = 7

function useLookAt(card: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = card.current
    if (!el || !enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let tx = 0
    let ty = 0
    let x = 0
    let y = 0
    let frame = 0
    const tick = (): void => {
      x += (tx - x) * 0.09
      y += (ty - y) * 0.09
      el.style.transform = `rotateX(${y.toFixed(3)}deg) rotateY(${x.toFixed(3)}deg)`
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.01 ? requestAnimationFrame(tick) : 0
    }
    const kick = (): void => {
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const move = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect()
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (inside) {
        tx = 0
        ty = 0
      } else {
        const dx = (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)
        const dy = (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2)
        const ease = (v: number): number => Math.sign(v) * Math.min(1, Math.abs(v)) ** 0.8
        tx = ease(dx) * MAX_TILT
        ty = -ease(dy) * MAX_TILT
      }
      kick()
    }
    const leave = (): void => {
      tx = 0
      ty = 0
      kick()
    }
    window.addEventListener('pointermove', move)
    document.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
      el.style.transform = ''
    }
  }, [card, enabled])
}

function useFit(root: React.RefObject<HTMLElement | null>, inner: React.RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const box = root.current
    const el = inner.current
    if (!box || !el) return
    let last = ''
    const fit = (): void => {
      el.style.zoom = '1'
      const style = getComputedStyle(box)
      const availH = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const availW = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const z = Math.max(0.6, Math.min(1, (availH - 4) / el.scrollHeight, (availW - 4) / el.scrollWidth))
      const value = z.toFixed(3)
      el.style.zoom = value
      if (value !== last) {
        last = value
        box.classList.toggle('nh-zoomed', z < 1)
      }
    }
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    fit()
    return () => ro.disconnect()
  }, [root, inner, key])
}

export function NewHome(): ReactNode {
  const instances = useStore((s) => s.instances)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const openInstance = useStore((s) => s.openInstance)
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))
  const byRecent = useMemo(() => [...instances].sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt)), [instances])
  const ordered = useMemo(() => [...byRecent].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [byRecent])
  const current = instances.find((i) => i.id === selectedId) ?? byRecent[0]
  const isLast = current && current.id === byRecent[0]?.id && Boolean(current.lastPlayedAt)
  const motion = useStore((s) => s.settings?.animations !== false)
  const card = useRef<HTMLElement>(null)
  useLookAt(card, motion && Boolean(current))
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (s.promptRequest || s.confirmRequest || s.newInstanceOpen || s.loginOpen || s.palette || s.menu || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)) return
      if (!current) return
      if (e.key === 'Enter') {
        const state = s.games[current.id]
        if (!state || state === 'stopped') {
          e.preventDefault()
          void s.play(current.id)
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = ordered.findIndex((x) => x.id === current.id)
        const next = ordered[(i + (e.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length]
        if (next) {
          e.preventDefault()
          select(next.id)
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [current, ordered, select])
  const root = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useFit(root, inner, `${current?.id}:${instances.length}`)

  return (
    <div className="nh" ref={root}>
      {current && <div className="nh-aura" style={{ background: current.color }} />}
      <Snow />
      <div className="nh-fit" ref={inner}>
      <h1 className="nh-wm rise">Hesperian<span onClick={secret}>.</span></h1>
      {current ? (
        <>
          <div className="nh-pill rise" style={rise(1)}>{isLast ? 'Последний заход' : 'Выбранная сборка'}</div>
          <div className="nh-stage rise" style={rise(2)}>
            <section ref={card} className="nh-card">
              <div className="nh-glow" style={{ background: current.color }} />
              <header className="nh-head">
                <div className="nh-title">
                  <b className="nh-ver">{current.mcVersion}</b>
                  <span className="nh-loader" style={{ '--c': current.color } as React.CSSProperties}>{LOADER_NAMES[current.loader]}{current.loaderVersion ? ` ${current.loaderVersion}` : ''}</span>
                </div>
                <div className="nh-name">
                  <span>{current.name}</span>
                  <small>{current.lastPlayedAt ? `запускали ${when(current.lastPlayedAt)}` : 'ещё не запускалась'}</small>
                </div>
              </header>
              <div className="nh-body">
                <Mods instance={current} />
                <div className="nh-side">
                  <div className="nh-stats">
                    <div><I.clock size={15} /><small>Наиграно</small><b>{hours(current.playTimeSec)}</b></div>
                    <div><I.user size={15} /><small>Игрок</small><b className="sensitive">{account?.name ?? 'нет аккаунта'}</b></div>
                  </div>
                  <div className="nh-quick">
                    {current.loader !== 'vanilla' && (
                      <button onClick={() => { useStore.setState({ storeTarget: current.id, storeKind: 'mod' }); useStore.getState().openSidebar('store') }}><I.store size={14} /> Моды из магазина</button>
                    )}
                    <button onClick={() => void api.openInstanceFolder(current.id, 'game')}><I.folder size={14} /> Папка</button>
                    <button onClick={() => void api.openInstanceFolder(current.id, 'saves')}><I.globe size={14} /> Миры</button>
                  </div>
                  <div className="nh-actions">
                    <RunButton instanceId={current.id} />
                    <button className="nh-settings" onClick={() => openInstance(current.id)}><I.settings size={15} /> Настройки сборки</button>
                  </div>
                </div>
              </div>
            </section>
          </div>
          {instances.length > 1 && (
            <div className="nh-others rise" style={rise(3)}>
              {ordered.map((i) => (
                <button key={i.id} className={`nh-chip ${i.id === current.id ? 'on' : ''}`} onClick={() => select(i.id)} onDoubleClick={() => openInstance(i.id)}>
                  {i.pinned ? <I.star size={12} /> : <span className="fdot" style={{ background: i.color }} />}
                  {i.name}
                  <small>{i.mcVersion}</small>
                </button>
              ))}
              <button className="nh-chip add" onClick={() => useStore.setState({ newInstanceOpen: true })}><I.plus size={13} /></button>
            </div>
          )}
          {instances.length === 1 && (
            <button className="nh-chip add solo rise" style={rise(3)} onClick={() => useStore.setState({ newInstanceOpen: true })}><I.plus size={13} /> Ещё сборка</button>
          )}
        </>
      ) : (
        <section className="nh-card nh-empty rise" style={rise(1)}>
          <b>Сборок пока нет</b>
          <small>Выберите версию Minecraft и загрузчик, остальное лаунчер скачает сам</small>
          <button className="run-btn" onClick={() => useStore.setState({ newInstanceOpen: true })}><I.plus size={13} /> Новая сборка</button>
        </section>
      )}
      </div>
    </div>
  )
}
