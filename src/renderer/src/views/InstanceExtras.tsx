import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Instance } from '../../../shared/types'
import { api } from '../bridge'
import { errorText, formatBytes, formatDate, Row, Seg } from '../components/common'
import { useStore } from '../store'

type Worlds = Awaited<ReturnType<typeof api.listWorlds>>
type Shots = Awaited<ReturnType<typeof api.listScreenshots>>

export function WorldsSection({ instance }: { instance: Instance }): ReactNode {
  const toast = useStore((s) => s.toast)
  const running = useStore((s) => s.games[instance.id] === 'running' || s.games[instance.id] === 'launching')
  const [worlds, setWorlds] = useState<Worlds | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    api.listWorlds(instance.id).then(setWorlds).catch((e) => toast('error', errorText(e)))
  }, [instance.id, toast])
  useEffect(load, [load])

  const run = async (key: string, work: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(key)
    try {
      await work()
      toast('info', done)
      load()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy('')
    }
  }

  if (!worlds) return <p className="hint">Загрузка...</p>
  if (!worlds.length) return <p className="hint">В этой сборке ещё нет миров. Они появятся здесь, когда вы создадите мир в игре.</p>
  return (
    <div className="ex-worlds">
      {running && <p className="hint">Пока игра запущена, копию сделать нельзя: мир в этот момент меняется.</p>}
      {worlds.map((world) => (
        <section key={world.name} className="ex-world">
          <div className="ex-world-head">
            <div>
              <b>{world.name}</b>
              <small className="muted">Изменён: {formatDate(world.modifiedAt)}</small>
            </div>
            <button className="btn" disabled={running || Boolean(busy)} onClick={() => void run(`b:${world.name}`, () => api.backupWorld(instance.id, world.name), 'Резервная копия готова')}>
              {busy === `b:${world.name}` && <span className="spinner" />} Сделать копию
            </button>
          </div>
          {world.backups.map((backup) => (
            <div key={backup.file} className="ex-backup">
              <span>{formatDate(backup.createdAt)}</span>
              <span className="muted grow">{formatBytes(backup.size)}</span>
              <button className="ghost-btn" disabled={Boolean(busy)} title="Появится рядом как отдельный мир, текущий не изменится" onClick={() => void run(`r:${backup.file}`, () => api.restoreBackup(instance.id, backup.file), 'Копия восстановлена как отдельный мир')}>Восстановить</button>
              <button
                className="ghost-btn"
                disabled={Boolean(busy)}
                onClick={() => {
                  void useStore.getState().confirm('Удалить копию?', `${world.name}, ${formatDate(backup.createdAt)}. Отменить это нельзя.`, 'Удалить').then((ok) => {
                    if (ok) void run(`d:${backup.file}`, () => api.deleteBackup(instance.id, backup.file), 'Копия удалена')
                  })
                }}
              >Удалить</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

export function ScreenshotsSection({ instance }: { instance: Instance }): ReactNode {
  const toast = useStore((s) => s.toast)
  const [shots, setShots] = useState<Shots | null>(null)

  const load = useCallback(() => {
    api.listScreenshots(instance.id).then(setShots).catch((e) => toast('error', errorText(e)))
  }, [instance.id, toast])
  useEffect(load, [load])

  if (!shots) return <p className="hint">Загрузка...</p>
  if (!shots.length) return <p className="hint">Скриншотов пока нет. В игре они делаются клавишей F2.</p>
  return (
    <div className="ex-shots">
      {shots.map((shot) => (
        <figure key={shot.file} className="ex-shot">
          <img src={shot.thumb} alt={shot.file} draggable={false} onClick={() => void api.openScreenshot(instance.id, shot.file).catch((e) => toast('error', errorText(e)))} />
          <figcaption>
            <span className="muted grow">{formatDate(shot.createdAt)}</span>
            <button className="ghost-btn" onClick={() => void api.copyScreenshot(instance.id, shot.file).then(() => toast('info', 'Скопировано'))}>Копировать</button>
            <button className="ghost-btn" onClick={() => void api.trashScreenshot(instance.id, shot.file).then(load).catch((e) => toast('error', errorText(e)))}>В корзину</button>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

const ASTRA_STYLES: [number, string][] = [[0, 'Minecraft'], [1, 'Astra'], [2, 'GNOME'], [3, 'Windows 11'], [4, 'macOS']]

export function AstraStyleRow({ instance }: { instance: Instance }): ReactNode {
  const toast = useStore((s) => s.toast)
  const revision = useStore((s) => s.contentRevision)
  const [style, setStyle] = useState<number | null>(null)
  useEffect(() => {
    api
      .astraHome(instance.id)
      .then((home) => setStyle(home.installed ? home.style : null))
      .catch(() => setStyle(null))
  }, [instance.id, revision])
  if (style === null) return null
  return (
    <Row title="Главное меню Astra" desc="Стиль меню в игре. Его же можно переключить прямо на главном экране">
      <Seg
        value={style}
        options={ASTRA_STYLES}
        onChange={(next) => {
          setStyle(next)
          api.setAstraStyle(instance.id, next).catch((e) => toast('error', errorText(e)))
        }}
      />
    </Row>
  )
}

export function OptimizeRow({ instance }: { instance: Instance }): ReactNode {
  const toast = useStore((s) => s.toast)
  const bumpContent = useStore((s) => s.bumpContent)
  const [busy, setBusy] = useState(false)
  if (instance.loader === 'vanilla' || instance.engine) return null
  return (
    <Row title="Оптимизация" desc="Поставить моды производительности: Sodium, Lithium, FerriteCore, ImmediatelyFast, EntityCulling, ModernFix">
      <button
        className="btn"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          api
            .optimizeInstance(instance.id)
            .then(({ installed, skipped }) => {
              bumpContent()
              toast('info', installed.length ? `Установлено: ${installed.join(', ')}${skipped.length ? `. Нет для этой версии: ${skipped.join(', ')}` : ''}` : 'Для этой версии подходящих модов не нашлось')
            })
            .catch((e) => toast('error', errorText(e)))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Ставлю...' : 'Ускорить сборку'}
      </button>
    </Row>
  )
}
