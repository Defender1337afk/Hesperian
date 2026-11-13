import { join } from 'node:path'
import { paths } from '../config'

export interface Artifact {
  path?: string
  url: string
  sha1?: string
  size?: number
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}

export interface RawLibrary {
  name: string
  url?: string
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> }
  natives?: Record<string, string>
  rules?: Rule[]
  extract?: { exclude?: string[] }
  clientreq?: boolean
  serverreq?: boolean
}

export interface LibraryFile {
  dest: string
  urls: string[]
  sha1?: string
  size?: number
  native: boolean
  exclude?: string[]
}

const MIRRORS = [
  'https://libraries.minecraft.net/',
  'https://maven.minecraftforge.net/',
  'https://maven.neoforged.net/releases/',
  'https://repo1.maven.org/maven2/'
]

export const osName = (): 'windows' | 'osx' | 'linux' =>
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'

export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules?.length) return true
  let allowed = false
  for (const rule of rules) {
    if (rule.os?.name && rule.os.name !== osName()) continue
    if (rule.os?.arch && rule.os.arch !== (process.arch === 'x64' ? 'x86_64' : process.arch)) continue
    if (rule.features && Object.entries(rule.features).some(([k, v]) => Boolean(features[k]) !== v)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

export function mavenPath(coord: string): string {
  const [spec, ext = 'jar'] = coord.split('@')
  const [group, artifact, version, classifier] = spec.split(':')
  const suffix = classifier ? `-${classifier}` : ''
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${suffix}.${ext}`
}

const withMirrors = (path: string, base?: string): string[] => {
  const normalized = base ? [base.endsWith('/') ? base : `${base}/`] : []
  return [...new Set([...normalized, ...MIRRORS])].map((root) => root + path)
}

export function libraryKey(lib: RawLibrary): string {
  const [group, artifact, , classifier] = lib.name.split('@')[0].split(':')
  return `${group}:${artifact}:${classifier ?? ''}`
}

export function libraryFiles(lib: RawLibrary): LibraryFile[] {
  if (!rulesAllow(lib.rules) || lib.clientreq === false) return []
  const root = paths.libraries()
  const files: LibraryFile[] = []

  const artifact = lib.downloads?.artifact
  if (artifact) {
    const rel = artifact.path || mavenPath(lib.name)
    files.push({
      dest: join(root, rel),
      urls: artifact.url ? [artifact.url] : [],
      sha1: artifact.sha1,
      size: artifact.size,
      native: false
    })
  } else if (!lib.downloads && !lib.natives) {
    const rel = mavenPath(lib.name)
    files.push({ dest: join(root, rel), urls: withMirrors(rel, lib.url), native: false })
  }

  const nativeKey = lib.natives?.[osName()]
  if (nativeKey) {
    const classifier = nativeKey.replace('${arch}', '64')
    const entry = lib.downloads?.classifiers?.[classifier]
    const rel = entry?.path || mavenPath(`${lib.name}:${classifier}`)
    files.push({
      dest: join(root, rel),
      urls: entry?.url ? [entry.url] : withMirrors(rel, lib.url),
      sha1: entry?.sha1,
      size: entry?.size,
      native: true,
      exclude: lib.extract?.exclude
    })
  }
  return files
}
