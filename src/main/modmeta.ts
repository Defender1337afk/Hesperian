import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConflictIssue, ConflictReport, Instance } from '../shared/types'
import { contentDir } from './content'
import { getInstance } from './instances'

type Loader = 'fabric' | 'quilt' | 'forge' | 'neoforge'

interface Dep {
  id: string
  range?: string
}

export interface ModMeta {
  file: string
  ids: string[]
  name: string
  version: string
  loaders: Loader[]
  depends: Dep[]
  breaks: Dep[]
  minecraft?: string
  forgeStyle?: boolean
}

const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'forge', 'neoforge', 'javafml', 'lowcodefml', 'mixinextras'])

const KNOWN: { a: string[]; b: string[]; text: string }[] = [
  { a: ['optifine', 'optifabric'], b: ['sodium', 'embeddium', 'rubidium', 'iris', 'oculus'], text: 'OptiFine не работает вместе с Sodium, Embeddium и Iris. Оставьте что-то одно.' },
  { a: ['sodium'], b: ['embeddium', 'rubidium'], text: 'Sodium и Embeddium делают одно и то же и мешают друг другу.' },
  { a: ['embeddium'], b: ['rubidium'], text: 'Embeddium и Rubidium делают одно и то же и мешают друг другу.' },
  { a: ['iris'], b: ['oculus'], text: 'Iris и Oculus делают одно и то же, нужен только один.' },
  { a: ['canvas'], b: ['sodium', 'iris'], text: 'Canvas не работает вместе с Sodium и Iris.' }
]

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)])

function fabricDeps(obj: Record<string, unknown> | undefined): Dep[] {
  if (!obj) return []
  return Object.entries(obj).map(([id, range]) => ({ id, range: asArray(range).join(' || ') || '*' }))
}

function quiltDeps(list: unknown): Dep[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((d) => {
    if (typeof d === 'string') return [{ id: d.split(':').pop()!, range: '*' }]
    if (d && typeof d === 'object' && 'id' in d) {
      const o = d as { id: string; versions?: unknown; optional?: boolean }
      if (o.optional) return []
      return [{ id: o.id.split(':').pop()!, range: asArray(o.versions).join(' || ') || '*' }]
    }
    return []
  })
}

