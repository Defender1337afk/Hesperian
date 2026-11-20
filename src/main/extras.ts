import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Instance } from '../shared/types'
import { getSettings, paths } from './config'
import { emit } from './events'
import { backupWorld } from './gallery'
import { getInstance, listInstances } from './instances'

let tray: Tray | null = null
let launcher: ((id: string) => Promise<void>) | null = null
let opener: (() => void) | null = null

export const setLauncher = (fn: (id: string) => Promise<void>, open: () => void): void => {
  launcher = fn
  opener = open
}

const iconPath = (): string => join(__dirname, '../renderer/icon.png')

export const launchArg = (argv: string[]): string | null => {
  const arg = argv.find((a) => a.startsWith('--launch='))
  return arg ? arg.slice('--launch='.length) : null
}

export function handleLaunchArg(argv: string[]): void {
  const id = launchArg(argv)
  if (!id || !launcher) return
  try {
    getInstance(id)
  } catch {
    emit('app:toast', { text: 'Сборка из ярлыка не найдена', kind: 'warn' })
    return
  }
  setTimeout(() => {
    void launcher!(id).catch((e) => emit('app:toast', { text: e instanceof Error ? e.message : String(e), kind: 'error' }))
  }, 1800)
}

const recent = async (): Promise<Instance[]> =>
  (await listInstances())
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, 6)

export async function refreshTray(): Promise<void> {
  const want = getSettings().minimizeToTray
  if (!want) {
    tray?.destroy()
    tray = null
    return
  }
  if (!tray) {
    const image = nativeImage.createFromPath(iconPath()).resize({ width: 22, height: 22 })
    tray = new Tray(image)
    tray.setToolTip('Hesperian')
    tray.on('click', () => opener?.())
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Hesperian', click: () => opener?.() },
      { type: 'separator' },
      ...(await recent()).map((i) => ({ label: `Играть: ${i.name}`, click: () => void launcher?.(i.id).catch(() => {}) })),
      { type: 'separator' },
      { label: 'Выйти', click: () => app.exit(0) }
    ])
  )
}

export const trayActive = (): boolean => Boolean(tray)

const exeForShortcut = (): string => process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath

const fileSafe = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Hesperian'

export async function createShortcut(id: string): Promise<string> {
  const instance = getInstance(id)
  const desktop = app.getPath('desktop')
  await mkdir(desktop, { recursive: true })
  const exe = exeForShortcut()
  const devArgs = app.isPackaged ? '' : ` "${app.getAppPath()}"`
  if (process.platform === 'win32') {
    const target = join(desktop, `${fileSafe(instance.name)}.lnk`)
    const ok = shell.writeShortcutLink(target, {
      target: exe,
      args: `${app.isPackaged ? '' : `"${app.getAppPath()}" `}--launch=${id}`,
      description: `Minecraft ${instance.mcVersion}: ${instance.name}`,
      icon: exe,
      iconIndex: 0
    })
    if (!ok) throw new Error('Не удалось создать ярлык')
    return target
  }
  const icon = existsSync(join(exe, '..', 'icon.png')) ? join(exe, '..', 'icon.png') : iconPath()
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${instance.name}`,
    `Comment=Minecraft ${instance.mcVersion} в Hesperian`,
    `Exec="${exe}"${devArgs} --launch=${id}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Game;'
  ].join('\n')
  const target = join(desktop, `hesperian-${id}.desktop`)
  await writeFile(target, entry + '\n')
  await chmod(target, 0o755)
  const apps = join(app.getPath('home'), '.local', 'share', 'applications')
  await mkdir(apps, { recursive: true }).catch(() => {})
  await writeFile(join(apps, `hesperian-${id}.desktop`), entry + '\n').catch(() => {})
  return target
}

const AUTO_KEEP = 3

export async function autoBackupWorlds(id: string): Promise<number> {
  const saves = join(paths.gameDir(id), 'saves')
  if (!existsSync(saves)) return 0
  const worlds = (await readdir(saves, { withFileTypes: true })).filter((d) => d.isDirectory() && existsSync(join(saves, d.name, 'level.dat')))
  let done = 0
  for (const w of worlds) {
    await backupWorld(id, w.name)
    done++
    const dir = join(paths.gameDir(id), 'backups')
    const mine = (await readdir(dir)).filter((f) => f.startsWith(`${w.name}__`)).sort()
    for (const old of mine.slice(0, Math.max(0, mine.length - AUTO_KEEP))) await rm(join(dir, old), { force: true })
  }
  return done
}

export const focusMain = (): void => {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

async function walk(dir: string, visit: (path: string, size: number, mtime: number) => void): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, visit)
    else if (e.isFile()) {
      const st = await stat(p).catch(() => null)
      if (st) visit(p, st.size, st.mtimeMs)
    }
  }
}

export async function instanceSize(id: string): Promise<{ total: number; junk: number }> {
  const root = paths.instanceDir(id)
  let total = 0
  let junk = 0
  const cutoff = Date.now() - 14 * 86400000
  await walk(root, (p, size, mtime) => {
    total += size
    if (isJunk(p, mtime, cutoff)) junk += size
  })
  return { total, junk }
}

const isJunk = (p: string, mtime: number, cutoff: number): boolean =>
  p.endsWith('.part') ||
  (/[\\/]logs[\\/]/.test(p) && /\.log\.gz$/.test(p) && mtime < cutoff) ||
  (/[\\/]crash-reports[\\/]/.test(p) && mtime < cutoff) ||
  (/[\\/]game[\\/]hs_err_pid\d+\.log$/.test(p) && mtime < cutoff)

export async function cleanInstance(id: string): Promise<number> {
  const cutoff = Date.now() - 14 * 86400000
  const victims: { p: string; size: number }[] = []
  await walk(paths.instanceDir(id), (p, size, mtime) => {
    if (isJunk(p, mtime, cutoff)) victims.push({ p, size })
  })
  let freed = 0
  for (const v of victims) {
    await rm(v.p, { force: true })
    freed += v.size
  }
  return freed
}
