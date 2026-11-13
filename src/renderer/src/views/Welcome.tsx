import type { ReactNode } from 'react'
import { describeInstance } from '../components/common'
import { I } from '../components/icons'
import { openPacks } from '../components/menus'
import { useStore } from '../store'
import { Snow, Splash } from '../components/Fun'

const SHORTCUTS: [string, string][] = [
  ['Все команды', 'Ctrl ⇧ P'],
  ['Найти сборку', 'Ctrl P'],
  ['Играть', 'F5'],
  ['Новая сборка', 'Ctrl N']
]

const rise = (i: number): React.CSSProperties => ({ '--i': i }) as React.CSSProperties

let taps: number[] = []
const secret = (): void => {
  const now = Date.now()
  taps = [...taps.filter((t) => now - t < 900), now]
  if (taps.length >= 3) {
    taps = []
    useStore.getState().toggleClawd()
  }
}

export function Welcome(): ReactNode {
  const instances = useStore((s) => s.instances)
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))
  const openInstance = useStore((s) => s.openInstance)
  const openSidebar = useStore((s) => s.openSidebar)
  const recent = instances.slice(0, 6)
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="wm-wrap rise"><h1 className="wm">Hesperian<span onClick={secret}>.</span></h1><Splash /></div>
        <Snow />
        <p className="hero-sub rise" style={rise(1)}>{account ? `С возвращением, ${account.name}.` : 'Собирай, запускай, играй.'}</p>
        <div className="welcome-grid">
          <div className="w-col">
            <div className="w-list rise" style={rise(2)}>
              <button className="w-row" onClick={() => useStore.setState({ newInstanceOpen: true })}><I.plus size={16} /><span>Новая сборка</span><kbd>Ctrl N</kbd></button>
              <button className="w-row" onClick={openPacks}><I.sparkle size={16} /><span>Готовые модпаки</span></button>
              <button className="w-row" onClick={() => openSidebar('store')}><I.store size={16} /><span>Магазин модов и текстур</span></button>
              <button className="w-row" onClick={() => useStore.setState({ accountOpen: true })}><I.user size={16} /><span>{account ? 'Аккаунты' : 'Добавить аккаунт'}</span></button>
            </div>
            {recent.length > 0 && (
              <>
                <h3 className="rise" style={rise(3)}>Недавние</h3>
                <div className="w-list rise" style={rise(4)}>
                  {recent.map((i) => (
                    <button key={i.id} className="w-recent" onClick={() => openInstance(i.id)}>
                      <span>{i.name}</span>
                      <small>{describeInstance(i)}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="w-col">
            <h3 className="rise" style={rise(2)}>Всё для игры</h3>
            <div className="w-feats rise" style={rise(3)}>
              <div className="feat"><I.cube size={16} /><div><b>Версии от 1.16.5 до новейших</b><small>Нужная Java ставится сама</small></div></div>
              <div className="feat"><I.sparkle size={16} /><div><b>Fabric, Forge, NeoForge</b><small>У каждой сборки свои моды и миры</small></div></div>
              <div className="feat"><I.store size={16} /><div><b>Магазин</b><small>Модпаки, моды, текстуры и шейдеры с зависимостями</small></div><kbd>Ctrl ⇧ X</kbd></div>
              <div className="feat"><I.user size={16} /><div><b>Аккаунты</b><small>Лицензия Microsoft и офлайн-профили</small></div></div>
            </div>
            <h3 className="rise" style={rise(4)}>Клавиши</h3>
            <div className="shortcuts rise" style={rise(5)}>
              {SHORTCUTS.map(([action, keys]) => (
                <div className="sc-row" key={action}>
                  <span>{action}</span>
                  <span className="keys">{keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
