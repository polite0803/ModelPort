/**
 * 进程内「真 store + 真代理路由」harness（仅 tests/ 使用，不进任何生产构建）。
 *
 * 它**不替代任何被测逻辑**，只接上两个 OS/进程边界，让 `src/main/**` 的真实实现
 * 能在 `node --test` 里跑起来：
 * - `electron` → `tests/routes/electron-stub.mjs`（经 `loader-hooks.mjs` 的 resolve 钩子）；
 * - 存储目录 → `mkdtemp` 出来的临时目录（经 `USERPROFILE`/`HOME` + `stubState.userDataDir`），
 *   所以 `storeManager.initialize()` 读写的绝不是开发者机器上的 `~/.modelport`。
 *
 * 被证明的层次（每个测试文件再写一遍自己那一层）：
 * `store.ts` 的 normalizeConfig/normalizeRoutes 与路由 CRUD → `store/modelRoutes.ts` 的请求解析
 * → `proxy/routes/*.ts` 的 Koa 处理器（经真 HTTP 请求）→ `proxy/autoRouter.select()` 的池/sticky 决策。
 * 没被证明的层次：renderer UI、真 Electron 进程、OS 钥匙串、上游网络。
 *
 * 纯 JS（`.mjs`）：钩子必须在 `src/main` 被解析之前注册，所以这里不能有类型标注以外的花样，
 * 被测模块一律 `await import()`。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

// 钩子必须**在任何 src/main 模块被解析之前**注册；本文件由测试文件静态 import，
// 所以对 src 的一切引用都走 `await import()`（见 bootstrapStore / loadModule）。
register(new URL('./loader-hooks.mjs', import.meta.url))

const repoRoot = new URL('../..', import.meta.url).href

/** `loadModule('main/store/store.ts')` → `<repo>/src/main/store/store.ts` 的 file URL。 */
function srcUrl(relative) {
  return new URL(`src/${relative}`, repoRoot).href
}

const stub = await import(new URL('./electron-stub.mjs', import.meta.url).href)

let instanceCounter = 0
const activeDirs = []

function makeDataDir() {
  const dir = mkdtempSync(join(tmpdir(), `modelport-routes-${process.pid}-${instanceCounter++}-`))
  activeDirs.push(dir)
  return dir
}

/**
 * 起一个**真** `storeManager`（单例，所以「一个测试文件 = 一个 store 进程」）。
 *
 * ⚠️ 为什么必须在 import 之前设环境：`StoreManager.getStoragePath()` 读 `homedir()`，
 * 而 `initialize()` 只跑一次（`isInitialized` 短路）。要证明「旧 data.json 第一次被读」
 * 这条真实路径，就把 `initialData` 写好再 bootstrap —— 那才是升级安装的真序。
 *
 * 返回：`{ dataDir, storagePath, storeManager, dataFile(), dataFileExists(), writeDataFile(), dispose() }`
 */
export async function bootstrapStore(options = {}) {
  const dataDir = makeDataDir()
  const storagePath = join(dataDir, '.modelport')
  mkdirSync(storagePath, { recursive: true })

  // store.getStoragePath() = join(homedir(), '.modelport')
  process.env.USERPROFILE = dataDir
  process.env.HOME = dataDir
  process.env.MODELPORT_TEST_DATADIR = storagePath
  stub.stubState.userDataDir = storagePath

  if (options.initialData !== undefined) {
    const initial = { ...options.initialData }
    if (options.seedPresetRoutes !== true && initial.config && typeof initial.config === 'object') {
      // 默认**不参与播种**：`store.seedPresetRoutes` 会在 init 末尾往表里加预设路由
      // （协议名 + 三档），而这批夹具的断言基线是「表里/清单里只有我写进去的那几条」。
      // 这里写的是那个记档键本身（`pendingPresetRouteSeeds` 的唯一判据），不是另造
      // 一个开关 —— 要证播种路径的用例传 `seedPresetRoutes: true` 就回到真实行为。
      const { PRESET_ROUTE_SEEDS } = await import(srcUrl('main/store/modelRoutes.ts'))
      initial.config = {
        ...initial.config,
        seededPresetRoutes: PRESET_ROUTE_SEEDS.map(seed => seed.name),
      }
    }
    writeFileSync(join(storagePath, 'data.json'), JSON.stringify(initial, null, 2), 'utf8')
  }

  const { storeManager } = await import(srcUrl('main/store/store.ts'))
  await storeManager.initialize()
  if (storeManager.hasInitializationError()) {
    throw new Error(
      `[harness] store failed to initialize: ${storeManager.getInitializationError()?.message}`,
    )
  }

  const dataFilePath = join(storagePath, 'data.json')

  return {
    dataDir,
    storagePath,
    storeManager,
    /** 盘上 `data.json` 的真实内容（无 keystore 时是明文，正是产品文档写明的降级分支）。 */
    dataFile: () => JSON.parse(readFileSync(dataFilePath, 'utf8')),
    dataFileExists: () => existsSync(dataFilePath),
    writeDataFile: (value) => writeFileSync(dataFilePath, JSON.stringify(value, null, 2), 'utf8'),
    dispose: () => {
      // 只把**异步**的落盘（app 日志 / 请求日志 / 额度账本，都是 debounce 写）压平：
      // 目录**不在这里删**，否则那个 debounce 定时器会在目录消失之后才触发，
      // 报一个与本用例无关的 ENOENT（实测）。真正的清理由下面的 process 'exit' 钩子做。
      try {
        storeManager.flushPendingWrites()
      } catch {
        // 收尾失败不改变结论
      }
    },
  }
}

/**
 * 加载 src 里的一个模块（路径相对 `src/`，如 `main/proxy/routes/models.ts`）。
 * 在 `bootstrapStore()` 之后调用，它拿到的 `storeManager` 才是同一个单例。
 */
export async function loadModule(relative) {
  return import(srcUrl(relative))
}

/**
 * 在回环端口起**真** `ProxyServer`（auth 是 fail-closed 的：没配 API key 时只允许 127.0.0.1，
 * 正是这里用的形态），返回直接打真 HTTP 的 `request()`。
 *
 * 这一层证明的是「HTTP 请求进来 → 中间件 → 路由解析 → 状态码/响应头/错误体」整条链，
 * 不是读源码文本：`X-ModelPort-Route-Name`、404/503 的 code 与 message 都来自真响应。
 */
export async function startProxy(port) {
  const { proxyServer } = await loadModule('main/proxy/server.ts')
  const started = await proxyServer.start(port, '127.0.0.1')
  if (started !== true) {
    throw new Error(`[harness] proxy server refused to start on 127.0.0.1:${port}`)
  }

  const base = `http://127.0.0.1:${port}`
  return {
    port,
    base,
    request: async (method, path, init = {}) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(init.headers || {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      const text = await response.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
      return {
        status: response.status,
        headers: Object.fromEntries([...response.headers.entries()]),
        json,
        text,
      }
    },
    stop: () => proxyServer.stop(),
  }
}

/** 进程退出时回收所有 harness 临时目录（Windows 上 rmSync 偶发 EBUSY，忽略即可）。 */
process.on('exit', () => {
  for (const dir of activeDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 见上
    }
  }
})
