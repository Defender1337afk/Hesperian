import { basename, join } from 'node:path'
import { assertLocalFits, installLocal, isLocalMod, localHits, localProject, localVersions } from './localmods'
import type { ContentKind, StoreHit, StoreKind, StoreProject, StoreQuery, StoreResult, StoreVersion } from '../shared/types'
import { contentDir, filesOfProject, forgetContent, recordContent } from './content'
import { Task } from './events'
import { getInstance } from './instances'
import { download, fetchJson, HttpError } from './net'
import { rm } from 'node:fs/promises'

export const API = 'https://api.modrinth.com/v2'
const PAGE_SIZE = 20

const PROJECT_TYPE: Record<StoreKind, string> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', modpack: 'modpack' }
const MODPACK_LOADERS = ['fabric', 'forge', 'neoforge']

interface RawHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  icon_url: string | null
  downloads: number
  follows: number
  display_categories: string[]
}

export interface RawVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  date_published: string
  downloads: number
  files: { url: string; filename: string; primary: boolean; size?: number; hashes: { sha1?: string; sha512?: string } }[]
  dependencies: { version_id: string | null; project_id: string | null; dependency_type: string }[]
}

export interface RawProject {
  id: string
  slug: string
  project_type: string
  title: string
  description: string
  body: string
  icon_url: string | null
  downloads: number
  followers: number
  license?: { id: string }
  source_url: string | null
  issues_url: string | null
  wiki_url: string | null
  gallery: { url: string; title: string | null; ordering: number }[]
  updated: string
}

export async function searchStore(q: StoreQuery): Promise<StoreResult> {
  const facets: string[][] = [[`project_type:${PROJECT_TYPE[q.kind]}`]]
  if (q.gameVersions.length) facets.push(q.gameVersions.map((v) => `versions:${v}`))
  if (q.loader && (q.kind === 'mod' || q.kind === 'modpack')) facets.push([`categories:${q.loader}`])
  else if (q.kind === 'modpack') facets.push(MODPACK_LOADERS.map((l) => `categories:${l}`))
  const params = new URLSearchParams({
    query: q.query,
    index: q.sort,
    offset: String(q.offset),
    limit: String(PAGE_SIZE),
    facets: JSON.stringify(facets)
  })
  const res = await fetchJson<{ hits: RawHit[]; total_hits: number; offset: number; limit: number }>(
    `${API}/search?${params}`
  )
  const local = q.kind === 'mod' && q.offset === 0 ? localHits(q.query) : []
  return {
    hits: [
      ...local,
      ...res.hits.map(
      (h): StoreHit => ({
        id: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        author: h.author,
        iconUrl: h.icon_url ?? undefined,
        downloads: h.downloads,
        follows: h.follows,
        categories: h.display_categories ?? []
      })
      )
    ],
    total: res.total_hits + local.length,
    offset: res.offset,
    limit: res.limit
  }
}

export async function getProject(id: string): Promise<StoreProject> {
  if (isLocalMod(id)) return localProject(id)
  const p = await fetchJson<RawProject>(`${API}/project/${encodeURIComponent(id)}`)
  return {
    id: p.id,
    slug: p.slug,
    kind: (['resourcepack', 'shader', 'modpack'] as const).find((k) => k === p.project_type) ?? 'mod',
    title: p.title,
    description: p.description,
    body: p.body,
    iconUrl: p.icon_url ?? undefined,
    downloads: p.downloads,
    follows: p.followers,
    license: p.license?.id,
    sourceUrl: p.source_url ?? undefined,
    issuesUrl: p.issues_url ?? undefined,
    wikiUrl: p.wiki_url ?? undefined,
    gallery: [...p.gallery]
      .sort((a, b) => a.ordering - b.ordering)
      .map((g) => ({ url: g.url, title: g.title ?? undefined })),
    updatedAt: p.updated
  }
}

