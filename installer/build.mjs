import AdmZip from 'adm-zip'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const unpacked = join(root, 'release', 'win-unpacked')
const output = join(root, 'release', `Hesperian-Setup-${version}.exe`)

execFileSync(
  'dotnet',
  ['build', join(here, 'Installer.csproj'), '-c', 'Release', '-v', 'quiet', '-nologo', `-p:Version=${version}`],
  { stdio: 'inherit' }
)
const stub = readFileSync(join(here, 'bin', 'Release', 'net48', 'HesperianSetup.exe'))

const zip = new AdmZip()
zip.addLocalFolder(unpacked)
const payload = zip.toBuffer()

const footer = Buffer.alloc(16)
footer.writeBigInt64LE(BigInt(payload.length), 0)
footer.write('HSPRPAY1', 8, 'ascii')

writeFileSync(output, Buffer.concat([stub, payload, footer]))
console.log(`${output}: ${(stub.length + payload.length + footer.length) / 1024 / 1024 | 0} МБ`)
