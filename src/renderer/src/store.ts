import type { ReactNode } from 'react'
import { create } from 'zustand'
import type {
  Account,
  AccountsState,
  GameState,
  Instance,
  LogLine,
  McVersion,
  PluginInfo,
  Settings,
  StoreKind,
  SystemInfo,
  TaskState
} from '../../shared/types'
import { api, onEvent } from './bridge'
import { applySettings } from './themes'
import { CURRENT } from '../../shared/release'

export type SidebarKind = 'instances' | 'store'
export type Stage = 'home' | 'store' | 'tab'

export interface Tab {
  id: string
  kind: 'welcome' | 'instance' | 'project' | 'settings' | 'plugins' | 'servers'
  title: string
  ref?: string
}

export interface Toast {
  id: number
  kind: 'info' | 'warn' | 'error'
  text: string
  leaving?: boolean
}

export interface MenuEntry {
  label?: string
  sep?: boolean
  kbd?: string
  check?: boolean
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
  run?: () => void
}

interface ConfirmRequest {
  title: string
  text: string
  action: string
  resolve: (ok: boolean) => void
}

interface PromptRequest {
  title: string
  placeholder: string
  ok: string
  resolve: (value: string | null) => void
}

const MAX_LOG_LINES = 5000
const WELCOME: Tab = { id: 'welcome', kind: 'welcome', title: 'Начало' }
const SETTINGS: Tab = { id: 'settings', kind: 'settings', title: 'Настройки' }
const PLUGINS: Tab = { id: 'plugins', kind: 'plugins', title: 'Плагины' }
const SERVERS: Tab = { id: 'servers', kind: 'servers', title: 'Серверы' }

interface State {
  ready: boolean
  plugins: PluginInfo[]
  clawd: boolean
  toggleClawd(): void
  whatsNewOpen: boolean
  system: SystemInfo | null
  settings: Settings | null
  versions: McVersion[]
  versionsError: string | null
  instances: Instance[]
  accounts: Account[]
  activeAccountId: string | null
  selectedId: string | null
  sidebar: SidebarKind | null
  lastSidebar: SidebarKind
  panelOpen: boolean
  maximized: boolean
  tabs: Tab[]
  activeTabId: string | null
  logs: Record<string, LogLine[]>
  logInstanceId: string | null
  games: Record<string, GameState['state']>
  tasks: TaskState[]
  toasts: Toast[]
  confirmRequest: ConfirmRequest | null
  promptRequest: PromptRequest | null
  palette: 'commands' | 'instances' | null
  menu: { x: number; y: number; items: MenuEntry[]; owner?: string } | null
  accountOpen: boolean
  newInstanceOpen: boolean
  loginOpen: boolean
  bigPicture: boolean
  bigPictureHidden: boolean
  contentRevision: number
  storeTarget: string | null
  storeKind: StoreKind
  stage: Stage
  stageBack: Exclude<Stage, 'tab'>

  init(): Promise<void>
  enterBigPicture(): Promise<void>
  exitBigPicture(): Promise<void>
  patchSettings(patch: Partial<Settings>): Promise<void>
  refreshInstances(): Promise<void>
  setAccounts(state: AccountsState): void
  select(id: string): void
  toggleRail(kind: SidebarKind): void
  openSidebar(kind: SidebarKind): void
  toggleSidebar(): void
  openTab(tab: Tab): void
  closeTab(id: string): void
  openInstance(id: string): void
  openProject(id: string, title: string): void
  openSettings(): void
  openPlugins(): void
  openServers(): void
  refreshPlugins(): Promise<void>
  closeWhatsNew(): void
  openWelcome(): void
  play(id: string, server?: string): Promise<void>
  stop(id: string): Promise<void>
  removeInstance(id: string): Promise<void>
  duplicateInstance(id: string): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  confirm(title: string, text: string, action: string): Promise<boolean>
  prompt(title: string, placeholder: string, ok: string): Promise<string | null>
  bumpContent(): void
  installModpack(projectId: string, versionId?: string): Promise<void>
  importModpack(): Promise<void>
  exportModpack(id: string): Promise<void>
  createWithLocalMod(projectId: string, title: string, gameVersion: string): Promise<void>
}

