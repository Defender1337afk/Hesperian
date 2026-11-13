import type { Api } from '../../main/api'

interface Bridge {
  invoke(name: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

export const api = new Proxy({} as Api, {
  get:
    (_target, name: string) =>
    async (...args: unknown[]) => {
      try {
        return await window.bridge.invoke(name, ...args)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        throw new Error(message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
      }
    }
})

export const onEvent = <T,>(channel: string, listener: (payload: T) => void): (() => void) =>
  window.bridge.on(channel, listener as (payload: unknown) => void)
