import { BrowserWindow } from 'electron'

let factory: (() => void) | null = null
let unloaded = false

export const setWindowFactory = (fn: () => void): void => {
  factory = fn
}

export const mainWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())

export function unloadWindow(): void {
  const win = mainWindow()
  if (!win) return
  unloaded = true
  win.close()
}

export const isUnloaded = (): boolean => unloaded

export function restoreWindow(): void {
  const win = mainWindow()
  if (win) {
    win.show()
    return
  }
  unloaded = false
  factory?.()
}
