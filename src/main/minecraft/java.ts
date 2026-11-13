import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { paths } from '../config'
import type { Task } from '../events'
import { download, fetchJson } from '../net'

interface AdoptiumAsset {
  binary: { package: { link: string; checksum: string; name: string; size: number } }
  release_name: string
}

const isWin = process.platform === 'win32'
const javaBin = (home: string, gui: boolean): string =>
  join(home, 'bin', isWin ? (gui ? 'javaw.exe' : 'java.exe') : 'java')

const adoptiumMajor = (major: number): number => (major === 16 ? 17 : major)

const bundledHome = (major: number): string => join(paths.runtimes(), `java${major}`)

export const javaVersion = (java: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const proc = spawn(java, ['-version'], { windowsHide: true })
    let out = ''
    proc.stderr.on('data', (d) => (out += d))
    proc.stdout.on('data', (d) => (out += d))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve(out.split('\n')[0].trim()) : reject(new Error(out))))
  })

async function installBundled(major: number, task: Task): Promise<void> {
  const os = isWin ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' && !(os === 'mac' && major === 8) ? 'aarch64' : 'x64'
  const assets = await fetchJson<AdoptiumAsset[]>(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`
  )
  const pkg = assets[0]?.binary.package
  if (!pkg) throw new Error(`Для этой системы не нашлось сборки Java ${major}`)

  task.stage(`Скачивание Java ${major}`, pkg.size)
  const archive = join(paths.runtimes(), pkg.name)
  await download(pkg.link, archive, {
    checksum: { algo: 'sha256', value: pkg.checksum },
    onBytes: (received) => task.progress(received, pkg.size)
  })

  task.stage(`Распаковка Java ${major}`)
  const tmp = join(paths.runtimes(), `java${major}.tmp`)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  if (pkg.name.endsWith('.zip')) {
    await new Promise<void>((resolve, reject) =>
      new AdmZip(archive).extractAllToAsync(tmp, true, false, (e) => (e ? reject(e) : resolve()))
    )
  } else {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', ['-xzf', archive, '-C', tmp])
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar завершился с кодом ${code}`))))
    })
  }
  const [root] = await readdir(tmp)
  const home = process.platform === 'darwin' ? join(tmp, root, 'Contents', 'Home') : join(tmp, root)
  await rm(bundledHome(major), { recursive: true, force: true })
  await rename(home, bundledHome(major))
  await rm(tmp, { recursive: true, force: true })
  await rm(archive, { force: true })
}

export async function ensureJava(requested: number, task: Task, override?: string): Promise<{ java: string; javaGui: string }> {
  if (override) {
    if (!existsSync(override)) throw new Error(`Java не найдена: ${override}`)
    return { java: override, javaGui: override }
  }
  const major = adoptiumMajor(requested)
  if (!existsSync(javaBin(bundledHome(major), false))) await installBundled(major, task)
  return { java: javaBin(bundledHome(major), false), javaGui: javaBin(bundledHome(major), true) }
}
