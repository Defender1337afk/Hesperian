import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { releaseName } from '../shared/release'
import { loadPlugins } from './plugins'
import { join } from 'node:path'
import { api } from './api'
import { getSettings, updateSettings } from './config'
import { setEventSink } from './events'
import { anyRunning } from './minecraft/launch'
import { stopAllServers } from './servers'
import { setWindowFactory } from './window'

const hidden = process.env.HESPERIAN_HIDDEN === '1'

const isSafeExternal = (url: string): boolean => /^https?:\/\//.test(url)

function createWindow(): void {
  const { windowBounds, windowMaximized } = getSettings()
  const win = new BrowserWindow({
    ...(windowBounds ?? { width: 1400, height: 880 }),
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0c110e',
    title: releaseName(),
    icon: join(__dirname, '../renderer/icon.png'),
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      offscreen: hidden,
      backgroundThrottling: !hidden
    }
  })

  if (windowMaximized) win.maximize()
  if (!hidden) win.once('ready-to-show', () => win.show())

  const sendState = (): void => {
    if (!win.isDestroyed()) win.webContents.send('win:state', { maximized: win.isMaximized() })
  }
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
  win.on('close', () => {
    updateSettings({ windowBounds: win.getNormalBounds(), windowMaximized: win.isMaximized() })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    if (isSafeExternal(url) && !url.startsWith('http://localhost')) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const expose = (): void => {
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(`api:${name}`, (_event, ...args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args)
    )
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.show()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    setEventSink((channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
      }
    })
    expose()
    setWindowFactory(createWindow)
    createWindow()
    void loadPlugins().catch((e) => console.error('Плагины не загрузились', e))
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', stopAllServers)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !anyRunning()) app.quit()
  })
}
