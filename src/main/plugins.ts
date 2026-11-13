import { app, shell } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import type { Instance, PluginInfo, PluginLogLine } from '../shared/types'
import { CURRENT } from '../shared/release'
import { readJsonSync, writeJsonSync } from './config'
import { emit } from './events'
import { listInstances } from './instances'
import { backupWorld, listWorlds } from './gallery'

interface Manifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  main?: string
}

type LaunchHook = (instance: Instance) => void | { jvmArgs?: string[] } | Promise<void | { jvmArgs?: string[] }>
type ExitHook = (instance: Instance, info: { playedSec: number }) => void | Promise<void>

interface Command {
  id: string
  title: string
  run: () => unknown
}

interface Loaded {
  manifest: Manifest
  dir: string
  enabled: boolean
  error?: string
  commands: Command[]
  launch: LaunchHook[]
  exit: ExitHook[]
  module?: { deactivate?: () => unknown }
}

interface State {
  disabled: string[]
  data: Record<string, Record<string, unknown>>
}

const root = (): string => join(app.getPath('userData'), 'plugins')
const stateFile = (): string => join(app.getPath('userData'), 'plugins.json')
const loadState = (): State => ({ disabled: [], data: {}, ...readJsonSync<Partial<State>>(stateFile(), {}) })
const saveState = (s: State): void => writeJsonSync(stateFile(), s)

const plugins = new Map<string, Loaded>()
const logs: PluginLogLine[] = []
const MAX_LOGS = 500

function log(pluginId: string, text: string, level: PluginLogLine['level'] = 'info'): void {
  const line = { pluginId, text, level, at: Date.now() }
  logs.push(line)
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
  emit('plugins:log', line)
}

const ID = /^[a-z0-9][a-z0-9-]{1,48}$/

function readManifest(dir: string): Manifest {
  const manifest = readJsonSync<Manifest | null>(join(dir, 'plugin.json'), null)
  if (!manifest) throw new Error('Нет plugin.json или в нём ошибка')
  if (!ID.test(manifest.id ?? '')) throw new Error('id в plugin.json: латиница в нижнем регистре, цифры и дефис')
  if (!manifest.name) throw new Error('В plugin.json нет name')
  return { ...manifest, version: manifest.version || '0.0.0', main: manifest.main || 'main.js' }
}

