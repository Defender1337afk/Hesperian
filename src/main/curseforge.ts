import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ContentKind, StoreHit, StoreKind, StoreProject, StoreQuery, StoreResult, StoreVersion } from '../shared/types'
import { getSettings } from './config'
import { contentDir, filesOfProject, forgetContent, recordContent } from './content'
import { Task } from './events'
import { getInstance } from './instances'
import { download, fetchJson, HttpError } from './net'

const API = 'https://api.curseforge.com/v1'
const GAME = 432
const PAGE_SIZE = 20
export const PREFIX = 'cf:'

const CLASS: Record<StoreKind, number> = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 }
const KIND_OF: Record<number, StoreKind> = { 6: 'mod', 12: 'resourcepack', 6552: 'shader', 4471: 'modpack' }
const LOADER: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const SORT: Record<StoreQuery['sort'], number> = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 }
const RELEASE: Record<number, string> = { 1: 'release', 2: 'beta', 3: 'alpha' }
const LOADER_TAGS = new Set(['Forge', 'Fabric', 'Quilt', 'NeoForge'])

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  classId: number
  downloadCount: number
  thumbsUpCount: number
  logo: { thumbnailUrl?: string; url?: string } | null
  authors: { name: string }[]
  categories: { name: string }[]
  links: { websiteUrl?: string; sourceUrl?: string | null; issuesUrl?: string | null; wikiUrl?: string | null }
  screenshots: { title?: string; url: string }[]
  dateModified: string
  allowModDistribution?: boolean | null
}

interface CfFile {
  id: number
  modId: number
  displayName: string
  fileName: string
  releaseType: number
  fileDate: string
  downloadCount: number
  downloadUrl: string | null
  gameVersions: string[]
  hashes: { value: string; algo: number }[]
  dependencies: { modId: number; relationType: number }[]
}

const external: string | undefined = Object.values(
  import.meta.glob<{ curseforgeKey?: string }>('./private/*.ts', { eager: true })
).find((m) => m.curseforgeKey)?.curseforgeKey

export const curseforgeKey = (): string => getSettings().cfApiKey?.trim() || external || ''
export const curseforgeAvailable = (): boolean => Boolean(curseforgeKey())

const cfId = (id: string): string => id.slice(PREFIX.length)
export const isCurseforge = (id: string): boolean => id.startsWith(PREFIX)

const NO_KEY = 'CurseForge недоступен в этой сборке лаунчера. Пока можно ставить моды с Modrinth.'
const BLOCKED = 'CurseForge сейчас не отвечает. Попробуйте позже, а пока можно ставить моды с Modrinth.'

async function request<T>(url: string): Promise<T> {
  const key = curseforgeKey()
  if (!key) throw new Error(NO_KEY)
  try {
    return await fetchJson<T>(url, { headers: { 'x-api-key': key, Accept: 'application/json' } })
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) throw new Error(BLOCKED)
    throw e
  }
}

async function cf<T>(path: string): Promise<T> {
  return (await request<{ data: T }>(`${API}${path}`)).data
}

const toHit = (m: CfMod): StoreHit => ({
  id: PREFIX + m.id,
  slug: m.slug,
  title: m.name,
  description: m.summary,
  author: m.authors[0]?.name ?? '',
  iconUrl: m.logo?.thumbnailUrl || m.logo?.url || undefined,
  downloads: m.downloadCount,
  follows: m.thumbsUpCount,
  categories: m.categories.map((c) => c.name).slice(0, 3)
})

export async function searchCurseforge(q: StoreQuery): Promise<StoreResult> {
  const params = new URLSearchParams({
    gameId: String(GAME),
    classId: String(CLASS[q.kind]),
    searchFilter: q.query,
    sortField: String(SORT[q.sort]),
    sortOrder: 'desc',
    index: String(q.offset),
    pageSize: String(PAGE_SIZE)
  })
  if (q.gameVersions.length === 1) params.set('gameVersion', q.gameVersions[0])
  if (q.loader && (q.kind === 'mod' || q.kind === 'modpack')) params.set('modLoaderType', String(LOADER[q.loader]))
  const res = await request<{ data: CfMod[]; pagination: { index: number; pageSize: number; totalCount: number } }>(`${API}/mods/search?${params}`)
  return { hits: res.data.map(toHit), total: Math.min(res.pagination.totalCount, 10000), offset: res.pagination.index, limit: res.pagination.pageSize }
}

