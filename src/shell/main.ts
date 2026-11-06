/**
 * The console: one window, one tray, and a gateway in one of three places.
 *
 *   local   - a windowless gateway this binary starts as a child process
 *   WSL     - a daemon this console installs and upgrades inside WSL
 *   remote  - a gateway on another host, which this console only connects to
 *
 * The window always loads `<origin>/ui/` (the gateway's own page) and authenticates with
 * the management secret: sealed in `secrets.json` per origin when the OS keystore exists,
 * sessionStorage otherwise. It holds no gateway logic - the gateway is a separate process
 * in every mode, which is what keeps "close the window" from meaning "stop serving".
 *
 * Identity is separate from the gateway profile on purpose (`com.modelport.shell`,
 * userData `modelport-shell`, its own single-instance lock): the console must not share a
 * profile, a lock, or the `chat2api -> modelport` migration with the gateway it supervises.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { join } from 'node:path'
import {
  activeEntry,
  normalizeOrigin,
  readBook,
  removeEntry,
  upsertEntry,
  writeBook,
  type GatewayEntry,
  type GatewayKind,
} from './addressBook'
import { dropSecret, getSecret, putSecret, type SecretSealer } from './secretStore'
import { checkForUpdates, runUpgrade } from './updater'
import {
  adoptLocalHandshake,
  isPidAlive,
  readLocalGatewayLog,
  readLocalGatewayView,
  localGatewayPaths,
  startLocalGateway,
  stopLocalGateway,
  waitForLocalGateway,
} from './localGateway'
import { installWslGateway, probeWslGateway } from './wslInstall'
import type { LocalGatewayView } from '../shared/localGateway'
import type { ShellUpdateProgress } from '../shared/shellBridge'

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

/**
 * Where the window points. Development uses the Vite page (HMR) and reaches the gateway
 * through the dev server's `/v1` proxy, so dev exercises the same HTTP+SSE transport the
 * shipped console uses instead of the old preload IPC.
 */
function viewUrl(origin: string): string {
  const dev = process.env.ELECTRON_RENDERER_URL?.trim()
  return dev ? dev : `${origin.replace(/\/+$/, '')}/ui/`
}

const LOCAL_GATEWAY_NAME = '本机网关'
const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:8080'

async function loadActive(): Promise<void> {
  if (!window) return
  const entry = activeEntry(readBook())
  if (!entry) {
    void window.loadURL(emptyPageUrl())
    return
  }
  if (entry.kind === 'local') {
    await loadLocalGateway(entry)
    return
  }
  void window.loadURL(viewUrl(entry.url))
}

async function loadLocalGateway(entry: GatewayEntry): Promise<void> {
  // The status file is the only authority on the local port, so the window always follows
  // it rather than the URL stored in the address book.
  const view = await ensureLocalGateway(entry)
  const current = activeEntry(readBook())
  const target = current && current.id === entry.id ? current : entry
  if (view.phase === 'running' && view.origin) {
    void window?.loadURL(viewUrl(view.origin))
    return
  }
  void window?.loadURL(localFailurePageUrl(target, view))
}

/**
 * Installs the local gateway on first use, starts it when it is stopped, and adopts the
 * one-time management secret. Returns the state *after* those attempts.
 *
 * "Install" is honest here: the gateway code ships inside this binary, so what the first
 * run actually does is provision (`--init-local`: data dir, management secret, listener)
 * and hand the secret back through a 0600 file the console seals and deletes.
 */
async function ensureLocalGateway(entry: GatewayEntry): Promise<LocalGatewayView> {
  let view = await readLocalGatewayView()
  if (view.phase === 'not-installed') {
    tray?.setToolTip('ModelPort: 正在安装本地网关…')
    startLocalGateway('init')
    view = await waitForLocalGateway()
  } else if (view.phase === 'stopped') {
    startLocalGateway('serve')
    view = await waitForLocalGateway()
  }
  tray?.setToolTip('ModelPort 控制台')

  const origin = view.origin
  if (origin) {
    const adopted = adoptLocalHandshake()
    if (adopted) {
      putSecret(secretsPath(), secretSealer, origin, adopted.secret)
      console.log('[Shell] adopted the local gateway management secret')
    }
    const book = readBook()
    const stored = activeEntry(book)
    if (stored && stored.id === entry.id && normalizeOrigin(stored.url) !== origin) {
      // The port moved (the user changed it in settings). Keep the entry pointing at the
      // gateway that actually exists; the sealed secret now lives under the new origin.
      writeBook(upsertEntry(book, { id: stored.id, name: stored.name, url: origin, kind: 'local' }))
      buildTrayMenu()
    }
  }
  return view
}