function apiFor(p: Loaded): unknown {
  const id = p.manifest.id
  return {
    hesperian: { version: app.getVersion(), codename: CURRENT.codename },
    plugin: { id, name: p.manifest.name, version: p.manifest.version, dir: p.dir },
    log: (text: unknown) => log(id, String(text)),
    warn: (text: unknown) => log(id, String(text), 'warn'),
    notify: (text: unknown, kind: 'info' | 'warn' | 'error' = 'info') => emit('plugins:toast', { text: `${p.manifest.name}: ${String(text)}`, kind }),
    commands: {
      register: (cmdId: string, title: string, run: () => unknown) => {
        p.commands = [...p.commands.filter((c) => c.id !== cmdId), { id: String(cmdId), title: String(title), run }]
        emit('plugins:changed', null)
      }
    },
    on: (event: 'launch' | 'exit', fn: LaunchHook | ExitHook) => {
      if (event === 'launch') p.launch.push(fn as LaunchHook)
      else if (event === 'exit') p.exit.push(fn as ExitHook)
      else throw new Error(`Неизвестное событие ${String(event)}: есть launch и exit`)
    },
    instances: { list: () => listInstances() },
    worlds: {
      list: (instanceId: string) => listWorlds(instanceId),
      backup: (instanceId: string, world: string) => backupWorld(instanceId, world)
    },
    storage: {
      get: (key: string) => loadState().data[id]?.[key],
      set: (key: string, value: unknown) => {
        const s = loadState()
        s.data[id] = { ...s.data[id], [key]: value }
        saveState(s)
      }
    },
    openUrl: (url: string) => {
      if (!/^https?:\/\//.test(url)) throw new Error('Открываются только ссылки http и https')
      return shell.openExternal(url)
    },
    openPath: (path: string) => shell.openPath(path)
  }
}

function forget(dir: string): void {
  const prefix = resolve(dir) + sep
  for (const key of Object.keys(require.cache)) if (key.startsWith(prefix)) delete require.cache[key]
}

async function activate(p: Loaded): Promise<void> {
  const main = resolve(p.dir, p.manifest.main ?? 'main.js')
  if (!main.startsWith(resolve(p.dir) + sep)) throw new Error('main в plugin.json должен лежать внутри папки плагина')
  if (!existsSync(main)) throw new Error(`Нет файла ${p.manifest.main}`)
  forget(p.dir)
  const mod = createRequire(main)(main) as { activate?: (api: unknown) => unknown; deactivate?: () => unknown }
  if (typeof mod.activate !== 'function') throw new Error('main.js должен экспортировать функцию activate')
  p.module = mod
  await mod.activate(apiFor(p))
}

async function deactivate(p: Loaded): Promise<void> {
  try {
    await p.module?.deactivate?.()
  } catch (e) {
    log(p.manifest.id, `deactivate: ${errorText(e)}`, 'error')
  }
  p.module = undefined
  p.commands = []
  p.launch = []
  p.exit = []
  forget(p.dir)
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function loadPlugins(): Promise<void> {
  for (const p of plugins.values()) await deactivate(p)
  plugins.clear()
  mkdirSync(root(), { recursive: true })
  const disabled = new Set(loadState().disabled)
  for (const entry of readdirSync(root(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root(), entry.name)
    let manifest: Manifest
    try {
      manifest = readManifest(dir)
    } catch (e) {
      const broken = { id: entry.name, name: entry.name, version: '?' }
      plugins.set(`broken:${entry.name}`, { manifest: broken, dir, enabled: false, error: errorText(e), commands: [], launch: [], exit: [] })
      continue
    }
    if (plugins.has(manifest.id)) {
      log(manifest.id, `Плагин с таким id уже есть, папка ${entry.name} пропущена`, 'warn')
      continue
    }
    const p: Loaded = { manifest, dir, enabled: !disabled.has(manifest.id), commands: [], launch: [], exit: [] }
    plugins.set(manifest.id, p)
    if (!p.enabled) continue
    try {
      await activate(p)
      log(manifest.id, `Загружен ${manifest.name} ${manifest.version}`)
    } catch (e) {
      p.error = errorText(e)
      log(manifest.id, p.error, 'error')
      await deactivate(p)
    }
  }
  emit('plugins:changed', null)
}

export function listPlugins(): PluginInfo[] {
  return [...plugins.values()]
    .map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description ?? '',
      author: p.manifest.author ?? '',
      enabled: p.enabled,
      error: p.error,
      folder: p.dir,
      commands: p.commands.map(({ id, title }) => ({ id, title })),
      hooks: p.launch.length + p.exit.length
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginInfo[]> {
  const p = plugins.get(id)
  if (!p) throw new Error('Нет такого плагина')
  const s = loadState()
  s.disabled = enabled ? s.disabled.filter((d) => d !== id) : [...new Set([...s.disabled, id])]
  saveState(s)
  p.enabled = enabled
  p.error = undefined
  if (enabled) {
    try {
      await activate(p)
      log(id, 'Включён')
    } catch (e) {
      p.error = errorText(e)
      log(id, p.error, 'error')
      await deactivate(p)
    }
  } else {
    await deactivate(p)
    log(id, 'Выключен')
  }
  emit('plugins:changed', null)
  return listPlugins()
}

export async function runPluginCommand(pluginId: string, commandId: string): Promise<void> {
  const command = plugins.get(pluginId)?.commands.find((c) => c.id === commandId)
  if (!command) throw new Error('Команда плагина не найдена')
  try {
    await command.run()
  } catch (e) {
    log(pluginId, `${command.title}: ${errorText(e)}`, 'error')
    throw e
  }
}

const bundledRoot = (): string => (app.isPackaged ? join(process.resourcesPath, 'plugins') : join(app.getAppPath(), 'resources', 'plugins'))

export function bundledPlugins(): { id: string; name: string; description: string; installed: boolean }[] {
  if (!existsSync(bundledRoot())) return []
  return readdirSync(bundledRoot(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const m = readManifest(join(bundledRoot(), e.name))
      return { id: m.id, name: m.name, description: m.description ?? '', installed: plugins.has(m.id) || existsSync(join(root(), m.id)) }
    })
}

export async function installBundledPlugin(id: string): Promise<PluginInfo[]> {
  if (!ID.test(id)) throw new Error('Неверный id плагина')
  const source = join(bundledRoot(), id)
  if (!existsSync(join(source, 'plugin.json'))) throw new Error('Такого готового плагина нет')
  mkdirSync(root(), { recursive: true })
  cpSync(source, join(root(), id), { recursive: true })
  await loadPlugins()
  return listPlugins()
}

export const pluginLogs = (): PluginLogLine[] => logs

export async function openPluginsFolder(): Promise<void> {
  mkdirSync(root(), { recursive: true })
  await shell.openPath(root())
}

export async function beforeLaunch(instance: Instance): Promise<string[]> {
  const extra: string[] = []
  for (const p of plugins.values()) {
    for (const hook of p.launch) {
      try {
        const result = await hook(instance)
        if (result && Array.isArray(result.jvmArgs)) extra.push(...result.jvmArgs.map(String))
      } catch (e) {
        log(p.manifest.id, `launch: ${errorText(e)}`, 'error')
      }
    }
  }
  return extra
}

export async function afterExit(instance: Instance, playedSec: number): Promise<void> {
  for (const p of plugins.values()) {
    for (const hook of p.exit) {
      try {
        await hook(instance, { playedSec })
      } catch (e) {
        log(p.manifest.id, `exit: ${errorText(e)}`, 'error')
      }
    }
  }
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

const slug = (name: string): string =>
  [...name.toLowerCase()]
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export async function createPlugin(name: string): Promise<PluginInfo[]> {
  const title = name.trim()
  if (!title) throw new Error('Введите название')
  let id = slug(title) || 'plugin'
  if (id.length < 2) id = `plugin-${id}`
  let n = 2
  const base = id
  while (existsSync(join(root(), id)) || plugins.has(id)) id = `${base}-${n++}`
  const dir = join(root(), id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({ id, name: title, version: '1.0.0', description: 'Мой плагин для Hesperian', author: '', main: 'main.js' }, null, 2)
  )
  writeFileSync(join(dir, 'main.js'), TEMPLATE.replaceAll('%NAME%', title))
  writeFileSync(join(dir, 'README.md'), README)
  await loadPlugins()
  await shell.openPath(dir)
  return listPlugins()
}

const TEMPLATE = `exports.activate = (hesperian) => {
  hesperian.log(\`Привет из Hesperian \${hesperian.hesperian.version} \${hesperian.hesperian.codename}\`)

  hesperian.commands.register('hello', '%NAME%: поздороваться', () => {
    const launches = hesperian.storage.get('launches') ?? 0
    hesperian.notify(\`Игра запускалась \${launches} раз с этим плагином\`)
  })

  hesperian.on('launch', (instance) => {
    hesperian.storage.set('launches', (hesperian.storage.get('launches') ?? 0) + 1)
    hesperian.log(\`Запуск \${instance.name} (\${instance.mcVersion})\`)
    return { jvmArgs: [] }
  })

  hesperian.on('exit', (instance, { playedSec }) => {
    hesperian.log(\`\${instance.name}: сыграно \${Math.round(playedSec / 60)} мин\`)
  })
}

exports.deactivate = () => {}
`

const README = `# Плагин Hesperian

Плагин это папка с двумя файлами:

- \`plugin.json\`: \`id\` (латиница, цифры, дефис), \`name\`, \`version\`, \`description\`, \`author\`, \`main\`
- \`main.js\`: модуль CommonJS с функцией \`activate(hesperian)\` и по желанию \`deactivate()\`

Плагин работает внутри лаунчера с полными правами Node.js: ставьте только свои или проверенные плагины.

## API

| Что | Описание |
| --- | --- |
| \`hesperian.hesperian\` | \`{ version, codename }\` лаунчера |
| \`hesperian.plugin\` | \`{ id, name, version, dir }\` самого плагина |
| \`hesperian.log(text)\`, \`hesperian.warn(text)\` | Строка в журнале на вкладке «Плагины» |
| \`hesperian.notify(text, kind)\` | Уведомление в лаунчере, \`kind\`: info, warn, error |
| \`hesperian.commands.register(id, title, fn)\` | Команда в палитре и на вкладке плагина |
| \`hesperian.on('launch', fn(instance))\` | Перед запуском игры. Можно вернуть \`{ jvmArgs: [...] }\` |
| \`hesperian.on('exit', fn(instance, { playedSec }))\` | После выхода из игры |
| \`hesperian.instances.list()\` | Все сборки |
| \`hesperian.storage.get(key)\`, \`set(key, value)\` | Свои данные, сохраняются между запусками |
| \`hesperian.openUrl(url)\`, \`hesperian.openPath(path)\` | Открыть ссылку или папку |
`
