import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentKind, StoreHit, StoreKind, StoreQuery } from '../../../shared/types'
import { api } from '../bridge'
import { useStore } from '../store'
import { errorText, formatDownloads, LOADER_NAMES, Seg } from './common'
import { I } from './icons'

const KINDS: [StoreKind, string][] = [['modpack', 'Сборки'], ['mod', 'Моды'], ['resourcepack', 'Текстуры'], ['shader', 'Шейдеры']]

const PACK_LOADERS: [string, string][] = [['', 'Загрузчик'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge']]

const SORTS: [StoreQuery['sort'], string][] = [
  ['relevance', 'По релевантности'],
  ['downloads', 'По скачиваниям'],
  ['follows', 'По подпискам'],
  ['updated', 'Недавно обновлённые'],
  ['newest', 'Новые']
]

export const storeLoader = (loader: string | undefined): StoreQuery['loader'] =>
  loader === 'fabric' || loader === 'forge' || loader === 'neoforge' ? loader : undefined

export function useInstalledProjects(instanceId: string | null, kind: StoreKind): Set<string> {
  const revision = useStore((s) => s.contentRevision)
  const instances = useStore((s) => s.instances)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const packs = useMemo(() => new Set(instances.flatMap((i) => (i.modpack?.projectId ? [i.modpack.projectId] : []))), [instances])
  useEffect(() => {
    if (kind === 'modpack' || !instanceId) {
      setInstalled(new Set())
      return
    }
    let alive = true
    void api.listContent(instanceId, kind).then((items) => {
      if (alive) setInstalled(new Set(items.flatMap((i) => (i.projectId ? [i.projectId] : []))))
    })
    return () => {
      alive = false
    }
  }, [instanceId, kind, revision])
  return kind === 'modpack' ? packs : installed
}

export function useInstall(): (instanceId: string, kind: ContentKind, projectId: string, versionId?: string) => Promise<void> {
  const toast = useStore((s) => s.toast)
  const bumpContent = useStore((s) => s.bumpContent)
  return async (instanceId, kind, projectId, versionId) => {
    try {
      const result = await api.installFromStore(instanceId, kind, projectId, versionId)
      bumpContent()
      const extra = result.installed.length > 1 ? ` и зависимости: ${result.installed.slice(1).join(', ')}` : ''
      toast('info', `Установлено: ${result.installed[0]}${extra}`)
      if (result.skippedDependencies.length) {
        toast('warn', `Не нашлись зависимости для этой версии: ${result.skippedDependencies.join(', ')}`)
      }
    } catch (e) {
      toast('error', errorText(e))
    }
  }
}

function HitRow({ hit, index, kind, canInstall, installed, targetId }: {
  hit: StoreHit
  index: number
  kind: StoreKind
  canInstall: boolean
  installed: boolean
  targetId: string | null
}): ReactNode {
  const openProject = useStore((s) => s.openProject)
  const install = useInstall()
  const installModpack = useStore((s) => s.installModpack)
  const createWithLocalMod = useStore((s) => s.createWithLocalMod)
  const target = useStore((s) => s.instances.find((i) => i.id === targetId))
  const [busy, setBusy] = useState(false)
  const needsNew = Boolean(hit.local && hit.gameVersion && !(target && target.mcVersion === hit.gameVersion && target.loader === 'fabric'))
  return (
    <div className="hit" style={{ '--i': Math.min(index, 12) } as React.CSSProperties} onClick={() => openProject(hit.id, hit.title)}>
      {hit.iconUrl ? <img className="hit-icon" src={hit.iconUrl} alt="" loading="lazy" /> : <span className="hit-icon hit-icon-empty"><I.cube size={18} /></span>}
      <div className="hit-body">
        <div className="hit-title">
          <span className="hit-name">{hit.title}</span>
          <span className="hit-dl"><I.download size={11} /> {formatDownloads(hit.downloads)}</span>
        </div>
        <div className="hit-desc">{hit.description}</div>
        <div className="hit-foot">
          <span className="hit-author">{hit.author}</span>
          {installed ? (
            <span className="role">установлено</span>
          ) : needsNew ? (
            <button
              className="ghost-btn hit-install"
              disabled={busy}
              title={`Нужна ${hit.gameVersion} с Fabric`}
              onClick={(e) => {
                e.stopPropagation()
                setBusy(true)
                void createWithLocalMod(hit.id, hit.title, hit.gameVersion!).finally(() => setBusy(false))
              }}
            >
              {busy ? <span className="spinner" /> : <I.plus size={13} />} Создать сборку
            </button>
          ) : (
            canInstall && (
              <button
                className="ghost-btn hit-install"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation()
                  setBusy(true)
                  const work = kind === 'modpack' ? installModpack(hit.id) : install(targetId!, kind, hit.id)
                  void work.finally(() => setBusy(false))
                }}
              >
                {busy ? <span className="spinner" /> : <I.download size={13} />} Установить
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

export function StorePanel(): ReactNode {
  const instances = useStore((s) => s.instances)
  const versions = useStore((s) => s.versions)
  const targetId = useStore((s) => s.storeTarget)
  const kind = useStore((s) => s.storeKind)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<StoreQuery['sort']>('relevance')
  const [packVersion, setPackVersion] = useState('')
  const [packLoader, setPackLoader] = useState('')
  const [hits, setHits] = useState<StoreHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const target = instances.find((i) => i.id === targetId) ?? null
  const installed = useInstalledProjects(target?.id ?? null, kind)
  const allReleases = useMemo(() => versions.filter((v) => v.type === 'release').map((v) => v.id), [versions])
  const packs = kind === 'modpack'
  const gameVersions = useMemo(
    () => (packs ? (packVersion ? [packVersion] : allReleases) : target ? [target.mcVersion] : allReleases),
    [packs, packVersion, target, allReleases]
  )
  const loader = kind === 'mod' ? storeLoader(target?.loader) : packs ? storeLoader(packLoader) : undefined
  const vanillaMods = kind === 'mod' && target?.loader === 'vanilla'

  const run = async (offset: number): Promise<void> => {
    if (!gameVersions.length) return
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = await api.searchStore({ kind, query, sort, gameVersions, loader, offset })
      if (id !== requestId.current) return
      setHits((prev) => (offset ? [...prev, ...result.hits] : result.hits))
      setTotal(result.total)
    } catch (e) {
      if (id === requestId.current) setError(errorText(e))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void run(0), query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [kind, query, sort, gameVersions, loader])

  return (
    <div className="store">
      <div className="side-head"><span className="side-title">Магазин · Modrinth</span></div>
      <div className="pad-x">
        <input className="input sm" placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Seg full value={kind} options={KINDS} onChange={(storeKind) => useStore.setState({ storeKind })} />
        {packs ? (
          <div className="store-pair">
            <select className="select" value={packVersion} onChange={(e) => setPackVersion(e.target.value)} aria-label="Версия игры">
              <option value="">Все версии</option>
              {allReleases.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="select" value={packLoader} onChange={(e) => setPackLoader(e.target.value)} aria-label="Загрузчик">
              {PACK_LOADERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
        ) : (
          <select className="select full" value={targetId ?? ''} onChange={(e) => useStore.setState({ storeTarget: e.target.value || null })} aria-label="Сборка">
            <option value="">Все версии от 1.16.5</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.mcVersion}{i.loader !== 'vanilla' ? `, ${LOADER_NAMES[i.loader]}` : ''})
              </option>
            ))}
          </select>
        )}
        <select className="select full" value={sort} onChange={(e) => setSort(e.target.value as StoreQuery['sort'])} aria-label="Сортировка">
          {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="hits">
        {vanillaMods && <div className="store-note">В ванильную сборку моды не поставить. Выберите сборку с загрузчиком.</div>}
        {packs && <div className="store-note">Готовые сборки с модами и настройками. Каждая ставится отдельной сборкой в один клик.</div>}
        {!packs && !target && instances.length > 0 && <div className="store-note">Выберите сборку, чтобы устанавливать в неё.</div>}
        {error && (
          <div className="store-note bad">
            {error} <button className="link" onClick={() => void run(0)}>Повторить</button>
          </div>
        )}
        {!error && !loading && hits.length === 0 && <div className="store-note">Ничего не найдено{!packs && target ? ` для ${target.mcVersion}` : ''}.</div>}
        {hits.map((hit, i) => (
          <HitRow key={hit.id} hit={hit} index={i} kind={kind} targetId={target?.id ?? null} canInstall={packs || (Boolean(target) && !vanillaMods)} installed={installed.has(hit.id)} />
        ))}
        {loading && <div className="store-note"><span className="spinner" /></div>}
        {!loading && hits.length > 0 && hits.length < total && (
          <div className="pad-x hits-more">
            <button className="btn full" onClick={() => void run(hits.filter((h) => !h.local).length)}>Показать ещё</button>
          </div>
        )}
      </div>
    </div>
  )
}