function parseToml(text: string): { mods: { modId: string; version?: string; displayName?: string }[]; deps: Record<string, { modId: string; mandatory: boolean; versionRange?: string }[]> } {
  const mods: { modId: string; version?: string; displayName?: string }[] = []
  const deps: Record<string, { modId: string; mandatory: boolean; versionRange?: string }[]> = {}
  let section: { kind: 'mod' | 'dep' | 'other'; owner?: string; data: Record<string, string> } = { kind: 'other', data: {} }
  const flush = (): void => {
    if (section.kind === 'mod' && section.data.modId) mods.push({ modId: section.data.modId, version: section.data.version, displayName: section.data.displayName })
    if (section.kind === 'dep' && section.owner && section.data.modId) {
      const mandatory = section.data.mandatory === 'true' || section.data.type === 'required' || (section.data.mandatory === undefined && section.data.type === undefined)
      ;(deps[section.owner] ??= []).push({ modId: section.data.modId, mandatory, versionRange: section.data.versionRange })
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const header = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line)
    if (header) {
      flush()
      const name = header[1]
      if (name === 'mods') section = { kind: 'mod', data: {} }
      else if (name.startsWith('dependencies.')) section = { kind: 'dep', owner: name.slice('dependencies.'.length).replace(/"/g, ''), data: {} }
      else section = { kind: 'other', data: {} }
      continue
    }
    if (/^\[[^\]]+\]$/.test(line)) {
      flush()
      section = { kind: 'other', data: {} }
      continue
    }
    const kv = /^([A-Za-z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line)
    if (kv) section.data[kv[1]] = kv[2]
  }
  flush()
  return { mods, deps }
}

function readFromZip(zip: AdmZip, file: string, depth = 0): ModMeta | null {
  const text = (name: string): string | null => {
    const entry = zip.getEntry(name)
    return entry ? entry.getData().toString('utf8') : null
  }
  const nested = (list: string[]): string[] => {
    if (depth > 0) return []
    const ids: string[] = []
    for (const path of list) {
      const entry = zip.getEntry(path)
      if (!entry) continue
      try {
        const inner = readFromZip(new AdmZip(entry.getData()), path, depth + 1)
        if (inner) ids.push(...inner.ids)
      } catch {
        continue
      }
    }
    return ids
  }

  const fabric = text('fabric.mod.json')
  if (fabric) {
    try {
      const j = JSON.parse(fabric.replace(/^﻿/, '').replace(/[\u0000-\u0019]+/g, ' '))
      const depends = fabricDeps(j.depends)
      const provides = asArray(j.provides)
      const jars = Array.isArray(j.jars) ? j.jars.map((x: { file: string }) => x.file) : []
      return {
        file,
        ids: [j.id, ...provides, ...nested(jars)].filter(Boolean),
        name: j.name || j.id,
        version: String(j.version ?? ''),
        loaders: ['fabric', 'quilt'],
        depends: depends.filter((d) => d.id !== 'minecraft'),
        breaks: [...fabricDeps(j.breaks), ...fabricDeps(j.conflicts)],
        minecraft: depends.find((d) => d.id === 'minecraft')?.range
      }
    } catch {
      return { file, ids: [], name: file, version: '', loaders: ['fabric', 'quilt'], depends: [], breaks: [] }
    }
  }
  const quilt = text('quilt.mod.json')
  if (quilt) {
    try {
      const q = JSON.parse(quilt).quilt_loader ?? {}
      const depends = quiltDeps(q.depends)
      return {
        file,
        ids: [q.id, ...asArray(q.provides).map((p: unknown) => (typeof p === 'string' ? p : (p as { id: string }).id))].filter(Boolean),
        name: q.metadata?.name || q.id,
        version: String(q.version ?? ''),
        loaders: ['quilt'],
        depends: depends.filter((d) => d.id !== 'minecraft'),
        breaks: quiltDeps(q.breaks),
        minecraft: depends.find((d) => d.id === 'minecraft')?.range
      }
    } catch {
      return null
    }
  }
  const neo = text('META-INF/neoforge.mods.toml')
  const forge = text('META-INF/mods.toml')
  const toml = neo ?? forge
  if (toml) {
    const parsed = parseToml(toml)
    const deps = parsed.mods.flatMap((m) => parsed.deps[m.modId] ?? [])
    const mc = deps.find((d) => d.modId === 'minecraft')
    const first = parsed.mods[0]
    return {
      file,
      ids: parsed.mods.map((m) => m.modId),
      name: first?.displayName || first?.modId || file,
      version: first?.version ?? '',
      loaders: neo ? ['neoforge'] : ['forge', 'neoforge'],
      depends: deps.filter((d) => d.mandatory && d.modId !== 'minecraft').map((d) => ({ id: d.modId, range: d.versionRange })),
      breaks: [],
      minecraft: mc?.versionRange,
      forgeStyle: true
    }
  }
  if (zip.getEntry('mcmod.info')) return { file, ids: [], name: file, version: '', loaders: ['forge'], depends: [], breaks: [], forgeStyle: true }
  return null
}

export function readModMeta(path: string, file: string): ModMeta | null {
  try {
    return readFromZip(new AdmZip(path), file)
  } catch {
    return null
  }
}

const num = (v: string): number[] => v.split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1))

