import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { access, chmod, constants, copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { UpdateCheck, UpdateKind } from '../shared/types'
import { emit } from './events'

const FEED = process.env.HESPERIAN_UPDATE_FEED || 'https://defender1337afk.github.io/update.json'
const SITE = 'https://defender1337afk.github.io/#download'

interface FeedFile {
  url: string
  sha256: string
  size: number
}

interface Feed {
  version?: string
  codename?: string
  notes?: string
  url?: string
  files?: Partial<Record<UpdateKind, FeedFile>>
}

let pending: { version: string; file: FeedFile; kind: UpdateKind } | null = null
let busy = false

const parts = (v: string): number[] => v.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)

function newer(a: string, b: string): boolean {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

const writable = (path: string): Promise<boolean> =>
  access(path, constants.W_OK).then(
    () => true,
    () => false
  )

const installDir = (): string => dirname(process.execPath)

export async function installKind(): Promise<UpdateKind | null> {
  if (!app.isPackaged || process.env.HESPERIAN_NO_SELF_UPDATE) return null
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return (await writable(dirname(process.env.APPIMAGE))) ? 'linux-appimage' : null
    const dir = installDir()
    return (await writable(dirname(dir))) && (await writable(dir)) ? 'linux-tar' : null
  }
  if (process.platform === 'win32') {
    if (process.env.PORTABLE_EXECUTABLE_FILE) return (await writable(dirname(process.env.PORTABLE_EXECUTABLE_FILE))) ? 'win-portable' : null
    return existsSync(join(installDir(), 'uninstall.exe')) ? 'win-setup' : null
  }
  return null
}

const validFile = (f: unknown): f is FeedFile => {
  const x = f as FeedFile
  return Boolean(x) && typeof x.url === 'string' && (/^https:\/\//.test(x.url) || (Boolean(process.env.HESPERIAN_UPDATE_FEED) && /^http:\/\/127\.0\.0\.1[:/]/.test(x.url))) && typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(x.sha256) && typeof x.size === 'number' && x.size > 0
}

export async function checkUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion()
  try {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(4000), headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) return { state: 'none', current }
    const feed = (await res.json()) as Feed
    if (!feed.version || !newer(feed.version, current)) return { state: 'none', current }
    const url = typeof feed.url === 'string' && /^https:\/\//.test(feed.url) ? feed.url : SITE
    const kind = await installKind()
    const file = kind ? feed.files?.[kind] : undefined
    pending = kind && validFile(file) ? { version: feed.version, file, kind } : null
    return { state: 'available', current, version: feed.version, codename: feed.codename, notes: feed.notes, url, auto: Boolean(pending), size: pending?.file.size }
  } catch {
    return { state: 'offline', current }
  }
}

const taskbar = (value: number): void => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.setProgressBar(value, value > 1 ? { mode: 'indeterminate' } : undefined)
}

const progress = (stage: 'download' | 'install' | 'restart', done = 0, total = 0): void => {
  emit('update:progress', { stage, done, total })
  taskbar(stage === 'download' && total ? Math.min(1, done / total) : 2)
}

async function download(file: FeedFile, dest: string): Promise<void> {
  const res = await fetch(file.url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Сервер обновлений ответил ${res.status}`)
  const hash = createHash('sha256')
  const out = createWriteStream(dest)
  let done = 0
  let last = 0
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      hash.update(value)
      done += value.length
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      if (Date.now() - last > 100) {
        last = Date.now()
        progress('download', done, file.size)
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  }
  progress('download', done, file.size)
  if (hash.digest('hex').toLowerCase() !== file.sha256.toLowerCase()) {
    await rm(dest, { force: true })
    throw new Error('Файл обновления повреждён. Попробуйте ещё раз.')
  }
}

const detached = (command: string, args: string[], cwd?: string): void => {
  const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

function relaunchLinux(target: string, cleanup?: string): void {
  const script = [`while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`, cleanup ? `rm -rf ${quote(cleanup)}` : '', `exec ${quote(target)}`].filter(Boolean).join('; ')
  detached('/bin/sh', ['-c', script])
}

async function applyAppImage(file: FeedFile): Promise<void> {
  const target = process.env.APPIMAGE!
  const temp = `${target}.update`
  await download(file, temp)
  progress('install')
  await chmod(temp, 0o755)
  await rename(temp, target)
  relaunchLinux(target)
}

async function applyTar(file: FeedFile, version: string): Promise<void> {
  const dir = installDir()
  const parent = dirname(dir)
  const archive = join(tmpdir(), `hesperian-${version}-${process.pid}.tar.gz`)
  const staging = join(parent, `.${basename(dir)}-${version}`)
  const old = join(parent, `.${basename(dir)}-old`)
  await download(file, archive)
  progress('install')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', archive, '-C', staging, '--strip-components=1'], { stdio: 'ignore' })
    tar.on('error', reject)
    tar.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Не удалось распаковать обновление'))))
  })
  await rm(archive, { force: true })
  const exe = join(staging, basename(process.execPath))
  if (!existsSync(exe)) throw new Error('В архиве обновления нет программы')
  for (const name of await readdir(dir)) {
    const from = join(dir, name)
    if (!existsSync(join(staging, name)) && (await stat(from)).isFile()) await copyFile(from, join(staging, name))
  }
  await rm(old, { recursive: true, force: true })
  await rename(dir, old)
  try {
    await rename(staging, dir)
  } catch (e) {
    await rename(old, dir)
    throw e
  }
  relaunchLinux(process.execPath, old)
}

async function applyPortable(file: FeedFile, version: string): Promise<void> {
  const target = process.env.PORTABLE_EXECUTABLE_FILE!
  const temp = `${target}.${version}.update`
  await download(file, temp)
  progress('install')
  const child = spawn('cmd.exe', ['/d /c', windowsLoop(temp, target)], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
  child.unref()
}

function windowsLoop(from: string, to: string): string {
  return `for /l %i in (1,1,120) do (ping -n 2 127.0.0.1 >nul & move /y "${from}" "${to}" >nul 2>&1 && (start "" "${to}" & exit))`
}

async function applySetup(file: FeedFile, version: string): Promise<void> {
  const setup = join(tmpdir(), `Hesperian-Setup-${version}.exe`)
  await download(file, setup)
  progress('install')
  detached(setup, ['--update', '--dir', installDir()])
}

export async function installUpdate(): Promise<void> {
  if (busy) throw new Error('Обновление уже идёт')
  if (!pending) throw new Error('Для этой копии Hesperian автообновление недоступно, скачайте новую версию с сайта')
  busy = true
  const { file, kind, version } = pending
  try {
    if (kind === 'linux-appimage') await applyAppImage(file)
    else if (kind === 'linux-tar') await applyTar(file, version)
    else if (kind === 'win-portable') await applyPortable(file, version)
    else await applySetup(file, version)
    progress('restart')
    setTimeout(() => app.exit(0), 400)
  } catch (e) {
    busy = false
    taskbar(-1)
    throw e
  }
}

export async function cleanupUpdate(): Promise<void> {
  if (process.platform !== 'linux' || !app.isPackaged || process.env.APPIMAGE) return
  const dir = installDir()
  await rm(join(dirname(dir), `.${basename(dir)}-old`), { recursive: true, force: true }).catch(() => {})
}
