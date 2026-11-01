import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { storeManager } from '../store/store'

let mainWindow: BrowserWindow | null = null

/**
 * 应用自身文档的位置：开发态是 dev server 的 origin，生产态是打包目录的 `file://` 前缀。
 *
 * 之前导航判据是「URL 以 `file://` 开头就放行」，那等于允许页面把窗口导航到用户磁盘上任意
 * 一个 HTML —— 那个页面同样会挂载本应用的 preload，于是它拿到完整的 `window.electronAPI`。
 * 加载时记一次位置，之后只认同一起点的文档。
 */
let appLocationPrefix: string | null = null

function rememberAppLocation(target: string): void {
  try {
    const url = new URL(target)
    appLocationPrefix = url.protocol === 'file:' ? target.slice(0, target.lastIndexOf('/') + 1) : url.origin
  } catch {
    appLocationPrefix = null
  }
}

/**
 * 建窗时先按「这份构建会从哪儿加载」预置允许位置。
 *
 * 不能只靠 `loadUrl` / `loadFile` 里那一次登记：那两个的 Promise 要到 `did-finish-load`
 * 才落地，而渲染层的脚本在页面加载过程中就发得出第一个 IPC。等那一趟回来才登记的话，
 * 最早一批调用会被来源校验全部拒掉，界面表现为「数据全空」而不是「被拒绝」。
 */
function seedAppLocation(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    rememberAppLocation(devUrl)
    return
  }
  if (process.env.NODE_ENV === 'development') {
    rememberAppLocation('http://localhost:5173')
    return
  }
  rememberAppLocation(pathToFileURL(join(__dirname, '../renderer/index.html')).href)
}

function isAppLocation(target: string): boolean {
  if (!appLocationPrefix) return false
  try {
    const url = new URL(target)
    return url.protocol === 'file:' ? target.startsWith(appLocationPrefix) : url.origin === appLocationPrefix
  } catch {
    return false
  }
}

/**
 * IPC 侧的同一把尺：`event.senderFrame.url` 必须是本应用自己的文档，
 * 否则这个调用不是从我们的界面来的（iframe、被导航到的外部页、被注入的脚本）。
 */
export function isAppDocumentUrl(target: string): boolean {
  return isAppLocation(target)
}

/**
 * `shell.openExternal` 把 URL 交给系统默认处理器，`file://` / `smb://` / `ms-msdt:` 之类
 * 协议会直接落到本地程序或网络认证上，所以这里只认 http(s)。
 */
const OPEN_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

function openExternalIfAllowed(url: string): void {
  let protocol = ''
  try {
    protocol = new URL(url).protocol
  } catch {
    console.warn('[Window] Refused to open a malformed URL')
    return
  }
  if (!OPEN_EXTERNAL_PROTOCOLS.has(protocol)) {
    console.warn(`[Window] Refused to open a ${protocol} URL from the window`)
    return
  }
  shell.openExternal(url).catch((error) => console.error('[Window] openExternal failed:', error))
}

// Windows and Linux get a frameless window with the in-app header acting as the
// title bar; the system caption buttons stay as an overlay in the top-right.
// macOS keeps the native traffic lights, so its frame is left untouched.
const usesOverlayTitleBar = process.platform === 'win32' || process.platform === 'linux'

const TOPBAR_HEIGHT = 48

function titleBarOverlayColors(theme: 'dark' | 'light'): { color: string; symbolColor: string } {
  return theme === 'dark'
    ? { color: '#0b0c0e', symbolColor: '#f1f2f4' }
    : { color: '#f7f7f8', symbolColor: '#18181b' }
}

export function setTitleBarTheme(theme: 'dark' | 'light'): void {
  if (!usesOverlayTitleBar) return
  mainWindow?.setTitleBarOverlay({ ...titleBarOverlayColors(theme), height: TOPBAR_HEIGHT })
}

export interface WindowOptions {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  title?: string
  show?: boolean
  /**
   * Whether `ready-to-show` should reveal the window.
   *
   * Boot autostart passes `false`: this app is a resident proxy service, so
   * surfacing a window while the user is logging in steals focus. Defaults to
   * `true` - every ordinary launch must still appear.
   */
  showOnReady?: boolean
}

export function createWindow(options: WindowOptions = {}): BrowserWindow {
  const {
    width = 1200,
    height = 800,
    minWidth = 800,
    minHeight = 600,
    title = 'ModelPort',
    show = false,
    showOnReady = true,
  } = options

  seedAppLocation()

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 沙箱开启。preload 只 import `electron` 与纯常量/类型（不含 `fs`/`path`/`child_process`
      // 之类的 Node 能力），所以关掉沙箱换不来任何功能，只留下「渲染进程一旦被注入就能
      // 直接 require 整个 Node」这条提升路径。要新增主进程能力，走具名 IPC 通道，
      // 不要往 preload 里塞 Node 模块。
      sandbox: true,
      webSecurity: true,
    },
    title,
    show,
    autoHideMenuBar: true,
    frame: true,
    ...(usesOverlayTitleBar
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            ...titleBarOverlayColors(nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
            height: TOPBAR_HEIGHT,
          },
        }
      : {}),
    backgroundColor: '#1a1a1a',
    icon: join(__dirname, '../../resources/icon.png'),
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppLocation(url)) return
    event.preventDefault()
    openExternalIfAllowed(url)
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    // `<webview>` 会以同一份 session 渲染任意内容，本应用没有用它，这里一律拒绝，
    // 免得日后某个依赖或某次改动悄悄引入一个带 preload 的嵌入式文档。
    event.preventDefault()
  })

  mainWindow.once('ready-to-show', () => {
    // 开机自启进来时保持隐藏：窗口存在、可从托盘打开，但不抢焦点。
    if (!showOnReady) return
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      try {
        const config = storeManager.getConfig()
        if (config.minimizeToTray) {
          event.preventDefault()
          mainWindow?.hide()
        }
      } catch (error) {
        console.error('[Window] Failed to get config during close:', error)
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function showWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  }
}

export function hideWindow(): void {
  mainWindow?.hide()
}

export function minimizeWindow(): void {
  mainWindow?.minimize()
}

export function maximizeWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
}

export function closeWindow(): void {
  mainWindow?.close()
}

export function isWindowVisible(): boolean {
  return mainWindow?.isVisible() ?? false
}

export function isWindowMaximized(): boolean {
  return mainWindow?.isMaximized() ?? false
}

export function isWindowMinimized(): boolean {
  return mainWindow?.isMinimized() ?? false
}

export function loadUrl(url: string): Promise<void> {
  rememberAppLocation(url)
  return mainWindow?.loadURL(url) ?? Promise.resolve()
}

export function loadFile(filePath: string): Promise<void> {
  rememberAppLocation(pathToFileURL(filePath).href)
  return mainWindow?.loadFile(filePath) ?? Promise.resolve()
}

export function reloadWindow(): void {
  mainWindow?.reload()
}

export function openDevTools(): void {
  mainWindow?.webContents.openDevTools()
}

export function closeDevTools(): void {
  mainWindow?.webContents.closeDevTools()
}

export function toggleDevTools(): void {
  mainWindow?.webContents.toggleDevTools()
}