function cmp(a: string, b: string): number {
  const pa = num(a)
  const pb = num(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

function matchFabric(version: string, range: string): boolean {
  return range.split('||').some((alt) => {
    const parts = alt.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return true
    return parts.every((p) => {
      if (p === '*' || p === 'x') return true
      const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(p)!
      const op = m[1] ?? ''
      const target = m[2].replace(/-.*$/, '')
      if (/[xX*]/.test(target)) {
        const prefix = target.split('.').filter((x) => !/[xX*]/.test(x))
        const pv = version.split('.')
        return prefix.every((x, i) => x === pv[i])
      }
      const c = cmp(version, target)
      if (op === '>=') return c >= 0
      if (op === '<=') return c <= 0
      if (op === '>') return c > 0
      if (op === '<') return c < 0
      if (op === '~') {
        const t = target.split('.')
        return c >= 0 && version.split('.').slice(0, 2).join('.') === t.slice(0, 2).join('.')
      }
      if (op === '^') {
        const t = target.split('.')
        return c >= 0 && version.split('.')[0] === t[0] && (t[0] !== '1' || version.split('.')[1] === t[1])
      }
      return c === 0
    })
  })
}

function matchMaven(version: string, range: string): boolean {
  const r = range.trim()
  if (!r || r === '*') return true
  if (!/^[[(]/.test(r)) return cmp(version, r) >= 0
  return r.split(/(?<=[\])]),\s*(?=[[(])/).some((part) => {
    const m = /^([[(])\s*([^,]*)\s*(?:,\s*([^\])]*))?\s*([\])])$/.exec(part.trim())
    if (!m) return true
    const [, open, lo, hi, close] = m
    if (hi === undefined) return cmp(version, lo) === 0
    if (lo && (open === '[' ? cmp(version, lo) < 0 : cmp(version, lo) <= 0)) return false
    if (hi && (close === ']' ? cmp(version, hi) > 0 : cmp(version, hi) >= 0)) return false
    return true
  })
}

const fits = (version: string, range: string | undefined, maven: boolean): boolean => {
  if (!range) return true
  try {
    return maven ? matchMaven(version, range) : matchFabric(version, range)
  } catch {
    return true
  }
}

const loaderFits = (meta: ModMeta, instance: Instance): boolean => {
  if (instance.loader === 'vanilla') return false
  if (instance.loader === 'neoforge' && meta.loaders.includes('forge') && !meta.loaders.includes('neoforge')) return instance.mcVersion === '1.20.1'
  if (instance.loader === 'neoforge' && meta.forgeStyle && !meta.loaders.includes('neoforge')) return false
  return meta.loaders.includes(instance.loader as Loader)
}

const cache = new Map<string, { key: string; report: ConflictReport }>()

export async function checkConflicts(id: string): Promise<ConflictReport> {
  const instance = getInstance(id)
  const dir = contentDir(instance, 'mod')
  if (!existsSync(dir)) return { checked: 0, issues: [] }
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jar')).sort()
  const marks = await Promise.all(files.map(async (f) => {
    const st = await stat(join(dir, f)).catch(() => null)
    return `${f}:${st?.size}:${st?.mtimeMs}`
  }))
  const key = `${instance.mcVersion}|${instance.loader}|${marks.join('|')}`
  const hit = cache.get(id)
  if (hit && hit.key === key) return hit.report
  const report = await scan(instance, dir, files)
  cache.set(id, { key, report })
  return report
}

async function scan(instance: Instance, dir: string, files: string[]): Promise<ConflictReport> {
  const issues: ConflictIssue[] = []
  const metas: ModMeta[] = []
  for (const file of files) {
    const meta = readModMeta(join(dir, file), file)
    if (!meta) {
      issues.push({ level: 'warn', kind: 'unknown', files: [file], text: 'Не похоже на мод: внутри нет описания ни для Fabric, ни для Forge.' })
      continue
    }
    metas.push(meta)
  }

  const owners = new Map<string, ModMeta[]>()
  for (const m of metas) if (m.ids[0]) owners.set(m.ids[0], [...(owners.get(m.ids[0]) ?? []), m])
  for (const [modId, list] of owners) {
    if (list.length > 1) issues.push({ level: 'error', kind: 'duplicate', files: list.map((m) => m.file), text: `Мод «${list[0].name}» (${modId}) стоит ${list.length} раза. Оставьте одну версию.` })
  }

  for (const m of metas) {
    if (!loaderFits(m, instance)) {
      const wanted = instance.loader === 'vanilla' ? 'без загрузчика' : instance.loader
      issues.push({ level: 'error', kind: 'loader', files: [m.file], text: `«${m.name}» сделан для ${m.loaders.join(' / ')}, а сборка на ${wanted}.` })
      continue
    }
    if (m.minecraft && !fits(instance.mcVersion, m.minecraft, Boolean(m.forgeStyle))) {
      issues.push({ level: 'error', kind: 'version', files: [m.file], text: `«${m.name}» рассчитан на Minecraft ${m.minecraft}, а в сборке ${instance.mcVersion}.` })
    }
  }

  const present = new Map<string, ModMeta>()
  for (const m of metas) for (const i of m.ids) present.set(i, m)
  const fabricApi = present.has('fabric-api') || present.has('fabric')
  for (const m of metas) {
    if (!loaderFits(m, instance)) continue
    for (const d of m.depends) {
      if (BUILTIN.has(d.id)) continue
      if (d.id.startsWith('fabric-') && fabricApi) continue
      const has = present.get(d.id)
      if (!has) {
        issues.push({ level: 'error', kind: 'missing', files: [m.file], text: `«${m.name}» нужен мод ${d.id}${d.range && d.range !== '*' ? ` (${d.range})` : ''}, его нет в сборке.`, need: d.id })
        continue
      }
      if (d.range && has.version && !fits(has.version, d.range, Boolean(m.forgeStyle)) && !/^\$\{/.test(has.version)) {
        issues.push({ level: 'warn', kind: 'range', files: [m.file, has.file], text: `«${m.name}» хочет ${has.name} ${d.range}, а стоит ${has.version}.` })
      }
    }
    for (const b of m.breaks) {
      const other = present.get(b.id)
      if (other && other !== m && fits(other.version, b.range, false)) {
        issues.push({ level: 'error', kind: 'breaks', files: [m.file, other.file], text: `«${m.name}» несовместим с «${other.name}».` })
      }
    }
  }

  for (const rule of KNOWN) {
    const left = rule.a.map((i) => present.get(i)).find(Boolean)
    const right = rule.b.map((i) => present.get(i)).find(Boolean)
    if (left && right && left !== right) issues.push({ level: 'error', kind: 'known', files: [left.file, right.file], text: rule.text })
  }

  const seen = new Set<string>()
  const unique = issues.filter((i) => {
    const key = `${i.kind}:${i.files.join('|')}:${i.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  return { checked: files.length, issues: unique }
}
