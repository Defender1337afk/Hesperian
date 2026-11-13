import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from './config'
import { download, fetchJson } from './net'

const RELEASES = 'https://api.github.com/repos/horizon-rust/horizon/releases?per_page=30'
const TAG_PREFIX = 'launcher@'
const ASSET = 'horizon-launcher-windows-x64.zip'
const EXE = 'horizon-launcher.exe'

interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string; digest?: string }[]
}

const root = (): string => join(dataRoot(), 'experimental', 'horizon')
const stateFile = (): string => join(root(), 'current.json')
const folderFor = (tag: string): string => join(root(), tag.replace(/[^\w.-]/g, '_'))

async function installedTag(): Promise<string | null> {
  try {
    const { tag } = JSON.parse(await readFile(stateFile(), 'utf8')) as { tag: string }
    return existsSync(join(folderFor(tag), EXE)) ? tag : null
  } catch {
    return null
  }
}

async function install(release: Release): Promise<void> {
  const asset = release.assets.find((a) => a.name === ASSET)
  const sha256 = asset?.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null
  if (!asset || !sha256) throw new Error(`В релизе Horizon ${release.tag_name} нет файла для Windows с контрольной суммой`)
  const archive = join(root(), ASSET)
  await download(asset.browser_download_url, archive, { checksum: { algo: 'sha256', value: sha256 } })
  const entry = new AdmZip(archive).getEntry(EXE)
  if (!entry) throw new Error(`В архиве Horizon нет ${EXE}`)
  const folder = folderFor(release.tag_name)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, EXE), entry.getData())
  await writeFile(stateFile(), JSON.stringify({ tag: release.tag_name }))
  await rm(archive, { force: true })
  for (const name of await readdir(root(), { withFileTypes: true })) {
    if (name.isDirectory() && join(root(), name.name) !== folder) await rm(join(root(), name.name), { recursive: true, force: true })
  }
}

export async function ensureHorizon(): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Horizon в Hesperian пока запускается только на Windows')
  await mkdir(root(), { recursive: true })
  const current = await installedTag()
  try {
    const releases = await fetchJson<Release[]>(RELEASES)
    const latest = releases.find((r) => r.tag_name.startsWith(TAG_PREFIX) && !r.draft && !r.prerelease)
    if (!latest) throw new Error('На GitHub не нашлось релиза лаунчера Horizon')
    if (latest.tag_name !== current) await install(latest)
    return join(folderFor(latest.tag_name), EXE)
  } catch (e) {
    if (current) return join(folderFor(current), EXE)
    throw e
  }
}