let toastSeq = 0

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useStore = create<State>((set, get) => ({
  ready: false,
  plugins: [],
  clawd: (() => {
    try {
      return localStorage.getItem('clawd') === '1'
    } catch {
      return false
    }
  })(),
  toggleClawd() {
    const next = !get().clawd
    try {
      localStorage.setItem('clawd', next ? '1' : '0')
    } catch {
    }
    set({ clawd: next })
  },
  whatsNewOpen: false,
  system: null,
  settings: null,
  versions: [],
  versionsError: null,
  instances: [],
  accounts: [],
  activeAccountId: null,
  selectedId: localStorage.getItem('selectedId'),
  sidebar: 'instances',
  lastSidebar: 'instances',
  panelOpen: false,
  maximized: false,
  tabs: [WELCOME],
  activeTabId: 'welcome',
  logs: {},
  logInstanceId: null,
  games: {},
  tasks: [],
  toasts: [],
  confirmRequest: null,
  promptRequest: null,
  palette: null,
  menu: null,
  accountOpen: false,
  newInstanceOpen: false,
  bigPicture: false,
  bigPictureHidden: false,
  loginOpen: false,
  contentRevision: 0,
  storeTarget: null,
  storeKind: 'mod',
  stage: 'home',
  stageBack: 'home',

  async init() {
    const [system, settings, instances, accounts] = await Promise.all([
      api.system(),
      api.getSettings(),
      api.listInstances(),
      api.getAccounts()
    ])
    applySettings(settings)
    if (settings.bigPictureOnStart) void get().enterBigPicture()
    const remembered = get().selectedId
    const selectedId = instances.some((i) => i.id === remembered) ? remembered : (instances[0]?.id ?? null)
    set({
      ready: true,
      system,
      settings,
      instances,
      accounts: accounts.accounts,
      activeAccountId: accounts.activeId,
      selectedId,
      storeTarget: selectedId,
      whatsNewOpen: settings.seenRelease !== CURRENT.version
    })
    subscribe()
    void get().refreshPlugins()
    try {
      set({ versions: await api.listVersions() })
    } catch (e) {
      set({ versionsError: errorText(e) })
    }
  },

  async patchSettings(patch) {
    const merged = { ...get().settings!, ...patch }
    applySettings(merged)
    set({ settings: merged })
    await api.updateSettings(patch)
  },

  async refreshInstances() {
    const instances = await api.listInstances()
    const { selectedId, tabs, activeTabId, storeTarget, stage, stageBack } = get()
    const alive = new Set(instances.map((i) => i.id))
    const nextTabs = tabs
      .filter((t) => t.kind !== 'instance' || alive.has(t.ref!))
      .map((t) => (t.kind === 'instance' ? { ...t, title: instances.find((i) => i.id === t.ref)!.name } : t))
    const nextSelected = selectedId && alive.has(selectedId) ? selectedId : (instances[0]?.id ?? null)
    const activeGone = stage === 'tab' && !nextTabs.some((t) => t.id === activeTabId)
    set({
      instances,
      stage: activeGone ? stageBack : stage,
      tabs: nextTabs,
      activeTabId: nextTabs.some((t) => t.id === activeTabId) ? activeTabId : (nextTabs.at(-1)?.id ?? null),
      selectedId: nextSelected,
      storeTarget: storeTarget && alive.has(storeTarget) ? storeTarget : nextSelected
    })
  },

  setAccounts: (state) => set({ accounts: state.accounts, activeAccountId: state.activeId }),

  select(id) {
    localStorage.setItem('selectedId', id)
    set({ selectedId: id, storeTarget: id })
  },

  toggleRail(kind) {
    const { sidebar } = get()
    set({ sidebar: sidebar === kind ? null : kind, lastSidebar: kind })
  },

  async enterBigPicture() {
    set({ bigPicture: true, bigPictureHidden: false })
    await api.setFullscreen(true)
  },
  async exitBigPicture() {
    set({ bigPicture: false, bigPictureHidden: false })
    await api.setFullscreen(false)
  },
  openSidebar: (kind) => set({ sidebar: kind, lastSidebar: kind, stage: kind === 'store' ? 'store' : 'home' }),

  toggleSidebar() {
    const { sidebar, lastSidebar } = get()
    set({ sidebar: sidebar ? null : lastSidebar, lastSidebar: sidebar ?? lastSidebar })
  },

  openTab(tab) {
    const { tabs, stage, stageBack } = get()
    set({
      tabs: tabs.some((t) => t.id === tab.id) ? tabs : [...tabs, tab],
      activeTabId: tab.id,
      stage: 'tab',
      stageBack: stage === 'tab' ? stageBack : stage
    })
  },

  closeTab(id) {
    const { tabs, activeTabId, stage, stageBack } = get()
    const index = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    set({
      tabs: next,
      stage: id === activeTabId && stage === 'tab' ? stageBack : stage,
      activeTabId: id === activeTabId ? (next[Math.min(index, next.length - 1)]?.id ?? null) : activeTabId
    })
  },

  openInstance(id) {
    const instance = get().instances.find((i) => i.id === id)
    if (!instance) return
    get().select(id)
    get().openTab({ id: `instance:${id}`, kind: 'instance', title: instance.name, ref: id })
  },

  openProject: (id, title) => get().openTab({ id: `project:${id}`, kind: 'project', title, ref: id }),
  openSettings: () => get().openTab(SETTINGS),
  openPlugins: () => get().openTab(PLUGINS),
  openServers: () => get().openTab(SERVERS),
  async refreshPlugins() {
    try {
      set({ plugins: await api.listPlugins() })
    } catch {
    }
  },
  closeWhatsNew() {
    set({ whatsNewOpen: false })
    void get().patchSettings({ seenRelease: CURRENT.version })
  },
  openWelcome() {
    get().openTab(WELCOME)
    set({ stage: 'home' })
  },

  async play(id, server) {
    const { settings, activeAccountId, toast, instances } = get()
    if (!instances.some((i) => i.id === id)) return
    if (!activeAccountId) {
      toast('warn', 'Добавьте аккаунт, чтобы начать игру')
      set({ accountOpen: true })
      return
    }
    set((s) => ({
      logs: { ...s.logs, [id]: [] },
      logInstanceId: id,
      panelOpen: settings?.openPanelOnLaunch ? true : s.panelOpen
    }))
    try {
      await api.launch(id, server ? { server } : undefined)
    } catch (e) {
      toast('error', errorText(e))
    }
    await get().refreshInstances()
  },

  stop: (id) => api.stop(id),

  async removeInstance(id) {
    const instance = get().instances.find((i) => i.id === id)
    if (!instance) return
    const ok = await get().confirm(
      `Удалить «${instance.name}»?`,
      'Папка сборки с мирами и модами будет перемещена в корзину.',
      'Удалить'
    )
    if (!ok) return
    try {
      await api.removeInstance(id)
      await get().refreshInstances()
    } catch (e) {
      get().toast('error', errorText(e))
    }
  },

  async duplicateInstance(id) {
    try {
      const copy = await api.duplicateInstance(id)
      await get().refreshInstances()
      get().openInstance(copy.id)
    } catch (e) {
      get().toast('error', errorText(e))
    }
  },

  toast(kind, text) {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 260)
      },
      kind === 'info' ? 3500 : 9000
    )
  },

  confirm: (title, text, action) =>
    new Promise((resolve) =>
      set({
        confirmRequest: {
          title,
          text,
          action,
          resolve: (ok) => {
            set({ confirmRequest: null })
            resolve(ok)
          }
        }
      })
    ),

  prompt: (title, placeholder, ok) =>
    new Promise((resolve) =>
      set({
        promptRequest: {
          title,
          placeholder,
          ok,
          resolve: (value) => {
            set({ promptRequest: null })
            resolve(value)
          }
        }
      })
    ),

  bumpContent: () => set((s) => ({ contentRevision: s.contentRevision + 1 })),

  async installModpack(projectId, versionId) {
    try {
      const instance = await api.installModpack(projectId, versionId)
      await get().refreshInstances()
      get().openInstance(instance.id)
      get().toast('info', `Модпак «${instance.name}» установлен. Можно играть!`)
    } catch (e) {
      get().toast('error', errorText(e))
    }
  },

  async importModpack() {
    try {
      const instance = await api.importModpack()
      if (!instance) return
      await get().refreshInstances()
      get().openInstance(instance.id)
      get().toast('info', `Модпак «${instance.name}» импортирован`)
    } catch (e) {
      get().toast('error', errorText(e))
    }
  },

  async createWithLocalMod(projectId, title, gameVersion) {
    try {
      const loaders = await api.loaderVersions('fabric', gameVersion)
      const loader = loaders.find((v) => v.tag === 'recommended') ?? loaders[0]
      if (!loader) throw new Error(`Для ${gameVersion} нет сборок Fabric.`)
      const instance = await api.createInstance({ name: title, mcVersion: gameVersion, loader: 'fabric', loaderVersion: loader.version, color: '#e0705a' })
      await api.installFromStore(instance.id, 'mod', projectId)
      await get().refreshInstances()
      get().select(instance.id)
      get().bumpContent()
      get().toast('info', `Сборка с ${title} готова. Нажмите «Играть».`)
    } catch (e) {
      get().toast('error', errorText(e))
    }
  },

  async exportModpack(id) {
    try {
      const path = await api.exportModpack(id)
      if (path) get().toast('info', `Сохранено: ${path}`)
    } catch (e) {
      get().toast('error', errorText(e))
    }
  }
}))

