import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ContentItem, ContentKind, ContentUpdate, Instance } from '../../../shared/types'
import { api } from '../bridge'
import { errorText, formatBytes, formatDate, formatPlayTime, IconBtn, INSTANCE_COLORS, LOADER_NAMES, Range, Row, RunButton, Seg, Swatches, Switch } from '../components/common'
import { I } from '../components/icons'
import { useStore } from '../store'
import { AstraStyleRow, OptimizeRow, ScreenshotsSection, WorldsSection } from './InstanceExtras'

type Section = 'overview' | ContentKind | 'worlds' | 'screenshots' | 'settings'

const SECTIONS: [Section, string][] = [
  ['overview', 'Обзор'],
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
        <button className="btn" onClick={() => guard(api.addContentFiles(instance.id, kind))}><I.plus size={14} /> Файл</button>
        <button className="btn" onClick={() => void api.openInstanceFolder(instance.id, KIND_FOLDER[kind])}><I.folderOpen size={14} /> Папка</button>
      </div>
      {items?.length === 0 && <p className="muted item-empty">{KIND_EMPTY[kind]}</p>}
      <div>
        {visible.map((item, i) => (
          <div key={item.file} className={`item-row ${item.enabled ? '' : 'off'}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
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
      {section === 'settings' && <Parameters instance={instance} />}
      {section === 'worlds' && <WorldsSection instance={instance} />}
      {section === 'screenshots' && <ScreenshotsSection instance={instance} />}
      {(section === 'mod' || section === 'resourcepack' || section === 'shader') && <ContentList key={section} instance={instance} kind={section} />}
      </>
      )}
    </div>
  )
}
