import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, renameSync } from 'fs'
import { createWindow, getMainWindow, loadUrl, loadFile, openDevTools } from './window/manager'
import { createTrayManager, TrayManager } from './tray/TrayManager'
import { registerIpcHandlers } from './ipc/handlers'
import { UpdaterManager } from './updater'
import { storeManager } from './store/store'
import { aggregateProviderManager } from './providers/aggregate'
import { primeModelProbeCache } from './providers/modelProbeStore'
import { shutdownCatalogBatchJobs } from './providers/modelCatalogBatchRunner'
import { detectHiddenLaunch, reconcileAutoStart } from './autostartHost'
import { recordProcessCrash, setCrashLogWriter } from './logging/crashReporter'
import { configureModelListRefresh } from './scheduler/modelListRefresh'
import { scheduler } from './scheduler/Scheduler'

// Keep the Electron profile directory stable across product renames.
// safeStorage seals store.key and every stored credential against this profile
// (Windows keeps the wrapped key in `Local State`, macOS in the login keychain
// entry tied to it), so deriving it from package.json's `name` would make an
// existing install unreadable the moment the package is renamed.
app.setPath('userData', join(app.getPath('appData'), 'modelport'))

// 数据目录迁移（Chat2API → ModelPort）：两处持久化位置都整体搬进新名字，
// 跑在任何 store/opencode/压缩缓存初始化之前，保证后续读到的都是新路径。
//
// - `<appData>/chat2api` → `<appData>/modelport`：Electron profile。safeStorage
//   封装密钥存在 profile 目录内部（Windows 的 Local State），整体 rename 不破坏
//   解密；macOS/Linux 的钥匙串条目绑定 app 名而非路径，同样安全。
// - `~/.chat2api` → `~/.modelport`：data.json / store.key / 凭据表 / ccr /
//   opencode / quota ledger 的根目录，跟着一起搬。
//
// rename 在同卷上是原子的；目标已存在（新版已初始化过）或源不存在则跳过。
// 失败（旧实例仍占用、权限不足）只告警不挡启动 —— 应用从空的新目录冷启动，
// 旧目录原样保留，数据不丢。该迁移是幂等的：成功后源目录不复存在。
function migrateLegacyDirectory(from: string, to: string, label: string): void {
  if (!existsSync(from) || existsSync(to)) return
  try {
    renameSync(from, to)
    console.log(`[Migration] moved ${label}: ${from} -> ${to}`)
  } catch (error) {
    console.warn(`[Migration] could not move ${label} (${from} -> ${to}); starting fresh:`, error)
  }
}

migrateLegacyDirectory(
  join(app.getPath('appData'), 'chat2api'),
  join(app.getPath('appData'), 'modelport'),
  'Electron profile',
)
migrateLegacyDirectory(join(homedir(), '.chat2api'), join(homedir(), '.modelport'), 'data directory')

// Keep the process alive, but never lose the evidence: a packaged GUI has no
// terminal attached, so console.error alone leaves an invisible crash.
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  recordProcessCrash('uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
  recordProcessCrash('unhandledRejection', reason)
})

// Workaround for V8 JIT compiler crash on macOS ARM64 (Electron 33 bug)
// Completely disable JIT compilation to prevent EXC_BAD_ACCESS crashes
// This trades some performance for stability
if (process.platform === 'darwin' && process.arch === 'arm64') {
  app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Running as root is reported, not fixed: this build does not append --no-sandbox
// on anyone's behalf, because doing so would trade the renderer sandbox for the
// convenience of a root container. Launch with `--no-sandbox` explicitly when that
// trade is actually intended.
if (process.getuid && process.getuid() === 0) {
  console.warn('Running as root: the sandbox stays enabled, pass --no-sandbox explicitly if you mean to drop it')
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }
  })

  initializeApp()
}

let trayManager: TrayManager | null = null

async function initializeApp(): Promise<void> {
  app.on('ready', async () => {
    await setupApp()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) {
      createWindow()
    } else {
      mainWindow.show()
    }
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    // 干净取消「全部补齐」：adoption 是整份台账原子写入，不会留下半写状态。
    shutdownCatalogBatchJobs()
    // 停止统一调度器：清掉所有 setInterval，避免退出后定时器仍持有回调。
    scheduler.stop()
    trayManager?.destroy()
  })

  app.on('will-quit', () => {
    cleanup()
  })
}

