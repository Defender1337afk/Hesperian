import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Instance } from '../../../shared/types'
import { api } from '../bridge'
import { useStore, type SidebarKind } from '../store'
import { Avatar, describeInstance, formatBytes, IconBtn, RunButton } from './common'
import { I } from './icons'
import { instanceMenu, menuItems } from './menus'
import { StorePanel } from './StorePanel'
import { releaseName } from '../../../shared/release'

const MENUS: [string, string][] = [['file', 'Файл'], ['view', 'Вид'], ['game', 'Игра'], ['help', 'Справка']]
const RAIL: [SidebarKind, (p: { size?: number }) => ReactNode, string][] = [
  ['instances', I.cube, 'Сборки (Ctrl+Shift+E)'],
  ['store', I.store, 'Магазин (Ctrl+Shift+X)']
]
const RAIL_STEP = 42

export function TitleBar(): ReactNode {
  const menu = useStore((s) => s.menu)
  const selected = useStore((s) => s.instances.find((i) => i.id === s.selectedId))
  const maximized = useStore((s) => s.maximized)
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))
  const accountOpen = useStore((s) => s.accountOpen)

  const open = (name: string, e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect()
    useStore.setState({ menu: { x: r.left, y: r.bottom + 4, items: menuItems(name), owner: name } })
  }

  return (
    <header className="titlebar">
      <div className="tb-left">
        <span className="wordmark"><I.apple size={16} /></span>
        <nav className="menubar">
          {MENUS.map(([key, label]) => (
            <button
              key={key}
              className={`menu-btn ${menu?.owner === key ? 'on' : ''}`}
              onMouseDown={(e) => open(key, e)}
              onMouseEnter={(e) => menu?.owner && menu.owner !== key && open(key, e)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <button className="cmdbar" onClick={() => useStore.setState({ palette: 'instances' })}>
        <I.search size={13} />
        <span className="cmdbar-text">{selected ? selected.name : 'Поиск и команды'}</span>
        <span className="kbd-hint">Ctrl P</span>
      </button>
      <div className="tb-right">
        {account ? (
          <button className={`avatar-btn ${accountOpen ? 'on' : ''}`} title={account.name} onClick={() => useStore.setState({ accountOpen: !accountOpen })}>
            <Avatar account={account} size={24} />
          </button>
        ) : (
          <button className="ghost-btn avatar-btn-empty" onClick={() => useStore.setState({ accountOpen: !accountOpen })}>
            <I.user size={15} /> Войти
          </button>
        )}
        {selected && <RunButton instanceId={selected.id} />}
        <div className="win-ctl">
          <button onClick={() => void api.winMinimize()} title="Свернуть"><I.minus size={15} /></button>
          <button onClick={() => void api.winMaximize()} title={maximized ? 'Восстановить' : 'Развернуть'}>
            {maximized ? <I.restore size={14} /> : <I.maximize size={14} />}
          </button>
          <button className="close" onClick={() => void api.winClose()} title="Закрыть"><I.close size={15} /></button>
        </div>
      </div>
    </header>
  )
}

export function Rail(): ReactNode {
  const sidebar = useStore((s) => s.sidebar)
  const panelOpen = useStore((s) => s.panelOpen)
  const settingsActive = useStore((s) => s.activeTabId === 'settings')
  const toggleRail = useStore((s) => s.toggleRail)
  const openSettings = useStore((s) => s.openSettings)
  const openServers = useStore((s) => s.openServers)
  const serversActive = useStore((s) => s.activeTabId === 'servers')
  const openSkins = useStore((s) => s.openSkins)
  const skinsActive = useStore((s) => s.activeTabId === 'skins')
  const index = RAIL.findIndex(([k]) => k === sidebar)
  return (
    <aside className="rail">
      <span className="rail-ind" style={{ transform: `translateY(${Math.max(index, 0) * RAIL_STEP}px)`, opacity: index >= 0 ? 1 : 0 }} />
      {RAIL.map(([key, icon, title]) => (
        <IconBtn key={key} icon={icon} title={title} active={sidebar === key} onClick={() => toggleRail(key)} />
      ))}
      <IconBtn icon={I.globe} title="Серверы" active={serversActive} onClick={openServers} />
      <IconBtn icon={I.shirt} title="Скины" active={skinsActive} onClick={openSkins} />
      <div className="rail-spacer" />
      <IconBtn icon={I.terminal} title="Вывод игры (Ctrl+`)" active={panelOpen} onClick={() => useStore.setState({ panelOpen: !panelOpen })} />
      <IconBtn icon={I.settings} title="Настройки (Ctrl+,)" active={settingsActive} onClick={openSettings} />
    </aside>
  )
}

function InstanceRow({ instance, depth }: { instance: Instance; depth: number }): ReactNode {
  const selected = useStore((s) => s.selectedId === instance.id)
  const shown = useStore((s) => s.activeTabId === `instance:${instance.id}`)
  const state = useStore((s) => s.games[instance.id])
  const openInstance = useStore((s) => s.openInstance)
  return (
    <div
      className={`tree-row ${shown ? 'active' : selected ? 'sel' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={describeInstance(instance)}
      onClick={() => openInstance(instance.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        useStore.setState({ menu: { x: e.clientX, y: e.clientY, items: instanceMenu(instance.id) } })
      }}
    >
      <span className="fdot" style={{ background: instance.color }} />
      <span className="tree-name">{instance.name}</span>
      {state === 'running' || state === 'launching' ? <span className="pulse tree-right" /> : <span className="tree-right tree-ver">{instance.mcVersion}</span>}
    </div>
  )
}

function InstancesPanel(): ReactNode {
  const instances = useStore((s) => s.instances)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => {
    const map = new Map<string, Instance[]>()
    for (const instance of instances) {
      const key = instance.group?.trim() || ''
      map.set(key, [...(map.get(key) ?? []), instance])
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru')))
  }, [instances])

  if (!instances.length) {
    return (
      <div className="side-empty">
        <p>Сборок пока нет</p>
        <button className="btn primary" onClick={() => useStore.setState({ newInstanceOpen: true })}>Новая сборка</button>
      </div>
    )
  }
  return (
    <div className="explorer">
      <div className="side-head">
        <span className="side-title">Сборки</span>
        <div className="side-actions">
          <IconBtn icon={I.plus} title="Новая сборка (Ctrl+N)" onClick={() => useStore.setState({ newInstanceOpen: true })} />
        </div>
      </div>
      <div className="tree">
        {groups.map(([group, items]) =>
          group ? (
            <div key={group}>
              <div className="tree-row" style={{ paddingLeft: 8 }} onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}>
                <span className={`chev ${collapsed[group] ? '' : 'open'}`}><I.chevron size={11} /></span>
                <span className="tree-name dir">{group}</span>
                <span className="tree-right tree-ver">{items.length}</span>
              </div>
              {!collapsed[group] && <div className="tree-children">{items.map((i) => <InstanceRow key={i.id} instance={i} depth={1} />)}</div>}
            </div>
          ) : (
            items.map((i) => <InstanceRow key={i.id} instance={i} depth={0} />)
          )
        )}
      </div>
    </div>
  )
}

export function Sidebar(): ReactNode {
  const kind = useStore((s) => s.sidebar)
  const storedWidth = useStore((s) => s.settings!.sidebarWidth)
  const patchSettings = useStore((s) => s.patchSettings)
  const [width, setWidth] = useState(storedWidth)
  const [dragging, setDragging] = useState(false)
  const drag = (e: React.MouseEvent): void => {
    const start = e.clientX
    const w0 = width
    let last = w0
    setDragging(true)
    const move = (ev: MouseEvent): void => {
      last = Math.max(200, Math.min(560, w0 + ev.clientX - start))
      setWidth(last)
    }
    const up = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void patchSettings({ sidebarWidth: last })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <section className={`sidebar ${kind ? 'open' : ''} ${dragging ? 'dragging' : ''}`} style={{ width: kind ? width : 0 }}>
      <div className="sidebar-inner" style={{ width }} key={kind}>
        {kind === 'instances' && <InstancesPanel />}
        {kind === 'store' && <StorePanel />}
      </div>
      {kind && <div className="resizer-v" onMouseDown={drag} />}
    </section>
  )
}

export function TabBar(): ReactNode {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const closeTab = useStore((s) => s.closeTab)
  if (!tabs.length) return null
  const icon = (kind: string): ReactNode =>
    kind === 'settings' ? <I.settings size={13} /> : kind === 'instance' ? <I.cube size={13} /> : kind === 'project' ? <I.store size={13} /> : <I.apple size={13} />
  return (
    <div className="tabbar" onWheel={(e) => { e.currentTarget.scrollLeft += e.deltaY }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          title={tab.title}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              closeTab(tab.id)
            } else if (e.button === 0) useStore.setState({ activeTabId: tab.id })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            useStore.setState({
              menu: {
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Закрыть', kbd: 'Ctrl+W', run: () => closeTab(tab.id) },
                  { label: 'Закрыть остальные', run: () => useStore.setState({ tabs: [tab], activeTabId: tab.id }) }
                ]
              }
            })
          }}
        >
          {icon(tab.kind)}
          <span className="tab-name">{tab.title}</span>
          <button className="tab-close" title="Закрыть" onMouseDown={(e) => { e.stopPropagation(); closeTab(tab.id) }}>
            <I.close size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

const RENDER_LIMIT = 1500

export function BottomPanel(): ReactNode {
  const open = useStore((s) => s.panelOpen)
  const instances = useStore((s) => s.instances)
  const logInstanceId = useStore((s) => s.logInstanceId)
  const selectedId = useStore((s) => s.selectedId)
  const instanceId = logInstanceId ?? selectedId
  const logs = useStore((s) => (instanceId ? s.logs[instanceId] : undefined))
  const running = useStore((s) => (instanceId ? s.games[instanceId] === 'running' : false))
  const storedHeight = useStore((s) => s.settings!.panelHeight)
  const patchSettings = useStore((s) => s.patchSettings)
  const toast = useStore((s) => s.toast)
  const [height, setHeight] = useState(storedHeight)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState('')
  const [problems, setProblems] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (logs ?? [])
      .filter((l) => (!problems || l.level === 'warn' || l.level === 'error') && (!needle || l.text.toLowerCase().includes(needle)))
      .slice(-RENDER_LIMIT)
  }, [logs, filter, problems])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [lines, open])

  if (!open) return null

  const drag = (e: React.MouseEvent): void => {
    const start = e.clientY
    const h0 = height
    let last = h0
    setDragging(true)
    const move = (ev: MouseEvent): void => {
      last = Math.max(110, Math.min(window.innerHeight - 200, h0 - (ev.clientY - start)))
      setHeight(last)
    }
    const up = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void patchSettings({ panelHeight: last })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <section className={`panel ${dragging ? 'dragging' : ''}`} style={{ height }}>
      <div className="resizer-h" onMouseDown={drag} />
      <div className="panel-head">
        <button className="panel-tab on">Вывод {running && <span className="pulse" />}</button>
        <select className="select panel-select" value={instanceId ?? ''} onChange={(e) => useStore.setState({ logInstanceId: e.target.value })} aria-label="Сборка">
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input className="input sm panel-filter" placeholder="Фильтр" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="grow" />
        <IconBtn icon={I.warning} title="Только предупреждения и ошибки" active={problems} onClick={() => setProblems(!problems)} />
        <IconBtn
          icon={I.copy}
          title="Скопировать"
          onClick={() => {
            void navigator.clipboard.writeText(lines.map((l) => l.text).join('\n'))
            toast('info', 'Вывод скопирован')
          }}
        />
        <IconBtn icon={I.trash} title="Очистить" onClick={() => instanceId && useStore.setState((s) => ({ logs: { ...s.logs, [instanceId]: [] } }))} />
        <IconBtn icon={I.close} title="Скрыть (Ctrl+`)" onClick={() => useStore.setState({ panelOpen: false })} />
      </div>
      <div className="panel-body">
        <div className="log" ref={logRef}>
          {!lines.length && <div className="log-empty">Нажмите <kbd>F5</kbd>, чтобы запустить выбранную сборку. Здесь появится вывод игры.</div>}
          {lines.map((line, i) => (
            <div key={i} className={`log-${line.level === 'error' ? 'err' : line.level === 'warn' ? 'warn' : line.level === 'debug' ? 'info' : 'out'}`}>{line.text}</div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function StatusBar(): ReactNode {
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))
  const selected = useStore((s) => s.instances.find((i) => i.id === s.selectedId))
  const tasks = useStore((s) => s.tasks)
  const games = useStore((s) => s.games)
  const running = Object.values(games).filter((g) => g === 'running').length
  const task = tasks.find((t) => t.state === 'running')
  const percent = task && task.total ? Math.min(100, Math.round((task.done / task.total) * 100)) : null
  const bytes = task ? task.total > 1_000_000 : false
  return (
    <footer className="statusbar">
      <button className="sb-item btnlike" onClick={() => useStore.setState({ accountOpen: true })}>
        <I.user size={12} /> {account ? `${account.name} · ${account.licensed ? 'лицензия' : 'офлайн'}` : 'Нет аккаунта'}
      </button>
      {task && (
        <span className="sb-item live sb-task">
          <span className="spinner sb-spinner" />
          <span className="sb-task-text">
            {task.title}{task.detail ? `: ${task.detail}` : ''}
            {percent !== null && ` · ${bytes ? `${formatBytes(task.done)} из ${formatBytes(task.total)}` : `${task.done} из ${task.total}`}`}
          </span>
          {percent !== null && <span className="sb-progress"><i style={{ width: `${percent}%` }} /></span>}
        </span>
      )}
      <span className="grow" />
      {running > 0 && <span className="sb-item live"><span className="pulse" /> Запущено: {running}</span>}
      {selected && <span className="sb-item">{describeInstance(selected)}</span>}
      <button className="sb-item btnlike sb-release" title="Что нового" onClick={() => useStore.setState({ whatsNewOpen: true })}>{releaseName()}</button>
    </footer>
  )
}
