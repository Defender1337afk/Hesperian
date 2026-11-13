import { app } from 'electron'
import type { UpdateCheck } from '../shared/types'

const FEED = process.env.HESPERIAN_UPDATE_FEED || 'https://hesperian.fun/update.json'

const parts = (v: string): number[] => v.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)

function newer(a: string, b: string): boolean {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

export async function checkUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion()
  try {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(4000), headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) return { state: 'none', current }
    const feed = (await res.json()) as { version?: string; codename?: string; notes?: string; url?: string }
    if (!feed.version || !newer(feed.version, current)) return { state: 'none', current }
    const platform = process.platform === 'win32' ? 'windows' : 'linux'
    const url = typeof feed.url === 'string' && /^https:\/\//.test(feed.url) ? feed.url : `https://hesperian.fun/#download-${platform}`
    return { state: 'available', current, version: feed.version, codename: feed.codename, notes: feed.notes, url }
  } catch {
    return { state: 'offline', current }
  }
}
