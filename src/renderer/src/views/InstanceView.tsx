import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ConflictReport, ContentItem, ContentKind, ContentUpdate, Instance, SessionStats, SessionSummary } from '../../../shared/types'
import { api, onEvent } from '../bridge'
import { errorText, formatBytes, formatDate, formatPlayTime, IconBtn, INSTANCE_COLORS, LOADER_NAMES, Range, Row, RunButton, Seg, Swatches, Switch } from '../components/common'
import { I } from '../components/icons'
import { BarChart, LineChart } from '../components/Chart'
import { useStore } from '../store'
import { AstraStyleRow, OptimizeRow, ScreenshotsSection, WorldsSection } from './InstanceExtras'

type Section = 'overview' | 'stats' | ContentKind | 'worlds' | 'screenshots' | 'settings'

const SECTIONS: [Section, string][] = [
  ['overview', 'Обзор'],
  ['stats', 'Статистика'],
  ['mod', 'Моды'],
  ['resourcepack', 'Текстуры'],
  ['shader', 'Шейдеры'],
  ['worlds', 'Миры'],
  ['screenshots', 'Скриншоты'],
  ['settings', 'Параметры']
]

const FOLDERS: [string, string, (p: { size?: number }) => ReactNode][] = [
  ['game', 'Папка игры', I.folderOpen],
  ['saves', 'Миры', I.globe],
  ['screenshots', 'Скриншоты', I.image],
  ['logs', 'Логи', I.output]
]

const KIND_FOLDER: Record<ContentKind, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }
const KIND_EMPTY: Record<ContentKind, string> = {
  mod: 'Модов пока нет',
  resourcepack: 'Текстур-паков пока нет',
  shader: 'Шейдеров пока нет'
}

