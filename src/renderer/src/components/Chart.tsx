import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface Point {
  t: number
  v: number
}

const time = (sec: number): string => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const niceMax = (v: number): number => {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function LineChart({ points, unit, color, height = 170, extra }: { points: Point[]; unit: string; color: string; height?: number; extra?: (i: number) => string | null }): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const pad = { l: 44, r: 12, t: 12, b: 24 }
  const w = Math.max(120, width)
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const tMax = Math.max(1, ...points.map((p) => p.t))
  const vMax = niceMax(Math.max(...points.map((p) => p.v), 0) * 1.08)
  const x = (t: number): number => pad.l + (t / tMax) * iw
  const y = (v: number): number => pad.t + ih - (v / vMax) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area = points.length ? `${line} L${x(points[points.length - 1].t).toFixed(1)} ${pad.t + ih} L${x(points[0].t).toFixed(1)} ${pad.t + ih} Z` : ''
  const ticks = [0, vMax / 2, vMax]
  const xticks = [0, tMax / 2, tMax]

  const onMove = (e: React.PointerEvent): void => {
    if (!points.length) return
    const r = (e.currentTarget as SVGElement).getBoundingClientRect()
    const t = ((e.clientX - r.left - pad.l) / iw) * tMax
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i
    setHover(best)
  }
  const hp = hover !== null ? points[hover] : null
  const gid = `g${color.replace(/[^a-z0-9]/gi, '')}`

  return (
    <div className="chart" ref={box}>
      <svg width={w} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`График, ${unit}`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={pad.l - 8} y={y(v) + 4} className="chart-axis" textAnchor="end">{Math.round(v)}</text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 6} className="chart-axis" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{time(Math.round(t))}</text>
        ))}
        {points.length > 1 && <path d={area} fill={`url(#${gid})`} />}
        {points.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={pad.t + ih} className="chart-cross" />
            <circle cx={x(hp.t)} cy={y(hp.v)} r="5" fill={color} stroke="var(--panel)" strokeWidth="2" />
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" />
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hp.t), 70), w - 70), top: Math.max(y(hp.v) - 12, 0) }}>
          <b>{Math.round(hp.v)} {unit}</b>
          <small>{time(hp.t)}{extra && hover !== null && extra(hover) ? ` · ${extra(hover)}` : ''}</small>
        </div>
      )}
    </div>
  )
}

export function BarChart({ bars, unit, color, height = 150 }: { bars: { label: string; value: number; hint: string }[]; unit: string; color: string; height?: number }): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const pad = { l: 36, r: 8, t: 10, b: 22 }
  const w = Math.max(120, width)
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const max = niceMax(Math.max(...bars.map((b) => b.value), 0))
  const slot = iw / Math.max(1, bars.length)
  const bw = Math.max(4, Math.min(28, slot - 6))
  const y = (v: number): number => pad.t + ih - (v / max) * ih
  return (
    <div className="chart" ref={box}>
      <svg width={w} height={height} role="img" aria-label={`Столбчатый график, ${unit}`} onPointerLeave={() => setHover(null)}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={pad.l - 8} y={y(v) + 4} className="chart-axis" textAnchor="end">{Math.round(v)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2
          const top = y(b.value)
          const h = pad.t + ih - top
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
              {b.value > 0 && <path d={`M${x} ${pad.t + ih} V${top + Math.min(4, h)} Q${x} ${top} ${x + Math.min(4, bw / 2)} ${top} H${x + bw - Math.min(4, bw / 2)} Q${x + bw} ${top} ${x + bw} ${top + Math.min(4, h)} V${pad.t + ih} Z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {(i === 0 || i === bars.length - 1 || i === Math.floor(bars.length / 2)) && (
                <text x={pad.l + slot * i + slot / 2} y={height - 6} className="chart-axis" textAnchor="middle">{b.label}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(pad.l + slot * hover + slot / 2, 70), w - 70), top: Math.max(y(bars[hover].value) - 10, 0) }}>
          <b>{bars[hover].hint}</b>
          <small>{bars[hover].label}</small>
        </div>
      )}
    </div>
  )
}
