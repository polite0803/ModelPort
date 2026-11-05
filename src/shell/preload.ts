/**
 * Shell preload: the three capabilities D1 agreed to, plus the secret store the same
 * decision could not anticipate - re-typing the management secret on every start is friction
 * that pushes the operator toward a plaintext note file. Named methods only, no generic
 * `invoke`: the page inside this window is a remote document.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('modelportShell', {
  openInBrowser: (): Promise<void> => ipcRenderer.invoke('shell:openInBrowser'),
  reconnect: (): Promise<void> => ipcRenderer.invoke('shell:reconnect'),
  quit: (): Promise<void> => ipcRenderer.invoke('shell:quit'),
  getGatewaySecret: (origin: string): Promise<{ status: string; secret?: string }> =>
    ipcRenderer.invoke('shell:secret-get', origin),
  setGatewaySecret: (origin: string, secret: string): Promise<{ stored: boolean; result: string }> =>
    ipcRenderer.invoke('shell:secret-set', origin, secret),
  forgetGatewaySecret: (origin: string): Promise<void> =>
    ipcRenderer.invoke('shell:secret-forget', origin),
})
