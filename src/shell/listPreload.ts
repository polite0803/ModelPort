/**
 * Bridge for the gateway-list window.
 *
 * Named methods only, no generic invoke: this window lists the operator's gateways and can
 * start/stop/install them, so the surface is deliberately as small as the page's buttons.
 * The main process validates every id against the address book before acting.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { GatewayListSnapshot } from '../shared/shellList'

type LocalAction = 'start' | 'stop' | 'repair'
type WslAction = 'start' | 'stop' | 'restart' | 'uninstall'

const bridge = {
  snapshot: (): Promise<GatewayListSnapshot> => ipcRenderer.invoke('shell:gateways'),
  connect: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-connect', id),
  add: (): Promise<void> => ipcRenderer.invoke('shell:gateway-add'),
  edit: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-edit', id),
  remove: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-remove', id),
  localAction: (id: string, action: LocalAction): Promise<void> =>
    ipcRenderer.invoke('shell:gateway-local', id, action),
  installWsl: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-install-wsl', id),
  wslAction: (id: string, action: WslAction): Promise<void> =>
    ipcRenderer.invoke('shell:gateway-wsl', id, action),
  upgrade: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-upgrade', id),
  deploy: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-deploy', id),
  close: (): Promise<void> => ipcRenderer.invoke('shell:gateway-list-close'),
  onChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('shell:gateways-changed', handler)
    return () => ipcRenderer.removeListener('shell:gateways-changed', handler)
  },
}

contextBridge.exposeInMainWorld('shellList', bridge)
