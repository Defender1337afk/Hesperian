import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Instance, NewInstance } from '../shared/types'
import { paths, readJsonSync, writeJsonSync } from './config'

const metaPath = (id: string): string => join(paths.instanceDir(id), 'instance.json')

export function assertId(id: string): void {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Некорректный id сборки: ${id}`)
}

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'instance'

const newId = (name: string): string => `${slug(name)}-${randomBytes(3).toString('hex')}`

export async function listInstances(): Promise<Instance[]> {
  if (!existsSync(paths.instances())) return []
  const entries = await readdir(paths.instances(), { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => readJsonSync<Instance | null>(metaPath(e.name), null))
    .filter((i): i is Instance => i !== null)
    .sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt))
}

export function getInstance(id: string): Instance {
  assertId(id)
  const instance = readJsonSync<Instance | null>(metaPath(id), null)
  if (!instance) throw new Error('Сборка не найдена')
  return instance
}

export async function createInstance(input: NewInstance): Promise<Instance> {
  const instance: Instance = { ...input, id: newId(input.name), createdAt: Date.now(), playTimeSec: 0 }
  await mkdir(paths.gameDir(instance.id), { recursive: true })
  writeJsonSync(metaPath(instance.id), instance)
  return instance
}

export function updateInstance(id: string, patch: Partial<Instance>): Instance {
  const next = { ...getInstance(id), ...patch, id }
  writeJsonSync(metaPath(id), next)
  return next
}

export async function duplicateInstance(id: string): Promise<Instance> {
  const source = getInstance(id)
  const name = `${source.name} (копия)`
  const copy: Instance = { ...source, id: newId(name), name, createdAt: Date.now(), lastPlayedAt: undefined, playTimeSec: 0 }
  await cp(paths.instanceDir(id), paths.instanceDir(copy.id), { recursive: true })
  writeJsonSync(metaPath(copy.id), copy)
  return copy
}

export async function removeInstance(id: string, trash: (path: string) => Promise<void>): Promise<void> {
  assertId(id)
  const dir = paths.instanceDir(id)
  await trash(dir).catch(() => rm(dir, { recursive: true, force: true }))
}
