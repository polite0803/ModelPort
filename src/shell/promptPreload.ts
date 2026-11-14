/**
 * Preload for the add/edit gateway dialog only.
 *
 * The dialog document is a `data:` URL built by the shell, so it gets exactly these two
 * messages and no other bridge surface - same reason the main preload exposes named
 * methods instead of a generic `invoke`.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('promptHost', {
  submit: (values: {
    name: string
    url: string
    kind: string
    wslDistro: string
    clientHttpsUrl: string
  }): void => ipcRenderer.send('shell:prompt-submit', values),
  cancel: (): void => ipcRenderer.send('shell:prompt-cancel'),
  probeHttps: (url: string): Promise<{ url: string | null; error: string | null }> =>
    ipcRenderer.invoke('shell:prompt-probe-https', url),
})
