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
  net,
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
import { decideWindowOpen } from './openTarget'
import { dropSecret, getSecret, putSecret, type SecretSealer } from './secretStore'
import { secretOriginAllowed } from './secretGatePlan'
import { gatewayWindowTitle } from './windowTitlePlan'
import { changeGatewayTrust, describeCertificate, gatewayTrustStatus, resolveClientOrigin, type TrustTarget } from './gatewayTrust'
import {
  applySync,
  buildPreview,
  claudeClientInstalled,
  runningImageNames,
  type GatherInput,
} from './clientSync'
import { clientPaths } from './clientSyncPlan'
import { recoverClientWrites } from './clientLiveWrite'
import { readGatewayHttpsOrigin, type GatewayCredential } from './clientSyncRpc'
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
import { controlWslService, probeWslService, removeWslInstall, wslInstallDir } from './wslService'
import type { ServiceControlAction } from './wslInstallPlan'
import { fetchLatestRelease } from './wslExec'
import type { ReleaseInfo } from './updatePlan'
import { deployGuideHtml } from './deployGuide'
import type { LocalGatewayView } from '../shared/localGateway'
import type { GatewayListSnapshot } from '../shared/shellList'
import { buildSnapshot, GATEWAY_ACTION_LABELS, type GatewayListEntry, type GatewayProbeState } from './gatewayListPlan'
import { gatewayListPageUrl } from './gatewayListPage'
import { gatewayPromptPageUrl } from './gatewayPromptPage'
import { escapeHtml } from './htmlEscape'
import { installShellConsoleLog } from './consoleLogSink'
import type { ShellRouteCommand, ShellUpdateProgress } from '../shared/shellBridge'
import type { RouteMenuEntry, RouteMenuResult } from '../shared/types'