export async function getCurseforgeProject(id: string): Promise<StoreProject> {
  const [m, body] = await Promise.all([cf<CfMod>(`/mods/${cfId(id)}`), cf<string>(`/mods/${cfId(id)}/description`).catch(() => '')])
  return {
    id,
    slug: m.slug,
    kind: KIND_OF[m.classId] ?? 'mod',
    title: m.name,
    description: m.summary,
    body,
    iconUrl: m.logo?.thumbnailUrl || m.logo?.url || undefined,
    downloads: m.downloadCount,
    follows: m.thumbsUpCount,
    sourceUrl: m.links.sourceUrl ?? undefined,
    issuesUrl: m.links.issuesUrl ?? undefined,
    wikiUrl: m.links.wikiUrl ?? m.links.websiteUrl ?? undefined,
    gallery: m.screenshots.map((s) => ({ url: s.url, title: s.title || undefined })),
    updatedAt: m.dateModified
  }
}

async function files(id: string, gameVersion?: string, loader?: string): Promise<CfFile[]> {
  const params = new URLSearchParams({ pageSize: '50' })
  if (gameVersion) params.set('gameVersion', gameVersion)
  if (loader && LOADER[loader]) params.set('modLoaderType', String(LOADER[loader]))
  return cf<CfFile[]>(`/mods/${cfId(id)}/files?${params}`)
}

const fileLoaders = (f: CfFile): string[] =>
  f.gameVersions.filter((v) => LOADER_TAGS.has(v)).map((v) => v.toLowerCase())

export async function getCurseforgeVersions(id: string, gameVersion?: string, loader?: string): Promise<StoreVersion[]> {
  return (await files(id, gameVersion, loader)).map((f) => ({
    id: String(f.id),
    name: f.displayName,
    versionNumber: f.displayName,
    gameVersions: f.gameVersions.filter((v) => /^\d/.test(v)),
    loaders: fileLoaders(f),
    type: RELEASE[f.releaseType] ?? 'release',
    publishedAt: f.fileDate,
    downloads: f.downloadCount
  }))
}

const sha1 = (f: CfFile): string | undefined => f.hashes.find((h) => h.algo === 1)?.value

export async function installFromCurseforge(
  instanceId: string,
  kind: ContentKind,
  projectId: string,
  versionId?: string
): Promise<{ installed: string[]; skippedDependencies: string[] }> {
  const instance = getInstance(instanceId)
  if (kind === 'mod' && instance.loader === 'vanilla') {
    throw new Error('В ванильной сборке нет загрузчика модов. Создайте сборку с Fabric или Forge.')
  }
  const loader = kind === 'mod' ? instance.loader : undefined
  const outcome = { installed: [] as string[], skippedDependencies: [] as string[] }
  const visited = new Set<string>()
  const task = new Task('Установка с CurseForge')

  const one = async (pid: string, fid: string | undefined, dependency: boolean): Promise<void> => {
    if (visited.has(pid)) return
    visited.add(pid)
    const mod = await cf<CfMod>(`/mods/${cfId(pid)}`)
    let file: CfFile | undefined
    if (fid) file = await cf<CfFile>(`/mods/${cfId(pid)}/files/${fid}`)
    else {
      const list = (await files(pid, instance.mcVersion, loader)).sort((a, b) => b.fileDate.localeCompare(a.fileDate))
      file = list.find((f) => f.releaseType === 1) ?? list[0]
    }
    if (!file) {
      if (dependency) {
        outcome.skippedDependencies.push(mod.name)
        return
      }
      throw new Error(`У «${mod.name}» нет файлов для ${instance.mcVersion}${loader ? ` / ${loader}` : ''}`)
    }
    if (!file.downloadUrl) {
      if (dependency) {
        outcome.skippedDependencies.push(`${mod.name} (скачайте вручную)`)
        return
      }
      throw new Error(`Автор «${mod.name}» запретил скачивание через сторонние лаунчеры. Скачайте файл со страницы мода и перетащите его в окно Hesperian.`)
    }
    const name = basename(file.fileName)
    const dir = contentDir(instance, kind)
    for (const old of filesOfProject(instanceId, pid)) {
      if (old === name) continue
      await rm(join(dir, basename(old)), { force: true })
      await rm(join(dir, `${basename(old)}.disabled`), { force: true })
      forgetContent(instanceId, old)
    }
    task.stage(mod.name)
    const hash = sha1(file)
    await download(file.downloadUrl, join(dir, name), {
      checksum: hash ? { algo: 'sha1', value: hash } : undefined,
      onBytes: (received, total) => task.progress(received, total)
    })
    recordContent(instanceId, name, {
      title: mod.name,
      iconUrl: mod.logo?.thumbnailUrl || undefined,
      projectId: pid,
      versionId: String(file.id),
      versionNumber: file.displayName
    })
    outcome.installed.push(mod.name)
    if (kind !== 'mod') return
    for (const dep of file.dependencies.filter((d) => d.relationType === 3)) {
      await one(PREFIX + dep.modId, undefined, true).catch(() => {
        outcome.skippedDependencies.push(String(dep.modId))
      })
    }
  }

  try {
    await one(projectId, versionId, false)
    task.finish()
    return outcome
  } catch (e) {
    task.fail(e)
    throw e
  }
}

