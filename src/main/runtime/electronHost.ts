/**
 * Electron host bindings - the only place the gateway reads the Electron shell for.
 *
 * Bound by `src/main/index.ts` before any gateway module is touched; the headless
 * daemon binds `createNodeHost()` instead. See `host.ts` for why there is no default.
 *
 * The `desktop` bag is deliberately populated here and nowhere else: tray, updater,
 * save dialogs, window buttons and the OS link handler only exist in a desktop install,
 * so a headless host leaves it absent and the shared handlers answer `desktop-only`.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { setHost, type SystemCapabilities, type WindowAction } from './host'
import { setIpcTransport } from '../ipc/registry'
import { installTrustedSenderGuard } from '../ipc/trustedSender'
import { syncAutoStart } from '../autostartHost'
import { TrayManager } from '../tray/TrayManager'
import { UpdaterManager } from '../updater'
import { setTitleBarTheme } from '../window/manager'

export function bindElectronHost(): void {
  // Sender validation must wrap `ipcMain.handle` before any handler is registered,
  // otherwise the channels registered in this tick bypass the guard.
  installTrustedSenderGuard()
  setIpcTransport((channel, handler) => {
    ipcMain.handle(channel, handler as (...args: unknown[]) => unknown)
  })

  const updaterManager = UpdaterManager.getInstance()

  // Shared by the windowed desktop host and the windowless local gateway.
  const system: SystemCapabilities = {
    pickSavePath: async (defaultName) => {
      // `downloads` is unavailable in a few managed environments; a failed export
      // because of the default folder would be worse than writing to home.
      let directory = app.getPath('home')
      try {
        directory = app.getPath('downloads')
      } catch {
        // fall back to home
      }
      const options = {
        defaultPath: join(directory, defaultName),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
      const parent = dialogWindow()
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      return result.canceled || !result.filePath ? null : result.filePath
    },
    pickOpenPath: async () => {
      const options = {
        properties: ['openFile'] as ['openFile'],
        filters: [{ name: 'ModelPort backup', extensions: ['json'] }],
      }
      const parent = dialogWindow()
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    restart: () => {
      app.relaunch()
      app.quit()
    },
    openWithSystemHandler: (target) => shell.openExternal(target),
  }

  setHost({
    kind: 'electron',
    getVersion: () => app.getVersion(),
    // Packaged: electron-builder's `extraResources` land next to the app under
    // `process.resourcesPath`. Dev: the same tree lives under the repo's `resources/`.
    getResourceRoot: () => (app.isPackaged ? process.resourcesPath : joinAppResources()),
    openExternal: (url) => {
      void shell.openExternal(url)
    },
    push: (channel, payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        // Destroying the window and destroying its webContents are two different events;
        // sending into either one throws.
        try {
          if (window.isDestroyed() || window.webContents.isDestroyed()) continue
          window.webContents.send(channel, payload)
        } catch {
          // A broadcast never blocks the action that produced it.
        }
      }
    },
    syncLoginItem: (enabled) => syncAutoStart(enabled),
    sealer: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => Buffer.from(safeStorage.encryptString(plain)),
      decryptString: (sealed) => safeStorage.decryptString(sealed),
    },
    system,
    desktop: {
      ...system,
      notifyProxyStatus: (running) => TrayManager.getInstance().updateProxyStatus(running),
      getAppVersion: () => app.getVersion(),
      getUpdateStatus: () => updaterManager.getStatus(),
      checkForUpdates: async () => {
        await updaterManager.checkForUpdates()
        return updaterManager.getStatus()
      },
      downloadUpdate: () => updaterManager.downloadUpdate(),
      quitAndInstall: () => updaterManager.quitAndInstall(),
      window: (action, theme) => {
        const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
        switch (action) {
          case 'minimize':
            window?.minimize()
            return
          case 'maximize':
            if (window?.isMaximized()) window.unmaximize()
            else window?.maximize()
            return
          case 'close':
            // The quit flag is what tells `window-all-closed` to actually quit; without it
            // the same button hides the app into a tray nobody asked for.
            app.isQuitting = true
            window?.close()
            return
          case 'hide':
            window?.hide()
            return
          case 'show':
            window?.show()
            window?.focus()
            return
          case 'title-bar-theme':
            if (theme === 'dark' || theme === 'light') setTitleBarTheme(theme)
            return
        }
      },
    },
  })
}

function joinAppResources(): string {
  return join(app.getAppPath(), 'resources')
}

/** Modals hang off the focused window when there is one, so the dialog stays on top of it. */
function dialogWindow(): Electron.BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  const [first] = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed())
  return first
}
