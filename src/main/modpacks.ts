import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ContentKind, Instance, LoaderType, ModpackInfo } from '../shared/types'
import { paths } from './config'
import { type ContentMeta, recordContentBatch } from './content'
import { Task } from './events'
import { createInstance, getInstance, updateInstance } from './instances'
import { pickLoaderVersion } from './minecraft/launch'
import { listVersions } from './minecraft/vanilla'
import { API, fetchVersions, type RawProject, type RawVersion } from './modrinth'
import { download, fetchJson, pool, postJson } from './net'

interface MrpackFile {
  path: string
  hashes: { sha1: string; sha512: string }
  env?: { client?: 'required' | 'optional' | 'unsupported'; server?: 'required' | 'optional' | 'unsupported' }
  downloads: string[]
  fileSize: number
}

interface MrpackIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

const ALLOWED_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'])

const LOADER_KEYS: Record<string, Exclude<LoaderType, 'vanilla'>> = {
  'fabric-loader': 'fabric',
  forge: 'forge',
  neoforge: 'neoforge'
}
const DEPENDENCY_KEY: Record<Exclude<LoaderType, 'vanilla'>, string> = {
  fabric: 'fabric-loader',
  forge: 'forge',
  neoforge: 'neoforge'
}

const COLORS = ['#5fbf7f', '#3fb6a8', '#4f9fe0', '#8d7be6', '#d66a9f', '#e0705a', '#d9a441']
const DOWNLOAD_CONCURRENCY = 8
const EXPORT_FOLDERS = ['config', 'defaultconfigs', 'kubejs', 'scripts']

const CONTENT_FOLDERS: Record<string, ContentKind> = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader' }

function insideGame(gameDir: string, path: string): string {
  const root = resolve(gameDir)
  const dest = resolve(root, path)
  if (!path || path.includes('\0') || dest === root || !dest.startsWith(root + sep)) {
    throw new Error(`Модпак содержит недопустимый путь: ${path}`)
  }
  return dest
}

function checkUrls(urls: string[], path: string): string[] {
  const allowed = urls.filter((url) => {
    try {
      const u = new URL(url)
      return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname)
    } catch {
      return false
    }
  })
  if (!allowed.length) throw new Error(`Для ${path} нет ссылки с разрешённого сайта (Modrinth, GitHub, GitLab)`)
  return allowed
}

function readIndex(zip: AdmZip): MrpackIndex {
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry) throw new Error('Это не модпак Modrinth: внутри нет modrinth.index.json')
  const index = JSON.parse(entry.getData().toString('utf8')) as MrpackIndex
  if (index.game !== 'minecraft' || !index.dependencies?.minecraft || !Array.isArray(index.files)) {
    throw new Error('Модпак повреждён или сделан не для Minecraft')
  }
  return index
}

function loaderOf(index: MrpackIndex): { loader: LoaderType; loaderVersion?: string } {
  const deps = Object.keys(index.dependencies).filter((k) => k !== 'minecraft')
  if (!deps.length) return { loader: 'vanilla' }
  const key = deps.find((k) => k in LOADER_KEYS)
  if (!key) throw new Error(`Hesperian не поддерживает загрузчик ${deps.join(', ')}. Подойдут модпаки на Fabric, Forge и NeoForge.`)
  return { loader: LOADER_KEYS[key], loaderVersion: index.dependencies[key] }
}

