import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { paths } from './config'

const face = (i: number): string => `minecraft/textures/gui/title/background/panorama_${i}.png`
let cached: string[] | null = null

export async function panoramaFaces(): Promise<string[] | null> {
  if (cached) return cached
  const dir = join(paths.assets(), 'indexes')
  if (!existsSync(dir)) return null
  const indexes: { path: string; time: number }[] = []
  for (const name of await readdir(dir)) {
    if (name.endsWith('.json')) indexes.push({ path: join(dir, name), time: (await stat(join(dir, name))).mtimeMs })
  }
  indexes.sort((a, b) => b.time - a.time)
  for (const { path } of indexes) {
    try {
      const { objects } = JSON.parse(await readFile(path, 'utf8')) as { objects: Record<string, { hash: string }> }
      const files = [0, 1, 2, 3, 4, 5].map((i) => {
        const hash = objects[face(i)]?.hash
        return hash ? join(paths.assets(), 'objects', hash.slice(0, 2), hash) : ''
      })
      if (!files.every((file) => file && existsSync(file))) continue
      const data = await Promise.all(files.map((file) => readFile(file)))
      cached = data.map((d) => `data:image/png;base64,${d.toString('base64')}`)
      return cached
    } catch {
    }
  }
  return null
}
