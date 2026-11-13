import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StoreProject, StoreVersion } from '../../../shared/types'
import { api } from '../bridge'
import { errorText, formatDate, formatDownloads, LOADER_NAMES, Seg } from '../components/common'
import { I } from '../components/icons'
import { storeLoader, useInstall, useInstalledProjects } from '../components/StorePanel'
import { useStore } from '../store'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') node.setAttribute('target', '_blank')
})

const renderMarkdown = (body: string): string =>
  DOMPurify.sanitize(marked.parse(body, { async: false }), { FORBID_TAGS: ['style', 'iframe', 'form'], FORBID_ATTR: ['style'] })

const VERSION_TYPE: Record<string, string> = { release: 'релиз', beta: 'бета', alpha: 'альфа' }

type Section = 'about' | 'versions' | 'gallery'

export function ProjectView({ projectId }: { projectId: string }): ReactNode {
  const instances = useStore((s) => s.instances)
  const targetId = useStore((s) => s.storeTarget)
  const install = useInstall()
  const installModpack = useStore((s) => s.installModpack)
  const openInstance = useStore((s) => s.openInstance)
  const [project, setProject] = useState<StoreProject | null>(null)
  const [versions, setVersions] = useState<StoreVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('about')

  const target = instances.find((i) => i.id === targetId) ?? null
  const kind = project?.kind ?? 'mod'
  const packs = kind === 'modpack'
  const installed = useInstalledProjects(target?.id ?? null, kind).has(projectId)
  const packInstance = packs ? instances.find((i) => i.modpack?.projectId === projectId) : undefined
  const loader = kind === 'mod' ? storeLoader(target?.loader) : undefined
  const blocked = kind === 'mod' && target?.loader === 'vanilla'
  const versionGame = packs ? undefined : target?.mcVersion
  const versionLoader = packs ? undefined : loader

  useEffect(() => {
    let alive = true
    api.getProject(projectId).then((p) => alive && setProject(p)).catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    let alive = true
    setVersions(null)
    if (!project) return
    api
      .getProjectVersions(projectId, versionGame, versionLoader)
      .then((v) => alive && setVersions(v))
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [projectId, project, versionGame, versionLoader])

  const html = useMemo(() => (project ? renderMarkdown(project.body) : ''), [project])

  if (error) return <div className="center-msg hint bad">{error}</div>
  if (!project) return <div className="center-msg"><span className="spinner" /></div>

  const run = (versionId?: string): void => {
    if (kind === 'modpack') {
      setBusy(versionId ?? 'main')
      void installModpack(projectId, versionId).finally(() => setBusy(null))
      return
    }
    if (!target) return
    setBusy(versionId ?? 'main')
    void install(target.id, kind, projectId, versionId).finally(() => setBusy(null))
  }
  const canInstall = packs || (Boolean(target) && !blocked)

  const noFiles = versions !== null && versions.length === 0
  const sections: [Section, string][] = [
    ['about', 'Описание'],
    ['versions', versions ? `Версии (${versions.length})` : 'Версии'],
    ...(project.gallery.length ? [['gallery', `Галерея (${project.gallery.length})`] as [Section, string]] : [])
  ]
  const links = [
    { url: project.local ? undefined : `https://modrinth.com/project/${project.slug}`, label: 'Modrinth' },
    { url: project.sourceUrl, label: 'Исходный код' },
    { url: project.issuesUrl, label: 'Проблемы' },
    { url: project.wikiUrl, label: 'Вики' }
  ].filter((l): l is { url: string; label: string } => Boolean(l.url))

  return (
    <div className="cloud-view">
      <div className="cv-head">
        <div className="project-head">
          {project.iconUrl ? <img className="project-icon" src={project.iconUrl} alt="" /> : <span className="project-icon hit-icon-empty"><I.cube size={26} /></span>}
          <div className="cv-title">
            <h1>{project.title}</h1>
            <p className="muted">{project.description}</p>
          </div>
        </div>
        <div className="cv-actions">
          {packInstance && (
            <button className="btn" onClick={() => openInstance(packInstance.id)}><I.cube size={14} /> Открыть сборку</button>
          )}
          {installed && !packs ? (
            <span className="role">установлено</span>
          ) : (
            <button className="btn primary" disabled={!canInstall || noFiles || versions === null || busy !== null} onClick={() => run()}>
              {busy === 'main' ? <span className="spinner" /> : <I.download size={14} />} {packInstance ? 'Установить ещё раз' : 'Установить'}
            </button>
          )}
        </div>
      </div>
      <div className="cv-rating">
        {project.local ? (
          <span className="muted">Встроена в Hesperian, скачивать отдельно не нужно</span>
        ) : (
          <>
            <span className="big">{formatDownloads(project.downloads)}</span>
            <span className="muted">скачиваний · {project.license ?? 'лицензия не указана'} · обновлён {formatDate(project.updatedAt)}</span>
          </>
        )}
        <span className="grow" />
        {links.map((l) => (
          <button key={l.url} className="ghost-btn" onClick={() => void api.openExternal(l.url)}><I.reveal size={13} /> {l.label}</button>
        ))}
      </div>
      {packs ? (
        <div className="project-target"><span className="hint">Модпак установится отдельной сборкой со всеми модами и настройками. Устанавливается последний релиз или версия из списка.</span></div>
      ) : (
      <div className="project-target">
        <select className="select" value={targetId ?? ''} onChange={(e) => useStore.setState({ storeTarget: e.target.value || null })} aria-label="Сборка">
          <option value="">Выберите сборку</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({i.mcVersion}{i.loader !== 'vanilla' ? `, ${LOADER_NAMES[i.loader]}` : ''})</option>
          ))}
        </select>
        {blocked && <span className="hint">В ванильную сборку моды не ставятся.</span>}
        {target && noFiles && !blocked && <span className="hint">Нет файлов для {target.mcVersion}{loader ? ` / ${LOADER_NAMES[loader]}` : ''}.</span>}
      </div>
      )}
      <div className="view-tabs"><Seg value={section} options={sections} onChange={setSection} /></div>

      {section === 'about' && <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />}

      {section === 'versions' && (
        <div>
          {versions === null && <div className="item-empty"><span className="spinner" /></div>}
          {noFiles && <p className="muted item-empty">Подходящих версий нет.</p>}
          {versions?.map((v, i) => (
            <div key={v.id} className="item-row" style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
              <div className="item-text">
                <b>{v.name}</b>
                <small>{v.versionNumber} · {VERSION_TYPE[v.type] ?? v.type} · {packs ? `${v.gameVersions.join(', ')} · ` : ''}{v.loaders.join(', ')} · {formatDate(v.publishedAt)}</small>
              </div>
              <button className="ghost-btn" disabled={!canInstall || busy !== null} onClick={() => run(v.id)}>
                {busy === v.id ? <span className="spinner" /> : <I.download size={13} />} Установить
              </button>
            </div>
          ))}
        </div>
      )}

      {section === 'gallery' && (
        <div className="gallery">
          {project.gallery.map((g) => (
            <figure key={g.url}>
              <img src={g.url} alt={g.title ?? ''} loading="lazy" />
              {g.title && <figcaption className="hint">{g.title}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
