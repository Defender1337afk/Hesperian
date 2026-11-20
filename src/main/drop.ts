import AdmZip from 'adm-zip'
import { copyFile, mkdir, open, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ContentKind, DropResult } from '../shared/types'
import { BACKGROUND_TYPES, importBackground } from './backgrounds'
import { contentDir } from './content'
import { getInstance } from './instances'
import { importModpack } from './modpacks'
import { readModMeta } from './modmeta'

async function looksLikeSkin(path: string): Promise<boolean> {
  const head = Buffer.alloc(24)
  const handle = await open(path, 'r')
  try {
    await handle.read(head, 0, 24, 0)
  } finally {
    await handle.close()
  }
  const w = head.readUInt32BE(16)
  const h = head.readUInt32BE(20)
  return w === 64 && (h === 64 || h === 32)
}

function zipKind(path: string): ContentKind | 'modpack' | null {
  try {
    const zip = new AdmZip(path)
    const names = zip.getEntries().map((e) => e.entryName)
    if (names.includes('modrinth.index.json')) return 'modpack'
    if (names.some((n) => /^(?:[^/]+\/)?shaders\//.test(n))) return 'shader'
    if (names.some((n) => /^(?:[^/]+\/)?pack\.mcmeta$/.test(n))) return 'resourcepack'
    if (names.includes('fabric.mod.json') || names.includes('META-INF/mods.toml')) return 'mod'
  } catch {
    return null
  }
  return null
}

export async function dropFiles(instanceId: string | null, paths: string[]): Promise<DropResult> {
  const result: DropResult = { added: [], skipped: [] }
  for (const path of paths) {
    const name = basename(path)
    const ext = extname(path).toLowerCase()
    try {
      if ((await stat(path)).isDirectory()) {
        result.skipped.push(`${name}: папки не поддерживаются`)
        continue
      }
      if (ext === '.mrpack') {
        const instance = await importModpack(path)
        result.modpack = instance.name
        continue
      }
      if (BACKGROUND_TYPES[ext] && ext !== '.png' && ext !== '.zip') {
        result.background = await importBackground(path)
        continue
      }
      let kind: ContentKind | 'modpack' | null = null
      if (ext === '.jar') kind = readModMeta(path, name) ? 'mod' : null
      else if (ext === '.zip') kind = zipKind(path)
      else if (ext === '.png') {
        if (await looksLikeSkin(path)) {
          result.skipped.push(`${name}: похоже на скин, его можно поставить на вкладке «Скины»`)
          continue
        }
        result.background = await importBackground(path)
        continue
      }
      if (kind === 'modpack') {
        const instance = await importModpack(path)
        result.modpack = instance.name
        continue
      }
      if (!kind) {
        result.skipped.push(`${name}: не понял, что это за файл`)
        continue
      }
      if (!instanceId) {
        result.skipped.push(`${name}: сначала выберите сборку`)
        continue
      }
      const instance = getInstance(instanceId)
      if (kind === 'mod' && instance.loader === 'vanilla') {
        result.skipped.push(`${name}: в ванильную сборку моды не ставятся`)
        continue
      }
      const dir = contentDir(instance, kind)
      await mkdir(dir, { recursive: true })
      await copyFile(path, join(dir, name))
      result.added.push(`${name} → ${{ mod: 'моды', resourcepack: 'текстуры', shader: 'шейдеры' }[kind]}`)
    } catch (e) {
      result.skipped.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}