app.setPath('userData', join(app.getPath('appData'), 'modelport-shell'))
app.setAppUserModelId('com.modelport.shell')
// Before anything that can fail: a packaged console has no terminal, so without this its own
// `console.error` / `console.warn` - refused certificate, unreadable address book, a gateway
// child that never came up - goes to a stream nobody reads. See `consoleLogSink.ts`.
installShellConsoleLog(app.getPath('userData'))
// A client-config write that was interrupted by a crash or a kill finishes here: the
// journal names the staged files, and each one is adopted only if it still holds the bytes
// read before the write. Nothing is overwritten when the user edited the file meanwhile.
recoverClientWrites(app.getPath('userData'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let window: BrowserWindow | null = null
let tray: Tray | null = null
let listWindow: BrowserWindow | null = null
let guideWindow: BrowserWindow | null = null

/**
 * The certificate the active gateway presented while this machine was refusing it, and the
 * exact failure document that may ask for trust actions.
 *
 * Both exist for one situation: an HTTPS gateway whose certificate is not trusted has no
 * page to click a button on, so the console has to offer the install itself. The captured
 * PEM is what the handshake already showed the user, and the failure-page URL is compared
 * literally because a `data:` document has no origin to gate on - a remote page cannot
 * forge it (Chromium refuses top-level navigation to `data:` URLs) and cannot guess it.
 */
let refusedCertificate: { origin: string; pem: string; error: string } | null = null
let trustFailurePageUrl: string | null = null

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

/**
 * The title bar names the gateway this window is pointed at - with several entries in
 * the book, "ModelPort" alone cannot say which one answers the next click. Re-applied
 * on every load and on `page-title-updated`, because the gateway page's own <title>
 * would otherwise overwrite it.
 */
function applyWindowTitle(): void {
  if (window === null || window.isDestroyed()) return
  window.setTitle(gatewayWindowTitle(activeEntry(readBook())))
}

async function loadActive(): Promise<void> {
  if (!window) return
  applyWindowTitle()
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
  // ensureLocalGateway may have moved the entry to the port the gateway actually uses.
  applyWindowTitle()
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
 * The gateway list: one row per address-book entry, each with the actions that make sense
 * for its mode and state. In the console it is a page (`/gateways`), so the entry in the
 * sidebar and the accelerator navigate instead of opening a second window; this function
 * is the fallback for when no page of ours is loaded - nothing configured yet, or the
 * gateway that should serve the page is down and the window shows a `data:` document.
 */
function openGatewayList(): void {
  if (listWindow && !listWindow.isDestroyed()) {
    listWindow.show()
    listWindow.focus()
    return
  }
  listWindow = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 700,
    minHeight: 420,
    parent: window ?? undefined,
    title: '网关管理',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/shell-list-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  listWindow.on('closed', () => {
    listWindow = null
  })
  void listWindow.loadURL(gatewayListPageUrl())
}

function notifyGatewayList(): void {
  if (listWindow && !listWindow.isDestroyed()) listWindow.webContents.send('shell:gateways-changed')
  if (window !== null && !window.isDestroyed()) window.webContents.send('shell:gateways-changed')
}

/**
 * Whether the main window is showing a page of ours (the console UI), and therefore whether
 * the manager can be reached by navigating instead of by opening another window. In dev the
 * UI comes from the vite server, not from the gateway, so the prefix to compare is that one.
 */
function showsConsolePage(): boolean {
  if (window === null || window.isDestroyed()) return false
  const current = window.webContents.getURL()
  const dev = process.env.ELECTRON_RENDERER_URL?.trim()
  if (dev) return current.startsWith(dev)
  const entry = activeEntry(readBook())
  return entry !== null && current.startsWith(viewUrl(entry.url))
}

/**
 * The menu entry and its accelerator are the "flexible switch": they take the window the
 * user is already looking at to `/gateways` rather than covering it with a second one.
 * Only when that is impossible does the list window appear - it is the one surface that
 * still works for a gateway that cannot serve a page.
 */
function showGatewayManager(): void {
  if (showsConsolePage()) {
    window?.show()
    window?.focus()
    window?.webContents.send('shell:navigate', '/gateways')
    return
  }
  openGatewayList()
}

/**
 * One probe per entry. Local goes through the status file (which is also what tells
 * "not installed" from "stopped"); WSL adds one root `wsl.exe` call for the unit's state,
 * in parallel with the HTTP probe; remote is HTTP only. An unreachable row must not hold
 * the list hostage, so every leg has a short timeout.
 */
async function probeHttpOrigin(url: string): Promise<GatewayProbeState> {
  try {
    const response = await net.fetch(new URL('/', url).toString(), {
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) return { phase: 'offline', version: null }
    const body = (await response.json()) as { version?: unknown }
    return { phase: 'running', version: typeof body.version === 'string' ? body.version : null }
  } catch {
    return { phase: 'offline', version: null }
  }
}

async function probeEntry(entry: GatewayEntry): Promise<GatewayProbeState> {
  if (entry.kind === 'local') {
    const view = await readLocalGatewayView()
    return { phase: view.phase, version: view.version }
  }
  if (entry.kind !== 'wsl' || process.platform !== 'win32') return await probeHttpOrigin(entry.url)
  const [http, service] = await Promise.all([
    probeHttpOrigin(entry.url),
    probeWslService(entry.wslDistro),
  ])
  // A gateway that answers is running no matter what the local unit says - the entry may
  // point at another machine's WSL. Only when HTTP is silent does the unit get a vote.
  if (http.phase === 'running') return http
  if (!service) return { phase: 'offline', version: null }
  if (!service.installed) return { phase: 'not-installed', version: null }
  return { phase: service.active ? 'unreachable' : 'stopped', version: null }
}

async function gatewaySnapshot(): Promise<GatewayListSnapshot> {
  const book = readBook()
  const active = activeEntry(book)
  const entries: GatewayListEntry[] = book.entries.map(entry => ({
    id: entry.id,
    name: entry.name,
    url: entry.url,
    kind: entry.kind,
    active: entry.id === active?.id,
  }))
  const states: Record<string, GatewayProbeState> = {}
  await Promise.all(
    book.entries.map(async entry => {
      states[entry.id] = await probeEntry(entry)
    }),
  )
  return buildSnapshot(entries, states, { canAddWsl: process.platform === 'win32' })
}

function findEntryById(id: unknown): GatewayEntry | null {
  if (typeof id !== 'string' || id === '') return null
  return readBook().entries.find(entry => entry.id === id) ?? null
}

/** The menu entry and its accelerator are the "flexible switch" that is always one key away. */
function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' } as MenuItemConstructorOptions]
      : []),
    {
      label: '视图',
      submenu: [
        { label: '网关管理…', accelerator: 'CommandOrControl+Shift+G', click: () => showGatewayManager() },
        { label: '重新连接', accelerator: 'CommandOrControl+R', click: () => void loadActive() },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
  <li>https 自签证书：这张证书要在<b>这台电脑</b>上被信任，在网关主机上装没有用。如果失败的原因就是证书校验，本页会直接给出「安装到本机信任并重试」；否则用 <code>${escapeHtml(entry.url)}/v1/management/tls/ca</code>（要管理口令）取 PEM 再手动信任</li>
</ul>
</body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * The HTTPS bootstrap page: the gateway answered the handshake and this machine refused its
 * certificate. There is no gateway page to click a button on, and the management endpoint
 * that serves the PEM is unreachable for the same reason the window is - so the certificate
 * comes from the handshake the console just watched fail, and the install runs here.
 *
 * The button calls the argument-free bridge method; the PEM never crosses the page, and the
 * document is shown only for the active gateway's own origin.
 */
function tlsFailurePageUrl(entry: GatewayEntry, error: string, pem: string): string {
  const described = describeCertificate(pem)
  const details = described
    ? `<ul style="color:#a1a1aa;margin:0 0 14px">
  <li>主题：<code>${escapeHtml(described.subject)}</code></li>
  <li>SHA-256 指纹：<code>${escapeHtml(described.fingerprint256)}</code></li>
  <li>有效期至：${escapeHtml(described.validTo)}</li>
  <li>证书包含：<code>${escapeHtml(described.subjectAltName ?? '无 SAN')}</code></li>
</ul>`
    : '<p style="color:#a1a1aa">握手给出的证书无法解析，只能按网关主机上的 PEM 手动信任。</p>'
  const html = `<!doctype html><meta charset="utf-8"><title>ModelPort Shell</title>
<body style="font:14px/1.6 system-ui;padding:40px;background:#1a1a1a;color:#eee">
<h2 style="font-size:16px">这台电脑不信任 ${escapeHtml(entry.name)} 的证书</h2>
<p style="color:#f87171">${escapeHtml(error)}</p>
<p>目标：<code>${escapeHtml(uiUrl(entry))}</code></p>
${details}<p>安装只改<b>这台电脑</b>当前用户的根证书库；网关主机上的信任状态不会因此改变，别的电脑仍要各自安装。装完请重启客户端。</p>
<p><button id="trust" style="font:inherit;padding:6px 12px;cursor:pointer">安装到本机信任并重试</button></p>
<pre id="out" style="white-space:pre-wrap;color:#a1a1aa;font-size:12px;margin:8px 0 0"></pre>
<p style="margin-top:18px"><a href="${escapeHtml(uiUrl(entry))}" style="color:#60a5fa">不安装，只重试</a></p>
<script>
const button = document.getElementById('trust')
const out = document.getElementById('out')
const host = window.modelportShell
if (!host || typeof host.installGatewayCertificateTrust !== 'function') {
  button.disabled = true
  out.textContent = '这个控制台版本不能在本机安装证书：请按上面的指纹核对后手动信任。'
} else {
  button.addEventListener('click', async () => {
    button.disabled = true
    out.textContent = '正在安装…'
    try {
      const result = await host.installGatewayCertificateTrust()
      out.textContent = result.message + (result.fingerprint256 ? '\\n指纹 ' + result.fingerprint256 : '')
      if (result.ok) await host.reconnect()
    } catch (cause) {
      out.textContent = String((cause && cause.message) || cause)
      button.disabled = false
    }
  })
}
</script>
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

  window.webContents.on('certificate-error', (_event, url, error, certificate) => {
    // Never accept the invalid certificate. Capture it so the failure page can offer to
    // trust it on this machine, and let Chromium keep rejecting the connection.
    const entry = activeEntry(readBook())
    const origin = entry ? normalizeOrigin(entry.url) : null
    if (origin === null || normalizeOrigin(url) !== origin) return
    const pem = certificate.data
    if (typeof pem !== 'string' || pem === '') return
    refusedCertificate = { origin, pem, error }
    trustFailurePageUrl = null
    console.warn(`[Shell] certificate refused for ${url}: ${error}`)
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL.startsWith('data:')) return
    const entry = activeEntry(readBook())
    if (!entry) return
    console.warn(`[Shell] load failed ${errorCode} ${errorDescription} for ${validatedURL}`)
    const error = `${errorDescription} (${errorCode})`
    const refused =
      refusedCertificate !== null && normalizeOrigin(validatedURL) === refusedCertificate.origin
        ? refusedCertificate
        : null
    const document = refused ? tlsFailurePageUrl(entry, error, refused.pem) : failurePageUrl(entry, error)
    if (refused) trustFailurePageUrl = document
    void window?.loadURL(document)
  })

  // A real gateway page means this machine already trusts what the listener presents: the
  // captured certificate and the page that was allowed to act on it are both stale from
  // here on, and keeping them would leave a stale data: document able to install.
  window.webContents.on('did-finish-load', () => {
    if ((window?.webContents.getURL() ?? '').startsWith('data:')) return
    refusedCertificate = null
    trustFailurePageUrl = null
    // The page is the only holder of the management secret, so the tray menu can exist
    // only after the page mounts. Ask once per load; the page republishes on changes.
    requestRouteMenu()
    applyWindowTitle()
  })

  // The gateway page's <title> is just "ModelPort": letting it through would erase which
  // gateway this window is connected to. Keep the title bar naming the active entry.
  window.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    applyWindowTitle()
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

  // A link the page opens in a new window is usually a *route*, not a second document: the
  // window routes in place when the target is the gateway's own UI, and only a different
  // origin goes to the real browser. Sending both to `shell.openExternal` is what made an
  // in-app link ("打开渠道") leave the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(window?.webContents.getURL() ?? '', url)
    if (decision.kind === 'navigate') {
      window?.webContents.send('shell:navigate', decision.path)
    } else if (decision.kind === 'load') {
      void window?.loadURL(decision.url)
    } else if (decision.kind === 'external') {
      void shell.openExternal(decision.url)
    }
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
  clientHttpsUrl?: string
}

function promptForGateway(existing?: GatewayEntry): Promise<GatewayPromptResult | null> {
  // A modal child of a hidden window is a dialog nobody can click: the tray opens this
  // while the window sits in the tray. Show the owner first, then attach modally.
  if (window && !window.isDestroyed() && !window.isVisible()) window.show()
  return new Promise(resolve => {
    const dialog = new BrowserWindow({
      width: 480,
      height: 490,
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
      ipcMain.removeHandler('shell:prompt-probe-https')
      if (!dialog.isDestroyed()) dialog.close()
      resolve(result)
    }

    ipcMain.once('shell:prompt-submit', (_event, values: {
      name?: string
      url?: string
      kind?: string
      wslDistro?: string
      clientHttpsUrl?: string
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
      const rawClientHttps = typeof values?.clientHttpsUrl === 'string' ? values.clientHttpsUrl.trim() : ''
      let clientHttpsUrl: string | undefined
      if (rawClientHttps !== '') {
        const httpsOrigin = normalizeOrigin(rawClientHttps)
        if (httpsOrigin === null || !httpsOrigin.startsWith('https:')) {
          dialog.webContents.executeJavaScript(
            `document.getElementById('err').textContent='客户端 HTTPS 地址要写成完整 https origin，例如 https://192.168.0.235:8443'`,
          ).catch(() => undefined)
          return
        }
        clientHttpsUrl = httpsOrigin
      }
      settle({
        name: typeof values?.name === 'string' ? values.name : '',
        url,
        kind,
        wslDistro,
        ...(clientHttpsUrl !== undefined ? { clientHttpsUrl } : {}),
      })
    })
    ipcMain.once('shell:prompt-cancel', () => settle(null))
    // One-shot suggestion only: the probe result still has to be submitted and is stored
    // on the entry, never re-derived from the gateway at switch time.
    ipcMain.handle('shell:prompt-probe-https', async (_event, rawUrl: unknown) => {
      const origin = typeof rawUrl === 'string' ? normalizeOrigin(rawUrl.trim()) : null
      if (origin === null) return { url: null, error: '先填写网关地址（完整 http(s) origin）' }
      // An https entry is its own client endpoint; the gateway's httpsPort would suggest
      // a wrong port for a path that terminates TLS elsewhere (a domain behind a proxy).
      if (origin.startsWith('https:')) return { url: null, error: 'https 条目无需探测：客户端 HTTPS 地址留空即用上方地址' }
      const found = getSecret(secretsPath(), secretSealer, origin)
      if (found.status !== 'found') return { url: null, error: '这台网关还没有保存管理密钥，先在控制台连接一次再探测' }
      const suggestion = await readGatewayHttpsOrigin(origin, found.secret ?? '')
      if (suggestion === null) return { url: null, error: '网关未开启 https 监听或读取失败' }
      return { url: suggestion, error: null }
    })
    // The window's own X button fires no IPC: without this the promise never settles and the
    // two `once` listeners stay behind, so the *next* dialog's submit resolves the old caller.
    dialog.on('closed', () => settle(null))

    void dialog.loadURL(gatewayPromptPageUrl({
      ...(existing ? {
        existing: {
          name: existing.name,
          url: existing.url,
          kind: existing.kind,
          wslDistro: existing.wslDistro,
          ...(existing.clientHttpsUrl !== undefined ? { clientHttpsUrl: existing.clientHttpsUrl } : {}),
        },
      } : {}),
      canUseWsl: process.platform === 'win32',
    }))

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
 * The check-confirm-run upgrade path, shared by the tray (active entry) and the gateway
 * list (any row). The entry's kind is the authorization: only a WSL entry may trigger the
 * root daemon replacement, and a local entry's gateway is this same binary.
 */
async function checkForUpdatesForEntry(entry: GatewayEntry): Promise<void> {
  try {
    const check = await checkForUpdates(entry)
    const managementLine = entry.kind === 'local'
      ? '本地网关与控制台是同一个安装包：升级控制台即升级本地网关'
      : check.daemon.managed
        ? '网关由本机 WSL 管理，可一并升级'
        : '网关未标记为 WSL 托管，只升级控制台'
    const lines = [
      `Shell: ${check.shell.current} → ${check.shell.latest ?? '未知'}`,
      `网关: ${check.daemon.current ?? '读取失败'} → ${check.daemon.latest ?? '未知'}`,
      managementLine,
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
  await checkForUpdatesForEntry(entry)
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
  if (activeEntry(readBook())?.id === entry.id) await loadLocalGateway(entry)
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
  // Only when this is the gateway the window is showing - stopping a background one is a
  // list action, not a reason to replace the page the operator is working in.
  const current = activeEntry(readBook())
  if (current && current.id === entry.id) {
    const after = await readLocalGatewayView()
    window?.loadURL(localFailurePageUrl(current, after))
  }
}

async function reinstallLocalFromTray(entry: GatewayEntry): Promise<void> {
  const view = await readLocalGatewayView()
  if (view.status && isPidAlive(view.status.pid)) await stopLocalGateway(view.status.pid)
  startLocalGateway('init')
  const after = await waitForLocalGateway()
  const current = activeEntry(readBook())
  if (!current || current.id !== entry.id) return
  if (after.phase === 'running') await loadLocalGateway(current)
  else window?.loadURL(localFailurePageUrl(current, after))
}

/** Shared by the tray and the list: one systemctl path, errors named rather than swallowed. */
async function runWslServiceAction(entry: GatewayEntry, action: ServiceControlAction): Promise<void> {
  try {
    await controlWslService(entry.wslDistro, action)
  } catch (error) {
    console.error(`[Shell] WSL gateway ${action} failed:`, error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'WSL 网关',
      message: `${GATEWAY_ACTION_LABELS[action]}失败`,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  notifyGatewayList()
}

/**
 * Uninstall removes the program and the unit, never the data: the rollback script's rule
 * (`~/.modelport` untouched) is also the uninstall rule, so a mistaken click costs a
 * reinstall, not a backup restore. The directory is read from the unit first - a manual
 * deploy may not live in /opt/modelport, and the confirmation must name the real target.
 */
async function uninstallWslForEntry(entry: GatewayEntry): Promise<void> {
  let installDir: string
  try {
    installDir = await wslInstallDir(entry.wslDistro)
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: '卸载 WSL 网关',
      message: '找不到已安装的网关单元',
      detail: error instanceof Error ? error.message : String(error),
    })
    return
  }
  const options = {
    type: 'question' as const,
    title: '卸载 WSL 网关',
    message: `卸载「${entry.name}」的网关程序？`,
    detail: `将停止并移除服务与 ${installDir}（含随装的 Node）。保留 ~/.modelport 数据目录；地址簿条目与管理口令不动。`,
    buttons: ['卸载', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const choice = listWindow
    ? await dialog.showMessageBox(listWindow, options)
    : await dialog.showMessageBox(options)
  if (choice.response !== 0) return
  try {
    await removeWslInstall(entry.wslDistro, installDir)
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: '卸载 WSL 网关',
      message: '卸载失败',
      detail: error instanceof Error ? error.message : String(error),
    })
    return
  }
  notifyGatewayList()
}

/**
 * Remote deployment is a guide, not a remote control: the console has no credentials for
 * that host. Links open in the real browser so downloads land in the operator's own
 * download flow instead of navigating this document away.
 */
function openDeployGuide(entry: GatewayEntry, release: ReleaseInfo | null, error?: string): void {
  const html = deployGuideHtml({
    name: entry.name,
    url: entry.url,
    release,
    ...(error === undefined ? {} : { error }),
  })
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  if (guideWindow && !guideWindow.isDestroyed()) {
    void guideWindow.loadURL(url)
    guideWindow.show()
    guideWindow.focus()
    return
  }
  guideWindow = new BrowserWindow({
    width: 760,
    height: 680,
    parent: window ?? undefined,
    title: '部署指南',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  guideWindow.on('closed', () => {
    guideWindow = null
  })
  guideWindow.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith('data:')) return
    event.preventDefault()
    if (normalizeOrigin(target)) void shell.openExternal(target)
  })
  guideWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (normalizeOrigin(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  void guideWindow.loadURL(url)
}

/**
 * The tray's model menu is built from a snapshot the **page** publishes.
 *
 * The console process never holds the management secret - it is sealed by the page's
 * transport (`headless.ts`) - so the tray cannot call `routes:menu` itself. It asks the
 * page to refresh and renders whatever came back; a missing snapshot is shown as
 * "reading…" rather than as "no routes", because those two are different failures.
 */
let routeMenuCache: RouteMenuResult | null = null

/** 托盘右键时刷新一次；超过这个年龄的快照还会被标成「稍旧」。 */
const ROUTE_MENU_STALE_MS = 20_000

function routeMenuSnapshot(): RouteMenuResult | null {
  return routeMenuCache
}

function sanitizeRouteMenu(raw: unknown): RouteMenuResult | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as { routes?: unknown; generatedAt?: unknown; error?: unknown }
  if (!Array.isArray(record.routes)) return null
  return {
    routes: record.routes.filter((entry): entry is RouteMenuEntry => {
      if (entry === null || typeof entry !== 'object') return false
      const candidate = entry as { route?: unknown; models?: unknown }
      return typeof candidate.route === 'string' && Array.isArray(candidate.models)
    }),
    generatedAt: typeof record.generatedAt === 'number' ? record.generatedAt : Date.now(),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  }
}

function requestRouteMenu(): void {
  const target = window
  if (target === null || target.isDestroyed()) return
  target.webContents.send('shell:route-menu-request')
}

function trayRouteCommand(command: ShellRouteCommand): void {
  const target = window
  if (target === null || target.isDestroyed()) return
  console.log(`[Shell] tray route command: ${command.action} ${command.route}${command.model === undefined ? '' : ` -> ${command.model}`}`)
  target.webContents.send('shell:route-command', command)
}

function routeMenuModelLabel(model: RouteMenuEntry['models'][number]): string {
  const parts = [model.displayName]
  if (model.current) parts.push('上轮服务')
  if (model.pinned) parts.push('已固定')
  parts.push(model.accountCount > 0 ? `${model.accountCount} 账号` : '无可用账号')
  if (model.ewmaFirstTokenMs !== undefined) parts.push(`首字 ${Math.round(model.ewmaFirstTokenMs)}ms`)
  if (model.costBucket === 'free') parts.push('免费')
  if (model.circuitUntil !== undefined) {
    parts.push(`熔断中 ${Math.max(1, Math.round((model.circuitUntil - Date.now()) / 60_000))}m`)
  }
  return parts.join(' · ')
}

/** 打开控制台的路由页并选中这条路由：托盘列不下的模型在那里能搜到也能切。 */
function openRouteManager(route: string): void {
  const target = window
  if (target === null || target.isDestroyed()) return
  target.show()
  target.focus()
  target.webContents.send('shell:navigate', `/routes?${new URLSearchParams({ route }).toString()}`)
}

function routeMenuSubmenu(entry: RouteMenuEntry): MenuItemConstructorOptions[] {
  // 「上一轮」而不是「当前」：这一格记的是已经跑完的那一轮，而下一次请求由下面的
  // 钉子决定。混用「当前」会让用户以为钉子没生效。
  const current = entry.current === undefined
    ? '还没有服务过的模型'
    : `上一轮：${entry.current.displayName}${
        entry.current.firstTokenMs === undefined ? '' : ` · 首字 ${Math.round(entry.current.firstTokenMs)}ms`
      }`
  const pin = entry.pin === undefined
    ? []
    : [{
        // 钉子指向的模型不在池里时必须说出来：菜单显示「已固定」而实际每轮都在
        // 用别的模型，是这类功能最坏的一种沉默。
        label: entry.pin.stale
          ? `已固定：${entry.pin.displayName}（已不在池内·不生效）`
          : entry.pin.until === 0
            ? `已固定：${entry.pin.displayName}（持久）`
            : `已固定：${entry.pin.displayName}（${Math.max(1, Math.round((entry.pin.until - Date.now()) / 60_000))} 分钟后到期）`,
        enabled: false,
      } satisfies MenuItemConstructorOptions,
      // 固定是路由级的：这一条路由背后的每个客户端都会跟着换模型。不写这句，
      // 用户会以为只影响自己手上的那个客户端。
      {
        label: '影响这条路由的全部客户端 · 托盘固定默认 10 分钟',
        enabled: false,
      } satisfies MenuItemConstructorOptions]
  const models: MenuItemConstructorOptions[] = entry.models.map(model => ({
    label: routeMenuModelLabel(model),
    type: 'checkbox',
    checked: model.pinned,
    enabled: model.accountCount > 0,
    click: () => trayRouteCommand({
      action: 'switch',
      route: entry.route,
      model: model.displayName,
      providerId: model.providerId,
    }),
  }))
  return [
    { label: current, enabled: false },
    ...pin,
    { type: 'separator' },
    trayAction('换下一个', () => trayRouteCommand({ action: 'switch', route: entry.route })),
    trayAction('恢复到自动排序', () => trayRouteCommand({ action: 'reset', route: entry.route })),
    { type: 'separator' },
    ...(models.length > 0
      ? models
      : [{ label: '这条路由当前没有可切换的模型', enabled: false } as MenuItemConstructorOptions]),
    ...(entry.totalModels > entry.models.length
      ? [{
          // 托盘列不完的模型只能在控制台**选**：以前这行是纯文本，而它指向的页面
          // （模型管理）既不按路由看也不能切换 —— 等于告诉用户“去那儿”，那儿却没有。
          // 现在它直接打开路由页并选中这条路由，搜索框就在模型列表上方。
          label: `…另有 ${entry.totalModels - entry.models.length} 个模型（在控制台搜索并切换）`,
          click: () => openRouteManager(entry.route),
        } as MenuItemConstructorOptions]
      : []),
    { type: 'separator' },
    trayAction('在控制台管理路由…', () => openRouteManager(entry.route)),
  ]
}

function modelMenuItems(): MenuItemConstructorOptions[] {
  const snapshot = routeMenuSnapshot()
  if (snapshot === null) {
    return [{ label: '读取模型列表…（打开控制台后可用）', enabled: false }]
  }
  if (snapshot.error !== undefined) {
    return [{ label: `读取失败：${snapshot.error}`, enabled: false }]
  }
  const routes = snapshot.routes.filter(entry => entry.enabled)
  if (routes.length === 0) {
    return [{ label: '没有启用的路由', enabled: false }]
  }
  const stale = Date.now() - snapshot.generatedAt > ROUTE_MENU_STALE_MS
  return [
    ...(stale ? [{ label: '数据稍旧，正在刷新…', enabled: false } as MenuItemConstructorOptions] : []),
    ...routes.slice(0, 12).map(entry => ({
      label: entry.pin !== undefined
        ? `${entry.pin.displayName}（${entry.route} · ${entry.pin.stale ? '固定已失效' : '已固定'}）`
        : entry.current !== undefined
          ? `${entry.current.displayName}（${entry.route}）`
          : `${entry.route}（未服务过）`,
      submenu: routeMenuSubmenu(entry),
    } satisfies MenuItemConstructorOptions)),
  ]
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

  // The local gateway is the one this console owns as a child process; a WSL gateway is
  // owned through systemd, so both get start/stop here, while install and the root
  // uninstall stay WSL-only. Upgrades ride along with the console's update check.
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
        trayAction('启动 WSL 网关', () => { window?.show(); void runWslServiceAction(active, 'start') }),
        trayAction('停止 WSL 网关', () => { window?.show(); void runWslServiceAction(active, 'stop') }),
        trayAction('重启 WSL 网关', () => { window?.show(); void runWslServiceAction(active, 'restart') }),
        trayAction('安装 WSL 网关…（网关不存在时）', () => { window?.show(); void offerWslInstall(active) }),
      ]
    : []

  // 顶层只留一格网关入口：选网关、启停安装卸载、增删改、重连全部收进子菜单，
  // 腾出的顶层位置留给模型切换这类常用动作。子菜单内按用途分块，顺序是
  // 「当前 → 选择 → 生命周期 → 增删改 → 连接」，与原来的平铺顺序一致。
  const gatewayMenu: MenuItemConstructorOptions[] = [
    {
      label: active
        ? `当前：${active.name}（${kindLabel(active.kind)}）`
        : '当前：未选择网关',
      enabled: false,
    },
    { type: 'separator' },
    ...(gatewayItems.length > 0
      ? gatewayItems
      : [{ label: '还没有配置的网关', enabled: false } as MenuItemConstructorOptions]),
    ...(localItems.length > 0
      ? [{ type: 'separator' } as MenuItemConstructorOptions, ...localItems]
      : []),
    ...(wslItems.length > 0
      ? [{ type: 'separator' } as MenuItemConstructorOptions, ...wslItems]
      : []),
    { type: 'separator' },
    trayAction('网关管理…', () => showGatewayManager()),
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
    trayAction('重新连接', () => void loadActive()),
    trayAction('在浏览器中打开', () => {
      if (active) void shell.openExternal(uiUrl(active))
    }),
  ]

  const items: MenuItemConstructorOptions[] = [
    { label: '模型', submenu: modelMenuItems() },
    { label: '网关', submenu: gatewayMenu },
    trayAction('检查更新（控制台 + 可管理的网关）…', () => void checkForUpdatesFromTray()),
    { type: 'separator' },
    trayAction('退出', () => {
      app.isQuitting = true
      app.quit()
    }),
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
  // 提示行回答「现在跑的是谁」—— 托盘图标本身没有文字，用户不该为了看一眼模型名
  // 去点开菜单。没有任何快照时保留默认文案。
  const primary = routeMenuCache?.routes.find(entry => entry.enabled)
  const running = primary?.pin?.displayName ?? primary?.current?.displayName
  tray.setToolTip(primary === undefined || running === undefined
    ? 'ModelPort 控制台'
    : `ModelPort · ${primary.route} · ${running}`)
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('ModelPort 控制台')
  buildTrayMenu()
  // 菜单是 `setContextMenu` 挂上去的，打开不会经过我们；先在按下时请页面刷新一次，
  // 下一次打开就是新快照（首屏已经拿到的那份照常立刻可用）。
  tray.on('right-click', () => requestRouteMenu())
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
  installAppMenu()
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

/**
 * The secret surface is gated like the update surface, plus one rule of its own: a page
 * may only touch its own origin's row. The preload survives cross-origin navigation, so
 * without this any page the window lands on could read or forget every other gateway's
 * secret - the multi-gateway case the per-origin store exists for.
 */
function secretGateAllows(event: IpcMainInvokeEvent, origin: string): boolean {
  const entry = activeEntry(readBook())
  return secretOriginAllowed({
    senderUrl: event.senderFrame?.url ?? '',
    requested: origin,
    activeOrigin: entry ? normalizeOrigin(entry.url) : null,
    devRendererUrl: process.env.ELECTRON_RENDERER_URL?.trim() || null,
  })
}

ipcMain.handle('shell:secret-get', (event, origin: unknown) => {
  if (typeof origin !== 'string' || origin === '') return { status: 'none' }
  // A rejected gate reads as "nothing stored": it must not leak which origins have rows.
  if (!secretGateAllows(event, origin)) return { status: 'none' }
  return getSecret(secretsPath(), secretSealer, origin)
})

// 托盘模型菜单：只接受主窗口自己发的快照（`send` 是单向的，来源判定与 `handle`
// 同一口径）。形状不合就丢弃 —— 这份数据只用于画菜单，坏数据不该让托盘崩掉。
ipcMain.on('shell:route-menu', (event, payload: unknown) => {
  if (window === null || event.sender !== window.webContents) return
  const snapshot = sanitizeRouteMenu(payload)
  if (snapshot === null) return
  routeMenuCache = snapshot
  buildTrayMenu()
})

ipcMain.handle('shell:secret-set', (event, origin: unknown, secret: unknown) => {
  if (typeof origin !== 'string' || typeof secret !== 'string') return { stored: false, result: 'rejected' }
  if (!secretGateAllows(event, origin)) return { stored: false, result: 'rejected' }
  const result = putSecret(secretsPath(), secretSealer, origin, secret)
  return { stored: result === 'stored', result }
})

ipcMain.handle('shell:secret-forget', (event, origin: unknown) => {
  if (typeof origin !== 'string') return
  if (!secretGateAllows(event, origin)) return
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
 * The gateway list's surface. Every id is resolved against the address book (a row the
 * page invented is not an entry), and every action goes through the same functions the
 * tray uses - there is no second way to start, stop or install a gateway.
 */
/**
 * Two documents ask for these: the `data:` list window this process authored, and the
 * console's own `/gateways` page inside the main window. The second one is served by the
 * gateway and is therefore remote, so it must prove it is the active gateway's page - the
 * same rule the update actions follow. The list window is trusted by identity instead:
 * its origin is `null` by construction, and it exists for the case where no page of ours
 * can be shown at all (gateway down, nothing configured).
 */
function assertGatewayAdminSender(event: IpcMainInvokeEvent): void {
  if (window !== null && event.sender === window.webContents) activeGatewayForSender(event)
}

ipcMain.handle('shell:gateways', async (event) => {
  assertGatewayAdminSender(event)
  return await gatewaySnapshot()
})

ipcMain.handle('shell:gateway-connect', async (event, id: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry) return
  window?.show()
  selectGateway(entry)
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-add', async (event) => {
  assertGatewayAdminSender(event)
  await addGateway()
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-edit', async (event, id: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry) return
  await editGateway(entry)
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-remove', async (event, id: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry) return
  const options = {
    type: 'question' as const,
    title: '删除网关',
    message: `从地址簿删除「${entry.name}」？`,
    detail: '只删除这一条地址：不会删除网关本身，也不会删除已保存的管理口令。',
    buttons: ['删除', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  // Whichever window asked owns the confirm: the list window when it is open, the main
  // window when the request came from the console page, so the dialog is never parentless
  // over the window the user is looking at.
  const parent = listWindow && !listWindow.isDestroyed() ? listWindow : window
  const choice = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (choice.response !== 0) return
  writeBook(removeEntry(readBook(), entry.id))
  buildTrayMenu()
  void loadActive()
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-local', async (event, id: unknown, action: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry || entry.kind !== 'local') return
  if (action === 'start') await startLocalFromTray(entry)
  else if (action === 'stop') await stopLocalFromTray(entry)
  else if (action === 'repair') await reinstallLocalFromTray(entry)
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-install-wsl', async (event, id: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry || entry.kind !== 'wsl' || process.platform !== 'win32') return
  await offerWslInstall(entry)
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-wsl', async (event, id: unknown, action: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry || entry.kind !== 'wsl' || process.platform !== 'win32') return
  if (action === 'start' || action === 'stop' || action === 'restart') {
    await runWslServiceAction(entry, action)
  } else if (action === 'uninstall') {
    await uninstallWslForEntry(entry)
  }
})

ipcMain.handle('shell:gateway-upgrade', async (event, id: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  // Remote rows have no upgrade: replacing the console is not managing that gateway.
  if (!entry || (entry.kind !== 'local' && entry.kind !== 'wsl')) return
  await checkForUpdatesForEntry(entry)
  notifyGatewayList()
})

ipcMain.handle('shell:gateway-deploy', async (event, id: unknown) => {
  assertGatewayAdminSender(event)
  const entry = findEntryById(id)
  if (!entry || entry.kind !== 'remote') return
  let release: ReleaseInfo | null = null
  let error: string | undefined
  try {
    release = await fetchLatestRelease()
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  openDeployGuide(entry, release, error)
})

ipcMain.handle('shell:gateway-list-close', async () => {
  listWindow?.close()
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

/**
 * Certificate trust, for the machine this console is running on.
 *
 * The gateway's own `tls:install-trust` is not usable from here: it acts where the listener
 * lives - a Linux daemon under WSL, somebody else's host when remote - while the client
 * refusing the handshake sits on this side of the wire. So the panel asks the shell, and
 * the shell writes its own OS store.
 *
 * Gated like the update actions, with one addition: the HTTPS bootstrap page is a `data:`
 * document and therefore has no origin to compare. It is accepted by exact URL match
 * against the document this process just loaded, which a remote page can neither navigate
 * to (Chromium refuses top-level `data:` navigation) nor guess.
 */
function activeGatewayForTrust(event: IpcMainInvokeEvent): GatewayEntry {
  const entry = activeEntry(readBook())
  if (!entry) throw new Error('还没有配置网关')
  const frameUrl = event.senderFrame?.url ?? ''
  let origin: string | null = null
  try {
    origin = frameUrl === '' ? null : new URL(frameUrl).origin
  } catch {
    origin = null
  }
  if (origin !== null && origin === normalizeOrigin(entry.url)) return entry
  if (trustFailurePageUrl !== null && frameUrl === trustFailurePageUrl) return entry
  if (frameUrl.startsWith('data:') && (window?.webContents.getURL() ?? '') === frameUrl) return entry
  throw new Error('证书信任操作只允许当前网关页面发起')
}

/** The PEM the console installs, kept under its own profile - never in the gateway's data dir. */
const gatewayTlsCachePath = (): string => join(app.getPath('userData'), 'tls', 'gateway-ca.pem')

async function trustTargetFor(event: IpcMainInvokeEvent): Promise<TrustTarget> {
  const entry = activeGatewayForTrust(event)
  const origin = normalizeOrigin(entry.url)
  if (origin === null) throw new Error('网关地址无效')
  // The client-facing endpoint is entry data: an https entry is its own url, an http entry
  // carries the stored client https endpoint. When absent, auto-detect it from the gateway
  // address (the same host on the advertised httpsPort) for the trust probe only. The
  // suggestion is access-path-blind, so it is never persisted nor fed to the client switch,
  // which keeps reading the stored entry value (a domain behind a proxy terminates TLS
  // elsewhere, and the gateway's own httpsPort would be wrong for that path).
  const clientOrigin = await resolveClientOrigin(origin, entry.clientHttpsUrl ?? null, async () => {
    const found = getSecret(secretsPath(), secretSealer, origin)
    if (found.status !== 'found') return null
    return await readGatewayHttpsOrigin(origin, found.secret ?? '')
  })
  return {
    origin,
    clientOrigin,
    cachePath: gatewayTlsCachePath(),
    captured: refusedCertificate !== null && clientOrigin !== null && refusedCertificate.origin === clientOrigin
      ? refusedCertificate.pem
      : null,
  }
}

ipcMain.handle('shell:tls-status', async (event: IpcMainInvokeEvent) => {
  return await gatewayTrustStatus(await trustTargetFor(event))
})

ipcMain.handle('shell:tls-install-trust', async (event: IpcMainInvokeEvent) => {
  return await changeGatewayTrust(await trustTargetFor(event), 'install')
})

ipcMain.handle('shell:tls-uninstall-trust', async (event: IpcMainInvokeEvent) => {
  return await changeGatewayTrust(await trustTargetFor(event), 'uninstall')
})

/**
 * Client repointing, gated exactly like the update actions: these writes land in the
 * user's own config stores and one of them is a User environment variable, so a page that
 * is not the active gateway must not be able to ask for them.
 *
 * The input is assembled here, never taken from the page. `apply` re-runs the same gather
 * as `preview`, so confirming a stale preview cannot write something the user did not see.
 */
async function clientSyncInputFor(event: IpcMainInvokeEvent): Promise<GatherInput> {
  const active = activeGatewayForSender(event)
  const gateways: GatewayCredential[] = readBook().entries.map(entry => {
    const origin = normalizeOrigin(entry.url)
    const found = origin === null ? null : getSecret(secretsPath(), secretSealer, origin)
    return { entry, secret: found !== null && found.status === 'found' ? (found.secret ?? null) : null }
  })
  const paths = clientPaths(app.getPath('home'), app.getPath('appData'), process.env.CLAUDE_CONFIG_DIR, {
    localAppData: process.env.LOCALAPPDATA,
    platform: process.platform,
    env: process.env,
  })
  const running = await runningImageNames()
  return {
    active,
    gateways,
    paths,
    running: running.names,
    runningKnown: running.known,
    claudeInstalled: claudeClientInstalled(paths, process.env.LOCALAPPDATA),
    dataDir: app.getPath('userData'),
  }
}

ipcMain.handle('shell:clients-preview', async (event: IpcMainInvokeEvent) => {
  return await buildPreview(await clientSyncInputFor(event))
})

ipcMain.handle('shell:clients-apply', async (event: IpcMainInvokeEvent, clientIds: unknown) => {
  const ids = Array.isArray(clientIds) ? clientIds.filter((id): id is string => typeof id === 'string') : []
  return await applySync(await clientSyncInputFor(event), ids)
})
