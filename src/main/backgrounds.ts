import { app, net, protocol } from 'electron'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEME = 'hbg'
const MAX_BYTES = 80 * 1024 * 1024
export const BACKGROUND_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

const dir = (): string => join(app.getPath('userData'), 'backgrounds')

export function registerBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

export function serveBackgrounds(): void {
  protocol.handle(SCHEME, (req) => {
    const name = basename(decodeURIComponent(new URL(req.url).pathname))
    if (!BACKGROUND_TYPES[extname(name).toLowerCase()]) return new Response('', { status: 404 })
    return net.fetch(pathToFileURL(join(dir(), name)).toString(), { headers: req.headers })
  })
}

export async function importBackground(source: string): Promise<string> {
  const ext = extname(source).toLowerCase()
  if (!BACKGROUND_TYPES[ext]) throw new Error('Формат не поддерживается: подойдут PNG, JPG, WebP, GIF, MP4 и WebM')
  if ((await stat(source)).size > MAX_BYTES) throw new Error('Файл больше 80 МБ')
  await mkdir(dir(), { recursive: true })
  for (const old of await readdir(dir())) await rm(join(dir(), old), { force: true })
  const name = `${randomUUID()}${ext}`
  await copyFile(source, join(dir(), name))
  return `${SCHEME}://bg/${name}`
}

export async function clearBackgrounds(): Promise<void> {
  await rm(dir(), { recursive: true, force: true })
}
