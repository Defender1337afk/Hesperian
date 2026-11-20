import { api } from '../bridge'
import { useStore, type MenuEntry } from '../store'
import { switchTheme, THEMES } from '../themes'
import { I } from './icons'

export function openPacks(): void {
  useStore.setState({ storeKind: 'modpack' })
  useStore.getState().openSidebar('store')
}

export function instanceMenu(id: string): MenuEntry[] {
  const s = useStore.getState()
  return [
    { label: 'Играть', icon: <I.play size={14} />, run: () => void s.play(id) },
    { label: 'Открыть', run: () => s.openInstance(id) },
    { label: 'Папка игры', icon: <I.folderOpen size={14} />, run: () => void api.openInstanceFolder(id, 'game') },
    { sep: true },
    {
      label: s.instances.find((i) => i.id === id)?.pinned ? 'Открепить' : 'Закрепить сверху',
      run: () => void api.updateInstance(id, { pinned: !s.instances.find((i) => i.id === id)?.pinned }).then(() => s.refreshInstances())
    },
    {
      label: 'Ярлык на рабочем столе',
      run: () =>
        void api
          .createShortcut(id)
          .then(() => s.toast('info', 'Ярлык создан: по нему сборка запустится сразу'))
          .catch((e: unknown) => s.toast('error', e instanceof Error ? e.message : String(e)))
    },
    { label: 'Дублировать', icon: <I.copy size={14} />, run: () => void s.duplicateInstance(id) },
    { label: 'Экспорт в .mrpack…', run: () => void s.exportModpack(id) },
    { label: 'Удалить', icon: <I.trash size={14} />, danger: true, run: () => void s.removeInstance(id) }
  ]
}

export function menuItems(name: string): MenuEntry[] {
  const s = useStore.getState()
  const selected = s.selectedId
  const state = selected ? s.games[selected] : undefined
  const busy = state === 'running' || state === 'launching'
  const menus: Record<string, MenuEntry[]> = {
    file: [
      { label: 'Новая сборка…', kbd: 'Ctrl+N', run: () => useStore.setState({ newInstanceOpen: true }) },
      { label: 'Импорт модпака (.mrpack)…', run: () => void s.importModpack() },
      { label: 'Каталог модпаков', run: () => openPacks() },
      { label: 'Открыть папку сборки', disabled: !selected, run: () => selected && void api.openInstanceFolder(selected, 'game') },
      { sep: true },
      { label: 'Big Picture', kbd: 'F11', run: () => void s.enterBigPicture() },
      { label: 'Настройки', kbd: 'Ctrl+,', run: () => s.openSettings() },
      { label: 'Закрыть вкладку', kbd: 'Ctrl+W', disabled: !s.activeTabId, run: () => s.activeTabId && s.closeTab(s.activeTabId) },
      { sep: true },
      { label: 'Выход', run: () => void api.winClose() }
    ],
    view: [
      { label: 'Big Picture', kbd: 'F11', run: () => void s.enterBigPicture() },
      { sep: true },
      { label: 'Палитра команд…', kbd: 'Ctrl+Shift+P', run: () => useStore.setState({ palette: 'commands' }) },
      { sep: true },
      { label: 'Боковая панель', kbd: 'Ctrl+B', check: Boolean(s.sidebar), run: () => s.toggleSidebar() },
      { label: 'Вывод игры', kbd: 'Ctrl+`', check: s.panelOpen, run: () => useStore.setState({ panelOpen: !s.panelOpen }) },
      { label: 'Режим стримера', check: Boolean(s.settings?.streamerMode), run: () => void s.patchSettings({ streamerMode: !s.settings?.streamerMode }) },
      { label: 'Горячие клавиши', kbd: 'F1', run: () => window.dispatchEvent(new Event('hesperian:hotkeys')) },
      { sep: true },
      ...THEMES.map((t) => ({ label: t.name, check: s.settings?.theme === t.id, run: () => switchTheme(t.id) })),
      { sep: true },
      ...([['dark', 'Тёмное оформление'], ['light', 'Светлое оформление'], ['black', 'Чёрное оформление'], ['system', 'Как в системе']] as const).map(([id, label]) => ({
        label,
        check: (s.settings?.appearance ?? 'dark') === id,
        run: () => void s.patchSettings({ appearance: id })
      }))
    ],
    game: [
      { label: 'Играть', kbd: 'F5', disabled: !selected || busy, run: () => selected && void s.play(selected) },
      { label: 'Закрыть игру', kbd: 'Shift+F5', disabled: !selected || !busy, run: () => selected && void s.stop(selected) },
      { sep: true },
      { label: 'Магазин модов', kbd: 'Ctrl+Shift+X', run: () => s.openSidebar('store') },
      { label: 'Каталог модпаков', run: () => openPacks() },
      { label: 'Аккаунты', run: () => useStore.setState({ accountOpen: true }) }
    ],
    help: [
      { label: 'Все команды', run: () => useStore.setState({ palette: 'commands' }) },
      { label: 'Начальный экран', run: () => s.openWelcome() },
      { label: 'Сайт Modrinth', run: () => void api.openExternal('https://modrinth.com') },
      { sep: true },
      { label: 'Инструменты разработчика', run: () => void api.winDevtools() }
    ]
  }
  return menus[name]
}

export function commands(): MenuEntry[] {
  const s = useStore.getState()
  const selected = s.selectedId
  return [
    ...(selected
      ? [
          { label: 'Играть', kbd: 'F5', run: () => void s.play(selected) },
          { label: 'Закрыть игру', kbd: 'Shift+F5', run: () => void s.stop(selected) }
        ]
      : []),
    { label: 'Новая сборка…', kbd: 'Ctrl+N', run: () => useStore.setState({ newInstanceOpen: true }) },
    { label: 'Каталог модпаков', run: () => openPacks() },
    { label: 'Импорт модпака (.mrpack)…', run: () => void s.importModpack() },
    ...(selected ? [{ label: 'Экспорт сборки в .mrpack…', run: () => void s.exportModpack(selected) }] : []),
    { label: 'Магазин модов', kbd: 'Ctrl+Shift+X', run: () => s.openSidebar('store') },
    { label: 'Сборки', kbd: 'Ctrl+Shift+E', run: () => s.openSidebar('instances') },
    { label: 'Аккаунты', run: () => useStore.setState({ accountOpen: true }) },
    { label: 'Настройки', kbd: 'Ctrl+,', run: () => s.openSettings() },
    { label: 'Начальный экран', run: () => s.openWelcome() },
    { label: 'Боковая панель', kbd: 'Ctrl+B', run: () => s.toggleSidebar() },
    { label: 'Вывод игры', kbd: 'Ctrl+`', run: () => useStore.setState({ panelOpen: !s.panelOpen }) },
    { label: 'Скины', run: () => s.openSkins() },
    { label: 'Что нового', run: () => useStore.setState({ whatsNewOpen: true }) },
    ...THEMES.map((t) => ({ label: `Интерфейс: ${t.name}`, run: () => switchTheme(t.id) }))
  ]
}
