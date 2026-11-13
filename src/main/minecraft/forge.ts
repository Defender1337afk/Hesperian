import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve, sep } from 'node:path'
import type { LoaderVersion } from '../../shared/types'
import { dataRoot, paths } from '../config'
import type { Task } from '../events'
import { download, fetchJson, fetchText } from '../net'
import { mavenPath, RawLibrary } from './library'
import { fetchLibraries, readVersionJson, VersionJson } from './vanilla'

const MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged'
const PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'

interface Processor {
  jar: string
  classpath: string[]
  args: string[]
  sides?: string[]
}

interface ModernProfile {
  json?: string
  libraries: RawLibrary[]
  processors?: Processor[]
  data?: Record<string, { client: string; server: string }>
}

const compareNumeric = (a: string, b: string): number => {
  const pa = a.split(/[.-]/).map(Number)
  const pb = b.split(/[.-]/).map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return diff
  }
  return 0
}

const versionsOf = (xml: string): string[] => [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])

export async function forgeVersions(mc: string): Promise<LoaderVersion[]> {
  const [xml, promos] = await Promise.all([
    fetchText(`${MAVEN}/maven-metadata.xml`),
    fetchJson<{ promos: Record<string, string> }>(PROMOTIONS).catch(() => ({ promos: {} as Record<string, string> }))
  ])
  const prefix = `${mc}-`
  const recommended = promos.promos[`${mc}-recommended`]
  const latest = promos.promos[`${mc}-latest`]
  return versionsOf(xml)
    .filter((full) => full.startsWith(prefix))
    .map((full) => full.slice(prefix.length))
    .sort((a, b) => compareNumeric(b, a))
    .map((version) => ({
      version,
      tag: version === recommended ? 'recommended' : version === latest ? 'latest' : undefined
    }))
}

const neoGameVersion = (version: string): string => {
  const [major, minor, patch] = version.split('-')[0].split('.')
  if (Number(major) < 26) return minor === '0' ? `1.${major}` : `1.${major}.${minor}`
  return patch === '0' ? `${major}.${minor}` : `${major}.${minor}.${patch}`
}

export async function neoforgeVersions(mc: string): Promise<LoaderVersion[]> {
  const list =
    mc === '1.20.1'
      ? versionsOf(await fetchText(`${NEO_MAVEN}/forge/maven-metadata.xml`))
          .filter((v) => v.startsWith('1.20.1-'))
          .map((v) => v.slice('1.20.1-'.length))
      : versionsOf(await fetchText(`${NEO_MAVEN}/neoforge/maven-metadata.xml`)).filter((v) => neoGameVersion(v) === mc)
  const sorted = list.sort((a, b) => compareNumeric(b, a))
  const stable = sorted.find((v) => !v.includes('-'))
  return sorted.map((version) => ({ version, tag: version === stable ? 'recommended' : undefined }))
}

const installerUrl = (kind: 'forge' | 'neoforge', mc: string, version: string): string => {
  if (kind === 'forge') return `${MAVEN}/${mc}-${version}/forge-${mc}-${version}-installer.jar`
  if (mc === '1.20.1') return `${NEO_MAVEN}/forge/1.20.1-${version}/forge-1.20.1-${version}-installer.jar`
  return `${NEO_MAVEN}/neoforge/${version}/neoforge-${version}-installer.jar`
}

const unwrapData = async (zip: AdmZip, tmp: string, value: string): Promise<string> => {
  if (!value.startsWith('/')) return value
  const entry = zip.getEntry(value.slice(1))
  if (!entry) throw new Error(`В установщике нет ${value}`)
  const out = join(tmp, value.slice(1).replaceAll('/', '_'))
  await writeFile(out, entry.getData())
  return out
}

