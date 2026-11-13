import { app, BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SkinLibraryItem, SkinProfile } from '../shared/types'
import { getLaunchAuth, setActiveSkin } from './accounts'
import { readJsonSync, writeJsonSync } from './config'
import { emit } from './events'

const API = 'https://api.minecraftservices.com/minecraft/profile'
const dir = (): string => join(app.getPath('userData'), 'skins')
const indexFile = (): string => join(dir(), 'library.json')
const MAX_SKIN = 64 * 1024

async function token(): Promise<string> {
  const auth = await getLaunchAuth()
  if (auth.userType !== 'msa') throw new Error('Скин меняется только у аккаунта с лицензией Minecraft')
  return auth.accessToken
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } })
  if (res.status === 429) throw new Error('Mojang просит подождать: слишком частая смена скина')
  if (!res.ok) throw new Error(`Mojang ответил ${res.status}`)
  return (await res.json()) as T
}

interface RawProfile {
  id: string
  name: string
  skins: { id: string; url: string; state: string; variant: 'CLASSIC' | 'SLIM' }[]
  capes: { id: string; url: string; state: string; alias: string }[]
}

const https = (url: string): string => url.replace(/^http:\/\//, 'https://')

function toProfile(raw: RawProfile): SkinProfile {
  const skin = raw.skins.find((s) => s.state === 'ACTIVE')
  setActiveSkin(skin?.url)
  return {
    name: raw.name,
    skinUrl: skin ? https(skin.url) : undefined,
    variant: skin?.variant === 'SLIM' ? 'slim' : 'classic',
    capes: raw.capes.map((c) => ({ id: c.id, alias: c.alias, url: https(c.url), active: c.state === 'ACTIVE' }))
  }
}

export const skinProfile = async (): Promise<SkinProfile> => toProfile(await call<RawProfile>(''))

function checkPng(data: Buffer): void {
  const png = data.length > 24 && data.readUInt32BE(0) === 0x89504e47
  if (!png) throw new Error('Скин должен быть картинкой PNG')
  if (data.length > MAX_SKIN) throw new Error('Файл скина слишком большой')
  const w = data.readUInt32BE(16)
  const h = data.readUInt32BE(20)
  if (w !== 64 || (h !== 64 && h !== 32)) throw new Error(`Скин должен быть 64×64 или 64×32, а этот ${w}×${h}`)
}

export async function uploadSkin(dataUrl: string, variant: 'classic' | 'slim'): Promise<SkinProfile> {
  const data = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
  checkPng(data)
  const body = new FormData()
  body.append('variant', variant)
  body.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'skin.png')
  return toProfile(await call<RawProfile>('/skins', { method: 'POST', body }))
}

export const resetSkin = async (): Promise<SkinProfile> => toProfile(await call<RawProfile>('/skins/active', { method: 'DELETE' }))

export async function setCape(id: string | null): Promise<SkinProfile> {
  if (id) return toProfile(await call<RawProfile>('/capes/active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId: id }) }))
  return toProfile(await call<RawProfile>('/capes/active', { method: 'DELETE' }))
}

export function skinLibrary(): SkinLibraryItem[] {
  return readJsonSync<Omit<SkinLibraryItem, 'data'>[]>(indexFile(), [])
    .filter((s) => existsSync(join(dir(), `${s.id}.png`)))
    .map((s) => ({ ...s, data: `data:image/png;base64,${readFileSync(join(dir(), `${s.id}.png`)).toString('base64')}` }))
}

export function saveSkin(name: string, dataUrl: string, variant: 'classic' | 'slim'): SkinLibraryItem[] {
  const data = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
  checkPng(data)
  mkdirSync(dir(), { recursive: true })
  const id = randomUUID()
  writeFileSync(join(dir(), `${id}.png`), data)
  const list = readJsonSync<Omit<SkinLibraryItem, 'data'>[]>(indexFile(), [])
  list.unshift({ id, name: name.trim() || 'Скин', variant, addedAt: Date.now() })
  writeJsonSync(indexFile(), list)
  return skinLibrary()
}

export function removeSkin(id: string): SkinLibraryItem[] {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Неверный скин')
  rmSync(join(dir(), `${id}.png`), { force: true })
  writeJsonSync(indexFile(), readJsonSync<Omit<SkinLibraryItem, 'data'>[]>(indexFile(), []).filter((s) => s.id !== id))
  return skinLibrary()
}

export async function skinFromUrl(url: string): Promise<string> {
  if (!/^https:\/\//.test(url)) throw new Error('Ссылка должна начинаться с https://')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Не удалось скачать скин: ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  checkPng(data)
  return `data:image/png;base64,${data.toString('base64')}`
}

export const SKIN_PARTITION = 'persist:skins'

export function watchSkinBrowser(): void {
  session.fromPartition(SKIN_PARTITION).on('will-download', (event, item) => {
    event.preventDefault()
    const url = item.getURL()
    const name = item.getFilename().replace(/\.png$/i, '')
    skinFromUrl(url)
      .then((data) => emit('skins:found', { name, data }))
      .catch((e: unknown) => emit('skins:found', { name, error: e instanceof Error ? e.message : String(e) }))
  })
  session.fromPartition(SKIN_PARTITION).setPermissionRequestHandler((_wc, _permission, allow) => allow(false))
}

export function allowSkinWebviews(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, prefs, params) => {
    if (params.partition !== SKIN_PARTITION || !/^https:\/\//.test(params.src)) {
      event.preventDefault()
      return
    }
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
  })
}
