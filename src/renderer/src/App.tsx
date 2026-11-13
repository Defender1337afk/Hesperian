import { useEffect, type ReactNode } from 'react'
import { BigPicture } from './components/BigPicture'
import { CrystalShell } from './components/CrystalShell'
import { AccountMenu, ConfirmDialog, LoginDialog, Menu, NewInstanceDialog, Palette, PromptDialog, Toasts } from './components/Overlays'
import { BottomPanel, Rail, Sidebar, StatusBar, TabBar, TitleBar } from './components/Shell'
import { useStore } from './store'
import { WhatsNew } from './components/WhatsNew'
import { Clawd } from './components/Clawd'
import { FunHooks } from './components/Fun'
import { releaseName } from '../../shared/release'
import { isCrystal } from './themes'
import { ActiveView } from './views/ActiveView'

function onKey(e: KeyboardEvent): void {
  const s = useStore.getState()
  if (s.promptRequest || s.confirmRequest || s.newInstanceOpen || s.loginOpen) return
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  let handled = true
  if (mod && e.shiftKey && k === 'p') useStore.setState({ palette: 'commands' })
  else if (mod && k === 'p') useStore.setState({ palette: 'instances' })
  else if (mod && k === 'b') s.toggleSidebar()
  else if (mod && (e.code === 'Backquote' || k === 'j')) useStore.setState({ panelOpen: !s.panelOpen })
  else if (e.key === 'F11') {
    if (s.bigPicture) void s.exitBigPicture()
    else void s.enterBigPicture()
  } else if (mod && k === ',') s.openSettings()
  else if (mod && k === 'n') useStore.setState({ newInstanceOpen: true })
  else if (mod && k === 'w') {
    if (s.activeTabId) s.closeTab(s.activeTabId)
  } else if (mod && e.shiftKey && k === 'x') s.openSidebar('store')
  else if (mod && e.shiftKey && k === 'e') s.openSidebar('instances')
  else if (e.key === 'F5' && s.selectedId) {
    const state = s.games[s.selectedId]
    if (e.shiftKey) void s.stop(s.selectedId)
    else if (!state || state === 'stopped') void s.play(s.selectedId)
  } else handled = false
  if (handled) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function Overlays(): ReactNode {
  return (
    <>
      <BigPicture />
      <Menu />
      <AccountMenu />
      <Palette />
      <NewInstanceDialog />
      <LoginDialog />
      <PromptDialog />
      <ConfirmDialog />
      <WhatsNew />
      <Clawd />
      <FunHooks />
      <Toasts />
    </>
  )
}

export function App(): ReactNode {
  const ready = useStore((s) => s.ready)
  const maximized = useStore((s) => s.maximized)
  const theme = useStore((s) => s.settings?.theme)
  const background = useStore((s) => s.settings?.backgroundImage)
  const opacity = useStore((s) => s.settings?.backgroundOpacity ?? 15)

  useEffect(() => {
    document.title = releaseName()
    void useStore.getState().init()
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!ready) return null

  if (isCrystal(theme)) {
    return (
      <>
        <CrystalShell />
        <Overlays />
      </>
    )
  }

  return (
    <div className={`app ${maximized ? 'maxed' : ''}`}>
      <TitleBar />
      <div className="body">
        <Rail />
        <Sidebar />
        <div className="center">
          <main className="main">
            <TabBar />
            <div className="content">
              {background && <div className="content-bg" style={{ backgroundImage: `url(${background})`, opacity: opacity / 100 }} />}
              <ActiveView />
            </div>
          </main>
          <BottomPanel />
        </div>
      </div>
      <StatusBar />
      <Overlays />
    </div>
  )
}
