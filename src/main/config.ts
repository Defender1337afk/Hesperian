import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/types'

export function readJsonSync<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJsonSync(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

const defaults = (): Settings => ({
  theme: 'grove',
  accentHue: 145,
  density: 'comfortable',
  radius: 8,
  uiSize: 13,
  animations: true,
  sidebarWidth: 280,
  panelHeight: 250,
  backgroundImage: '',
  backgroundOpacity: 15,
  customCss: '',
  defaultMemoryMb: Math.min(4096, Math.floor(totalmem() / 1024 / 1024 / 2)),
  defaultJvmArgs: '',
  defaultWidth: 1280,
  defaultHeight: 720,
  afterLaunch: 'keep',
  lowEnd: false,
  openPanelOnLaunch: true,
  dataDir: '',
  msClientId: '',
  bigPictureBackground: 'panorama',
  bigPictureOnStart: false
})

let cached: Settings | null = null

export function getSettings(): Settings {
  cached ??= { ...defaults(), ...readJsonSync<Partial<Settings>>(settingsPath(), {}) }
  return cached
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cached = { ...getSettings(), ...patch }
  writeJsonSync(settingsPath(), cached)
  return cached
}

export const dataRoot = (): string =>
  process.env.HESPERIAN_DATA || getSettings().dataDir || join(app.getPath('userData'), 'game')

export const paths = {
  versions: () => join(dataRoot(), 'versions'),
  versionDir: (id: string) => join(dataRoot(), 'versions', id),
  versionJson: (id: string) => join(dataRoot(), 'versions', id, `${id}.json`),
  versionJar: (id: string) => join(dataRoot(), 'versions', id, `${id}.jar`),
  libraries: () => join(dataRoot(), 'libraries'),
  assets: () => join(dataRoot(), 'assets'),
  runtimes: () => join(dataRoot(), 'runtimes'),
  instances: () => join(dataRoot(), 'instances'),
  instanceDir: (id: string) => join(dataRoot(), 'instances', id),
  gameDir: (id: string) => join(dataRoot(), 'instances', id, 'game')
}
