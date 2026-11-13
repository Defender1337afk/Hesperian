import { app, BrowserWindow, dialog, shell } from 'electron'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { extname, join } from 'node:path'
import type { ContentKind, ContentUpdate, Instance, NewInstance, Settings, StoreQuery, SystemInfo } from '../shared/types'
import * as accounts from './accounts'
import { dataRoot, getSettings, paths, updateSettings } from './config'
import * as content from './content'
import { emit, Task } from './events'
import * as instances from './instances'
import { fabricVersions } from './minecraft/fabric'
import { forgeVersions, neoforgeVersions } from './minecraft/forge'
import { ensureHorizon } from './experimental'
import * as gallery from './gallery'
import { panoramaFaces } from './panorama'
import { ensureInstalled, isRunning, launchExternal, launchGame, stopGame } from './minecraft/launch'
import { listVersions } from './minecraft/vanilla'
import * as modpacks from './modpacks'
import * as modrinth from './modrinth'
import * as updates from './updates'
import * as plugins from './plugins'
import * as servers from './servers'
import * as skins from './skins'
import { restoreWindow, unloadWindow } from './window'
import { optimizeInstance } from './optimize'
import { updateLocalMods } from './localmods'
import * as astra from './astra'

const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const window = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0]

const FOLDERS: Record<string, string> = {
  game: '',
  mods: 'mods',
  resourcepacks: 'resourcepacks',
  shaderpacks: 'shaderpacks',
  saves: 'saves',
  screenshots: 'screenshots',
  logs: 'logs'
}

