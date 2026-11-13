import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { McVersion } from '../../shared/types'
import { paths } from '../config'
import type { Task } from '../events'
import { Checksum, download, fetchJson, fileMatches, pool } from '../net'
import { libraryFiles, libraryKey, LibraryFile, RawLibrary, Rule } from './library'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FIRST_SUPPORTED = '1.16.5'
const EXPERIMENTAL_OLD = new Set(['20w14infinite'])
const CONCURRENCY = 16

interface ManifestEntry extends McVersion {
  url: string
  sha1: string
}

export type ArgValue = string | { rules?: Rule[]; value: string | string[] }

export interface VersionJson {
  id: string
  type: string
  inheritsFrom?: string
  jar?: string
  mainClass: string
  javaVersion?: { majorVersion: number }
  arguments?: { game?: ArgValue[]; jvm?: ArgValue[] }
  libraries: RawLibrary[]
  assets?: string
  assetIndex?: { id: string; url: string; sha1: string; size: number }
  downloads?: { client?: { url: string; sha1: string; size: number }; server?: { url: string; sha1: string; size: number } }
  logging?: { client?: { argument: string; file: { id: string; url: string; sha1: string; size: number } } }
}

let manifestCache: ManifestEntry[] | null = null

async function loadManifest(): Promise<ManifestEntry[]> {
  if (manifestCache) return manifestCache
  const cache = join(paths.versions(), 'manifest.json')
  let versions: ManifestEntry[]
  try {
    versions = (await fetchJson<{ versions: ManifestEntry[] }>(MANIFEST_URL)).versions
    await mkdir(dirname(cache), { recursive: true })
    await writeFile(cache, JSON.stringify(versions))
  } catch (e) {
    if (!existsSync(cache)) throw e
    versions = JSON.parse(await readFile(cache, 'utf8'))
  }
  const limit = versions.find((v) => v.id === FIRST_SUPPORTED)?.releaseTime
  if (!limit) throw new Error(`В манифесте нет версии ${FIRST_SUPPORTED}`)
  manifestCache = versions.filter((v) => v.releaseTime >= limit || EXPERIMENTAL_OLD.has(v.id))
  return manifestCache
}

export const listVersions = async (): Promise<McVersion[]> =>
  (await loadManifest()).filter((v) => !EXPERIMENTAL_OLD.has(v.id)).map(({ id, type, releaseTime }) => ({ id, type, releaseTime }))

export const readVersionJson = async (id: string): Promise<VersionJson> =>
  JSON.parse(await readFile(paths.versionJson(id), 'utf8'))

export async function resolveVersion(id: string): Promise<VersionJson> {
  const child = await readVersionJson(id)
  if (!child.inheritsFrom) return child
  const parent = await resolveVersion(child.inheritsFrom)
  const seen = new Set<string>()
  const libraries = [...child.libraries, ...parent.libraries].filter((lib) => {
    const key = libraryKey(lib)
    if (lib.rules?.length) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    ...parent,
    ...child,
    libraries,
    jar: child.jar ?? parent.jar ?? parent.id,
    assets: child.assets ?? parent.assets,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    downloads: child.downloads ?? parent.downloads,
    logging: child.logging ?? parent.logging,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    arguments: child.arguments || parent.arguments
      ? {
          game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
          jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])]
        }
      : undefined
  }
}

const sha1Of = async (path: string): Promise<string> =>
  createHash('sha1').update(await readFile(path)).digest('hex')

interface Job {
  dest: string
  urls: string[]
  checksum?: Checksum
  size?: number
}

export async function fetchMissing(jobs: Job[], task: Task, label: string, verify = false): Promise<void> {
  const pending: Job[] = []
  for (const job of jobs) {
    let ok = await fileMatches(job.dest, job.size)
    if (ok && verify && job.checksum?.algo === 'sha1') ok = (await sha1Of(job.dest)) === job.checksum.value
    if (!ok) pending.push(job)
  }
  if (!pending.length) return
  task.stage(label, pending.length)
  let done = 0
  await pool(pending, CONCURRENCY, async (job) => {
    if (!job.urls.length) throw new Error(`Файл не удалось получить: ${job.dest}`)
    await download(job.urls, job.dest, { checksum: job.checksum })
    task.progress(++done)
  })
}

