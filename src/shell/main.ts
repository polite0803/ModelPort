/**
 * Windows-native shell for a gateway that runs elsewhere (WSL daemon, remote host).
 *
 * It is a client window plus a tray icon: `loadURL` at the daemon's `/ui/`, an address
 * book of gateways, and three actions (open in browser / reconnect / quit). It holds no
 * gateway logic and no gateway credentials - the page inside it authenticates with the
 * management secret in sessionStorage, exactly as it does in a plain browser tab.
 *
 * Identity is deliberately separate from the main app (`com.modelport.shell`, userData
 * `modelport-shell`, its own single-instance lock): the two Electron programs must not
 * share a profile, a lock, or the `chat2api -> modelport` migration in the main entry.
 *
 * Closing the window does not quit. That is the requirement this whole line of work
 * exists for: the gateway lives in WSL, and the shell is just a view of it.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import {
  activeEntry,
  normalizeOrigin,
  readBook,
  removeEntry,
  upsertEntry,
  writeBook,
  type GatewayEntry,
} from './addressBook'
import { dropSecret, getSecret, putSecret, type SecretSealer } from './secretStore'

app.setPath('userData', join(app.getPath('appData'), 'modelport-shell'))
app.setAppUserModelId('com.modelport.shell')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let window: BrowserWindow | null = null
let tray: Tray | null = null

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'build/icon.png')
    : join(__dirname, '../../build/icon.png')
}

/** The daemon's own UI path; `/ui` would only bounce through its 302. */
function uiUrl(entry: GatewayEntry): string {
  return `${entry.url.replace(/\/+$/, '')}/ui/`
}

function loadActive(): void {
  if (!window) return
  const entry = activeEntry(readBook())
  if (!entry) {
    window.loadURL(emptyPageUrl())
    return
  }
  void window.loadURL(uiUrl(entry))
}

/**
 * Escape interpolated text for the HTML below. The whole document is separately
 * percent-encoded for its `data:` URL, so a second URL-encode here would make the
 * address field read back as `http%3A%2F%2F127.0.0.1%3A8080` - and saving that fails
 * origin validation, so editing an entry would be impossible. Gateway names are
 * user-typed and reach both an attribute and the failure page's text.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Failure and empty states are plain documents with a link back to the gateway, so they
 * need no IPC surface at all. They name the reason and the next command rather than
 * showing a blank frame - "the gateway is unreachable" and "no gateway configured yet"
 * are different problems and must not look the same.
 */
function emptyPageUrl(): string {
  const html = `<!doctype html><meta charset="utf-8"><title>ModelPort Shell</title>
<body style="font:14px/1.6 system-ui;padding:40px;background:#1a1a1a;color:#eee">
<h2 style="font-size:16px">还没有配置网关</h2>
<p>在托盘图标上选<b>添加网关</b>，填守护进程的地址，例如 <code>http://127.0.0.1:8080</code>。</p>
<p>WSL 里的启动方式见 <code>docs/plan/PLAN-wsl-headless-daemon-and-shell.md</code>。</p>
</body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function failurePageUrl(entry: GatewayEntry, error: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>ModelPort Shell</title>
<body style="font:14px/1.6 system-ui;padding:40px;background:#1a1a1a;color:#eee">
<h2 style="font-size:16px">连不上 ${escapeHtml(entry.name)}</h2>
<p style="color:#f87171">${escapeHtml(error)}</p>
<p>目标：<code>${escapeHtml(uiUrl(entry))}</code></p>
<p><a href="${escapeHtml(uiUrl(entry))}" style="color:#60a5fa">重试</a></p>
<ul style="color:#a1a1aa">
  <li>WSL 里的服务在跑吗：<code>systemctl is-active modelport</code></li>
  <li>绑的是非回环地址吗：宿主连不上只绑 <code>127.0.0.1</code> 的 WSL 监听</li>
  <li>https 自签证书：先在浏览器信任 CA，或从 <code>${escapeHtml(entry.url)}/v1/management/tls/ca</code> 取下来看</li>
</ul>
</body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'ModelPort',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/shell-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL.startsWith('data:')) return
    const entry = activeEntry(readBook())
    if (!entry) return
    console.warn(`[Shell] load failed ${errorCode} ${errorDescription} for ${validatedURL}`)
    window?.loadURL(failurePageUrl(entry, `${errorDescription} (${errorCode})`))
  })

  // A page that fails to mount shows a dark rectangle and leaves nothing behind: the shell
  // has no app-log writer, so without this the only report is "黑屏". Error-level console
  // output and a dead renderer both go to stderr, where the tray process inherited a handle.
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return // this Electron reports numeric levels: 2 = warning, 3 = error
    console.error(`[Shell][renderer level=${level}] ${message} (${sourceId}:${line})`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Shell] renderer gone: ${details.reason} exitCode=${details.exitCode}`)
  })

  // External links stay in the real browser: the shell window is a remote document and
  // must not grow a navigation surface the page itself did not ask for.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (normalizeOrigin(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('close', event => {
    // Hide instead of quitting while the tray is alive: closing the view must leave the
    // gateway (and this client's session) in place.
    if (!app.isQuitting && tray) {
      event.preventDefault()
      window?.hide()
    }
  })

  loadActive()
}

