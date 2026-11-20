import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CrashReport, SessionReport, SessionSample, SessionStats } from '../shared/types'
import { getSettings, paths, readJsonSync, writeJsonSync } from './config'
import { Notification } from 'electron'
import { emit } from './events'

const MAX_SESSIONS = 40
const MAX_SAMPLES = 240
const LOG_LINES = 600
const STATS_TAG = '[HesperianStats] '

const statsPath = (id: string): string => join(paths.instanceDir(id), 'stats.json')

export const readStats = (id: string): SessionStats => readJsonSync<SessionStats>(statsPath(id), { sessions: [] })

const pending: SessionReport[] = []
const active = new Map<string, { name: string; started: number }>()

export async function todayPlaytime(ids: string[]): Promise<{ sec: number; playing: { id: string; name: string; startedAt: number }[] }> {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const from = midnight.getTime()
  let sec = 0
  for (const id of ids) {
    for (const s of readStats(id).sessions) {
      if (s.endedAt <= from) continue
      sec += Math.max(0, Math.round((s.endedAt - Math.max(s.startedAt, from)) / 1000))
    }
  }
  return { sec, playing: [...active.entries()].map(([id, a]) => ({ id, name: a.name, startedAt: a.started })) }
}

export const takeReports = (): SessionReport[] => pending.splice(0)

function linuxRss(pid: number): number | null {
  try {
    const pages = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1])
    return Math.round((pages * 4096) / 1048576)
  } catch {
    return null
  }
}

function linuxCpu(pid: number): number | null {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
    return Number(fields[11]) + Number(fields[12])
  } catch {
    return null
  }
}

const windowsRss = (pid: number): Promise<number | null> =>
  new Promise((resolve) => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve(null)
      const kb = /"([\d\s., ]+)\s*[KК]/i.exec(out)?.[1]
      resolve(kb ? Math.round(Number(kb.replace(/[^\d]/g, '')) / 1024) : null)
    })
  })

function downsample(samples: SessionSample[]): SessionSample[] {
  if (samples.length <= MAX_SAMPLES) return samples
  const step = samples.length / MAX_SAMPLES
  const out: SessionSample[] = []
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const chunk = samples.slice(Math.floor(i * step), Math.floor((i + 1) * step))
    const fps = chunk.filter((s) => s.fps !== undefined).map((s) => s.fps!)
    out.push({
      t: chunk[0].t,
      rss: Math.max(...chunk.map((s) => s.rss ?? 0)) || undefined,
      heap: Math.max(...chunk.map((s) => s.heap ?? 0)) || undefined,
      fps: fps.length ? Math.round(fps.reduce((a, b) => a + b, 0) / fps.length) : undefined,
      cpu: chunk[0].cpu
    })
  }
  return out
}

interface Rule {
  test: RegExp
  title: string
  hint: string
}

const RULES: Rule[] = [
  { test: /OutOfMemoryError|Could not reserve enough space|There is insufficient memory for the Java Runtime/i, title: 'Игре не хватило памяти', hint: 'Добавьте памяти в параметрах сборки или уберите тяжёлые моды и шейдеры. Для модпаков обычно нужно 6–8 ГБ.' },
  { test: /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/i, title: 'Не та версия Java', hint: 'Мод собран под более новую Java. Уберите свой путь к Java в параметрах сборки, тогда Hesperian подберёт нужную сам.' },
  { test: /Incompatible mods found|Missing or unsupported mandatory dependencies|requires (?:version|any version)[^\n]*of|is missing|Mod resolution failed/i, title: 'Не хватает модов или версии не подходят', hint: 'Каким-то модам нужны другие моды или другие версии. Нажмите «Проверить конфликты» на вкладке «Моды» или поставьте недостающее из магазина.' },
  { test: /Found duplicate mods|Duplicate mod|duplicate mod id/i, title: 'Один мод стоит дважды', hint: 'Удалите лишнюю копию на вкладке «Моды».' },
  { test: /Mixin apply failed|MixinApplyError|InvalidInjectionException|mixin\.transformer/i, title: 'Моды конфликтуют', hint: 'Два мода пытаются изменить одно и то же место в игре. Отключайте недавно добавленные моды по одному или нажмите «Проверить конфликты».' },
  { test: /NoClassDefFoundError|ClassNotFoundException/i, title: 'Мод не нашёл нужный ему код', hint: 'Обычно это мод для другой версии игры или загрузчика, либо не хватает библиотеки, например Fabric API.' },
  { test: /GLFW error 65542|Pixel format not accelerated|WGL: The driver does not appear to support OpenGL|No OpenGL context|OpenGL 3\.2 is not supported/i, title: 'Проблема с видеодрайвером', hint: 'Обновите драйвер видеокарты. На ноутбуках с двумя видеокартами запускайте игру на дискретной.' },
  { test: /EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime/i, title: 'Игра упала на уровне драйвера или нативной библиотеки', hint: 'Часто помогает обновление видеодрайвера или отключение шейдеров. Подробности в hs_err-файле в папке игры.' },
  { test: /Failed to (?:download|resolve) .*libraries|Could not find or load main class/i, title: 'Повреждены файлы игры', hint: 'Нажмите «Проверить файлы» на вкладке «Обзор» сборки, чтобы скачать их заново.' }
]