async function setupApp(): Promise<void> {
  // 只依赖 argv / 登录项状态，不读配置 —— 窗口是否显示必须在建窗时就定下来，
  // 而配置要等 store 初始化后才有。
  const launchHidden = detectHiddenLaunch()

  const mainWindow = createWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ModelPort',
    show: false,
    // 开机自启时不抢焦点；用户可从托盘打开。
    showOnReady: !launchHidden,
  })

  await registerIpcHandlers(mainWindow)

  // 探测读数的内存快照必须在任何选号发生之前灌好：sidecar 是异步 JSON，而
  // `autoRouter::select` 同步执行，热路径里读不了盘。存储不可用时保持空表 ——
  // 探测层缺席只是回到「没实测」，不是错误。
  if (!storeManager.hasInitializationError()) {
    await primeModelProbeCache()
  }

  // 存储就绪后把启动早期缓冲的崩溃写进应用日志；存储不可用时保留 crash-fallback.ndjson。
  if (!storeManager.hasInitializationError()) {
    setCrashLogWriter((entry) => storeManager.appendLogEntry(entry))
  }

  // 凭据加密降级必须让人看见：打包后的 GUI 里没人看 stdout，只写一条应用日志等于静默
  // 明文落盘。这里只提示、不阻断 —— 阻断会让这些机器直接无法使用。
  if (!storeManager.hasInitializationError() && storeManager.isCredentialEncryptionDegraded()) {
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '凭据未加密',
      message: '系统密钥库不可用，上游凭据将以明文保存在本机。',
      detail: [
        '常见场景：Linux 缺少 libsecret/keyring、精简版系统、容器内运行。',
        '处理办法：安装系统密钥库后重启应用即可恢复加密；在此之前请限制 ~/.modelport 的访问权限。',
      ].join('\n'),
      buttons: ['知道了'],
      noLink: true,
    })
  }

  // 免验证（keyless）聚合条目自动开通：建记录、启用并拉取上游模型清单。
  // 异步执行不阻塞启动，失败只告警；存储初始化失败时直接跳过。
  if (!storeManager.hasInitializationError()) {
    void aggregateProviderManager.autoProvisionKeyless()
  }

  // 模型清单定时刷新：store 就绪后按当前配置装配调度任务并启动统一调度器。
  // 存储不可用时跳过（调度器依赖 store 枚举 provider，没意义也无从落状态）。
  if (!storeManager.hasInitializationError()) {
    configureModelListRefresh(storeManager.getConfig().modelListRefresh)
    scheduler.start()
  }

  trayManager = createTrayManager(mainWindow)

  await loadAppContent(mainWindow)

  // store 已在 `registerIpcHandlers` 里初始化；此时才读得到 `autoStart`。
  // 校正失败不挡启动（`reconcileAutoStart` 内部只告警）。
  void reconcileAutoStart(readAutoStartConfig())

  if (launchHidden) {
    console.log('[AutoStart] 以开机自启方式启动，窗口保持隐藏（可在托盘打开）')
  }

  // 渲染层在挂载前无法收到 STORE_INIT_ERROR（那时 webContents 还没加载），
  // 所以存储不可用时必须用原生对话框把原因和处置办法直接摆到用户面前。
  if (storeManager.hasInitializationError()) {
    await showStorageFailureDialog(mainWindow)
  }

  if (process.env.NODE_ENV === 'development') {
    openDevTools()
  }
}

/**
 * 读配置里的 `autoStart`，存储尚未就绪时按 `false` 处理。
 *
 * ⚠️ 不能直接 `storeManager.getConfig()`：它在未初始化/初始化失败时会抛错，而本
 * 函数位于启动流程里，抛错会把"校正开机自启"变成"启动失败"。存储不可用时真正
 * 要提示的是 `showStorageFailureDialog`，不该被这里抢先。
 */
function readAutoStartConfig(): boolean {
  try {
    return storeManager.getConfig().autoStart === true
  } catch (error) {
    console.warn('[AutoStart] 读取配置失败，本次跳过校正：', error)
    return false
  }
}

async function showStorageFailureDialog(mainWindow: BrowserWindow | null): Promise<void> {
  const dataDir = join(homedir(), '.modelport')
  const reason = storeManager.getInitializationError()?.message ?? 'unknown error'
  const options = {
    type: 'error' as const,
    title: '本地数据无法读取',
    message: '应用数据初始化失败，配置与账号暂不可用',
    detail: [
      reason,
      '',
      `数据目录：${dataDir}`,
      'store.key 解密失败通常意味着系统凭据/账户密码被重置。',
      '处理办法：先备份，再把 store.key 与 data.json 移到别处后重启应用；',
      '如需恢复旧数据，可用同目录的 data.json.pre-key-migration.bak 覆盖 data.json。',
    ].join('\n'),
    buttons: ['打开数据目录', '退出'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }

  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)

  if (response === 0) {
    await shell.openPath(dataDir)
    return
  }

  app.isQuitting = true
  app.quit()
}

async function loadAppContent(mainWindow: BrowserWindow): Promise<void> {
  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    try {
      await loadUrl(process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173')
    } catch (error) {
      console.error('Failed to load development server:', error)
    }
  } else {
    try {
      await loadFile(join(__dirname, '../renderer/index.html'))
    } catch (error) {
      console.error('Failed to load production files:', error)
    }
  }
}

function cleanup(): void {
  console.log('Application is exiting, performing cleanup...')
  storeManager.flushPendingWrites()
  const updaterManager = UpdaterManager.getInstance()
  updaterManager.destroy()
}

export function restartApp(): void {
  app.relaunch()
  app.quit()
}

export function getAppVersion(): string {
  return app.getVersion()
}

export function isAppQuitting(): boolean {
  return app.isQuitting ?? false
}

export { getMainWindow }
