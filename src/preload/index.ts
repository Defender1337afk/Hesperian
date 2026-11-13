import { contextBridge, ipcRenderer } from 'electron'

const EVENTS = new Set(['task', 'game:log', 'game:state', 'account:login', 'win:state', 'app:toast', 'server:log', 'server:state', 'skins:found'])

contextBridge.exposeInMainWorld('bridge', {
  invoke: (name: string, ...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args),
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!EVENTS.has(channel)) throw new Error(`Неизвестное событие: ${channel}`)
    const wrapped = (_: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})