function promptForGateway(existing?: GatewayEntry): Promise<{ name: string; url: string } | null> {
  return new Promise(resolve => {
    const dialog = new BrowserWindow({
      width: 460,
      height: 300,
      parent: window ?? undefined,
      modal: !!window,
      resizable: false,
      title: existing ? '编辑网关' : '添加网关',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/shell-prompt-preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    })

    const settle = (result: { name: string; url: string } | null): void => {
      ipcMain.removeAllListeners('shell:prompt-submit')
      ipcMain.removeAllListeners('shell:prompt-cancel')
      if (!dialog.isDestroyed()) dialog.close()
      resolve(result)
    }

    ipcMain.once('shell:prompt-submit', (_event, values: { name?: string; url?: string }) => {
      const url = typeof values?.url === 'string' ? values.url : ''
      if (normalizeOrigin(url) === null) {
        // Keep the dialog open with the reason: closing it on a typo reads as a cancel.
        dialog.webContents.executeJavaScript(
          `document.getElementById('err').textContent='地址要写成完整 http(s) origin，例如 http://127.0.0.1:8080'`,
        ).catch(() => undefined)
        return
      }
      settle({ name: typeof values?.name === 'string' ? values.name : '', url })
    })
    ipcMain.once('shell:prompt-cancel', () => settle(null))
    // The window's own X button fires no IPC: without this the promise never settles and the
    // two `once` listeners stay behind, so the *next* dialog's submit resolves the old caller.
    dialog.on('closed', () => settle(null))

    const nameValue = existing ? ` value="${escapeHtml(existing.name)}"` : ''
    const urlValue = existing ? ` value="${escapeHtml(existing.url)}"` : ''
    const html = `<!doctype html><meta charset="utf-8"><title>gateway</title>
<body style="font:14px/1.5 system-ui;padding:18px;background:#1a1a1a;color:#eee">
<label style="display:block;margin-bottom:10px">名称<input id="name" ${nameValue}
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<label style="display:block;margin-bottom:10px">地址<input id="url" ${urlValue} placeholder="http://127.0.0.1:8080"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<p id="err" style="color:#f87171;min-height:1.2em;margin:0"></p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
<button id="cancel" style="padding:6px 14px">取消</button>
<button id="ok" style="padding:6px 14px">保存</button></div>
<script>
const send=(t)=>window.promptHost[t]();
document.getElementById('ok').onclick=()=>window.promptHost.submit({
  name:document.getElementById('name').value, url:document.getElementById('url').value});
document.getElementById('cancel').onclick=send('cancel');
addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('ok').click();
if(e.key==='Escape')send('cancel')});
</script></body>`
    void dialog.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

async function addGateway(): Promise<void> {
  const result = await promptForGateway()
  if (!result) return
  try {
    writeBook(upsertEntry(readBook(), result))
  } catch (error) {
    console.error('[Shell] add gateway rejected:', error)
    return
  }
  buildTrayMenu()
  loadActive()
}

async function editGateway(entry: GatewayEntry): Promise<void> {
  const result = await promptForGateway(entry)
  if (!result) return
  writeBook(upsertEntry(readBook(), { ...result, id: entry.id }))
  buildTrayMenu()
  loadActive()
}

function selectGateway(entry: GatewayEntry): void {
  const book = readBook()
  writeBook({ ...book, activeId: entry.id })
  buildTrayMenu()
  loadActive()
}

/**
 * Every tray action announces itself on stderr first. The report that started this was
 * "the shell vanished when I clicked the tray", and a clean exit with an empty log gives
 * nothing to attribute - so the click, not the guess, is what has to be on record.
 */
function trayAction(label: string, run: () => void): MenuItemConstructorOptions {
  return {
    label,
    click: () => {
      console.log(`[Shell] tray action: ${label}`)
      run()
    },
  }
}

function buildTrayMenu(): void {
  if (!tray) return
  const book = readBook()
  const active = activeEntry(book)

  const gatewayItems = book.entries.map(entry =>
    trayAction(`${entry.id === active?.id ? '● ' : '   '}${entry.name}`, () => {
      window?.show()
      selectGateway(entry)
    }),
  )

  tray.setContextMenu(Menu.buildFromTemplate([
    ...(gatewayItems.length > 0
      ? gatewayItems
      : [{ label: '还没有配置的网关', enabled: false }]),
    { type: 'separator' },
    trayAction('添加网关…', () => void addGateway()),
    ...(active ? [trayAction('编辑当前网关…', () => void editGateway(active))] : []),
    ...(active
      ? [trayAction('删除当前网关', () => {
          writeBook(removeEntry(readBook(), active.id))
          buildTrayMenu()
          loadActive()
        })]
      : []),
    { type: 'separator' },
    trayAction('重新连接', () => loadActive()),
    trayAction('在浏览器中打开', () => {
      if (active) void shell.openExternal(uiUrl(active))
    }),
    { type: 'separator' },
    trayAction('退出', () => {
      app.isQuitting = true
      app.quit()
    }),
  ]))
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('ModelPort 控制台')
  buildTrayMenu()
  tray.on('double-click', () => {
    window?.show()
    window?.focus()
  })
}

app.on('second-instance', () => {
  window?.show()
  window?.focus()
})

app.on('ready', () => {
  createTray()
  createWindow()
})

// Electron performs the default quit-on-all-closed only when nothing listens to the event
// (the signal carries no event object, so there is no preventDefault to call here). An empty
// listener is therefore the way to say "the tray outlives the windows": the gateway this
// window shows lives in another process, and losing the view must not look like losing it.
app.on('window-all-closed', () => undefined)

// The first field report was "the shell vanished" with an empty log and a clean exit code,
// so the exit itself has to leave a line behind.
process.on('exit', code => {
  console.error(`[Shell] process exiting, code=${code}`)
})

app.on('before-quit', () => {
  app.isQuitting = true
  tray?.destroy()
})

/**
 * The management secret per gateway, sealed by the OS for this Windows user.
 *
 * `sessionStorage` is the right lifetime for a browser tab and the wrong one for a client
 * whose job is to reconnect; keeping the operator re-pasting a 40-character secret every
 * start only pushes the secret into a text file. With no keystore the store refuses to
 * write (see `secretStore`), so the fallback is the old behaviour, never plaintext.
 */
const secretsPath = (): string => join(app.getPath('userData'), 'secrets.json')

const secretSealer: SecretSealer = {
  get available(): boolean {
    return safeStorage.isEncryptionAvailable()
  },
  encrypt: (text: string): string => safeStorage.encryptString(text).toString('base64'),
  decrypt: (sealed: string): string | null => {
    try {
      return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
    } catch {
      // Sealed for another user or machine: the caller asks again rather than guessing.
      return null
    }
  },
}

ipcMain.handle('shell:secret-get', (_event, origin: unknown) => {
  if (typeof origin !== 'string' || origin === '') return { status: 'none' }
  return getSecret(secretsPath(), secretSealer, origin)
})

ipcMain.handle('shell:secret-set', (_event, origin: unknown, secret: unknown) => {
  if (typeof origin !== 'string' || typeof secret !== 'string') return { stored: false, result: 'rejected' }
  const result = putSecret(secretsPath(), secretSealer, origin, secret)
  return { stored: result === 'stored', result }
})

ipcMain.handle('shell:secret-forget', (_event, origin: unknown) => {
  if (typeof origin !== 'string') return
  dropSecret(secretsPath(), origin)
})

ipcMain.handle('shell:openInBrowser', async () => {
  const entry = activeEntry(readBook())
  if (entry) await shell.openExternal(uiUrl(entry))
})

ipcMain.handle('shell:reconnect', async () => {
  loadActive()
})

ipcMain.handle('shell:quit', async () => {
  app.isQuitting = true
  app.quit()
})