/**
 * An empty address book means a fresh install, and a fresh install is local: the console
 * replaces the old desktop app, so the first window must show a gateway that exists
 * rather than an empty "add a gateway" page.
 */
function ensureFirstRunEntry(): void {
  if (readBook().entries.length > 0) return
  try {
    writeBook(upsertEntry(readBook(), {
      name: LOCAL_GATEWAY_NAME,
      url: DEFAULT_LOCAL_ORIGIN,
      kind: 'local',
    }))
  } catch (error) {
    console.error('[Shell] could not create the default local entry:', error)
  }
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

/**
 * The local gateway failing is not the same as a remote one being unreachable: the console
 * owns this process, so the page names which step failed and prints its log tail. Three
 * states stay distinct - never installed, installed but stopped, running but not answering.
 */
function localFailurePageUrl(entry: GatewayEntry, view: LocalGatewayView): string {
  const title = view.phase === 'unreachable'
    ? '本地网关没有响应'
    : view.phase === 'stopped'
      ? '本地网关没有运行'
      : '本地网关没有安装成功'
  const detail = view.phase === 'unreachable'
    ? `进程 ${view.status?.pid ?? '?'} 还在，但 <code>${escapeHtml(view.origin ?? '')}/health</code> 没有应答。`
    : view.phase === 'stopped'
      ? '上次运行的网关进程已经退出。可在托盘选择「启动本地网关」重新拉起。'
      : '网关进程没有写出状态文件。可在托盘选择「重新安装本地网关」，或先看下面的日志。'
  const log = readLocalGatewayLog()
  const logBlock = log.length > 0
    ? `<h3 style="font-size:14px;margin:24px 0 6px">网关日志（最后 ${log.length} 行）</h3>
<pre style="background:#111;padding:12px;overflow:auto;color:#a1a1aa;font-size:12px">${escapeHtml(log.join('\n'))}</pre>`
    : ''
  const html = `<!doctype html><meta charset="utf-8"><title>ModelPort Shell</title>
<body style="font:14px/1.6 system-ui;padding:40px;background:#1a1a1a;color:#eee">
<h2 style="font-size:16px">${title}</h2>
<p style="color:#f87171">${detail}</p>
<p>网关：<code>${escapeHtml(entry.name)}</code> · 本机形态由这个控制台安装与启动。</p>
<ul style="color:#a1a1aa">
  <li>托盘 →「启动本地网关」/「重新安装本地网关」</li>
  <li>端口被占用时网关不会自行换端口：设置里的“代理端口”要空出来</li>
  <li>数据目录是这台机器的 <code>~/.modelport</code>，凭据由系统密钥库封装</li>
</ul>${logBlock}
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

  void loadActive()
}

type GatewayPromptResult = {
  name: string
  url: string
  kind: GatewayKind
  wslDistro: string
}

function promptForGateway(existing?: GatewayEntry): Promise<GatewayPromptResult | null> {
  return new Promise(resolve => {
    const dialog = new BrowserWindow({
      width: 480,
      height: 410,
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

    const settle = (result: GatewayPromptResult | null): void => {
      ipcMain.removeAllListeners('shell:prompt-submit')
      ipcMain.removeAllListeners('shell:prompt-cancel')
      if (!dialog.isDestroyed()) dialog.close()
      resolve(result)
    }

    ipcMain.once('shell:prompt-submit', (_event, values: {
      name?: string
      url?: string
      kind?: string
      wslDistro?: string
    }) => {
      const kind: GatewayKind =
        values?.kind === 'local' || values?.kind === 'wsl' || values?.kind === 'remote'
          ? values.kind
          : 'remote'
      const rawUrl = typeof values?.url === 'string' ? values.url.trim() : ''
      // A local gateway's address is discovered from its status file, so an empty field
      // means "the default loopback origin" rather than an error.
      const url = rawUrl === '' && kind === 'local' ? DEFAULT_LOCAL_ORIGIN : rawUrl
      if (normalizeOrigin(url) === null) {
        // Keep the dialog open with the reason: closing it on a typo reads as a cancel.
        dialog.webContents.executeJavaScript(
          `document.getElementById('err').textContent='地址要写成完整 http(s) origin，例如 http://127.0.0.1:8080'`,
        ).catch(() => undefined)
        return
      }
      const wslDistro = kind === 'wsl' && typeof values?.wslDistro === 'string' ? values.wslDistro.trim() : ''
      if (wslDistro !== '' && !/^[A-Za-z0-9._-]+$/.test(wslDistro)) {
        dialog.webContents.executeJavaScript(
          `document.getElementById('err').textContent='WSL 发行版只能包含字母、数字、点、下划线与连字符'`,
        ).catch(() => undefined)
        return
      }
      settle({
        name: typeof values?.name === 'string' ? values.name : '',
        url,
        kind,
        wslDistro,
      })
    })
    ipcMain.once('shell:prompt-cancel', () => settle(null))
    // The window's own X button fires no IPC: without this the promise never settles and the
    // two `once` listeners stay behind, so the *next* dialog's submit resolves the old caller.
    dialog.on('closed', () => settle(null))

    const nameValue = existing ? ` value="${escapeHtml(existing.name)}"` : ''
    const urlValue = existing ? ` value="${escapeHtml(existing.url)}"` : ''
    const distroValue = existing?.wslDistro ? ` value="${escapeHtml(existing.wslDistro)}"` : ''
    const kind: GatewayKind = existing?.kind === 'wsl' && process.platform !== 'win32'
      ? 'remote'
      : (existing?.kind ?? 'local')
    const selected = (value: GatewayKind): string => ` value="${value}"${kind === value ? ' selected' : ''}`
    const html = `<!doctype html><meta charset="utf-8"><title>gateway</title>
<body style="font:14px/1.5 system-ui;padding:18px;background:#1a1a1a;color:#eee">
<label style="display:block;margin-bottom:10px">名称<input id="name" ${nameValue}
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<label style="display:block;margin-bottom:10px">形态<select id="kind"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box">
  <option${selected('local')}>本地（由本控制台安装与启动）</option>
  ${process.platform === 'win32' ? `<option${selected('wsl')}>WSL（网关装在 WSL 里，本控制台负责安装与升级）</option>` : ''}
  <option${selected('remote')}>远程（网关在另一台机器上，本控制台只连接）</option>
</select></label>
<label id="urlRow" style="display:block;margin-bottom:10px">地址<input id="url" ${urlValue} placeholder="http://127.0.0.1:8080"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<label id="wslRow" style="display:block;margin-bottom:10px">WSL 发行版（留空使用默认）<input id="wslDistro"${distroValue} placeholder="Ubuntu-24.04"
  style="display:block;width:100%;margin-top:4px;padding:6px;box-sizing:border-box"></label>
<p id="err" style="color:#f87171;min-height:1.2em;margin:0"></p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
<button id="cancel" style="padding:6px 14px">取消</button>
<button id="ok" style="padding:6px 14px">保存</button></div>
<script>
const mode=document.getElementById('kind');
const sync=function(){
  document.getElementById('urlRow').style.display=mode.value==='local'?'none':'block';
  document.getElementById('wslRow').style.display=mode.value==='wsl'?'block':'none';
};
mode.onchange=sync;sync();
const send=(t)=>window.promptHost[t]();
document.getElementById('ok').onclick=()=>window.promptHost.submit({
  name:document.getElementById('name').value,
  url:document.getElementById('url').value,
  kind:mode.value,
  wslDistro:document.getElementById('wslDistro').value});
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
  const saved = activeEntry(readBook())
  if (saved && saved.kind === 'wsl' && process.platform === 'win32') void offerWslInstall(saved)
  void loadActive()
}

async function editGateway(entry: GatewayEntry): Promise<void> {
  const result = await promptForGateway(entry)
  if (!result) return
  writeBook(upsertEntry(readBook(), { ...result, id: entry.id }))
  buildTrayMenu()
  void loadActive()
}

/**
 * WSL is the one mode whose gateway genuinely has to be installed: the binary is not on
 * that host, the unit does not exist, and Node may be missing too. The console probes
 * first and only offers the install when the probe says "absent".
 */
async function offerWslInstall(entry: GatewayEntry): Promise<void> {
  const probe = await probeWslGateway(entry.wslDistro)
  if (probe.installed) return
  if (!probe.available) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'WSL 网关',
      message: '这台机器上没有可用的 WSL',
      detail: `${probe.error ?? ''}\n\n先执行 \`wsl --install\`（需要管理员并重启），再回来安装。`,
    })
    return
  }
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'WSL 网关',
    message: '这个发行版里还没有网关，现在安装吗？',
    detail: [
      `发行版：${entry.wslDistro || '默认'}`,
      `Node：${probe.nodeMajor ?? '缺失'}（缺失时由控制台装一份官方构建到 /opt/modelport/node）`,
      '安装会把网关解到 /opt/modelport、写 systemd 单元并启用，需要 root。',
    ].join('\n'),
    buttons: ['安装', '取消'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice.response !== 0) return
  await installWslForEntry(entry)
}