function Overview({ instance }: { instance: Instance }): ReactNode {
  const duplicate = useStore((s) => s.duplicateInstance)
  const remove = useStore((s) => s.removeInstance)
  const toast = useStore((s) => s.toast)
  const exportModpack = useStore((s) => s.exportModpack)
  const openProject = useStore((s) => s.openProject)
  const [repairing, setRepairing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const pack = instance.modpack
  return (
    <>
      {pack && (
        <Row title="Модпак" desc={`${pack.title}, версия ${pack.versionNumber}`}>
          {pack.projectId && <button className="btn" onClick={() => openProject(pack.projectId!, pack.title)}><I.store size={14} /> Страница модпака</button>}
        </Row>
      )}
      <AstraStyleRow instance={instance} />
      <OptimizeRow instance={instance} />
      <DiskRow instance={instance} />
      <Row title="Папки" desc="Откроются в проводнике">
        <div className="row-wrap">
          {FOLDERS.map(([id, label, icon]) => (
            <button key={id} className="ghost-btn" onClick={() => void api.openInstanceFolder(instance.id, id)}>{icon({ size: 14 })} {label}</button>
          ))}
        </div>
      </Row>
      <Row title="Проверить файлы" desc="Пересчитать контрольные суммы и скачать заново всё повреждённое">
        <button
          className="btn"
          disabled={repairing}
          onClick={() => {
            setRepairing(true)
            api
              .repair(instance.id)
              .then(() => toast('info', 'Файлы проверены'))
              .catch((e) => toast('error', errorText(e)))
              .finally(() => setRepairing(false))
          }}
        >
          {repairing && <span className="spinner" />} Проверить
        </button>
      </Row>
      <Row title="Экспорт в .mrpack" desc="Файл модпака, чтобы поделиться сборкой. Моды с Modrinth уходят ссылками, миры не попадают">
        <button
          className="btn"
          disabled={exporting}
          onClick={() => {
            setExporting(true)
            void exportModpack(instance.id).finally(() => setExporting(false))
          }}
        >
          {exporting && <span className="spinner" />} Экспорт
        </button>
      </Row>
      <Row title="Дублировать" desc="Копия сборки со всеми модами и мирами">
        <button className="btn" onClick={() => void duplicate(instance.id)}>Дублировать</button>
      </Row>
      <Row title="Удалить" desc="Папка сборки переместится в корзину">
        <button className="btn danger" onClick={() => void remove(instance.id)}>Удалить</button>
      </Row>
    </>
  )
}

function ContentList({ instance, kind }: { instance: Instance; kind: ContentKind }): ReactNode {
  const revision = useStore((s) => s.contentRevision)
  const bumpContent = useStore((s) => s.bumpContent)
  const toast = useStore((s) => s.toast)
  const confirm = useStore((s) => s.confirm)
  const [items, setItems] = useState<ContentItem[] | null>(null)
  const [filter, setFilter] = useState('')
  const [updates, setUpdates] = useState<Map<string, ContentUpdate> | null>(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<Set<string>>(new Set())
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = useCallback(
    (loud: boolean) => {
      if (kind !== 'mod' || instance.loader === 'vanilla') return
      setScanning(true)
      api
        .checkConflicts(instance.id)
        .then((report: ConflictReport) => {
          setConflicts(report)
          if (loud && !report.issues.length) toast('info', `Конфликтов нет, проверено модов: ${report.checked}`)
        })
        .catch((e) => loud && toast('error', errorText(e)))
        .finally(() => setScanning(false))
    },
    [instance.id, instance.loader, kind, toast]
  )

  useEffect(() => scan(false), [scan, revision])
  const flagged = new Map<string, 'error' | 'warn'>()
  for (const issue of conflicts?.issues ?? []) for (const f of issue.files) if (flagged.get(f) !== 'error') flagged.set(f, issue.level)

  const checkUpdates = (): void => {
    setChecking(true)
    api
      .checkUpdates(instance.id, [kind])
      .then((list) => {
        setUpdates(new Map(list.map((u) => [u.file, u])))
        toast('info', list.length ? `Доступно обновлений: ${list.length}` : 'Всё уже последних версий')
      })
      .catch((e) => toast('error', errorText(e)))
      .finally(() => setChecking(false))
  }

  const applyUpdates = async (list: ContentUpdate[]): Promise<void> => {
    setUpdating(new Set(list.map((u) => u.file)))
    let done = 0
    for (const update of list) {
      try {
        await api.applyUpdate(instance.id, update)
        done++
        setUpdates((prev) => {
          const next = new Map(prev)
          next.delete(update.file)
          return next
        })
      } catch (e) {
        toast('error', `${update.title}: ${errorText(e)}`)
      }
      setUpdating((prev) => {
        const next = new Set(prev)
        next.delete(update.file)
        return next
      })
    }
    bumpContent()
    if (done) toast('info', done === 1 ? `Обновлено: ${list[0].title}` : `Обновлено: ${done}`)
  }

  const load = useCallback(() => {
    api.listContent(instance.id, kind).then(setItems).catch((e) => toast('error', errorText(e)))
  }, [instance.id, kind, toast])

  useEffect(load, [load, revision])

  const guard = (work: Promise<unknown>): void => {
    work.then(() => bumpContent()).catch((e) => toast('error', errorText(e)))
  }

  const needle = filter.trim().toLowerCase()
  const visible = (items ?? []).filter((i) => !needle || i.title.toLowerCase().includes(needle) || i.file.toLowerCase().includes(needle))
  const vanilla = kind === 'mod' && instance.loader === 'vanilla'

  if (vanilla) return <p className="muted item-empty">В ванильной сборке нет загрузчика модов. Создайте сборку с Fabric, Forge или NeoForge.</p>

  return (
    <>
      <div className="item-toolbar">
        <input className="input sm" placeholder="Фильтр" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="grow" />
        {updates && updates.size > 0 ? (
          <button className="btn primary" disabled={updating.size > 0} onClick={() => void applyUpdates([...updates.values()])}>
            {updating.size > 0 ? <span className="spinner" /> : <I.download size={14} />} Обновить всё ({updates.size})
          </button>
        ) : (
          <button className="btn" disabled={checking || !items?.length} onClick={checkUpdates} title="Найти новые версии на Modrinth">
            {checking ? <span className="spinner" /> : <I.download size={14} />} Обновления
          </button>
        )}
        <button
          className="btn primary"
          onClick={() => {
            useStore.setState({ storeTarget: instance.id, storeKind: kind })
            useStore.getState().openSidebar('store')
          }}
        >
          <I.store size={14} /> В магазин
        </button>
        {kind === 'mod' && (
          <button className="btn" disabled={scanning} onClick={() => scan(true)} title="Найти дубли, недостающие зависимости и несовместимые моды">
            {scanning ? <span className="spinner" /> : <I.warning size={14} />} Конфликты
          </button>
        )}
        <button className="btn" onClick={() => guard(api.addContentFiles(instance.id, kind))}><I.plus size={14} /> Файл</button>
        <button className="btn" onClick={() => void api.openInstanceFolder(instance.id, KIND_FOLDER[kind])}><I.folderOpen size={14} /> Папка</button>
      </div>
      {items?.length === 0 && <p className="muted item-empty">{KIND_EMPTY[kind]}</p>}
      {conflicts && conflicts.issues.length > 0 && (
        <div className="conflicts">
          <div className="conflicts-head">
            <I.warning size={16} />
            <b>{conflicts.issues.filter((i) => i.level === 'error').length ? 'Найдены проблемы с модами' : 'Есть на что обратить внимание'}</b>
            <span className="grow" />
            <button className="ghost-btn" onClick={() => setConflicts(null)}>Скрыть</button>
          </div>
          {conflicts.issues.map((issue, i) => (
            <div key={i} className={`conflict ${issue.level}`}>
              <i />
              <div>
                <span>{issue.text}</span>
                <small>{issue.files.join(' · ')}</small>
              </div>
              {issue.need && (
                <button
                  className="ghost-btn"
                  onClick={() => {
                    useStore.setState({ storeTarget: instance.id, storeKind: 'mod' })
                    useStore.getState().openSidebar('store')
                    void navigator.clipboard.writeText(issue.need!).catch(() => {})
                    toast('info', `Ищите в магазине: ${issue.need} (скопировано)`)
                  }}
                >
                  Найти
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div>
        {visible.map((item, i) => (
          <div key={item.file} className={`item-row ${item.enabled ? '' : 'off'} ${flagged.has(item.file) ? `flag-${flagged.get(item.file)}` : ''}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
            <Switch on={item.enabled} label={`Включить ${item.title}`} onChange={(on) => guard(api.setContentEnabled(instance.id, kind, item.file, on))} />
            {item.iconUrl ? <img className="item-icon" src={item.iconUrl} alt="" /> : <span className="item-icon hit-icon-empty"><I.cube size={15} /></span>}
            <div className="item-text">
              <b>{item.title}</b>
              <small title={item.file}>{item.versionNumber ?? item.file}</small>
            </div>
            {updates?.has(item.file) && (
              <button
                className="ghost-btn"
                disabled={updating.size > 0}
                title={`Обновить ${item.title}`}
                onClick={() => void applyUpdates([updates.get(item.file)!])}
              >
                {updating.has(item.file) ? <span className="spinner" /> : <I.download size={13} />} {updates.get(item.file)!.toVersionNumber}
              </button>
            )}
            <span className="item-size">{formatBytes(item.size)}</span>
            <IconBtn
              icon={I.trash}
              title={`Удалить ${item.title}`}
              cls="hover-only"
              onClick={() => {
                void confirm(`Удалить «${item.title}»?`, 'Файл будет перемещён в корзину.', 'Удалить').then((ok) => {
                  if (ok) guard(api.removeContent(instance.id, kind, item.file))
                })
              }}
            />
          </div>
        ))}
      </div>
    </>
  )
}

function Parameters({ instance }: { instance: Instance }): ReactNode {
  const refreshInstances = useStore((s) => s.refreshInstances)
  const toast = useStore((s) => s.toast)
  const settings = useStore((s) => s.settings)!
  const totalMemory = useStore((s) => s.system?.totalMemoryMb ?? 16384)
  const [draft, setDraft] = useState(instance)
  useEffect(() => setDraft(instance), [instance])

  const save = (patch: Partial<Instance>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    api.updateInstance(instance.id, patch).then(refreshInstances).catch((e) => toast('error', errorText(e)))
  }
  const memory = draft.memoryMb ?? settings.defaultMemoryMb
  const gb = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.0', '')} ГБ` : `${mb} МБ`)

  return (
    <>
      <Row title="Название">
        <input className="input sm set-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => draft.name.trim() && draft.name !== instance.name && save({ name: draft.name.trim() })} />
      </Row>
      <Row title="Группа" desc="Сборки одной группы собираются в папку в боковой панели">
        <input className="input sm set-input" value={draft.group ?? ''} placeholder="Без группы" onChange={(e) => setDraft({ ...draft, group: e.target.value })} onBlur={() => draft.group !== instance.group && save({ group: draft.group?.trim() || undefined })} />
      </Row>
      <Row title="Цвет"><Swatches value={draft.color} colors={INSTANCE_COLORS} onChange={(color) => save({ color })} /></Row>
      <Row title="Закрепить сверху" desc="Сборка будет первой в списке, на главной и в трее"><Switch on={Boolean(draft.pinned)} label="Закрепить" onChange={(pinned) => save({ pinned })} /></Row>
      <Row title="Бэкап миров перед запуском" desc="Перед каждой игрой сохраняется копия миров, хранятся три последние. Восстановить можно на вкладке «Миры»"><Switch on={Boolean(draft.autoBackup)} label="Бэкап миров" onChange={(autoBackup) => save({ autoBackup })} /></Row>
      <Row title="Память" desc={draft.memoryMb ? 'Своё значение для этой сборки' : 'Как в общих настройках'}>
        <Range
          value={memory}
          min={512}
          max={Math.max(1024, totalMemory - 1024)}
          step={256}
          fmt={gb}
          onChange={(memoryMb) => setDraft({ ...draft, memoryMb })}
          onCommit={(memoryMb) => save({ memoryMb })}
        />
      </Row>
      <Row title="Размер окна" desc="Пусто: как в общих настройках">
        <div className="row">
          <input type="number" min={320} className="input sm num-input" value={draft.width ?? ''} placeholder={String(settings.defaultWidth)} aria-label="Ширина" onChange={(e) => setDraft({ ...draft, width: e.target.value ? Number(e.target.value) : undefined })} onBlur={() => save({ width: draft.width })} />
          <span className="muted">×</span>
          <input type="number" min={240} className="input sm num-input" value={draft.height ?? ''} placeholder={String(settings.defaultHeight)} aria-label="Высота" onChange={(e) => setDraft({ ...draft, height: e.target.value ? Number(e.target.value) : undefined })} onBlur={() => save({ height: draft.height })} />
        </div>
      </Row>
      <Row title="Аргументы JVM">
        <input className="input sm set-input mono" value={draft.jvmArgs ?? ''} placeholder={settings.defaultJvmArgs || '-XX:+UseG1GC'} onChange={(e) => setDraft({ ...draft, jvmArgs: e.target.value })} onBlur={() => save({ jvmArgs: draft.jvmArgs })} />
      </Row>
      <Row title="Своя Java" desc={draft.javaPath || 'Обычно не нужна: лаунчер сам ставит подходящую версию'}>
        <div className="row">
          <button className="btn" onClick={() => void api.pickJava().then((p) => p && save({ javaPath: p }))}>Выбрать</button>
          {draft.javaPath && <button className="btn" onClick={() => save({ javaPath: undefined })}>Сбросить</button>}
        </div>
      </Row>
      <Row title="Заметки">
        <textarea className="input area set-input" rows={3} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} onBlur={() => draft.notes !== instance.notes && save({ notes: draft.notes })} />
      </Row>
    </>
  )
}

export function InstanceView({ instanceId }: { instanceId: string }): ReactNode {
  const instance = useStore((s) => s.instances.find((i) => i.id === instanceId))
  const [section, setSection] = useState<Section>('overview')
  if (!instance) return null
  return (
    <div className="cloud-view">
      <div className="cv-head">
        <div className="cv-title">
          <h1>{instance.name}</h1>
          <p className="muted">
            {instance.engine === 'horizon' ? `Horizon, ${instance.mcVersion} на Rust` : `${instance.mcVersion} · ${LOADER_NAMES[instance.loader]}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`}
          </p>
          {instance.notes && <p className="muted cv-desc">{instance.notes}</p>}
        </div>
        <div className="cv-actions"><RunButton instanceId={instance.id} /></div>
      </div>
      <div className="cv-rating">
        {instance.playTimeSec > 0 ? (
          <>
            <span className="big">{formatPlayTime(instance.playTimeSec)}</span>
            <span className="muted">наиграно · последний запуск: {formatDate(instance.lastPlayedAt)}</span>
          </>
        ) : (
          <span className="muted">Ещё не запускалась</span>
        )}
      </div>
      {instance.engine === 'horizon' ? (
        <p className="hint exp-note">
          Запуск открывает лаунчер Horizon: сборки, моды и настройки игры находятся там. Это сторонний проект, не связанный с Mojang.
          Нужна учётная запись Microsoft с купленной Minecraft: Java Edition.
        </p>
      ) : (
      <>
      <div className="view-tabs"><Seg value={section} options={SECTIONS} onChange={setSection} /></div>
      {section === 'overview' && <Overview instance={instance} />}
      {section === 'stats' && <StatsSection instance={instance} />}
      {section === 'settings' && <Parameters instance={instance} />}
      {section === 'worlds' && <WorldsSection instance={instance} />}
      {section === 'screenshots' && <ScreenshotsSection instance={instance} />}
      {(section === 'mod' || section === 'resourcepack' || section === 'shader') && <ContentList key={section} instance={instance} kind={section} />}
      </>
      )}
    </div>
  )
}

const minutes = (sec: number): string => {
  if (sec < 60) return `${sec} с`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

const day = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function StatsSection({ instance }: { instance: Instance }): ReactNode {
  const running = useStore((s) => s.games[instance.id] === 'running')
  const totalMemory = useStore((s) => s.system?.totalMemoryMb ?? 8192)
  const refreshInstances = useStore((s) => s.refreshInstances)
  const toast = useStore((s) => s.toast)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [live, setLive] = useState<SessionSummary['samples']>([])
  const [picked, setPicked] = useState(0)

  useEffect(() => {
    void api.instanceStats(instance.id).then(setStats)
  }, [instance.id, running])

  useEffect(
    () =>
      onEvent<{ instanceId: string; sample: SessionSummary['samples'][number] }>('game:stats', (e) => {
        if (e.instanceId === instance.id) setLive((prev) => [...prev.slice(-899), e.sample])
      }),
    [instance.id]
  )
  useEffect(() => {
    if (!running) setLive([])
  }, [running])

  if (!stats) return <p className="muted item-empty"><span className="spinner" /></p>
  const sessions = stats.sessions
  const showLive = running && live.length > 0
  const current = showLive ? null : sessions[picked]
  const samples = showLive ? live : (current?.samples ?? [])
  const fps = samples.filter((s) => s.fps !== undefined).map((s) => ({ t: s.t, v: s.fps! }))
  const mem = samples.filter((s) => s.rss !== undefined || s.heap !== undefined).map((s) => ({ t: s.t, v: (s.rss ?? s.heap)! }))
  const withFps = sessions.filter((s) => s.avgFps)
  const avgAll = withFps.length ? Math.round(withFps.reduce((a, s) => a + s.avgFps!, 0) / withFps.length) : undefined
  const peak = Math.max(0, ...sessions.map((s) => s.peakRssMb ?? s.peakHeapMb ?? 0))
  const last = sessions[0]
  const tips: { text: string; action?: { label: string; run: () => void } }[] = []
  if (last?.peakHeapMb && last.heapMaxMb && last.peakHeapMb >= last.heapMaxMb * 0.88) {
    const next = Math.min(Math.ceil((last.heapMaxMb + 1024) / 1024) * 1024, Math.floor((totalMemory * 0.75) / 512) * 512)
    if (next > last.heapMaxMb) tips.push({
      text: `Java почти упёрлась в память: пик ${last.peakHeapMb} из ${last.heapMaxMb} МБ. Из-за этого бывают фризы и вылеты.`,
      action: { label: `Поставить ${(next / 1024).toFixed(next % 1024 ? 1 : 0)} ГБ`, run: () => void api.updateInstance(instance.id, { memoryMb: next }).then(() => { void refreshInstances(); toast('info', `Сборке выделено ${(next / 1024).toFixed(1)} ГБ`) }) }
    })
  }
  if (last?.avgFps && last.avgFps < 40 && instance.loader !== 'vanilla') tips.push({
    text: `Средний FPS в прошлый раз ${last.avgFps}. Моды оптимизации обычно поднимают его в 1,5–3 раза.`,
    action: { label: 'Ускорить сборку', run: () => void api.optimizeInstance(instance.id).then((r: { installed: string[] }) => toast('info', r.installed.length ? `Поставлено: ${r.installed.join(', ')}` : 'Всё уже стоит')).catch((e: unknown) => toast('error', errorText(e))) }
  })
  const crashes = sessions.slice(0, 5).filter((s) => !s.stopped && s.exitCode).length
  if (crashes >= 2) tips.push({ text: `Из последних пяти запусков ${crashes} закончились вылетом. Загляните во вкладку «Моды» и нажмите «Конфликты».` })
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (13 - i))
    const from = d.getTime()
    const to = from + 86400000
    const sec = sessions.filter((s) => s.startedAt >= from && s.startedAt < to).reduce((a, s) => a + s.durationSec, 0)
    return { label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), value: Math.round(sec / 60), hint: minutes(sec) }
  })
  const anyDays = days.some((d) => d.value > 0)

  return (
    <div className="stats">
      <div className="stat-tiles">
        <div className="stat-tile"><small>Наиграно всего</small><b>{minutes(instance.playTimeSec)}</b></div>
        <div className="stat-tile"><small>Сессий</small><b>{sessions.length}</b></div>
        <div className="stat-tile"><small>Средний FPS</small><b>{avgAll ?? '—'}</b></div>
        <div className="stat-tile"><small>Пик памяти</small><b>{peak ? `${(peak / 1024).toFixed(1)} ГБ` : '—'}</b></div>
      </div>

      {tips.map((t, i) => (
        <div key={i} className="stat-tip">
          <I.sparkle size={16} />
          <span>{t.text}</span>
          {t.action && <button className="btn sm primary" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}

      {anyDays && (
        <div className="stat-chart">
          <span className="stat-chart-title">Время в игре по дням, мин</span>
          <BarChart bars={days} unit="мин" color="var(--accent)" />
        </div>
      )}

      {!sessions.length && !showLive && (
        <div className="plug-empty">
          <b>Статистики пока нет</b>
          <span>Сыграйте в сборку, и здесь появятся графики FPS и памяти за каждую сессию.</span>
        </div>
      )}

      {(showLive || current) && (
        <>
          <div className="stat-head">
            <b>{showLive ? 'Сейчас в игре' : `Сессия ${day(current!.startedAt)}`}</b>
            {current && <small className="muted">{minutes(current.durationSec)}{current.avgFps ? ` · средний FPS ${current.avgFps}, минимум ${current.minFps}` : ''}{current.stopped ? ' · остановлена' : current.exitCode ? ` · вылет, код ${current.exitCode}` : ''}</small>}
            {showLive && <span className="pulse" />}
          </div>
          <div className="stat-charts">
            <div className="stat-chart">
              <span className="stat-chart-title">FPS</span>
              {fps.length > 1 ? (
                <LineChart points={fps} unit="FPS" color="var(--accent)" />
              ) : (
                <p className="muted stat-note">FPS записывается в сборках с Astra Visuals 1.3 и новее. Поставьте её из магазина, поиск «defender».</p>
              )}
            </div>
            <div className="stat-chart">
              <span className="stat-chart-title">Память, МБ</span>
              {mem.length > 1 ? (
                <LineChart points={mem} unit="МБ" color="#8fb4ff" extra={(i) => { const s = samples.filter((x) => x.rss !== undefined || x.heap !== undefined)[i]; return s?.heap ? `Java ${s.heap} МБ` : null }} />
              ) : (
                <p className="muted stat-note">Слишком короткая сессия, график появится после пары минут игры.</p>
              )}
            </div>
          </div>
        </>
      )}

      {sessions.length > 0 && (
        <>
          <h3 className="stat-h">История</h3>
          <div className="stat-table" role="table">
            <div className="stat-row head" role="row"><span>Когда</span><span>Длительность</span><span>Средний FPS</span><span>Мин. FPS</span><span>Пик памяти</span><span>Итог</span></div>
            {sessions.map((s, i) => (
              <button key={s.startedAt} className={`stat-row ${!showLive && i === picked ? 'on' : ''}`} role="row" onClick={() => setPicked(i)}>
                <span>{day(s.startedAt)}</span>
                <span>{minutes(s.durationSec)}</span>
                <span>{s.avgFps ?? '—'}</span>
                <span>{s.minFps ?? '—'}</span>
                <span>{s.peakRssMb ?? s.peakHeapMb ? `${s.peakRssMb ?? s.peakHeapMb} МБ` : '—'}</span>
                <span className={!s.stopped && s.exitCode ? 'bad' : ''}>{s.stopped ? 'остановлена' : s.exitCode ? `вылет (${s.exitCode})` : 'ок'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DiskRow({ instance }: { instance: Instance }): ReactNode {
  const toast = useStore((s) => s.toast)
  const [size, setSize] = useState<{ total: number; junk: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    void api.instanceSize(instance.id).then(setSize).catch(() => setSize(null))
  }, [instance.id])
  useEffect(load, [load])
  return (
    <Row title="Место на диске" desc={size ? `Сборка занимает ${formatBytes(size.total)}${size.junk ? `, из них ${formatBytes(size.junk)} старых логов и отчётов о вылетах` : ''}` : 'Считаем…'}>
      <button
        className="btn"
        disabled={busy || !size?.junk}
        onClick={() => {
          setBusy(true)
          api
            .cleanInstance(instance.id)
            .then((freed: number) => toast('info', `Освобождено ${formatBytes(freed)}`))
            .catch((e: unknown) => toast('error', errorText(e)))
            .finally(() => {
              setBusy(false)
              load()
            })
        }}
      >
        Очистить мусор
      </button>
    </Row>
  )
}
