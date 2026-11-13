import AdmZip from 'adm-zip'
import { clipboard, ClipboardItem, nativeImage, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { paths } from './config'
import { assertId } from './instances'

const THUMB_WIDTH = 360
const MAX_SHOTS = 120

export interface WorldInfo {
  name: string
  modifiedAt: number
  backups: { file: string; createdAt: number; size: number }[]
}

export interface ScreenshotInfo {
  file: string
  createdAt: number
  thumb: string
}

const safeName = (name: string): string => {
  if (!name || name !== basename(name) || name === '.' || name === '..') throw new Error(`Недопустимое имя: ${name}`)
  return name
}

const savesDir = (id: string): string => {
  assertId(id)
  return join(paths.gameDir(id), 'saves')
}

const backupsDir = (id: string): string => {
  assertId(id)
  return join(paths.gameDir(id), 'backups')
}

const shotsDir = (id: string): string => {
  assertId(id)
  return join(paths.gameDir(id), 'screenshots')
}

const stamp = (): string => {
  const d = new Date()
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`
}

export async function listWorlds(id: string): Promise<WorldInfo[]> {
  const saves = savesDir(id)
  if (!existsSync(saves)) return []
  const backupFiles = existsSync(backupsDir(id)) ? await readdir(backupsDir(id)) : []
  const worlds: WorldInfo[] = []
  for (const entry of await readdir(saves, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(saves, entry.name, 'level.dat'))) continue
    const info = await stat(join(saves, entry.name, 'level.dat'))
    const backups: WorldInfo['backups'] = []
    for (const file of backupFiles) {
      if (!file.startsWith(`${entry.name}__`) || !file.endsWith('.zip')) continue
      const meta = await stat(join(backupsDir(id), file))
      backups.push({ file, createdAt: meta.mtimeMs, size: meta.size })
    }
    backups.sort((a, b) => b.createdAt - a.createdAt)
    worlds.push({ name: entry.name, modifiedAt: info.mtimeMs, backups })
  }
  return worlds.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export async function backupWorld(id: string, world: string): Promise<void> {
  const source = join(savesDir(id), safeName(world))
  if (!existsSync(join(source, 'level.dat'))) throw new Error(`Мир не найден: ${world}`)
  await mkdir(backupsDir(id), { recursive: true })
  const zip = new AdmZip()
  await zip.addLocalFolderPromise(source, { zipPath: world })
  await zip.writeZipPromise(join(backupsDir(id), `${world}__${stamp()}.zip`))
}

export async function restoreBackup(id: string, file: string): Promise<string> {
  const archive = join(backupsDir(id), safeName(file))
  if (!existsSync(archive)) throw new Error(`Копия не найдена: ${file}`)
  const world = file.split('__')[0]
  const name = `${world} (копия ${stamp()})`
  const target = join(savesDir(id), name)
  await mkdir(target, { recursive: true })
  const zip = new AdmZip(archive)
  const prefix = `${world}/`
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const inner = entry.entryName.startsWith(prefix) ? entry.entryName.slice(prefix.length) : entry.entryName
    zip.extractEntryTo(entry, join(target, inner, '..'), false, true)
  }
  return name
}

export async function deleteBackup(id: string, file: string): Promise<void> {
  await rm(join(backupsDir(id), safeName(file)), { force: true })
}

export async function listScreenshots(id: string): Promise<ScreenshotInfo[]> {
  const dir = shotsDir(id)
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f))
  const dated = await Promise.all(files.map(async (file) => ({ file, createdAt: (await stat(join(dir, file))).mtimeMs })))
  dated.sort((a, b) => b.createdAt - a.createdAt)
  return dated.slice(0, MAX_SHOTS).map(({ file, createdAt }) => ({
    file,
    createdAt,
    thumb: nativeImage.createFromPath(join(dir, file)).resize({ width: THUMB_WIDTH, quality: 'good' }).toDataURL()
  }))
}

export async function openScreenshot(id: string, file: string): Promise<void> {
  const error = await shell.openPath(join(shotsDir(id), safeName(file)))
  if (error) throw new Error(error)
}

export async function copyScreenshot(id: string, file: string): Promise<void> {
  const png = nativeImage.createFromPath(join(shotsDir(id), safeName(file))).toPNG()
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
}

export async function trashScreenshot(id: string, file: string): Promise<void> {
  await shell.trashItem(join(shotsDir(id), safeName(file)))
}