async function latestCrashReport(id: string, since: number): Promise<string | null> {
  const dir = join(paths.gameDir(id), 'crash-reports')
  if (!existsSync(dir)) return null
  let best: { file: string; time: number } | null = null
  for (const file of await readdir(dir)) {
    const time = (await stat(join(dir, file))).mtimeMs
    if (time >= since && (!best || time > best.time)) best = { file, time }
  }
  return best ? readFile(join(dir, best.file), 'utf8').catch(() => null) : null
}

export function analyze(code: number | null, text: string): Omit<CrashReport, 'log'> {
  const rule = RULES.find((r) => r.test.test(text))
  const lines = text.split('\n')
  const details = new Set<string>()
  if (rule) {
    for (const line of lines) {
      if (details.size >= 6) break
      if (rule.test.test(line) || /^\s*-\s*Mod '|requires|from mod|Caused by/i.test(line)) details.add(line.trim().slice(0, 240))
    }
  }
  const cause = lines.reverse().find((l) => /Caused by:|Exception:|Error:/.test(l))
  if (!details.size && cause) details.add(cause.trim().slice(0, 240))
  return {
    code,
    title: rule?.title ?? 'Игра закрылась с ошибкой',
    hint: rule?.hint ?? 'Скопируйте лог и пришлите его в чат, по нему проще найти причину. Если ставили моды недавно, попробуйте отключить последние.',
    details: [...details]
  }
}

export class Session {
  private readonly samples: SessionSample[] = []
  private readonly log: string[] = []
  private readonly started = Date.now()
  private timer: NodeJS.Timeout
  private lastCpu: number | null = null
  private lastCpuAt = 0
  private fps?: number
  private heap?: number
  private heapMax?: number
  private place?: string
  private reminded = 0
  stoppedByUser = false

  constructor(
    private readonly instanceId: string,
    private readonly pid: number | undefined,
    private readonly name: string
  ) {
    this.timer = setInterval(() => void this.sample(), 2000)
    active.set(instanceId, { name, started: this.started })
  }

  intercept(text: string): boolean {
    const at = text.indexOf(STATS_TAG)
    if (at < 0) {
      this.log.push(text)
      if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES)
      return false
    }
    const [fps, used, max, place] = text.slice(at + STATS_TAG.length).trim().split(/\s+/)
    this.fps = Number(fps) || 0
    this.heap = Number(used) || undefined
    this.heapMax = Number(max) || undefined
    this.place = place
    return true
  }

  private async sample(): Promise<void> {
    if (!this.pid) return
    let rss: number | null = null
    let cpu: number | undefined
    if (process.platform === 'linux') {
      rss = linuxRss(this.pid)
      const ticks = linuxCpu(this.pid)
      const now = Date.now()
      if (ticks !== null && this.lastCpu !== null) cpu = Math.round((((ticks - this.lastCpu) / 100) / ((now - this.lastCpuAt) / 1000)) * 100)
      if (ticks !== null) {
        this.lastCpu = ticks
        this.lastCpuAt = now
      }
    } else if (process.platform === 'win32') rss = await windowsRss(this.pid)
    const point: SessionSample = { t: Math.round((Date.now() - this.started) / 1000), rss: rss ?? undefined, cpu, fps: this.fps, heap: this.heap }
    this.samples.push(point)
    const every = getSettings().breakReminderMin
    const playedMin = (Date.now() - this.started) / 60000
    if (every > 0 && Math.floor(playedMin / every) > this.reminded) {
      this.reminded = Math.floor(playedMin / every)
      if (Notification.isSupported()) new Notification({ title: 'Пора сделать перерыв', body: `Вы играете в «${this.name}» уже ${Math.round(playedMin)} мин. Разомнитесь и попейте воды.`, silent: false }).show()
    }
    emit('game:stats', { instanceId: this.instanceId, sample: point, heapMax: this.heapMax, place: this.place })
  }

  async finish(code: number | null): Promise<SessionReport> {
    clearInterval(this.timer)
    active.delete(this.instanceId)
    const ended = Date.now()
    const fps = this.samples.filter((s) => s.fps !== undefined && s.fps > 0).map((s) => s.fps!)
    const summary = {
      startedAt: this.started,
      endedAt: ended,
      durationSec: Math.round((ended - this.started) / 1000),
      avgFps: fps.length ? Math.round(fps.reduce((a, b) => a + b, 0) / fps.length) : undefined,
      minFps: fps.length ? Math.min(...fps) : undefined,
      maxFps: fps.length ? Math.max(...fps) : undefined,
      peakRssMb: Math.max(0, ...this.samples.map((s) => s.rss ?? 0)) || undefined,
      peakHeapMb: Math.max(0, ...this.samples.map((s) => s.heap ?? 0)) || undefined,
      heapMaxMb: this.heapMax,
      exitCode: code,
      stopped: this.stoppedByUser || undefined,
      samples: downsample(this.samples)
    }
    const stats = readStats(this.instanceId)
    stats.sessions = [summary, ...stats.sessions].slice(0, MAX_SESSIONS)
    writeJsonSync(statsPath(this.instanceId), stats)
    let crash: CrashReport | undefined
    const failed = !this.stoppedByUser && code !== 0 && code !== null
    if (failed) {
      const report = await latestCrashReport(this.instanceId, this.started).catch(() => null)
      const text = [this.log.join('\n'), report ?? ''].join('\n')
      crash = { ...analyze(code, text), log: this.log.slice(-LOG_LINES).join('\n') + (report ? `\n\n${report}` : '') }
    }
    const result: SessionReport = { instanceId: this.instanceId, instanceName: this.name, summary: { ...summary, samples: [] }, crash }
    pending.push(result)
    emit('game:session', result)
    return result
  }
}
