import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LoaderVersion } from '../../shared/types'
import { paths } from '../config'
import type { Task } from '../events'
import { fetchJson, HttpError } from '../net'
import { readVersionJson, fetchLibraries, VersionJson } from './vanilla'

const META = 'https://meta.fabricmc.net/v2/versions/loader'

interface FabricEntry {
  loader: { version: string; stable: boolean }
}

export async function fabricVersions(mc: string): Promise<LoaderVersion[]> {
  try {
    const list = await fetchJson<FabricEntry[]>(`${META}/${encodeURIComponent(mc)}`)
    const firstStable = list.find((e) => e.loader.stable)?.loader.version
    return list.map((e) => ({
      version: e.loader.version,
      tag: e.loader.version === firstStable ? ('recommended' as const) : undefined
    }))
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) return []
    throw e
  }
}

export async function installFabric(mc: string, loader: string, task: Task, verify = false): Promise<string> {
  const id = `fabric-loader-${loader}-${mc}`
  if (!existsSync(paths.versionJson(id))) {
    task.stage('Профиль Fabric')
    const profile = await fetchJson<VersionJson>(`${META}/${mc}/${loader}/profile/json`)
    await mkdir(dirname(paths.versionJson(id)), { recursive: true })
    await writeFile(paths.versionJson(id), JSON.stringify({ ...profile, id }, null, 2))
  }
  await fetchLibraries((await readVersionJson(id)).libraries, task, verify)
  return id
}
