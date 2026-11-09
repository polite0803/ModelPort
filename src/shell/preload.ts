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
import type {
  ShellBridge,
  ShellCertificateTrustResult,
  ShellCertificateTrustStatus,
  ShellUpdateCheck,
  ShellUpdateProgress,
  ShellUpgradeResult,
} from '../shared/shellBridge'

const bridge: ShellBridge = {
  openInBrowser: (): Promise<void> => ipcRenderer.invoke('shell:openInBrowser'),
  reconnect: (): Promise<void> => ipcRenderer.invoke('shell:reconnect'),
  quit: (): Promise<void> => ipcRenderer.invoke('shell:quit'),
  openGatewayManager: (): Promise<void> => ipcRenderer.invoke('shell:gateway-list-open'),
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
