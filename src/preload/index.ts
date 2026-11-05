/**
 * Preload: expose the shared API object over the real `ipcRenderer`.
 *
 * The method list itself lives in `src/shared/api.ts` so a browser client against a
 * headless daemon can build the identical object over HTTP. Nothing here decides what
 * the UI may call - adding a channel means editing that file, not this one.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { createElectronAPI } from '../shared/api'

const electronAPI = createElectronAPI({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, handler) => ipcRenderer.on(channel, handler as (...a: unknown[]) => void),
  off: (channel, handler) => ipcRenderer.removeListener(channel, handler as (...a: unknown[]) => void),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
})

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
