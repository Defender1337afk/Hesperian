import type { UpdateCheck, UpdateProgress } from '../../shared/types'
import { api, onEvent } from './bridge'

const MIN_SHOW = 1100

function applyBootPalette(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  try {
    const p = JSON.parse(localStorage.getItem('bootPalette') ?? 'null') as Record<string, string> | null
    if (!p) return
    for (const [k, v] of Object.entries(p)) boot.style.setProperty(`--boot-${k}`, v)
  } catch {
    return
  }
}

applyBootPalette()

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)

function reveal(): void {
  const root = document.getElementById('root')!
  const boot = document.getElementById('boot')
  root.classList.add('reveal')
  boot?.classList.remove('update')
  boot?.classList.add('leaving')
  const done = (): void => {
    root.classList.remove('reveal')
    root.classList.add('revealed')
    boot?.remove()
  }
  root.addEventListener('animationend', done, { once: true })
  setTimeout(done, 1600)
}

const WAVE_START = 6
const WAVE_END = 292
const GAP = 8

function wavePath(): string {
  const pts: string[] = []
  for (let x = 0; x <= 330; x += 2) pts.push(`${x} ${(9 + 3 * Math.sin((2 * Math.PI * x) / 24)).toFixed(2)}`)
  return `M${pts.join(' L')}`
}

function setProgress(fraction: number): void {
  const f = Math.max(0, Math.min(1, fraction))
  const end = WAVE_START + (WAVE_END - WAVE_START) * f
  document.getElementById('boot-clip-rect')!.setAttribute('width', String(end))
  const track = document.getElementById('boot-track')!
  track.setAttribute('x1', String(Math.min(WAVE_END, end + GAP)))
  track.style.opacity = end + GAP >= WAVE_END ? '0' : '1'
  document.getElementById('boot-pct')!.textContent = String(Math.floor(f * 100))
}

function runUpdate(result: UpdateCheck): void {
  const boot = document.getElementById('boot')!
  const status = document.getElementById('boot-status')!
  const actions = boot.querySelector('.boot-actions')!
  const get = document.getElementById('boot-get')!
  document.getElementById('boot-wave')!.setAttribute('d', wavePath())
  document.getElementById('boot-notes')!.style.display = 'none'
  const label = boot.querySelector('.boot-card small')!
  label.textContent = 'Обновляем'
  boot.classList.add('updating')
  boot.classList.remove('installing')
  status.classList.remove('boot-error')
  status.textContent = 'Подключаемся…'
  setProgress(0)
  let lastAt = performance.now()
  let lastDone = 0
  let speed = 0
  const stop = onEvent<UpdateProgress>('update:progress', (p) => {
    if (p.stage === 'download') {
      const total = p.total || result.size || 0
      const now = performance.now()
      const dt = (now - lastAt) / 1000
      if (dt > 0.25) {
        const instant = (p.done - lastDone) / dt
        speed = speed ? speed * 0.7 + instant * 0.3 : instant
        lastAt = now
        lastDone = p.done
      }
      setProgress(total ? p.done / total : 0)
      const rate = speed > 0 ? ` · ${mb(speed)} МБ/с` : ''
      status.textContent = total ? `${mb(p.done)} из ${mb(total)} МБ${rate}` : `${mb(p.done)} МБ${rate}`
    } else if (p.stage === 'install') {
      setProgress(1)
      boot.classList.add('installing')
      status.textContent = 'Устанавливаем…'
    } else status.textContent = 'Перезапускаем Hesperian…'
  })
  api.installUpdate().catch((e: unknown) => {
    stop()
    boot.classList.remove('updating', 'installing')
    document.getElementById('boot-notes')!.style.display = ''
    label.textContent = 'Доступно обновление'
    status.textContent = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
    status.classList.add('boot-error')
    status.style.display = 'block'
    actions.before(status)
    get.textContent = 'Повторить'
  })
}

export async function startBoot(): Promise<void> {
  const started = performance.now()
  const result: UpdateCheck = await api.checkUpdate().catch(() => ({ state: 'offline', current: '' }) as UpdateCheck)
  const wait = MIN_SHOW - (performance.now() - started)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  if (result.state !== 'available') {
    reveal()
    return
  }
  const boot = document.getElementById('boot')!
  const get = document.getElementById('boot-get')!
  document.getElementById('boot-title')!.textContent = `Hesperian ${result.version}${result.codename ? ` ${result.codename}` : ''}`
  document.getElementById('boot-notes')!.textContent = result.notes || `У вас ${result.current}. В новой версии исправления и новые возможности.`
  get.textContent = result.auto ? (result.size ? `Обновить · ${mb(result.size)} МБ` : 'Обновить') : 'Скачать'
  boot.classList.add('update')
  document.getElementById('boot-later')!.addEventListener('click', reveal, { once: true })
  get.addEventListener('click', () => {
    if (result.auto) runUpdate(result)
    else {
      void api.openExternal(result.url!)
      reveal()
    }
  })
}
