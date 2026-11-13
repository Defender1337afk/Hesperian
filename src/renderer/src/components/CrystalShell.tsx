import { useState, type ReactNode } from 'react'
import type { Instance } from '../../../shared/types'
import { api } from '../bridge'
import { useStore } from '../store'
import { ActiveView } from '../views/ActiveView'
import { Avatar, describeInstance, formatDate, formatPlayTime, LOADER_NAMES, RunButton } from './common'
import { I } from './icons'
import { instanceMenu } from './menus'
import { BottomPanel, StatusBar } from './Shell'
import { StorePanel } from './StorePanel'

function CrystalTop(): ReactNode {
  const stage = useStore((s) => s.stage)
  const openSidebar = useStore((s) => s.openSidebar)
  const openSettings = useStore((s) => s.openSettings)
  const selected = useStore((s) => s.instances.find((i) => i.id === s.selectedId))
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))
  const accountOpen = useStore((s) => s.accountOpen)
  const panelOpen = useStore((s) => s.panelOpen)
  const maximized = useStore((s) => s.maximized)
  return (
    <header className="c-top">
      <button className="c-brand" onClick={() => openSidebar('instances')} title="На главную">
        <span className="c-badge"><I.apple size={20} /></span>
        <span className="c-word">Hesperian</span>
      </button>
      <nav className="c-nav">
        <button className={stage === 'home' ? 'on' : ''} onClick={() => openSidebar('instances')}><I.cube size={15} /> Сборки</button>
        <button className={stage === 'store' ? 'on' : ''} onClick={() => openSidebar('store')}><I.store size={15} /> Магазин</button>
      </nav>
      <button className="c-search" onClick={() => useStore.setState({ palette: 'instances' })}>
        <I.search size={14} />
        <span className="c-search-text">{selected ? selected.name : 'Поиск и команды'}</span>
        <kbd>Ctrl P</kbd>
      </button>
      <div className="c-top-right">
        <button className={`c-round ${panelOpen ? 'on' : ''}`} title="Вывод игры (Ctrl+`)" onClick={() => useStore.setState({ panelOpen: !panelOpen })}><I.terminal size={16} /></button>
        <button className="c-round" title="Серверы" onClick={() => useStore.getState().openServers()}><I.globe size={16} /></button>
        <button className="c-round" title="Скины" onClick={() => useStore.getState().openSkins()}><I.shirt size={16} /></button>
        <button className="c-round" title="Настройки (Ctrl+,)" onClick={openSettings}><I.settings size={16} /></button>
        {account ? (
          <button className={`avatar-btn ${accountOpen ? 'on' : ''}`} title={account.name} onClick={() => useStore.setState({ accountOpen: !accountOpen })}>
            <Avatar account={account} size={28} />
          </button>
        ) : (
          <button className="c-pill avatar-btn-empty" onClick={() => useStore.setState({ accountOpen: !accountOpen })}><I.user size={15} /> Войти</button>
        )}
        <div className="win-ctl">
          <button onClick={() => void api.winMinimize()} title="Свернуть"><I.minus size={14} /></button>
          <button onClick={() => void api.winMaximize()} title={maximized ? 'Восстановить' : 'Развернуть'}>
            {maximized ? <I.restore size={13} /> : <I.maximize size={13} />}
          </button>
          <button className="close" onClick={() => void api.winClose()} title="Закрыть"><I.close size={14} /></button>
        </div>
      </div>
    </header>
  )
}

function Hero({ instance }: { instance: Instance }): ReactNode {
  const openInstance = useStore((s) => s.openInstance)
  return (
    <section className="c-hero">
      <span className="c-orb c-orb-big" style={{ '--tile': instance.color } as React.CSSProperties}><I.cube size={44} /></span>
      <div className="c-hero-text">
        <small>Выбранная сборка</small>
        <h1>{instance.name}</h1>
        <p>
          {instance.engine === 'horizon' ? `Horizon, ${instance.mcVersion} на Rust` : `${instance.mcVersion} · ${LOADER_NAMES[instance.loader]}`}
          {instance.playTimeSec > 0 ? ` · наиграно ${formatPlayTime(instance.playTimeSec)} · запуск ${formatDate(instance.lastPlayedAt)}` : ' · ещё не запускалась'}
        </p>
      </div>
      <div className="c-hero-actions">
        <button className="c-pill" onClick={() => openInstance(instance.id)}>Открыть</button>
        <RunButton instanceId={instance.id} />
      </div>
    </section>
  )
}