async function describeFiles(files: MrpackFile[]): Promise<Record<string, ContentMeta>> {
  const content = files.filter((f) => f.path.split('/')[0] in CONTENT_FOLDERS)
  if (!content.length) return {}
  const versions = await postJson<Record<string, RawVersion>>(`${API}/version_files`, {
    hashes: content.map((f) => f.hashes.sha512),
    algorithm: 'sha512'
  }).catch(() => ({}) as Record<string, RawVersion>)
  const projectIds = [...new Set(Object.values(versions).map((v) => v.project_id))]
  const projects = new Map<string, RawProject>()
  for (let i = 0; i < projectIds.length; i += 100) {
    const chunk = projectIds.slice(i, i + 100)
    const list = await fetchJson<RawProject[]>(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`).catch(() => [])
    for (const p of list) projects.set(p.id, p)
  }
  const meta: Record<string, ContentMeta> = {}
  for (const file of content) {
    const version = versions[file.hashes.sha512]
    const project = version && projects.get(version.project_id)
    if (!version || !project) continue
    meta[file.path.split('/').pop()!] = {
      title: project.title,
      iconUrl: project.icon_url ?? undefined,
      projectId: project.id,
      versionId: version.id,
      versionNumber: version.version_number
    }
  }
  return meta
}

async function installArchive(archive: string, info: Partial<ModpackInfo>, task: Task): Promise<Instance> {
  const zip = new AdmZip(archive)
  const index = readIndex(zip)
  const mcVersion = index.dependencies.minecraft
  const { loader, loaderVersion } = loaderOf(index)
  if (!(await listVersions()).some((v) => v.id === mcVersion)) {
    throw new Error(`Модпак сделан для Minecraft ${mcVersion}, а Hesperian поддерживает версии от 1.16.5`)
  }

  const instance = await createInstance({
    name: info.title ?? index.name,
    mcVersion,
    loader,
    loaderVersion,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    group: 'Модпаки'
  })
  const gameDir = paths.gameDir(instance.id)
  try {
    const files = index.files.filter((f) => f.env?.client !== 'unsupported')
    const jobs = files.map((f) => ({ file: f, dest: insideGame(gameDir, f.path), urls: checkUrls(f.downloads ?? [], f.path) }))
    const totalBytes = jobs.reduce((sum, j) => sum + (j.file.fileSize || 0), 0)
    let doneBytes = 0
    let doneFiles = 0
    task.stage(`Файлы модпака: 0 из ${jobs.length}`, totalBytes)
    await pool(jobs, DOWNLOAD_CONCURRENCY, async (job) => {
      let counted = 0
      await download(job.urls, job.dest, {
        checksum: { algo: 'sha512', value: job.file.hashes.sha512 },
        onBytes: (received) => {
          if (received < counted) counted = 0
          doneBytes += received - counted
          counted = received
          task.progress(doneBytes, totalBytes)
        }
      })
      doneFiles++
      task.stage(`Файлы модпака: ${doneFiles} из ${jobs.length}`, totalBytes)
      task.progress(doneBytes, totalBytes)
    })

    task.stage('Настройки модпака')
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue
        const dest = insideGame(gameDir, entry.entryName.slice(prefix.length))
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, entry.getData())
      }
    }

    task.stage('Описание модов')
    recordContentBatch(instance.id, await describeFiles(files))

    const modpack: ModpackInfo = {
      title: info.title ?? index.name,
      versionNumber: info.versionNumber ?? index.versionId,
      projectId: info.projectId,
      versionId: info.versionId,
      iconUrl: info.iconUrl
    }
    return updateInstance(instance.id, { modpack, notes: index.summary })
  } catch (e) {
    await rm(paths.instanceDir(instance.id), { recursive: true, force: true }).catch(() => {})
    throw e
  }
}

export async function installModpack(projectId: string, versionId?: string): Promise<Instance> {
  const project = await fetchJson<RawProject>(`${API}/project/${encodeURIComponent(projectId)}`)
  const task = new Task(`Модпак: ${project.title}`)
  const archive = join(tmpdir(), `hesperian-${project.id}-${Date.now()}.mrpack`)
  try {
    let version: RawVersion | undefined
    if (versionId) {
      version = await fetchJson<RawVersion>(`${API}/version/${encodeURIComponent(versionId)}`)
    } else {
      const list = (await fetchVersions(project.id)).filter((v) => v.loaders.some((l) => Object.values(LOADER_KEYS).includes(l as never)))
      version = list.find((v) => v.version_type === 'release') ?? list[0]
    }
    if (!version || version.project_id !== project.id) throw new Error(`У «${project.title}» нет версий для Fabric, Forge или NeoForge`)
    const file = version.files.find((f) => f.primary && f.filename.endsWith('.mrpack')) ?? version.files.find((f) => f.filename.endsWith('.mrpack'))
    if (!file) throw new Error(`В версии ${version.version_number} нет файла .mrpack`)

    task.stage(`Скачивание ${file.filename}`, file.size ?? 0)
    await download(file.url, archive, {
      checksum: file.hashes.sha512 ? { algo: 'sha512', value: file.hashes.sha512 } : undefined,
      onBytes: (received, total) => task.progress(received, total)
    })
    const instance = await installArchive(
      archive,
      { title: project.title, projectId: project.id, versionId: version.id, versionNumber: version.version_number, iconUrl: project.icon_url ?? undefined },
      task
    )
    task.finish()
    return instance
  } catch (e) {
    task.fail(e)
    throw e
  } finally {
    await rm(archive, { force: true }).catch(() => {})
  }
}

export async function importModpack(path: string): Promise<Instance> {
  const task = new Task('Импорт модпака')
  try {
    const instance = await installArchive(path, {}, task)
    task.finish()
    return instance
  } catch (e) {
    task.fail(e)
    throw e
  }
}

export const hashFile = (path: string, algo: 'sha1' | 'sha512'): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const hash = createHash(algo)
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')))
  })

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

export async function exportModpack(instanceId: string, dest: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (instance.engine) throw new Error('Сборку на стороннем движке нельзя сохранить как модпак')
  const task = new Task(`Экспорт: ${instance.name}`)
  try {
    const gameDir = paths.gameDir(instanceId)
    const candidates: string[] = []
    for (const folder of Object.keys(CONTENT_FOLDERS)) {
      const dir = join(gameDir, folder)
      if (!existsSync(dir)) continue
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isFile() && !entry.name.endsWith('.disabled') && !entry.name.endsWith('.part')) candidates.push(join(dir, entry.name))
      }
    }

    task.stage('Контрольные суммы', candidates.length)
    const hashed: { path: string; sha1: string; sha512: string; size: number }[] = []
    for (const path of candidates) {
      hashed.push({ path, sha1: await hashFile(path, 'sha1'), sha512: await hashFile(path, 'sha512'), size: (await stat(path)).size })
      task.progress(hashed.length)
    }

    task.stage('Поиск файлов на Modrinth')
    const known = hashed.length
      ? await postJson<Record<string, RawVersion>>(`${API}/version_files`, { hashes: hashed.map((h) => h.sha512), algorithm: 'sha512' })
      : {}

    const files: MrpackFile[] = []
    const zip = new AdmZip()
    for (const h of hashed) {
      const rel = relative(gameDir, h.path).split(sep).join('/')
      const remote = known[h.sha512]?.files.find((f) => f.hashes.sha512 === h.sha512)
      if (remote) {
        const clientOnly = rel.startsWith('resourcepacks/') || rel.startsWith('shaderpacks/')
        files.push({
          path: rel,
          hashes: { sha1: h.sha1, sha512: h.sha512 },
          env: { client: 'required', server: clientOnly ? 'unsupported' : 'required' },
          downloads: [remote.url],
          fileSize: h.size
        })
      } else {
        zip.addLocalFile(h.path, `overrides/${dirname(rel)}`)
      }
    }
    for (const folder of EXPORT_FOLDERS) {
      for (const path of await walk(join(gameDir, folder))) {
        zip.addLocalFile(path, `overrides/${dirname(relative(gameDir, path)).split(sep).join('/')}`)
      }
    }

    const dependencies: Record<string, string> = { minecraft: instance.mcVersion }
    if (instance.loader !== 'vanilla') {
      dependencies[DEPENDENCY_KEY[instance.loader]] = await pickLoaderVersion(instance, instance.loader)
    }
    const index: MrpackIndex = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: instance.modpack?.versionNumber ?? '1.0.0',
      name: instance.name,
      summary: instance.notes || undefined,
      files,
      dependencies
    }
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)))

    task.stage('Запись архива')
    await mkdir(dirname(dest), { recursive: true })
    await zip.writeZipPromise(dest)
    task.finish()
  } catch (e) {
    task.fail(e)
    throw e
  }
}
