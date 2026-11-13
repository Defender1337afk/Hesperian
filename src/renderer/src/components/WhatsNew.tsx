import type { ReactNode } from 'react'
import { CURRENT, ROADMAP, WHATS_NEW } from '../../../shared/release'
import { useStore } from '../store'

export function WhatsNew(): ReactNode {
  const open = useStore((s) => s.whatsNewOpen)
  const close = useStore((s) => s.closeWhatsNew)
  const openPlugins = useStore((s) => s.openPlugins)
  if (!open) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog wide whats-new">
        <div className="wn-hero">
          <span className="wn-version">Hesperian {CURRENT.version}</span>
          <h2 className="wn-codename">{CURRENT.codename}</h2>
          <p className="muted">Большое обновление лаунчера</p>
        </div>
        <div className="wn-list">
          {WHATS_NEW.map((item, i) => (
            <div className="wn-item rise" style={{ '--i': i } as React.CSSProperties} key={item.title}>
              <b>{item.title}</b>
              <small>{item.text}</small>
            </div>
          ))}
        </div>
        <div className="wn-road">
          {ROADMAP.map((r) => (
            <span key={r.version} className={`wn-step ${r.status}`} title={r.summary}>
              <i />
              {r.version === 'Wave' ? r.codename : `${r.version} ${r.codename}`}
            </span>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={() => { close(); openPlugins() }}>К плагинам</button>
          <button className="btn primary" autoFocus onClick={close}>Отлично</button>
        </div>
      </div>
    </div>
  )
}
