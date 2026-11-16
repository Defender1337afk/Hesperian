import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const release = readFileSync(join(root, 'src', 'shared', 'release.ts'), 'utf8')
const codename = /status: 'current'[^}]*?codename: '([^']+)'|codename: '([^']+)',\s*status: 'current'/.exec(release)?.slice(1).find(Boolean) ?? ''
const notes = process.argv.slice(2).join(' ')
const site = process.env.SITE_DIR || join(root, '..', 'HesperianSite')
const base = `https://github.com/Defender1337afk/Defender1337afk.github.io/releases/download/v${version}/`

const FILES = {
  'win-setup': `Hesperian-Setup-${version}.exe`,
  'win-portable': `Hesperian-${version}-portable.exe`,
  'linux-appimage': `Hesperian-${version}-x86_64.AppImage`,
  'linux-tar': `Hesperian-${version}-x64.tar.gz`
}

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })

const files = {}
for (const [kind, name] of Object.entries(FILES)) {
  const path = join(root, 'release', name)
  files[kind] = { url: base + name, sha256: await sha256(path), size: statSync(path).size }
}

const feed = { version, codename, notes, url: 'https://defender1337afk.github.io/#download', files }
writeFileSync(join(site, 'update.json'), JSON.stringify(feed, null, 2) + '\n')
console.log(JSON.stringify(feed, null, 2))
