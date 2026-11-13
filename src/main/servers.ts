import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import type { FriendServer, LocalServer, ServerAddress, ServerPing, ServerStatus } from '../shared/types'
import { dataRoot, readJsonSync, writeJsonSync } from './config'
import { emit, Task } from './events'
import { ensureJava } from './minecraft/java'
import { ensureVersionJson, readVersionJson } from './minecraft/vanilla'
import { download, fetchJson } from './net'

const root = (): string => join(dataRoot(), 'servers')
const dir = (id: string): string => join(root(), id)
const metaFile = (id: string): string => join(dir(id), 'hesperian-server.json')
const friendsFile = (): string => join(dataRoot(), 'friend-servers.json')

const running = new Map<string, { child: ChildProcess; players: Set<string>; startedAt: number }>()
const logs = new Map<string, string[]>()
const MAX_LOG = 600

const checkId = (id: string): void => {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('Неверный id сервера')
}

function slug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'server'
  let id = base
  for (let n = 2; existsSync(dir(id)); n++) id = `${base}-${n}`
  return id
}

function status(id: string): ServerStatus {
  const r = running.get(id)
  if (!r) return { state: 'stopped', players: [] }
  return { state: r.startedAt ? 'running' : 'starting', players: [...r.players], startedAt: r.startedAt || undefined }
}

