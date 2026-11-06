/**
 * Host bindings for the *windowless* Electron gateway - the local mode of the console.
 *
 * Why Electron and not the Node daemon: `store.key` is sealed with `safeStorage`, and a
 * bare Node process has no keystore (`UNAVAILABLE_SEALER`). Running the local gateway as a
 * Node child would either make every existing install unreadable or force a second sealing
 * scheme incompatible with the bytes already on disk. A separate Electron process in the
 * same binary keeps the OS keystore, keeps the existing `<appData>/modelport` profile
 * working, and still gives the console a distinct PID it can stop and restart.
 *
 * What is deliberately absent: `desktop`. There is no window, tray or updater here, so
 * `/v1/management/rpc` answers `desktop-only` for those calls. `system` stays, because
 * save/open dialogs and the OS opener work without a window - that is what keeps
 * "export backup" usable from the local console.
 */
import { app, dialog, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { GATEWAY_RESTART_EXIT_CODE } from '../../shared/localGateway'
import { pushToHeadlessSubscribers, setHost, type SystemCapabilities } from './host'

export function bindElectronGatewayHost(): void {
  const system: SystemCapabilities = {
    pickSavePath: async (defaultName) => {
      let directory = app.getPath('home')
      try {
        directory = app.getPath('downloads')
      } catch {
        // fall back to home
      }
      const result = await dialog.showSaveDialog({
        defaultPath: join(directory, defaultName),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      return result.canceled || !result.filePath ? null : result.filePath
    },
    pickOpenPath: async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'ModelPort backup', extensions: ['json'] }],
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    // `app.relaunch()` here would start the *console* (same binary, no flag). The supervisor
    // owns the restart, so ask it in the only language it listens to: the exit code.
    restart: () => {
      process.exit(GATEWAY_RESTART_EXIT_CODE)
    },
    openWithSystemHandler: (target) => shell.openExternal(target),
  }

  setHost({
    kind: 'electron',
    getVersion: () => app.getVersion(),
    // Packaged: the same `extraResources` tree the desktop app has. Dev: the repo copy.
    getResourceRoot: () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')),
    // The console loads `/ui/` from this listener, so the gateway must serve it. `__dirname`
    // is `out/main` in both dev and the packaged asar, and the renderer sits beside it.
    getWebRoot: () => join(__dirname, '../renderer'),
    openExternal: (url) => {
      void shell.openExternal(url).catch((error: unknown) => {
        console.warn(`[Gateway] could not open ${url}:`, error)
      })
    },
    push: pushToHeadlessSubscribers,
    syncLoginItem: async (enabled) => {
      // The console owns the login item; a gateway that also wrote one would leave two
      // autostarts behind after a mode switch.
      console.log(`[Gateway] autoStart=${enabled} is owned by the console, not by the gateway process`)
      return { applied: false }
    },
    sealer: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => Buffer.from(safeStorage.encryptString(plain)),
      decryptString: (sealed) => safeStorage.decryptString(sealed),
    },
    system,
    // No `desktop` bag on purpose - see the header.
  })
}