let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true

  onEvent<{ maximized: boolean }>('win:state', ({ maximized }) => useStore.setState({ maximized }))
  onEvent('plugins:changed', () => void useStore.getState().refreshPlugins())
  onEvent<{ text: string; kind: Toast['kind'] }>('plugins:toast', ({ text, kind }) => useStore.getState().toast(kind, text))

  let pending: LogLine[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const batch = pending
    pending = []
    useStore.setState((s) => {
      const logs = { ...s.logs }
      for (const line of batch) {
        const list = logs[line.instanceId] === s.logs[line.instanceId] ? [...(logs[line.instanceId] ?? [])] : logs[line.instanceId]
        list.push(line)
        logs[line.instanceId] = list
      }
      for (const key of Object.keys(logs)) {
        if (logs[key].length > MAX_LOG_LINES) logs[key] = logs[key].slice(-MAX_LOG_LINES)
      }
      return { logs }
    })
  }
  onEvent<LogLine>('game:log', (line) => {
    pending.push(line)
    timer ??= setTimeout(flush, 120)
  })

  onEvent<TaskState>('task', (task) => {
    useStore.setState((s) => ({
      tasks: s.tasks.some((t) => t.id === task.id) ? s.tasks.map((t) => (t.id === task.id ? task : t)) : [...s.tasks, task]
    }))
    if (task.state !== 'running') {
      setTimeout(() => useStore.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) })), 1500)
    }
  })

  onEvent<GameState>('game:state', ({ instanceId, state, exitCode }) => {
    useStore.setState((s) => ({ games: { ...s.games, [instanceId]: state } }))
    if (state === 'stopped') {
      void useStore.getState().refreshInstances()
      if (exitCode !== 0 && exitCode !== null && exitCode !== undefined) {
        useStore.getState().toast('error', `Игра завершилась с ошибкой (код ${exitCode}). Подробности в панели вывода.`)
        useStore.setState({ panelOpen: true, logInstanceId: instanceId })
      }
    }
  })
}