export function listServers(): LocalServer[] {
  if (!existsSync(root())) return []
  return readdirSync(root())
    .filter((id) => existsSync(metaFile(id)))
    .map((id) => ({ ...readJsonSync<LocalServer>(metaFile(id), {} as LocalServer), status: status(id) }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

const getServer = (id: string): LocalServer => {
  checkId(id)
  if (!existsSync(metaFile(id))) throw new Error('Сервер не найден')
  return { ...readJsonSync<LocalServer>(metaFile(id), {} as LocalServer), status: status(id) }
}

function writeProperties(s: LocalServer): void {
  const file = join(dir(s.id), 'server.properties')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const props = new Map<string, string>()
  for (const line of current.split('\n')) {
    const m = /^([^#=\s][^=]*)=(.*)$/.exec(line.trim())
    if (m) props.set(m[1], m[2])
  }
  const set: Record<string, string> = {
    'server-port': String(s.port),
    'max-players': String(s.maxPlayers),
    motd: s.motd.replace(/\n/g, ' '),
    'online-mode': String(s.onlineMode),
    gamemode: s.gamemode,
    difficulty: s.difficulty,
    pvp: String(s.pvp),
    'enable-status': 'true'
  }
  for (const [k, v] of Object.entries(set)) props.set(k, v)
  writeFileSync(file, `# Hesperian\n${[...props].map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
}

export function createServer(input: { name: string; mcVersion: string; loader: 'vanilla' | 'fabric'; acceptEula: boolean }): LocalServer {
  if (!input.acceptEula) throw new Error('Чтобы запустить сервер, нужно принять EULA Minecraft')
  const name = input.name.trim() || `Сервер ${input.mcVersion}`
  const id = slug(name)
  mkdirSync(dir(id), { recursive: true })
  const used = new Set(listServers().map((s) => s.port))
  let port = 25565
  while (used.has(port)) port++
  const server: LocalServer = {
    id,
    name,
    mcVersion: input.mcVersion,
    loader: input.loader,
    port,
    maxPlayers: 10,
    motd: `${name} · Hesperian`,
    onlineMode: false,
    gamemode: 'survival',
    difficulty: 'normal',
    pvp: true,
    memoryMb: 2048,
    createdAt: Date.now(),
    status: { state: 'stopped', players: [] }
  }
  writeJsonSync(metaFile(id), { ...server, status: undefined })
  writeFileSync(join(dir(id), 'eula.txt'), `# Принято в Hesperian ${new Date().toISOString()}\neula=true\n`)
  writeProperties(server)
  return server
}

export function updateServer(id: string, patch: Partial<LocalServer>): LocalServer {
  const current = getServer(id)
  const next = { ...current, ...patch, id: current.id, createdAt: current.createdAt }
  writeJsonSync(metaFile(id), { ...next, status: undefined })
  writeProperties(next)
  return { ...next, status: status(id) }
}

export function removeServer(id: string): void {
  checkId(id)
  if (running.has(id)) throw new Error('Сначала остановите сервер')
  rmSync(dir(id), { recursive: true, force: true })
}

export async function openServerFolder(id: string): Promise<void> {
  checkId(id)
  await shell.openPath(dir(id))
}

async function ensureJar(s: LocalServer, task: Task): Promise<string> {
  if (s.loader === 'fabric') {
    const jar = join(dir(s.id), 'fabric-server-launch.jar')
    if (existsSync(jar)) return jar
    task.stage('Fabric для сервера')
    const loaders = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(`https://meta.fabricmc.net/v2/versions/loader/${s.mcVersion}`)
    const installers = await fetchJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/installer')
    const loader = (loaders.find((l) => l.loader.stable) ?? loaders[0])?.loader.version
    const installer = (installers.find((i) => i.stable) ?? installers[0])?.version
    if (!loader || !installer) throw new Error(`Fabric не поддерживает Minecraft ${s.mcVersion}`)
    await download(`https://meta.fabricmc.net/v2/versions/loader/${s.mcVersion}/${loader}/${installer}/server/jar`, jar, {
      onBytes: (r, t) => task.progress(r, t)
    })
    return jar
  }
  const jar = join(dir(s.id), 'server.jar')
  if (existsSync(jar)) return jar
  task.stage('Сервер Minecraft')
  const version = await readVersionJson(s.mcVersion)
  const server = version.downloads?.server
  if (!server) throw new Error(`Mojang не выпускает сервер для ${s.mcVersion}`)
  await download(server.url, jar, { checksum: { algo: 'sha1', value: server.sha1 }, onBytes: (r, t) => task.progress(r, t) })
  return jar
}

function log(id: string, text: string): void {
  const list = logs.get(id) ?? []
  list.push(text)
  if (list.length > MAX_LOG) list.splice(0, list.length - MAX_LOG)
  logs.set(id, list)
  emit('server:log', { serverId: id, text })
}

export const serverLog = (id: string): string[] => logs.get(id) ?? []

export async function startServer(id: string): Promise<void> {
  const s = getServer(id)
  if (running.has(id)) return
  const task = new Task(`Запуск сервера: ${s.name}`)
  try {
    await ensureVersionJson(s.mcVersion, task)
    const version = await readVersionJson(s.mcVersion)
    const { java } = await ensureJava(version.javaVersion?.majorVersion ?? 17, task)
    const jar = await ensureJar(s, task)
    writeProperties(s)
    task.finish()
    logs.set(id, [])
    const child = spawn(java, [`-Xmx${s.memoryMb}M`, `-Xms${Math.min(1024, s.memoryMb)}M`, '-XX:+UseG1GC', '-jar', jar, 'nogui'], {
      cwd: dir(id),
      windowsHide: true
    })
    const entry = { child, players: new Set<string>(), startedAt: 0 }
    running.set(id, entry)
    emit('server:state', { serverId: id, status: status(id) })
    const onLine = (line: string): void => {
      log(id, line)
      if (!entry.startedAt && /Done \([\d.,]+s\)!/.test(line)) {
        entry.startedAt = Date.now()
        emit('server:state', { serverId: id, status: status(id) })
      }
      const joined = /]: (\w{3,16}) joined the game/.exec(line)
      const left = /]: (\w{3,16}) left the game/.exec(line)
      if (joined) entry.players.add(joined[1])
      if (left) entry.players.delete(left[1])
      if (joined || left) emit('server:state', { serverId: id, status: status(id) })
    }
    let buffer = ''
    const feed = (data: Buffer): void => {
      buffer += data.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(onLine)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('error', (e) => log(id, `Не удалось запустить Java: ${e.message}`))
    child.on('close', (code) => {
      running.delete(id)
      log(id, `Hesperian: сервер остановлен, код ${code}`)
      emit('server:state', { serverId: id, status: status(id) })
    })
  } catch (e) {
    task.fail(e)
    throw e
  }
}

export function stopServer(id: string): void {
  const r = running.get(id)
  if (!r) return
  r.child.stdin?.write('stop\n')
  setTimeout(() => {
    if (running.get(id) === r) r.child.kill()
  }, 20000)
}

export function sendCommand(id: string, command: string): void {
  const r = running.get(id)
  if (!r) throw new Error('Сервер не запущен')
  const text = command.trim().replace(/^\//, '')
  if (!text) return
  log(id, `> ${text}`)
  r.child.stdin?.write(`${text}\n`)
}

export const anyServerRunning = (): boolean => running.size > 0

export function stopAllServers(): void {
  for (const id of running.keys()) stopServer(id)
}

export function serverAddresses(): ServerAddress[] {
  const out: ServerAddress[] = []
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const ip = a.address
      const kind: ServerAddress['kind'] = ip.startsWith('26.')
        ? 'radmin'
        : ip.startsWith('25.')
          ? 'hamachi'
          : /zt|zerotier/i.test(iface)
            ? 'zerotier'
            : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
              ? 'lan'
              : 'other'
      out.push({ ip, iface, kind })
    }
  }
  const order = { radmin: 0, hamachi: 1, zerotier: 2, lan: 3, other: 4 }
  return out.sort((a, b) => order[a.kind] - order[b.kind])
}

export const listFriendServers = (): FriendServer[] => readJsonSync<FriendServer[]>(friendsFile(), [])

export function addFriendServer(name: string, address: string): FriendServer[] {
  const clean = address.trim()
  if (!/^[\w.-]+(:\d{1,5})?$/.test(clean)) throw new Error('Адрес: IP или домен, порт через двоеточие, например 26.12.34.56:25565')
  const list = listFriendServers()
  list.push({ id: randomUUID(), name: name.trim() || clean, address: clean, addedAt: Date.now() })
  writeJsonSync(friendsFile(), list)
  return list
}

export function removeFriendServer(id: string): FriendServer[] {
  const list = listFriendServers().filter((s) => s.id !== id)
  writeJsonSync(friendsFile(), list)
  return list
}

export function splitAddress(address: string): { host: string; port: number } {
  const [host, port] = address.split(':')
  return { host, port: Number(port) || 25565 }
}

function varint(value: number): Buffer {
  const bytes: number[] = []
  do {
    let b = value & 0x7f
    value >>>= 7
    if (value) b |= 0x80
    bytes.push(b)
  } while (value)
  return Buffer.from(bytes)
}

function readVarint(buf: Buffer, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let pos = offset
  while (pos < buf.length) {
    const b = buf[pos++]
    value |= (b & 0x7f) << shift
    if (!(b & 0x80)) return [value, pos]
    shift += 7
    if (shift > 35) break
  }
  return [-1, offset]
}

const packet = (...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts)
  return Buffer.concat([varint(body.length), body])
}

export function pingServer(address: string, timeoutMs = 3500): Promise<ServerPing> {
  const { host, port } = splitAddress(address)
  return new Promise((resolve) => {
    const socket = new Socket()
    const started = Date.now()
    let data = Buffer.alloc(0)
    const done = (result: ServerPing): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done({ online: false, error: 'Нет ответа' }))
    socket.on('error', (e) => done({ online: false, error: e.message }))
    socket.connect(port, host, () => {
      const hostBuf = Buffer.from(host, 'utf8')
      const portBuf = Buffer.alloc(2)
      portBuf.writeUInt16BE(port)
      socket.write(packet(varint(0), varint(767), varint(hostBuf.length), hostBuf, portBuf, varint(1)))
      socket.write(packet(varint(0)))
    })
    socket.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      const [length, afterLength] = readVarint(data, 0)
      if (length < 0 || data.length < afterLength + length) return
      const [, afterId] = readVarint(data, afterLength)
      const [strLen, afterStr] = readVarint(data, afterId)
      try {
        const json = JSON.parse(data.subarray(afterStr, afterStr + strLen).toString('utf8'))
        const text = (d: unknown): string =>
          typeof d === 'string' ? d : d && typeof d === 'object' ? `${(d as { text?: string }).text ?? ''}${((d as { extra?: unknown[] }).extra ?? []).map(text).join('')}` : ''
        done({
          online: true,
          latencyMs: Date.now() - started,
          version: json.version?.name,
          players: json.players?.online ?? 0,
          maxPlayers: json.players?.max ?? 0,
          motd: text(json.description).replace(/§./g, '').trim()
        })
      } catch {
        done({ online: false, error: 'Непонятный ответ сервера' })
      }
    })
  })
}
