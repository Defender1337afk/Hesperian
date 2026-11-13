import type { ReactNode } from 'react'
import type { Account, Instance, LoaderType } from '../../../shared/types'
import { useStore } from '../store'
import { I } from './icons'

export const LOADER_NAMES: Record<LoaderType, string> = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' }

export const describeInstance = (i: Instance): string =>
  i.loader === 'vanilla' ? i.mcVersion : `${i.mcVersion} · ${LOADER_NAMES[i.loader]}`

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

export const formatDownloads = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} млн`
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс`
  return String(n)
}

export const formatBytes = (n: number): string => {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  return `${Math.max(1, Math.round(n / 1024))} КБ`
}

export const formatPlayTime = (sec: number): string => {
  if (sec < 60) return 'меньше минуты'
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`
}

export const formatDate = (value?: number | string): string => {
  if (!value) return 'никогда'
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export const INSTANCE_COLORS = ['#5fbf7f', '#3fb6a8', '#4f9fe0', '#8d7be6', '#d66a9f', '#e0705a', '#d9a441', '#8a978e']

export function IconBtn({ icon, title, onClick, active, disabled, cls = '' }: {
  icon: (p: { size?: number }) => ReactNode
  title: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  cls?: string
}): ReactNode {
  return (
    <button className={`icon-btn ${active ? 'on' : ''} ${cls}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {icon({ size: 17 })}
    </button>
  )
}

export function Avatar({ account, size = 26 }: { account?: Account | null; size?: number }): ReactNode {
  const skin = account?.skinUrl?.replace(/^http:\/\//, 'https://')
  if (skin) {
    const layer = (x: number): React.CSSProperties => ({ backgroundImage: `url(${skin})`, backgroundSize: `${size * 8}px auto`, backgroundPosition: `${-size * x}px ${-size}px` })
    return (
      <span className="avatar avatar-skin" style={{ width: size, height: size }}>
        <i style={layer(1)} />
        <i className="avatar-hat" style={layer(5)} />
      </span>
    )
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {account ? account.name.slice(0, 1).toUpperCase() : '?'}
    </span>
  )
}

export function RunButton({ instanceId }: { instanceId: string }): ReactNode {
  const state = useStore((s) => s.games[instanceId])
  const play = useStore((s) => s.play)
  const stop = useStore((s) => s.stop)
  if (state === 'launching') {
    return (
      <button className="run-btn" disabled>
        <span className="spinner" /> Запуск
      </button>
    )
  }
  if (state === 'running') {
    return (
      <button className="run-btn stop" onClick={() => void stop(instanceId)} title="Закрыть игру (Shift+F5)">
        <I.stop size={13} /> Стоп
      </button>
    )
  }
  return (
    <button className="run-btn" onClick={() => void play(instanceId)} title="Играть (F5)">
      <I.play size={13} /> Играть
    </button>
  )
}

export function Seg<T extends string | number>({ value, options, onChange, full }: {
  value: T
  options: [T, string][]
  onChange: (value: T) => void
  full?: boolean
}): ReactNode {
  return (
    <div className={`seg ${full ? 'full' : ''}`}>
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }): ReactNode {
  return (
    <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label}>
      <span />
    </button>
  )
}

export function Row({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }): ReactNode {
  return (
    <div className="set-row">
      <div className="set-text">
        <b>{title}</b>
        {desc && <small>{desc}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

export function Range({ value, min, max, step = 1, onChange, onCommit, fmt = String }: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  fmt?: (value: number) => string
}): ReactNode {
  return (
    <div className="range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
      <span className="range-val">{fmt(value)}</span>
    </div>
  )
}

export function Swatches({ value, colors, onChange }: { value: string; colors: string[]; onChange: (color: string) => void }): ReactNode {
  return (
    <div className="accents">
      {colors.map((color) => (
        <button
          key={color}
          className={`accent-sw ${value.toLowerCase() === color.toLowerCase() ? 'on' : ''}`}
          style={{ background: color }}
          aria-label={color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}
