import { totalmem } from 'node:os'
import { app } from 'electron'
import { ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join, dirname } from 'node:path'
import type { Instance } from '../../shared/types'
import { getSettings, paths } from '../config'
import { emit, Task } from '../events'
import { fabricVersions, installFabric } from './fabric'
import { forgeVersions, installForgeLike, neoforgeVersions } from './forge'
import { ensureJava, javaVersion } from './java'
import { libraryFiles, rulesAllow } from './library'
import { LogParser } from './log'
import { ArgValue, extractNatives, installVanilla, readVersionJson, resolveVersion, VersionJson } from './vanilla'

export interface LaunchAuth {
  name: string
  uuid: string
  accessToken: string
  userType: string
}

const running = new Map<string, ChildProcess>()

export const anyRunning = (): boolean => running.size > 0

const LOW_END_FLAGS = ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:+UseStringDeduplication']

export function lowEndMemory(): number {
  const total = Math.floor(totalmem() / 1024 / 1024)
  if (total <= 4096) return 1536
  if (total <= 8192) return 2048
  return 3072
}

export const isRunning = (id: string): boolean => running.has(id)

export async function launchExternal(instance: Instance, resolveExe: () => Promise<string>, onExit: (playedSec: number) => void): Promise<void> {
  if (running.has(instance.id)) throw new Error('Эта сборка уже запущена')
  const id = instance.id
  const log = (text: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void =>
    emit('game:log', { instanceId: id, text, level })
  emit('game:state', { instanceId: id, state: 'launching' })
  const task = new Task(`Запуск: ${instance.name}`)
  let exe: string
  try {
    task.stage('Загрузка лаунчера Horizon')
    exe = await resolveExe()
    task.finish()
  } catch (e) {
    task.fail(e)
    log(e instanceof Error ? e.message : String(e), 'error')
    emit('game:state', { instanceId: id, state: 'stopped', exitCode: null })
    throw e
  }
  log(`Hesperian: запускаем ${exe}`)
  const child = spawn(exe, [], { cwd: dirname(exe) })
  running.set(id, child)
  const startedAt = Date.now()
  emit('game:state', { instanceId: id, state: 'running' })
  child.stdout?.setEncoding('utf8').on('data', (d: string) => log(d.trimEnd()))
  child.stderr?.setEncoding('utf8').on('data', (d: string) => log(d.trimEnd(), 'warn'))
  let finished = false
  const finish = (code: number | null): void => {
    if (finished) return
    finished = true
    running.delete(id)
    onExit(Math.round((Date.now() - startedAt) / 1000))
    log(`Hesperian: лаунчер закрыт с кодом ${code}`, code === 0 ? 'info' : 'error')
    emit('game:state', { instanceId: id, state: 'stopped', exitCode: code })
  }
  child.on('error', (e) => {
    log(`Не удалось запустить: ${e.message}`, 'error')
    finish(null)
  })
  child.on('close', finish)
}

export const stopGame = (id: string): void => {
  running.get(id)?.kill()
}

const LOADER_VERSIONS = { fabric: fabricVersions, forge: forgeVersions, neoforge: neoforgeVersions }

export const pickLoaderVersion = async (instance: Instance, loader: keyof typeof LOADER_VERSIONS): Promise<string> => {
  if (instance.loaderVersion) return instance.loaderVersion
  const list = await LOADER_VERSIONS[loader](instance.mcVersion)
  const best = list.find((v) => v.tag === 'recommended') ?? list[0]
  if (!best) throw new Error(`Для ${instance.mcVersion} нет сборок ${loader}`)
  return best.version
}

export async function ensureInstalled(instance: Instance, task: Task, verify = false): Promise<{ versionId: string; javaGui: string; java: string }> {
  await installVanilla(instance.mcVersion, task, verify)
  const major = (await readVersionJson(instance.mcVersion)).javaVersion?.majorVersion ?? 8
  const { java, javaGui } = await ensureJava(major, task, instance.javaPath)
  let versionId = instance.mcVersion
  if (instance.loader === 'fabric') {
    versionId = await installFabric(instance.mcVersion, await pickLoaderVersion(instance, 'fabric'), task, verify)
  } else if (instance.loader !== 'vanilla') {
    const version = await pickLoaderVersion(instance, instance.loader)
    versionId = await installForgeLike(instance.loader, instance.mcVersion, version, java, task, verify)
  }
  return { versionId, java, javaGui }
}

const expandArgs = (args: ArgValue[], features: Record<string, boolean>): string[] =>
  args.flatMap((arg) => {
    if (typeof arg === 'string') return [arg]
    if (!rulesAllow(arg.rules, features)) return []
    return Array.isArray(arg.value) ? arg.value : [arg.value]
  })

const splitArgs = (line: string): string[] => line.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? []

export function buildCommand(
  version: VersionJson,
  instance: Instance,
  auth: LaunchAuth,
  nativesDir: string,
  classpath: string[],
  server?: string
): string[] {
  const settings = getSettings()
  const gameDir = paths.gameDir(instance.id)
  const assetsId = version.assets ?? 'legacy'
  const width = instance.width ?? settings.defaultWidth
  const height = instance.height ?? settings.defaultHeight

  const vars: Record<string, string> = {
    auth_player_name: auth.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: paths.assets(),
    assets_index_name: assetsId,
    auth_uuid: auth.uuid,
    auth_access_token: auth.accessToken,
    auth_xuid: '0',
    clientid: '0',
    user_type: auth.userType,
    user_properties: '{}',
    version_type: version.type,
    natives_directory: nativesDir,
    launcher_name: 'Hesperian',
    launcher_version: app.getVersion(),
    classpath: classpath.join(delimiter),
    library_directory: paths.libraries(),
    classpath_separator: delimiter,
    resolution_width: String(width),
    resolution_height: String(height)
  }
  const fill = (arg: string): string => arg.replace(/\$\{(\w+)\}/g, (whole, key) => vars[key] ?? whole)
  const quickPlay = Boolean(server) && JSON.stringify(version.arguments?.game ?? []).includes('quickPlayMultiplayer')
  if (server) vars.quickPlayMultiplayer = server
  const features = { has_custom_resolution: true, is_quick_play_multiplayer: quickPlay }

  const memory = instance.memoryMb ?? (settings.lowEnd ? lowEndMemory() : settings.defaultMemoryMb)
  const jvm: string[] = [
    `-Xmx${memory}M`,
    `-Xms${Math.min(512, memory)}M`,
    '-Dfile.encoding=UTF-8',
    '-Dlog4j2.formatMsgNoLookups=true'
  ]
  const logging = version.logging?.client
  if (logging) {
    jvm.push(logging.argument.replace('${path}', join(paths.assets(), 'log_configs', logging.file.id)))
  }
  const own = [...splitArgs(settings.defaultJvmArgs), ...splitArgs(instance.jvmArgs ?? '')]
  if (settings.lowEnd && !own.some((a) => /^-XX:\+Use\w+GC$/.test(a))) jvm.push(...LOW_END_FLAGS)
  jvm.push(...own)
  jvm.push(...expandArgs(version.arguments?.jvm ?? [], features).map(fill))
  const gameArgs = expandArgs(version.arguments?.game ?? [], features).map(fill)
  if (server && !quickPlay) {
    const [host, port] = server.split(':')
    gameArgs.push('--server', host, '--port', port || '25565')
  }

  return [...jvm, version.mainClass, ...gameArgs]
}

async function skipOnboarding(gameDir: string): Promise<void> {
  const file = join(gameDir, 'options.txt')
  const text = existsSync(file) ? await readFile(file, 'utf8') : ''
  if (/^onboardAccessibility:false$/m.test(text)) return
  const next = /^onboardAccessibility:/m.test(text)
    ? text.replace(/^onboardAccessibility:.*$/m, 'onboardAccessibility:false')
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}onboardAccessibility:false\n`
  await writeFile(file, next)
}

export async function launchGame(
  instance: Instance,
  auth: LaunchAuth,
  onExit: (playedSec: number) => void,
  server?: string
): Promise<void> {
  if (running.has(instance.id)) throw new Error('Эта сборка уже запущена')
  const id = instance.id
  const log = (text: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void =>
    emit('game:log', { instanceId: id, text, level })

  emit('game:state', { instanceId: id, state: 'launching' })
  const task = new Task(`Запуск: ${instance.name}`)
  let javaGui: string
  let args: string[]
  try {
    const installed = await ensureInstalled(instance, task)
    javaGui = installed.javaGui
    const version = await resolveVersion(installed.versionId)
    task.stage('Подготовка')
    const natives = await extractNatives(installed.versionId, version.libraries)
    const classpath = [
      ...new Set(version.libraries.flatMap(libraryFiles).filter((f) => !f.native).map((f) => f.dest))
    ]
    const missing = classpath.filter((p) => !existsSync(p))
    if (missing.length) throw new Error(`Не хватает библиотек:\n${missing.join('\n')}`)
    const jar = paths.versionJar(version.id)
    if (!existsSync(jar)) await copyFile(paths.versionJar(version.jar ?? version.inheritsFrom ?? version.id), jar)
    classpath.push(jar)
    await mkdir(paths.gameDir(id), { recursive: true })
    args = buildCommand(version, instance, auth, natives, classpath, server)
    if (server) await skipOnboarding(paths.gameDir(id))
    log(`Hesperian: ${await javaVersion(installed.java).catch(() => 'версия Java неизвестна')}`)
    log(`Hesperian: версия ${installed.versionId}, игрок ${auth.name}, каталог ${paths.gameDir(id)}`)
    task.finish()
  } catch (e) {
    task.fail(e)
    log(e instanceof Error ? e.message : String(e), 'error')
    emit('game:state', { instanceId: id, state: 'stopped', exitCode: null })
    throw e
  }

  const child = spawn(javaGui, args, { cwd: paths.gameDir(id), windowsHide: true })
  running.set(id, child)
  const startedAt = Date.now()
  emit('game:state', { instanceId: id, state: 'running' })

  const parser = new LogParser()
  const secret = auth.userType === 'msa' ? auth.accessToken : null
  const sink = (text: string, level: 'info' | 'warn' | 'error' | 'debug'): void =>
    log(secret ? text.replaceAll(secret, '<token>') : text, level)
  child.stdout?.setEncoding('utf8').on('data', (d: string) => parser.feed(d, sink))
  child.stderr?.setEncoding('utf8').on('data', (d: string) => parser.feed(d, sink))

  let finished = false
  const finish = (code: number | null): void => {
    if (finished) return
    finished = true
    parser.flush(sink)
    running.delete(id)
    onExit(Math.round((Date.now() - startedAt) / 1000))
    log(`Hesperian: игра завершилась с кодом ${code}`, code === 0 ? 'info' : 'error')
    emit('game:state', { instanceId: id, state: 'stopped', exitCode: code })
  }
  child.on('error', (e) => {
    log(`Не удалось запустить Java: ${e.message}`, 'error')
    finish(null)
  })
  child.on('close', finish)
}