function runProcessor(java: string, proc: Processor, resolveArg: (arg: string) => string): Promise<void> {
  const lib = (coord: string): string => join(paths.libraries(), mavenPath(coord))
  const manifest = new AdmZip(lib(proc.jar)).readAsText('META-INF/MANIFEST.MF')
  const mainClass = /^Main-Class:\s*(.+?)\s*$/m.exec(manifest)?.[1]
  if (!mainClass) throw new Error(`У процессора ${proc.jar} нет Main-Class`)
  const classpath = [proc.jar, ...proc.classpath].map(lib).join(delimiter)
  return new Promise((resolve, reject) => {
    const child = spawn(java, ['-cp', classpath, mainClass, ...proc.args.map(resolveArg)], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (d) => (output = (output + d).slice(-4000)))
    child.stderr.on('data', (d) => (output = (output + d).slice(-4000)))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Процессор ${proc.jar} завершился с кодом ${code}\n${output}`))
    )
  })
}

async function installModern(
  zip: AdmZip,
  profile: ModernProfile,
  mc: string,
  java: string,
  installer: string,
  task: Task
): Promise<string> {
  const version = JSON.parse(zip.readAsText((profile.json ?? '/version.json').slice(1))) as VersionJson

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('maven/')) continue
    const dest = resolve(paths.libraries(), entry.entryName.slice('maven/'.length))
    if (!dest.startsWith(resolve(paths.libraries()) + sep)) throw new Error(`Опасный путь в архиве: ${entry.entryName}`)
    if (existsSync(dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, entry.getData())
  }

  await fetchLibraries(profile.libraries, task)

  const processors = (profile.processors ?? []).filter((p) => !p.sides || p.sides.includes('client'))
  if (processors.length) {
    const tmp = await mkdtemp(join(tmpdir(), 'hesperian-forge-'))
    try {
      const vars: Record<string, string> = {
        SIDE: 'client',
        MINECRAFT_JAR: paths.versionJar(mc),
        MINECRAFT_VERSION: mc,
        ROOT: dataRoot(),
        INSTALLER: installer,
        LIBRARY_DIR: paths.libraries()
      }
      for (const [key, value] of Object.entries(profile.data ?? {})) {
        vars[key] = await unwrapData(zip, tmp, value.client)
      }
      const resolveArg = (arg: string): string => {
        const substituted = arg.replace(/\{(\w+)\}/g, (whole, key) => vars[key] ?? whole)
        if (substituted.startsWith('[') && substituted.endsWith(']')) {
          return join(paths.libraries(), mavenPath(substituted.slice(1, -1)))
        }
        if (substituted.startsWith("'") && substituted.endsWith("'")) return substituted.slice(1, -1)
        return substituted
      }
      task.stage('Сборка Forge', processors.length)
      let done = 0
      for (const proc of processors) {
        await runProcessor(java, proc, resolveArg)
        task.progress(++done)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }

  await mkdir(dirname(paths.versionJson(version.id)), { recursive: true })
  await writeFile(paths.versionJson(version.id), JSON.stringify(version, null, 2))
  return version.id
}

export async function installForgeLike(
  kind: 'forge' | 'neoforge',
  mc: string,
  version: string,
  java: string,
  task: Task,
  verify = false
): Promise<string> {
  const marker = join(paths.versions(), `.${kind}`, `${mc}-${version}.id`)
  if (existsSync(marker)) {
    const id = (await readFile(marker, 'utf8')).trim()
    if (existsSync(paths.versionJson(id))) {
      await fetchLibraries((await readVersionJson(id)).libraries, task, verify)
      return id
    }
  }

  const installer = join(paths.versions(), `.${kind}`, `${mc}-${version}-installer.jar`)
  task.stage(`Установщик ${kind === 'forge' ? 'Forge' : 'NeoForge'} ${version}`)
  await download(installerUrl(kind, mc, version), installer, {
    onBytes: (received, total) => task.progress(received, total)
  })
  const zip = new AdmZip(installer)
  const profile = JSON.parse(zip.readAsText('install_profile.json')) as ModernProfile
  const id = await installModern(zip, profile, mc, java, installer, task)
  await fetchLibraries((await readVersionJson(id)).libraries, task, verify)
  await writeFile(marker, id)
  await rm(installer, { force: true })
  return id
}
