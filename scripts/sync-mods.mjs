import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src', 'main', 'localmods.ts'), 'utf8')
const target = join(root, 'resources', 'mods')
const MODS = [
  { id: 'astra-visuals', project: 'AstraVisuals' }
]

mkdirSync(target, { recursive: true })
const keep = new Set()
for (const { id, project } of MODS) {
  const match = new RegExp(`id: '${id}',\\s*title: '[^']*',\\s*version: '([^']+)'`).exec(source)
  if (!match) throw new Error(`В localmods.ts нет версии мода ${id}`)
  const name = `${id}-${match[1]}.jar`
  const built = join(root, '..', project, 'build', 'libs', name)
  keep.add(name)
  if (existsSync(built)) {
    copyFileSync(built, join(target, name))
    console.log(`${name}: взят из ${built}`)
  } else if (existsSync(join(target, name))) {
    console.log(`${name}: используется уже лежащий файл`)
  } else {
    keep.delete(name)
    console.warn(`${name}: нет ни ${built}, ни готового файла. Лаунчер соберётся без этого мода.`)
  }
}
for (const file of readdirSync(target)) if (!keep.has(file)) rmSync(join(target, file))
