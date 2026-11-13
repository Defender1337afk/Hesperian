import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

const USER_AGENT = `Hesperian/${app.getVersion()} (Minecraft launcher)`
const IDLE_TIMEOUT_MS = 30_000
const REQUEST_ATTEMPTS = 4
const RETRIES = 3

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string
  ) {
    super(`HTTP ${status}: ${url}`)
  }
}

export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('User-Agent', USER_AGENT)
  const attempts = !init.method || init.method === 'GET' ? REQUEST_ATTEMPTS : 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(IDLE_TIMEOUT_MS), ...init, headers })
    } catch (e) {
      lastError = e
      continue
    }
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''))
    return res
  }
  const host = new URL(url).host
  throw new Error(`Нет связи с ${host}. Проверьте интернет или VPN и попробуйте ещё раз.`, { cause: lastError })
}

export const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> =>
  (await request(url, init)).json() as Promise<T>

export const fetchText = async (url: string): Promise<string> => (await request(url)).text()

export const postJson = <T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> =>
  fetchJson<T>(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }
  })

export interface Checksum {
  algo: 'sha1' | 'sha256' | 'sha512'
  value: string
}

export interface DownloadOptions {
  checksum?: Checksum
  onBytes?: (received: number, total: number) => void
}

async function downloadOnce(url: string, dest: string, opts: DownloadOptions): Promise<void> {
  const controller = new AbortController()
  let idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
  const part = `${dest}.${randomBytes(4).toString('hex')}.part`
  try {
    const res = await request(url, { signal: controller.signal })
    if (!res.body) throw new Error(`Пустой ответ: ${url}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const hash = opts.checksum ? createHash(opts.checksum.algo) : null
    const out = createWriteStream(part)
    let received = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      clearTimeout(idle)
      idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
      hash?.update(value)
      received += value.length
      if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve))
      opts.onBytes?.(received, total)
    }
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject)
      out.end(resolve)
    })
    if (hash && hash.digest('hex') !== opts.checksum!.value.toLowerCase()) {
      throw new Error(`Контрольная сумма не совпала: ${url}`)
    }
    await rename(part, dest)
  } finally {
    clearTimeout(idle)
    await rm(part, { force: true }).catch(() => {})
  }
}

export async function download(urls: string | string[], dest: string, opts: DownloadOptions = {}): Promise<void> {
  const list = Array.isArray(urls) ? urls : [urls]
  await mkdir(dirname(dest), { recursive: true })
  let lastError: unknown
  for (const url of list) {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        return await downloadOnce(url, dest, opts)
      } catch (e) {
        lastError = e
        if (e instanceof HttpError && e.status >= 400 && e.status < 500) break
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

export async function fileMatches(path: string, size?: number): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile() && (size === undefined || size === 0 || s.size === size)
  } catch {
    return false
  }
}

export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failure: unknown
  const worker = async (): Promise<void> => {
    while (next < items.length && failure === undefined) {
      try {
        await fn(items[next++])
      } catch (e) {
        failure = e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failure !== undefined) throw failure
}
