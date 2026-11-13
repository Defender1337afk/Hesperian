import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AstraHome, Instance } from '../shared/types'
import { paths, readJsonSync, writeJsonSync } from './config'

const configFile = (instance: Instance): string => join(paths.gameDir(instance.id), 'config', 'astra-visuals.json')

interface AstraConfig {
  modules?: Record<string, { enabled?: boolean; settings?: Record<string, number> }>
  [key: string]: unknown
}

function installed(instance: Instance): boolean {
  const mods = join(paths.gameDir(instance.id), 'mods')
  if (!existsSync(mods)) return false
  return readdirSync(mods).some((f) => /^astra-visuals-.*\.jar$/.test(f))
}

export function readHome(instance: Instance): AstraHome {
  const config = readJsonSync<AstraConfig>(configFile(instance), {})
  const home = config.modules?.home
  const style = home?.enabled === false ? 0 : (home?.settings?.style ?? 1)
  return { installed: installed(instance), style }
}

export function writeStyle(instance: Instance, style: number): AstraHome {
  if (!Number.isInteger(style) || style < 0 || style > 4) throw new Error('Неизвестный стиль меню')
  const config = readJsonSync<AstraConfig>(configFile(instance), {})
  const modules = config.modules ?? {}
  const home = modules.home ?? {}
  modules.home = { ...home, enabled: true, settings: { ...home.settings, style } }
  writeJsonSync(configFile(instance), { ...config, modules })
  return readHome(instance)
}
