import type { UpdateCheck } from '../../shared/types'
import { api } from './bridge'

const MIN_SHOW = 1100

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
  document.getElementById('boot-title')!.textContent = `Hesperian ${result.version}${result.codename ? ` ${result.codename}` : ''}`
  document.getElementById('boot-notes')!.textContent = result.notes || `У вас ${result.current}. В новой версии исправления и новые возможности.`
  boot.classList.add('update')
  document.getElementById('boot-later')!.addEventListener('click', reveal, { once: true })
  document.getElementById('boot-get')!.addEventListener(
    'click',
    () => {
      void api.openExternal(result.url!)
      reveal()
    },
    { once: true }
  )
}
