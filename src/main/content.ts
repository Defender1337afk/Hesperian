import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ContentItem, ContentKind, Instance } from '../shared/types'
import { paths, readJsonSync, writeJsonSync } from './config'
import { assertId, getInstance } from './instances'

export interface ContentMeta {
  title: string
  iconUrl?: string
  projectId: string
  versionId: string
  versionNumber: string
}

type MetaFile = Record<string, ContentMeta>

const DISABLED = '.disabled'
const metaPath = (id: string): string => join(paths.instanceDir(id), 'content.json')

export function contentDir(instance: Instance, kind: ContentKind): string {
  const game = paths.gameDir(instance.id)
  if (kind === 'mod') return join(game, 'mods')
  if (kind === 'shader') return join(game, 'shaderpacks')
  return join(game, 'resourcepacks')
}

const prettify = (file: string): string =>
  file.replace(/\.(jar|zip|litemod)$/i, '').replace(/[-_]+/g, ' ')

export async function listContent(id: string, kind: ContentKind): Promise<ContentItem[]> {
  const instance = getInstance(id)
  const dir = contentDir(instance, kind)
  if (!existsSync(dir)) return []
  const meta = readJsonSync<MetaFile>(metaPath(id), {})
  const entries = await readdir(dir, { withFileTypes: true })
  const items = await Promise.all(
    entries
      .filter((e) => (kind === 'mod' ? e.isFile() : true) && !e.name.endsWith('.part'))
      .map(async (e): Promise<ContentItem> => {
        const enabled = !e.name.endsWith(DISABLED)
        const file = enabled ? e.name : e.name.slice(0, -DISABLED.length)
        const info = meta[file]
        return {
          file,
          enabled,
          size: (await stat(join(dir, e.name))).size,
          title: info?.title ?? prettify(file),
          iconUrl: info?.iconUrl,
          projectId: info?.projectId,
          versionId: info?.versionId,
          versionNumber: info?.versionNumber
        }
      })
  )
  return items.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

export function recordContent(id: string, file: string, entry: ContentMeta): void {
  recordContentBatch(id, { [file]: entry })
}

export function recordContentBatch(id: string, entries: Record<string, ContentMeta>): void {
  const meta = readJsonSync<MetaFile>(metaPath(id), {})
  writeJsonSync(metaPath(id), { ...meta, ...entries })
}

export const readContentMeta = (id: string): MetaFile => readJsonSync<MetaFile>(metaPath(id), {})

export function filesOfProject(id: string, projectId: string): string[] {
  const meta = readJsonSync<MetaFile>(metaPath(id), {})
  return Object.keys(meta).filter((file) => meta[file].projectId === projectId)
}

export function forgetContent(id: string, file: string): void {
  const meta = readJsonSync<MetaFile>(metaPath(id), {})
  delete meta[file]
  writeJsonSync(metaPath(id), meta)
}

const safeName = (file: string): string => {
  const name = basename(file)
  if (name !== file || name === '.' || name === '..') throw new Error(`Некорректное имя файла: ${file}`)
  return name
}

export const contentPath = (id: string, kind: ContentKind, file: string): string =>
  join(contentDir(getInstance(id), kind), safeName(file))

export async function setContentEnabled(id: string, kind: ContentKind, file: string, enabled: boolean): Promise<void> {
  const path = contentPath(id, kind, file)
  const off = path + DISABLED
  if (enabled && existsSync(off)) await rename(off, path)
  if (!enabled && existsSync(path)) await rename(path, off)
}

export async function removeContent(
  id: string,
  kind: ContentKind,
  file: string,
  trash: (path: string) => Promise<void>
): Promise<void> {
  assertId(id)
  const path = contentPath(id, kind, file)
  for (const candidate of [path, path + DISABLED]) {
    if (existsSync(candidate)) await trash(candidate)
  }
  forgetContent(id, file)
}

export async function addLocalContent(id: string, kind: ContentKind, sources: string[]): Promise<void> {
  const dir = contentDir(getInstance(id), kind)
  await mkdir(dir, { recursive: true })
  for (const source of sources) await copyFile(source, join(dir, basename(source)))
}
