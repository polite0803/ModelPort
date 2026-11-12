/**
 * Shell preload: the three capabilities D1 agreed to, the secret store the same
 * decision could not anticipate, the online-upgrade surface, and the certificate trust
 * actions that belong to *this* machine rather than to the gateway's process.
 *
 * Named methods only, no generic `invoke`: the page inside this window is a remote
 * document. The update methods are additionally origin-gated in the main process
 * (`activeGatewayForSender`), so a page that is not the active gateway cannot turn
 * "check for updates" into a privileged WSL operation; the trust methods are gated the
 * same way (`activeGatewayForTrust`), because installing into the root store is a
 * privilege the page never asked for and must not get for free.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ShellBridge,
  ShellCertificateTrustResult,
  ShellCertificateTrustStatus,
  ShellRouteCommand,
  ShellUpdateCheck,
  ShellUpdateProgress,
  ShellUpgradeResult,
} from '../shared/shellBridge'

const bridge: ShellBridge = {
  openInBrowser: (): Promise<void> => ipcRenderer.invoke('shell:openInBrowser'),
  reconnect: (): Promise<void> => ipcRenderer.invoke('shell:reconnect'),
  quit: (): Promise<void> => ipcRenderer.invoke('shell:quit'),
  gateways: {
    snapshot: () => ipcRenderer.invoke('shell:gateways'),
    connect: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-connect', id),
    add: (): Promise<void> => ipcRenderer.invoke('shell:gateway-add'),
    edit: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-edit', id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-remove', id),
    installWsl: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-install-wsl', id),
    localAction: (id: string, action: 'start' | 'stop' | 'repair'): Promise<void> =>
      ipcRenderer.invoke('shell:gateway-local', id, action),
    wslAction: (id: string, action: 'start' | 'stop' | 'restart' | 'uninstall'): Promise<void> =>
      ipcRenderer.invoke('shell:gateway-wsl', id, action),
    upgrade: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-upgrade', id),
    deploy: (id: string): Promise<void> => ipcRenderer.invoke('shell:gateway-deploy', id),
    onChanged: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('shell:gateways-changed', handler)
      return () => ipcRenderer.removeListener('shell:gateways-changed', handler)
    },
  },

  routes: {
    publishRouteMenu: (result): void => ipcRenderer.send('shell:route-menu', result),
    onRouteMenuRequest: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('shell:route-menu-request', handler)
      return () => ipcRenderer.removeListener('shell:route-menu-request', handler)
    },
    onRouteCommand: (callback: (command: ShellRouteCommand) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, command: unknown): void => {
        if (command !== null && typeof command === 'object') callback(command as ShellRouteCommand)
      }
      ipcRenderer.on('shell:route-command', handler)
      return () => ipcRenderer.removeListener('shell:route-command', handler)
    },
  },

  onNavigate: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, path: unknown): void => {
      if (typeof path === 'string') callback(path)
    }
    ipcRenderer.on('shell:navigate', handler)
    return () => ipcRenderer.removeListener('shell:navigate', handler)
  },
  getGatewaySecret: (origin: string): Promise<{ status: string; secret?: string }> =>
    ipcRenderer.invoke('shell:secret-get', origin),
  setGatewaySecret: (origin: string, secret: string): Promise<{ stored: boolean; result: string }> =>
    ipcRenderer.invoke('shell:secret-set', origin, secret),
  forgetGatewaySecret: (origin: string): Promise<void> =>
    ipcRenderer.invoke('shell:secret-forget', origin),
  // Argument-free on purpose: the page may ask the console to trust *its* gateway, but it
  // cannot name a file or hand over a PEM for `certutil` to install.
  getGatewayCertificate: (): Promise<ShellCertificateTrustStatus> => ipcRenderer.invoke('shell:tls-status'),
  installGatewayCertificateTrust: (): Promise<ShellCertificateTrustResult> =>
    ipcRenderer.invoke('shell:tls-install-trust'),
  uninstallGatewayCertificateTrust: (): Promise<ShellCertificateTrustResult> =>
    ipcRenderer.invoke('shell:tls-uninstall-trust'),
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