function Tile({ instance, index }: { instance: Instance; index: number }): ReactNode {
  const selectedId = useStore((s) => s.selectedId)
  const state = useStore((s) => s.games[instance.id])
  const select = useStore((s) => s.select)
  const openInstance = useStore((s) => s.openInstance)
  const play = useStore((s) => s.play)
  const stop = useStore((s) => s.stop)
  const [flash, setFlash] = useState(0)
  const active = state === 'running' || state === 'launching'
  return (
    <div
      className={`c-tile ${selectedId === instance.id ? 'on' : ''}`}
      style={{ '--tile': instance.color, '--i': Math.min(index, 14) } as React.CSSProperties}
      title={describeInstance(instance)}
      onClick={() => select(instance.id)}
      onDoubleClick={() => openInstance(instance.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        useStore.setState({ menu: { x: e.clientX, y: e.clientY, items: instanceMenu(instance.id) } })
      }}
    >
      {flash > 0 && <span key={flash} className="c-flash" />}
      <span className="c-orb"><I.cube size={30} /></span>
      <b>{instance.name}</b>
      <small>{describeInstance(instance)}</small>
      {active && <span className="pulse c-tile-live" />}
      <button
        className="c-tile-play"
        title={active ? 'Закрыть игру' : 'Играть'}
        aria-label={active ? 'Закрыть игру' : `Играть в ${instance.name}`}
        onClick={(e) => {
          e.stopPropagation()
          select(instance.id)
          if (active) void stop(instance.id)
          else {
            setFlash((n) => n + 1)
            void play(instance.id)
          }
        }}
      >
        {active ? <I.stop size={14} /> : <I.play size={15} />}
      </button>
    </div>
  )
}

function Home(): ReactNode {
  const instances = useStore((s) => s.instances)
  const selected = useStore((s) => s.instances.find((i) => i.id === s.selectedId))
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))

  if (!instances.length) {
    return (
      <div className="c-empty">
        <span className="c-badge c-badge-big"><I.apple size={64} /></span>
        <h1 className="c-word c-word-big">Hesperian</h1>
        <p>{account ? `С возвращением, ${account.name}. Соберём первую сборку?` : 'Собирай, запускай, играй.'}</p>
        <button className="btn primary" onClick={() => useStore.setState({ newInstanceOpen: true })}><I.plus size={15} /> Новая сборка</button>
      </div>
    )
  }
  return (
    <div className="c-home">
      {selected && <Hero instance={selected} />}
      <div className="c-section">
        <span>Все сборки</span>
        <small>{instances.length}</small>
      </div>
      <div className="c-grid">
        {instances.map((instance, i) => <Tile key={instance.id} instance={instance} index={i} />)}
      </div>
      <button className="c-fab" title="Новая сборка (Ctrl+N)" aria-label="Новая сборка" onClick={() => useStore.setState({ newInstanceOpen: true })}>
        <I.plus size={22} />
      </button>
    </div>
  )
}

export function CrystalShell(): ReactNode {
  const stage = useStore((s) => s.stage)
  const stageBack = useStore((s) => s.stageBack)
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const closeTab = useStore((s) => s.closeTab)
  const background = useStore((s) => s.settings?.backgroundImage)
  const opacity = useStore((s) => s.settings?.backgroundOpacity ?? 15)
  const hasPage = stage === 'tab' && tab && tab.kind !== 'welcome'
  const view = hasPage ? 'tab' : stage === 'store' ? 'store' : 'home'

  return (
    <div className="c-app">
      <div className="c-backdrop" />
      {background && <div className="c-backdrop-image" style={{ backgroundImage: `url(${background})`, opacity: opacity / 100 }} />}
      <CrystalTop />
      <main className="c-stage">
        {view === 'home' && <Home />}
        {view === 'store' && <div className="c-store"><StorePanel /></div>}
        {view === 'tab' && (
          <div className="c-page">
            <button className="c-back" onClick={() => closeTab(tab!.id)}>
              <I.chevron size={13} /> {stageBack === 'store' ? 'Магазин' : 'Сборки'}
            </button>
            <div className="c-sheet"><ActiveView /></div>
          </div>
        )}
      </main>
      <BottomPanel />
      <StatusBar />
    </div>
  )
}
