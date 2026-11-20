import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DropResult, SessionReport } from '../../../shared/types'
import { api, onEvent } from '../bridge'
import { errorText } from './common'
import { I } from './icons'
import { useStore } from '../store'

const minutes = (sec: number): string => {
  if (sec < 60) return `${sec} с`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

export function DropZone(): ReactNode {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const target = useStore((s) => s.instances.find((i) => i.id === s.selectedId))

  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types.includes('Files'))
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    }
    const overFn = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = [...(e.dataTransfer?.files ?? [])].map((f) => window.bridge.pathFor?.(f) ?? '').filter(Boolean)
      if (!files.length) return
      const { selectedId, toast, refreshInstances, bumpContent } = useStore.getState()
      api
        .dropFiles(selectedId, files)
        .then(async (r: DropResult) => {
          if (r.background) useStore.setState({ settings: await api.updateSettings({ backgroundImage: r.background }) })
          if (r.modpack) await refreshInstances()
          if (r.added.length) bumpContent()
          const parts = [
            r.added.length ? `Добавлено: ${r.added.join(', ')}` : '',
            r.modpack ? `Модпак «${r.modpack}» импортирован` : '',
            r.background ? 'Фон обновлён' : ''
          ].filter(Boolean)
          if (parts.length) toast('info', parts.join('. '))
          for (const s of r.skipped) toast('warn', s)
        })
        .catch((err) => toast('error', errorText(err)))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', overFn)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (!over) return null
  return (
    <div className="dropzone">
      <div className="dropzone-card">
        <I.download size={30} />
        <b>Отпустите, чтобы добавить</b>
        <small>{target ? `Моды, текстуры и шейдеры попадут в «${target.name}».` : 'Выберите сборку, чтобы добавлять в неё моды.'} Модпаки .mrpack станут новой сборкой, картинки, GIF и видео станут фоном.</small>
      </div>
    </div>
  )
}

export function SessionReports(): ReactNode {
  const [crash, setCrash] = useState<SessionReport | null>(null)
  const [copied, setCopied] = useState(false)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    const pull = (): void => {
      void api.takeSessionReports().then((list: SessionReport[]) => {
        for (const r of list) {
          if (r.crash) setCrash(r)
          else if (r.summary.durationSec >= 30) {
            const fps = r.summary.avgFps ? ` · средний FPS ${r.summary.avgFps}` : ''
            toast('info', `«${r.instanceName}»: сыграно ${minutes(r.summary.durationSec)}${fps}`)
          }
        }
      })
    }
    pull()
    return onEvent('game:session', () => setTimeout(pull, 300))
  }, [toast])

  if (!crash?.crash) return null
  const c = crash.crash
  const close = (): void => {
    setCrash(null)
    setCopied(false)
  }
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog crash">
        <div className="crash-badge"><I.warning size={22} /></div>
        <small className="muted">«{crash.instanceName}» закрылась с ошибкой{c.code !== null ? `, код ${c.code}` : ''}</small>
        <h2>{c.title}</h2>
        <p>{c.hint}</p>
        {c.details.length > 0 && (
          <pre className="crash-lines">{c.details.join('\n')}</pre>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={() => void api.openInstanceFolder(crash.instanceId, 'crash-reports').catch(() => api.openInstanceFolder(crash.instanceId, 'game'))}>Папка вылетов</button>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(c.log).then(() => setCopied(true))
            }}
          >
            {copied ? <><I.check size={14} /> Скопировано</> : 'Скопировать лог'}
          </button>
          <button className="btn primary" autoFocus onClick={close}>Понятно</button>
        </div>
      </div>
    </div>
  )
}

const HOTKEYS: [string, string][] = [
  ['Ctrl P', 'Найти сборку'],
  ['Ctrl Shift P', 'Все команды'],
  ['Ctrl N', 'Новая сборка'],
  ['F5', 'Играть выбранной сборкой'],
  ['Shift F5', 'Закрыть игру'],
  ['Enter', 'Играть (на главной New)'],
  ['← →', 'Переключить сборку (на главной New)'],
  ['Ctrl ,', 'Настройки'],
  ['Ctrl B', 'Боковая панель'],
  ['Ctrl `', 'Вывод игры'],
  ['Ctrl Shift E', 'Сборки'],
  ['Ctrl Shift X', 'Магазин'],
  ['Ctrl W', 'Закрыть вкладку'],
  ['F11', 'Big Picture'],
  ['F1', 'Эта подсказка']
]

export function Hotkeys(): ReactNode {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen((v) => !v)
    window.addEventListener('hesperian:hotkeys', show)
    return () => window.removeEventListener('hesperian:hotkeys', show)
  }, [])
  if (!open) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <div className="dialog hotkeys">
        <h2>Горячие клавиши</h2>
        <div className="hotkeys-grid">
          {HOTKEYS.map(([k, label]) => (
            <div key={k} className="hotkey">
              <span>{label}</span>
              <span className="hotkey-keys">{k.split(' ').map((p) => <kbd key={p}>{p}</kbd>)}</span>
            </div>
          ))}
        </div>
        <div className="dialog-actions"><button className="btn primary" autoFocus onClick={() => setOpen(false)}>Закрыть</button></div>
      </div>
    </div>
  )
}

export async function hueFromImage(src: string): Promise<number | null> {
  const draw = (el: CanvasImageSource, w: number, h: number): number | null => {
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 48
    const ctx = c.getContext('2d')
    if (!ctx || !w || !h) return null
    ctx.drawImage(el, 0, 0, 48, 48)
    const data = ctx.getImageData(0, 0, 48, 48).data
    let x = 0
    let y = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max - min
      if (sat < 0.12 || max < 0.15) continue
      let h = 0
      if (max === r) h = ((g - b) / sat) % 6
      else if (max === g) h = (b - r) / sat + 2
      else h = (r - g) / sat + 4
      const angle = (h * 60 * Math.PI) / 180
      x += Math.cos(angle) * sat
      y += Math.sin(angle) * sat
    }
    if (!x && !y) return null
    return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
  }
  if (/\.(mp4|webm)$/i.test(src)) {
    const v = document.createElement('video')
    v.muted = true
    v.src = src
    await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }))
    return draw(v, v.videoWidth, v.videoHeight)
  }
  const img = new Image()
  img.src = src
  await img.decode()
  return draw(img, img.naturalWidth, img.naturalHeight)
}