export const fetchVersions = (projectId: string, gameVersion?: string, loader?: string): Promise<RawVersion[]> => {
  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  if (loader) params.set('loaders', JSON.stringify([loader]))
  return fetchJson<RawVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`)
}

export async function getProjectVersions(projectId: string, gameVersion?: string, loader?: string): Promise<StoreVersion[]> {
  if (isLocalMod(projectId)) return localVersions(projectId, gameVersion, loader)
  const versions = await fetchVersions(projectId, gameVersion, loader)
  return versions.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    type: v.version_type,
    publishedAt: v.date_published,
    downloads: v.downloads
  }))
}

interface InstallOutcome {
  installed: string[]
  skippedDependencies: string[]
}

export async function installFromStore(
  instanceId: string,
  kind: ContentKind,
  projectId: string,
  versionId?: string
): Promise<InstallOutcome> {
  if (isLocalMod(projectId)) {
    assertLocalFits(instanceId, projectId)
    const dependency = await installFromStore(instanceId, 'mod', 'fabric-api')
    const title = await installLocal(instanceId, projectId)
    return { installed: [title, ...dependency.installed], skippedDependencies: dependency.skippedDependencies }
  }
  const instance = getInstance(instanceId)
  if (kind === 'mod' && instance.loader === 'vanilla') {
    throw new Error('В ванильной сборке нет загрузчика модов. Создайте сборку с Fabric или Forge.')
  }
  const loader = kind === 'mod' ? instance.loader : undefined
  const outcome: InstallOutcome = { installed: [], skippedDependencies: [] }
  const visited = new Set<string>()
  const task = new Task('Установка из магазина')

  const installOne = async (pid: string, vid: string | undefined, isDependency: boolean): Promise<void> => {
    if (visited.has(pid)) return
    visited.add(pid)

    const project = await fetchJson<RawProject>(`${API}/project/${encodeURIComponent(pid)}`)
    let version: RawVersion | undefined
    if (vid) {
      version = await fetchJson<RawVersion>(`${API}/version/${encodeURIComponent(vid)}`)
    } else {
      const list = await fetchVersions(pid, instance.mcVersion, loader)
      version = list.find((v) => v.version_type === 'release') ?? list[0]
    }
    if (!version) {
      if (isDependency) {
        outcome.skippedDependencies.push(project.title)
        return
      }
      throw new Error(`У «${project.title}» нет файлов для ${instance.mcVersion}${loader ? ` / ${loader}` : ''}`)
    }

    const file = version.files.find((f) => f.primary) ?? version.files[0]
    if (!file) throw new Error(`В версии ${version.version_number} нет файлов`)
    const name = basename(file.filename)
    const dir = contentDir(instance, kind)

    for (const old of filesOfProject(instanceId, project.id)) {
      if (old === name) continue
      await rm(join(dir, basename(old)), { force: true })
      await rm(join(dir, `${basename(old)}.disabled`), { force: true })
      forgetContent(instanceId, old)
    }

    task.stage(project.title)
    await download(file.url, join(dir, name), {
      checksum: file.hashes.sha512
        ? { algo: 'sha512', value: file.hashes.sha512 }
        : file.hashes.sha1
          ? { algo: 'sha1', value: file.hashes.sha1 }
          : undefined,
      onBytes: (received, total) => task.progress(received, total)
    })
    recordContent(instanceId, name, {
      title: project.title,
      iconUrl: project.icon_url ?? undefined,
      projectId: project.id,
      versionId: version.id,
      versionNumber: version.version_number
    })
    outcome.installed.push(project.title)

    if (kind !== 'mod') return
    for (const dep of version.dependencies.filter((d) => d.dependency_type === 'required')) {
      let depProject = dep.project_id
      if (!depProject && dep.version_id) {
        depProject = (await fetchJson<RawVersion>(`${API}/version/${dep.version_id}`)).project_id
      }
      if (!depProject) continue
      try {
        await installOne(depProject, dep.version_id ?? undefined, true)
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e
        outcome.skippedDependencies.push(depProject)
      }
    }
  }

  try {
    await installOne(projectId, versionId, false)
    task.finish()
    return outcome
  } catch (e) {
    task.fail(e)
    throw e
  }
}