async function installWslForEntry(entry: GatewayEntry): Promise<void> {
  const result = await installWslGateway({
    distro: entry.wslDistro,
    onProgress: (progress) => tray?.setToolTip(`ModelPort: ${progress.message}`),
  })
  tray?.setToolTip('ModelPort 控制台')
  if (!result.ok || !result.origin || !result.secret) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'WSL 网关安装失败',
      message: result.error ?? '未知错误',
    })
    return
  }
  putSecret(secretsPath(), secretSealer, result.origin, result.secret)
  writeBook(upsertEntry(readBook(), {
    id: entry.id,
    name: entry.name,
    url: result.origin,
    kind: 'wsl',
    wslDistro: entry.wslDistro,
  }))
  buildTrayMenu()
  await dialog.showMessageBox({
    type: 'info',
    title: '安装完成',
    message: `网关已在 WSL 里运行：${result.origin}`,
    detail: result.apiKey
      ? `API Key：${result.apiKey}\n（也可以在「API Keys」页面查看或重新生成）`
      : '管理口令已存入系统密钥库，控制台会自动登录。',
  })
  void loadActive()
}

function selectGateway(entry: GatewayEntry): void {
  const book = readBook()
  writeBook({ ...book, activeId: entry.id })
  buildTrayMenu()
  void loadActive()
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

/**
 * Tray entry is the second way in (the first is the remote About page). It uses the
 * active entry directly because the click is the operator's own action, not a message
 * from a remote document.
 */
async function checkForUpdatesFromTray(): Promise<void> {
  const entry = activeEntry(readBook())
  if (!entry) {
    await dialog.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '还没有配置网关',
      detail: '先在托盘里添加一个网关，再检查更新。',
    })
    return
  }
  try {
    const check = await checkForUpdates(entry)
    const lines = [
      `Shell: ${check.shell.current} → ${check.shell.latest ?? '未知'}`,
      `网关: ${check.daemon.current ?? '读取失败'} → ${check.daemon.latest ?? '未知'}`,
      check.daemon.managed ? '网关由本机 WSL 管理，可一并升级' : '网关未标记为 WSL 托管，只升级 Shell',
    ]
    if (check.error) lines.push(`检查失败：${check.error}`)
    const wanted = check.shell.updateAvailable
      || (check.daemon.managed && check.daemon.updateAvailable)
    if (wanted && check.missing.length > 0) {
      lines.push(`缺少安装资源或校验文件：${check.missing.join(', ')}`)
    }
    if (!wanted) {
      await dialog.showMessageBox({ type: 'info', title: '检查更新', message: '已是最新版本', detail: lines.join('\n') })
      return
    }
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: '检查更新',
      message: `有可用更新：${check.release?.version ?? ''}`,
      detail: lines.join('\n'),
      buttons: ['升级', '取消'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response !== 0) return

    const result = await runUpgrade(entry, (progress: ShellUpdateProgress) => {
      tray?.setToolTip(`ModelPort: ${progress.message}`)
      if (window && !window.isDestroyed()) window.webContents.send('shell:update-progress', progress)
    })
    tray?.setToolTip('ModelPort 控制台')
    if (!result.ok) {
      await dialog.showMessageBox({ type: 'error', title: '升级失败', message: result.error ?? '未知错误' })
    } else if (!result.shellUpdated) {
      await dialog.showMessageBox({
        type: 'info',
        title: '升级完成',
        message: '网关已升级',
        detail: result.backup ? `回滚备份：${result.backup}` : '',
      })
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: '检查更新失败',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function kindLabel(kind: GatewayKind): string {
  return kind === 'local' ? '本机' : kind === 'wsl' ? 'WSL' : '远程'
}

/** Explicit start from the tray: unlike startup, this must not be silently skipped. */
async function startLocalFromTray(entry: GatewayEntry): Promise<void> {
  const view = await readLocalGatewayView()
  if (view.phase !== 'running') {
    startLocalGateway(view.phase === 'not-installed' ? 'init' : 'serve')
    await waitForLocalGateway()
  }
  await loadLocalGateway(entry)
}

async function stopLocalFromTray(entry: GatewayEntry): Promise<void> {
  const view = await readLocalGatewayView()
  if (view.status && isPidAlive(view.status.pid)) {
    const stopped = await stopLocalGateway(view.status.pid)
    if (!stopped) {
      console.error(`[Shell] local gateway pid ${view.status.pid} did not stop`)
    }
  }
  // Show the "stopped" screen directly: running loadActive() here would start it again.
  const after = await readLocalGatewayView()
  window?.loadURL(localFailurePageUrl(activeEntry(readBook()) ?? entry, after))
}

async function reinstallLocalFromTray(entry: GatewayEntry): Promise<void> {
  const view = await readLocalGatewayView()
  if (view.status && isPidAlive(view.status.pid)) await stopLocalGateway(view.status.pid)
  startLocalGateway('init')
  const after = await waitForLocalGateway()
  if (after.phase === 'running') await loadLocalGateway(entry)
  else window?.loadURL(localFailurePageUrl(activeEntry(readBook()) ?? entry, after))
}

function buildTrayMenu(): void {
  if (!tray) return
  const book = readBook()
  const active = activeEntry(book)

  const gatewayItems = book.entries.map(entry =>
    trayAction(`${entry.id === active?.id ? '● ' : '   '}[${kindLabel(entry.kind)}] ${entry.name}`, () => {
      window?.show()
      selectGateway(entry)
    }),
  )

  // The local gateway is the one this console owns, so it is the only mode with
  // start/stop/repair actions. A WSL gateway gets install (it has no unit until then) and
  // its upgrades ride along with the console's update check.
  const localItems: MenuItemConstructorOptions[] = active?.kind === 'local'
    ? [
        trayAction('启动本地网关', () => { window?.show(); void startLocalFromTray(active) }),
        trayAction('停止本地网关', () => { window?.show(); void stopLocalFromTray(active) }),
        trayAction('重新安装本地网关（修复）', () => { window?.show(); void reinstallLocalFromTray(active) }),
        trayAction('打开本地网关日志', () => { void shell.openPath(localGatewayPaths().log) }),
      ]
    : []
  const wslItems: MenuItemConstructorOptions[] = active?.kind === 'wsl' && process.platform === 'win32'
    ? [
        trayAction('安装 WSL 网关…（网关不存在时）', () => { window?.show(); void offerWslInstall(active) }),
      ]
    : []

  const items: MenuItemConstructorOptions[] = [
    ...(gatewayItems.length > 0
      ? gatewayItems
      : [{ label: '还没有配置的网关', enabled: false }]),
    { type: 'separator' },
    ...(localItems.length > 0 ? [...localItems, { type: 'separator' } as MenuItemConstructorOptions] : []),
    ...(wslItems.length > 0 ? [...wslItems, { type: 'separator' } as MenuItemConstructorOptions] : []),
    trayAction('添加网关…', () => void addGateway()),
    ...(active ? [trayAction('编辑当前网关…', () => void editGateway(active))] : []),
    ...(active
      ? [trayAction('删除当前网关', () => {
          writeBook(removeEntry(readBook(), active.id))
          buildTrayMenu()
          void loadActive()
        })]
      : []),
    { type: 'separator' },
    trayAction('检查更新（控制台 + 可管理的网关）…', () => void checkForUpdatesFromTray()),
    trayAction('重新连接', () => void loadActive()),
    trayAction('在浏览器中打开', () => {
      if (active) void shell.openExternal(uiUrl(active))
    }),
    { type: 'separator' },
    trayAction('退出', () => {
      app.isQuitting = true
      app.quit()
    }),
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
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
  ensureFirstRunEntry()
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
  await loadActive()
})

ipcMain.handle('shell:quit', async () => {
  app.isQuitting = true
  app.quit()
})

/**
 * The update actions are more dangerous than the secret methods: the WSL side runs as
 * root. Only the page currently loaded from the active gateway may ask for them. A
 * `data:` failure page, a stale frame, or a different origin gets a rejected promise.
 */
function activeGatewayForSender(event: IpcMainInvokeEvent): GatewayEntry {
  const entry = activeEntry(readBook())
  if (!entry) throw new Error('还没有配置网关')
  let origin: string | null = null
  try {
    const url = event.senderFrame?.url ?? ''
    origin = url === '' ? null : new URL(url).origin
  } catch {
    origin = null
  }
  if (origin === null || origin !== normalizeOrigin(entry.url)) {
    throw new Error('升级操作只允许当前网关页面发起')
  }
  return entry
}

ipcMain.handle('shell:version', async () => app.getVersion())

ipcMain.handle('shell:update-check', async (event: IpcMainInvokeEvent) => {
  return await checkForUpdates(activeGatewayForSender(event))
})

ipcMain.handle('shell:update-start', async (event: IpcMainInvokeEvent) => {
  const entry = activeGatewayForSender(event)
  const sender = event.sender
  return await runUpgrade(entry, (progress: ShellUpdateProgress) => {
    if (!sender.isDestroyed()) sender.send('shell:update-progress', progress)
  })
})
