import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentKind, ContentUpdate } from '../shared/types'
import { contentDir, filesOfProject, forgetContent, readContentMeta, setContentEnabled } from './content'
import { getInstance } from './instances'
import { hashFile } from './modpacks'
import { API, installFromStore, type RawProject, type RawVersion } from './modrinth'
import { fetchJson, postJson } from './net'
import { installLocal, isLocalMod, localUpdates } from './localmods'

const DISABLED = '.disabled'
const KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader']

const loadersFor = (kind: ContentKind, loader: string): string[] =>
  kind === 'mod' ? [loader] : kind === 'resourcepack' ? ['minecraft'] : ['iris', 'optifine', 'canvas', 'vanilla']

export async function checkUpdates(instanceId: string, kinds: ContentKind[] = KINDS): Promise<ContentUpdate[]> {
  const instance = getInstance(instanceId)
  if (instance.loader === 'vanilla') kinds = kinds.filter((k) => k !== 'mod')
  const meta = readContentMeta(instanceId)
  const found: (ContentUpdate & { projectId: string })[] = []
  const local = kinds.includes('mod') ? await localUpdates(instanceId) : []
  const localFiles = new Set(local.map((u) => u.file))

  for (const kind of kinds) {
    const dir = contentDir(instance, kind)
    if (!existsSync(dir)) continue
    const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.endsWith('.part'))
    if (!files.length) continue
    const bySha = new Map<string, string>()
    for (const entry of files) {
      const file = entry.name.endsWith(DISABLED) ? entry.name.slice(0, -DISABLED.length) : entry.name
      bySha.set(await hashFile(join(dir, entry.name), 'sha1'), file)
    }
    const latest = await postJson<Record<string, RawVersion>>(`${API}/version_files/update`, {
      hashes: [...bySha.keys()],
      algorithm: 'sha1',
      loaders: loadersFor(kind, instance.loader),
      game_versions: [instance.mcVersion]
    })
    for (const [sha1, version] of Object.entries(latest)) {
      if (version.files.some((f) => f.hashes.sha1 === sha1)) continue
      const file = bySha.get(sha1)!
      if (localFiles.has(file)) continue
      found.push({
        kind,
        file,
        title: meta[file]?.title ?? file,
        iconUrl: meta[file]?.iconUrl,
        projectId: version.project_id,
        fromVersion: meta[file]?.versionNumber,
        toVersionId: version.id,
        toVersionNumber: version.version_number
      })
    }
  }

  const unnamed = [...new Set(found.filter((u) => !meta[u.file]).map((u) => u.projectId))]
  if (unnamed.length) {
    const projects = await fetchJson<RawProject[]>(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(unnamed))}`).catch(() => [])
    for (const u of found) {
      const p = projects.find((x) => x.id === u.projectId)
      if (p && !meta[u.file]) Object.assign(u, { title: p.title, iconUrl: p.icon_url ?? undefined })
    }
  }
  return [...local, ...found].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

export async function applyUpdate(instanceId: string, update: ContentUpdate): Promise<void> {
  if (isLocalMod(update.projectId)) {
    await installLocal(instanceId, update.projectId)
    return
  }
  const instance = getInstance(instanceId)
  const dir = contentDir(instance, update.kind)
  const wasDisabled = existsSync(join(dir, update.file + DISABLED)) && !existsSync(join(dir, update.file))
  await installFromStore(instanceId, update.kind, update.projectId, update.toVersionId)
  const [current] = filesOfProject(instanceId, update.projectId)
  if (current !== update.file) {
    for (const old of [update.file, update.file + DISABLED]) await rm(join(dir, old), { force: true })
    forgetContent(instanceId, update.file)
  }
  if (wasDisabled && current) await setContentEnabled(instanceId, update.kind, current, false)
}
