/**
 * Shell preload: the three capabilities D1 agreed to, the secret store the same
 * decision could not anticipate, and the online-upgrade surface.
 *
 * Named methods only, no generic `invoke`: the page inside this window is a remote
 * document. The update methods are additionally origin-gated in the main process
 * (`activeGatewayForSender`), so a page that is not the active gateway cannot turn
 * "check for updates" into a privileged WSL operation.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ShellBridge,
  ShellUpdateCheck,
  ShellUpdateProgress,
  ShellUpgradeResult,
} from '../shared/shellBridge'

const bridge: ShellBridge = {
  openInBrowser: (): Promise<void> => ipcRenderer.invoke('shell:openInBrowser'),
  reconnect: (): Promise<void> => ipcRenderer.invoke('shell:reconnect'),
  quit: (): Promise<void> => ipcRenderer.invoke('shell:quit'),
  getGatewaySecret: (origin: string): Promise<{ status: string; secret?: string }> =>
    ipcRenderer.invoke('shell:secret-get', origin),
  setGatewaySecret: (origin: string, secret: string): Promise<{ stored: boolean; result: string }> =>
    ipcRenderer.invoke('shell:secret-set', origin, secret),
  forgetGatewaySecret: (origin: string): Promise<void> =>
    ipcRenderer.invoke('shell:secret-forget', origin),
  getVersion: (): Promise<string> => ipcRenderer.invoke('shell:version'),
  checkForUpdates: (): Promise<ShellUpdateCheck> => ipcRenderer.invoke('shell:update-check'),
  startUpgrade: (): Promise<ShellUpgradeResult> => ipcRenderer.invoke('shell:update-start'),
  onUpdateProgress: (callback: (progress: ShellUpdateProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ShellUpdateProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('shell:update-progress', handler)
    return () => ipcRenderer.removeListener('shell:update-progress', handler)
  },
}

contextBridge.exposeInMainWorld('modelportShell', bridge)