export const api = {
  system: async (): Promise<SystemInfo> => ({
    totalMemoryMb: Math.floor(totalmem() / 1024 / 1024),
    platform: process.platform,
    dataDir: dataRoot(),
    appVersion: app.getVersion()
  }),

  getSettings: async () => getSettings(),
  updateSettings: async (patch: Partial<Settings>) => updateSettings(patch),
  winMinimize: async () => window()?.minimize(),
  winMaximize: async () => {
    const win = window()
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize()
  },
  winClose: async () => window()?.close(),
  setFullscreen: async (on: boolean) => window()?.setFullScreen(on),
  panoramaFaces,
  listWorlds: gallery.listWorlds,
  backupWorld: gallery.backupWorld,
  restoreBackup: gallery.restoreBackup,
  deleteBackup: gallery.deleteBackup,
  listScreenshots: gallery.listScreenshots,
  openScreenshot: gallery.openScreenshot,
  copyScreenshot: gallery.copyScreenshot,
  trashScreenshot: gallery.trashScreenshot,
  winDevtools: async () => window()?.webContents.toggleDevTools(),

  listVersions,
  loaderVersions: async (loader: 'fabric' | 'forge' | 'neoforge', mc: string) =>
    ({ fabric: fabricVersions, forge: forgeVersions, neoforge: neoforgeVersions })[loader](mc),

  listInstances: instances.listInstances,
  createInstance: async (input: NewInstance) => instances.createInstance(input),
  updateInstance: async (id: string, patch: Partial<Instance>) => instances.updateInstance(id, patch),
  duplicateInstance: instances.duplicateInstance,
  removeInstance: async (id: string) => {
    if (isRunning(id)) throw new Error('Сначала закройте игру')
    await instances.removeInstance(id, (path) => shell.trashItem(path))
  },
  openInstanceFolder: async (id: string, folder: string) => {
    instances.assertId(id)
    if (!(folder in FOLDERS)) throw new Error(`Неизвестная папка: ${folder}`)
    const path = join(paths.gameDir(id), FOLDERS[folder])
    await mkdir(path, { recursive: true })
    await shell.openPath(path)
  },

  launch: async (id: string, options?: { server?: string }) => {
    const instance = instances.getInstance(id)
    if (instance.engine === 'horizon') {
      instances.updateInstance(id, { lastPlayedAt: Date.now() })
      await launchExternal(instance, ensureHorizon, (played) => {
        const current = instances.getInstance(id)
        instances.updateInstance(id, { playTimeSec: current.playTimeSec + played })
      })
      return
    }
    const auth = await accounts.getLaunchAuth()
    const updated = await updateLocalMods(id).catch(() => [] as string[])
    if (updated.length) emit('plugins:toast', { text: `Обновлено: ${updated.join(', ')}`, kind: 'info' })
    instances.updateInstance(id, { lastPlayedAt: Date.now() })
    const extra = await plugins.beforeLaunch(instance)
    const launched = extra.length ? { ...instance, jvmArgs: [instance.jvmArgs ?? '', ...extra].join(' ').trim() } : instance
    const server = options?.server?.trim() || undefined
    await launchGame(launched, auth, (played) => {
      const current = instances.getInstance(id)
      instances.updateInstance(id, { playTimeSec: current.playTimeSec + played })
      void plugins.afterExit(current, played)
      restoreWindow()
    }, server)
    const after = getSettings().afterLaunch
    if (after === 'unload') unloadWindow()
    else if (after === 'hide') window()?.hide()
  },
  stop: async (id: string) => stopGame(id),

  optimizeInstance,
  microsoftLoginAvailable: async () => accounts.microsoftLoginAvailable(),
  skinProfile: skins.skinProfile,
  uploadSkin: skins.uploadSkin,
  resetSkin: skins.resetSkin,
  setCape: skins.setCape,
  skinLibrary: async () => skins.skinLibrary(),
  saveSkin: async (name: string, data: string, variant: 'classic' | 'slim') => skins.saveSkin(name, data, variant),
  removeSkin: async (id: string) => skins.removeSkin(id),
  skinFromUrl: skins.skinFromUrl,
  pickSkinFile: async () => {
    const parent = window()
    const options = { properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Скин PNG', extensions: ['png'] }] }
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (res.canceled) return null
    const data = await readFile(res.filePaths[0])
    return { name: res.filePaths[0].split(/[\\/]/).pop()!.replace(/\.png$/i, ''), data: `data:image/png;base64,${data.toString('base64')}` }
  },
  listServers: async () => servers.listServers(),
  createServer: async (input: Parameters<typeof servers.createServer>[0]) => servers.createServer(input),
  updateServer: async (id: string, patch: Parameters<typeof servers.updateServer>[1]) => servers.updateServer(id, patch),
  removeServer: async (id: string) => servers.removeServer(id),
  startServer: servers.startServer,
  stopServer: async (id: string) => servers.stopServer(id),
  sendServerCommand: async (id: string, command: string) => servers.sendCommand(id, command),
  serverLog: async (id: string) => servers.serverLog(id),
  openServerFolder: servers.openServerFolder,
  serverAddresses: async () => servers.serverAddresses(),
  listFriendServers: async () => servers.listFriendServers(),
  addFriendServer: async (name: string, address: string) => servers.addFriendServer(name, address),
  removeFriendServer: async (id: string) => servers.removeFriendServer(id),
  pingServer: (address: string) => servers.pingServer(address),
  setLowEnd: async (on: boolean) =>
    updateSettings(on ? { lowEnd: true, afterLaunch: 'unload', animations: false } : { lowEnd: false, afterLaunch: 'keep', animations: true }),
  bundledPlugins: async () => plugins.bundledPlugins(),
  installBundledPlugin: plugins.installBundledPlugin,
  listPlugins: async () => plugins.listPlugins(),
  reloadPlugins: async () => {
    await plugins.loadPlugins()
    return plugins.listPlugins()
  },
  setPluginEnabled: plugins.setPluginEnabled,
  runPluginCommand: plugins.runPluginCommand,
  createPlugin: plugins.createPlugin,
  openPluginsFolder: plugins.openPluginsFolder,
  pluginLogs: async () => plugins.pluginLogs(),

  astraHome: async (id: string) => astra.readHome(instances.getInstance(id)),
  setAstraStyle: async (id: string, style: number) => astra.writeStyle(instances.getInstance(id), style),
  repair: async (id: string) => {
    const instance = instances.getInstance(id)
    const task = new Task(`Проверка файлов: ${instance.name}`)
    try {
      await ensureInstalled(instance, task, true)
      task.finish()
    } catch (e) {
      task.fail(e)
      throw e
    }
  },

  listContent: content.listContent,
  setContentEnabled: content.setContentEnabled,
  removeContent: async (id: string, kind: ContentKind, file: string) =>
    content.removeContent(id, kind, file, (path) => shell.trashItem(path)),
  addContentFiles: async (id: string, kind: ContentKind) => {
    const extensions = kind === 'mod' ? ['jar'] : ['zip']
    const parent = window()
    const options = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Файлы', extensions }]
    }
    const { canceled, filePaths } = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (!canceled) await content.addLocalContent(id, kind, filePaths)
    return !canceled
  },

  searchStore: async (q: StoreQuery) => modrinth.searchStore(q),
  getProject: modrinth.getProject,
  getProjectVersions: modrinth.getProjectVersions,
  installFromStore: modrinth.installFromStore,

  installModpack: modpacks.installModpack,
  importModpack: async () => {
    const parent = window()
    const options = {
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Модпак Modrinth', extensions: ['mrpack'] }]
    }
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : modpacks.importModpack(res.filePaths[0])
  },
  exportModpack: async (id: string) => {
    const instance = instances.getInstance(id)
    const parent = window()
    const options = {
      defaultPath: join(app.getPath('downloads'), `${instance.name.replace(/[\\/:*?"<>|]+/g, '_')}.mrpack`),
      filters: [{ name: 'Модпак Modrinth', extensions: ['mrpack'] }]
    }
    const res = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return null
    await modpacks.exportModpack(id, res.filePath)
    shell.showItemInFolder(res.filePath)
    return res.filePath
  },
  checkUpdates: async (id: string, kinds?: ContentKind[]) => updates.checkUpdates(id, kinds),
  applyUpdate: async (id: string, update: ContentUpdate) => {
    if (isRunning(id)) throw new Error('Сначала закройте игру')
    await updates.applyUpdate(id, update)
  },

  getAccounts: async () => accounts.getAccounts(),
  setActiveAccount: async (id: string) => accounts.setActiveAccount(id),
  removeAccount: async (id: string) => accounts.removeAccount(id),
  addOfflineAccount: async (name: string) => accounts.addOfflineAccount(name),
  startMicrosoftLogin: async () => accounts.startMicrosoftLogin(),
  cancelMicrosoftLogin: async () => accounts.cancelMicrosoftLogin(),

  openExternal: async (url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  },
  pickFolder: async () => {
    const parent = window()
    const options = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : res.filePaths[0]
  },
  pickJava: async () => {
    const parent = window()
    const options = {
      properties: ['openFile'] as 'openFile'[],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : []
    }
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : res.filePaths[0]
  },
  pickBackground: async () => {
    const parent = window()
    const options = {
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (res.canceled) return null
    const path = res.filePaths[0]
    if ((await stat(path)).size > MAX_BACKGROUND_BYTES) throw new Error('Файл больше 12 МБ')
    const type = IMAGE_TYPES[extname(path).toLowerCase()]
    if (!type) throw new Error('Формат не поддерживается')
    return `data:${type};base64,${(await readFile(path)).toString('base64')}`
  },
  relaunch: async () => {
    app.relaunch()
    app.exit(0)
  }
}

export type Api = typeof api