const libraryJob = (file: LibraryFile): Job => ({
  dest: file.dest,
  urls: file.urls,
  size: file.size,
  checksum: file.sha1 ? { algo: 'sha1', value: file.sha1 } : undefined
})

export const fetchLibraries = async (libs: RawLibrary[], task: Task, verify = false): Promise<void> =>
  fetchMissing(
    libs.flatMap(libraryFiles).map(libraryJob).filter((job) => job.urls.length),
    task,
    'Библиотеки',
    verify
  )

async function installAssets(version: VersionJson, task: Task, verify: boolean): Promise<void> {
  const index = version.assetIndex
  if (!index) return
  const indexPath = join(paths.assets(), 'indexes', `${index.id}.json`)
  await fetchMissing(
    [{ dest: indexPath, urls: [index.url], size: index.size, checksum: { algo: 'sha1', value: index.sha1 } }],
    task,
    'Индекс ресурсов'
  )
  const data = JSON.parse(await readFile(indexPath, 'utf8')) as { objects: Record<string, { hash: string; size: number }> }
  const objectPath = (hash: string): string => join(paths.assets(), 'objects', hash.slice(0, 2), hash)
  await fetchMissing(
    Object.values(data.objects).map(({ hash, size }) => ({
      dest: objectPath(hash),
      urls: [`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`],
      size,
      checksum: { algo: 'sha1' as const, value: hash }
    })),
    task,
    'Ресурсы игры',
    verify
  )
}

export async function ensureVersionJson(id: string, task: Task): Promise<void> {
  if (existsSync(paths.versionJson(id))) return
  const entry = (await loadManifest()).find((v) => v.id === id)
  if (!entry) throw new Error(`Версия ${id} не поддерживается`)
  await fetchMissing([{ dest: paths.versionJson(id), urls: [entry.url], checksum: { algo: 'sha1', value: entry.sha1 } }], task, `Описание версии ${id}`)
}

export async function installVanilla(id: string, task: Task, verify = false): Promise<void> {
  if (verify || !existsSync(paths.versionJson(id))) {
    const entry = (await loadManifest()).find((v) => v.id === id)
    if (!entry) throw new Error(`Версия ${id} не поддерживается`)
    await fetchMissing(
      [{ dest: paths.versionJson(id), urls: [entry.url], checksum: { algo: 'sha1', value: entry.sha1 } }],
      task,
      `Описание версии ${id}`,
      verify
    )
  }
  const version = await readVersionJson(id)
  const jobs: Job[] = []
  const client = version.downloads?.client
  if (client) {
    jobs.push({
      dest: paths.versionJar(id),
      urls: [client.url],
      size: client.size,
      checksum: { algo: 'sha1', value: client.sha1 }
    })
  }
  const log = version.logging?.client?.file
  if (log) {
    jobs.push({
      dest: join(paths.assets(), 'log_configs', log.id),
      urls: [log.url],
      size: log.size,
      checksum: { algo: 'sha1', value: log.sha1 }
    })
  }
  await fetchMissing(jobs, task, `Клиент ${id}`, verify)
  await fetchLibraries(version.libraries, task, verify)
  await installAssets(version, task, verify)
}

export async function extractNatives(versionId: string, libs: RawLibrary[]): Promise<string> {
  const dir = join(paths.versionDir(versionId), 'natives')
  const marker = join(dir, '.extracted')
  if (existsSync(marker)) return dir
  await mkdir(dir, { recursive: true })
  const root = resolve(dir)
  for (const file of libs.flatMap(libraryFiles).filter((f) => f.native)) {
    const exclude = file.exclude ?? []
    for (const entry of new AdmZip(file.dest).getEntries()) {
      if (entry.isDirectory || exclude.some((prefix) => entry.entryName.startsWith(prefix))) continue
      const dest = resolve(root, entry.entryName)
      if (relative(root, dest).startsWith(`..${sep}`)) continue
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, entry.getData())
    }
  }
  await writeFile(marker, '')
  return dir
}
