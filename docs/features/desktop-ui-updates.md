# 桌面界面与更新

> 适用版本：v1.7.1 ｜ 最后核对：2026-11-04 ｜ 状态：现行

## 这个功能点是什么

ModelPort 是一个 Electron 33 桌面应用：主进程负责存储、代理服务、托盘与更新，渲染进程是 React 18 + Tailwind + Zustand 的界面。界面按功能分成仪表盘、日志、模型、供应商、聚合渠道、账号渠道、API Key、代理设置、设置与关于等页面，中英双语（`zh-CN` / `en-US`）。

主进程与渲染进程只通过具名 IPC 通道沟通，命名约定是 `domain:action`（例如 `proxy:start`、`providers:add`、`requestLogs:bundleSave`）。渲染进程关闭沙箱外的 Node 能力：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，preload 只暴露白名单接口。

应用只允许单实例运行。关闭窗口时若 `minimizeToTray` 为真（默认），窗口隐藏而不是退出；托盘菜单提供“打开主界面”和“退出”，托盘本身还有一个紧凑窗口（`/tray` 路由）。开机自启时窗口保持隐藏，不抢焦点。

更新走 `electron-updater`：检查、下载、安装三段都由主进程驱动，状态通过 `app:update*` 事件推给渲染层。检查由用户触发（`app:checkUpdate`），启动不自动轮询；下载进度实时透出，安装前一键重启。

界面状态集中在 Zustand store：`proxyStore` 持有代理启停与运行状态，`providersStore` 持有供应商/账号/模型，`dashboardStore` 持有统计，`settingsStore` 持有配置，`navigationStore` 持有当前页面。组件不直接订阅 IPC 原始事件，而是订阅 store 的派生状态，避免多个页面各自维护一份运行态。

设置页的“数据管理”提供界面偏好导入/导出：导出件是浏览器侧清洗后的 `localStorage` 快照（`modelport-config-YYYY-MM-DD.json`），磁盘上旧的含 Key `config` 不会被带出；导入走同一套清洗逻辑。`.mpc` 只是安装包注册的文件关联扩展名，与这份配置导出不是同一条链路。诊断包与日志导出属于另一条独立路径，不复用该导入导出。

preload 只暴露按领域分组的方法与事件订阅函数；每个订阅函数返回取消订阅句柄，页面卸载时必须调用，否则重复进入页面会叠加监听器并造成内存泄漏。主进程侧的事件名集中在 `ipc/channels.ts`，新增通道必须同时更新 preload 与处理器，不能只在渲染层硬编码字符串。

## 关键行为与不变量（必守约束）

- **Electron profile 固定为 `<appData>/modelport`**，由 `app.setPath('userData', …)` 在入口最前面设置。不能改回由 `package.json` 的 `name` 推导：`safeStorage` 把 `store.key` 与凭据封装在这个 profile 上，改名会让已有安装的数据读不出来。〔v1.4.1 起〕
- 数据根是 `~/.modelport/`。旧版 `chat2api` 的两处路径会在启动时整体 rename 迁移到 `modelport`，且迁移幂等、失败只告警；迁移跑在 store/缓存初始化之前。〔v1.4.5 起〕
- macOS ARM64 必须加 `app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')`，同时关掉 GPU sandbox；这是 Electron 33 的 V8 JIT 崩溃规避，代价是性能。〔版本待考〕
- 渲染进程保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`。要新增主进程能力，走具名 IPC，不要把 Node 模块塞进 preload。
- 导航只认建窗时登记的应用自身文档：`will-navigate` 对非应用地址调用 `preventDefault()` 并转交外部打开；`setWindowOpenHandler` 一律 `deny`；`will-attach-webview` 一律拒绝。〔v1.4.11 起〕
- `openExternal` 只接受 `http(s)` 链接；IPC 经 `trustedSender` 校验 `senderFrame`。托盘使用的 `tray:open-dashboard`、`tray:resize`、`tray:set-height`、`tray:quit-app` 是 `ipcMain.on` 的 fire-and-forget 通道，每个都在处理函数内自行校验来源。〔v1.4.11 起〕
- 单实例锁由 `app.requestSingleInstanceLock()` 保证；第二个实例启动时把已有窗口 `restore()` / `show()` / `focus()`，而不是再开一个进程；进程在托盘隐藏时也会被拉回可见。
- `minimizeToTray` 默认 `true`：窗口 `close` 时若不在真正退出流程，只 `hide()`；托盘菜单与自启隐藏共用同一套窗口管理。
- 开机自启在 `store` 初始化之后与操作系统对账（`reconcileAutoStart`）：只信 `data.json` 不写系统会留下“配置开了、注册表没写”的分叉，只写系统不读配置则重装后永远恢复不了。开发态（`!app.isPackaged`）跳过对账，避免每轮误报“校正失败”。
- 隐藏启动的判据刻意不读配置：Windows/Linux 看启动参数里的 `--hidden`，macOS 看 `getLoginItemSettings().wasOpenedAtLogin`；配置要等 store 就绪，而窗口是否显示必须在建窗时就决定。macOS 13+ 会忽略登录项的“隐藏打开”，所以两条判据都保留。
- Linux 的开机自启状态直接检查 `~/.config/autostart/*.desktop` 文件，不能用 `app.getLoginItemSettings()`（该 API 只覆盖 macOS/Windows）；写失败只告警并留日志，不阻断启动。
- 主题只在根节点写 `data-theme`（`light` / `dark`），`system` 档跟随 `prefers-color-scheme` 媒体查询，不重建窗口；`zh` / `en` 的浏览器语言只做归一化映射，缺省文案回落到 `en-US`。
- 窗口最小尺寸 `800×600`；托盘窗口高度受屏幕可用区域限制，主进程对渲染层请求的 resize 做夹取，避免把托盘窗口拉出屏幕。
- 更新管理器固定 `autoDownload = false`、`autoInstallOnAppQuit = true`、`allowPrerelease = false`、`allowDowngrade = false`；下载必须由用户确认，安装前先 `flushPendingWrites()`，避免升级重启时丢掉最近两秒的日志。
- 更新错误文案按 `net::ERR_INTERNET_DISCONNECTED`、`ERR_CONNECTION_TIMED_OUT`、`ENOENT`、`EACCES`/`EPERM`、`signature` 等分类，界面拿到的是可读原因而不是原始异常。
- 打包产物不含 `node_modules`（`build.files` 排除了它），主进程运行时依赖必须由 rollup 打进 bundle；渠道包以 `extraResources` 落到 `process.resourcesPath/channel-pack`，因为它不能放进 asar。
- 发布目标：macOS 只产出 dmg（arm64），Windows 产出 nsis + portable（x64），Linux 产出 AppImage（x64/arm64）与 deb / tar.gz（x64）；`asar` 开启，`asarUnpack` 放行 `.node` 与 `electron-updater`；`build.publish` 指向 GitHub `polite0803/ModelPort`。当前没有代码签名与公证，macOS 产物不适合依赖 `electron-updater` 的自动更新链路。
- 应用注册 `.mpc` 文件关联与 `modelport://` 协议；安装包使用 NSIS，允许选择安装目录。
- 设置类表单必须等 `appConfig` 加载完成后再渲染可编辑控件；`ProxyConfigForm` 在没有未保存修改时同步持久化值，否则默认的 `127.0.0.1` / HTTPS 关闭会把用户配置覆盖回去。〔v1.5.2 起〕
- `npm run gate`（build + 两个 `tsc` + 全量测试）是唯一验收口径；`electron-vite build` 只转译不做类型检查，绿色构建不代表类型正确。
- 构建脚本区分平台：`dev` 走 `scripts/dev.sh`，Windows 用 `dev:win`（先构建渠道包再 `electron-vite dev`）；`build` 先过 `check:source-artifacts`、构建渠道包，再转译；`start:sandbox` 以 `--no-sandbox` 启动，仅供排障。
- 运行时要求 Node ≥ 22.18.0（测试运行器直接执行 `.test.ts`，旧版本会报 `ERR_UNKNOWN_FILE_EXTENSION`）；Electron 固定在 33.x，`electron-updater` 固定在 6.x。
- macOS 产物 `hardenedRuntime: true` 但 `gatekeeperAssess: false`，dmg 只放 Applications 链接；Windows NSIS 关闭 one-click、允许改安装目录与提权，并创建桌面/开始菜单快捷方式。

## 配置项与默认值

| 配置键 / 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `theme` | `system` | 界面主题（light / dark / system） |
| `language` | `en-US` | 界面语言（`zh-CN` / `en-US`） |
| `minimizeToTray` | `true` | 关闭窗口时隐藏到托盘 |
| `autoStart` | `false` | 开机自启 |
| `autoStartProxy` | `false` | 启动后自动开启代理 |
| 窗口初始尺寸 | `1200×800` | 由 `src/main/index.ts` 建窗设定；最小 `800×600` 由 `window/manager.ts` 执行 |
| 更新通道 | GitHub Releases | `build.publish`：`polite0803/ModelPort` |

托盘窗口的路由是 `/tray`；主界面路由为 `/`（仪表盘）、`/providers`、`/aggregate`、`/channels`、`/proxy`、`/models`、`/logs`、`/settings`。API Key 页嵌在代理设置里，关于页嵌在设置页里；未知路由回落到 `/`。

## 相关代码位置

- `src/main/index.ts` — 入口、profile 固定、单实例、macOS js-flags、进程钩子
- `src/main/window/manager.ts` — 窗口创建、沙箱、导航限制、隐藏到托盘
- `src/main/tray/TrayManager.ts` — 托盘菜单、托盘窗口、IPC 来源校验
- `src/main/tray/TrayWindow.ts` — 紧凑托盘窗口
- `src/main/ipc/channels.ts` — 全部 IPC 通道名与事件名
- `src/main/ipc/handlers.ts` — 主进程处理器注册
- `src/main/ipc/trustedSender.ts` — senderFrame 校验
- `src/main/ipc/logBroadcast.ts` — 日志实时广播
- `src/main/updater/UpdaterManager.ts` — 检查/下载/安装与状态事件
- `src/main/autostartHost.ts` — 开机自启与隐藏启动判定
- `src/main/scheduler/Scheduler.ts` — 统一调度器生命周期
- `src/renderer/src/App.tsx` — 页面路由与托盘视图分支
- `src/renderer/src/pages/` — 各功能页面
- `src/renderer/src/components/Tray/TrayView.tsx` — 托盘紧凑界面
- `src/renderer/src/stores/` — Zustand 状态
- `src/renderer/src/i18n/locales/` — `zh-CN.json` / `en-US.json` 文案
- `src/renderer/src/components/ThemeProvider.tsx` — `data-theme` 与系统主题跟随
- `src/renderer/src/components/settings/DataManagement.tsx` — 界面偏好导入/导出
- `package.json` — 脚本、Electron 版本、electron-builder 配置

## 版本沿革

| 版本 | 变化 | 证据 |
| --- | --- | --- |
| v1.0.0 | 首次发布：Electron + React 桌面应用，含仪表盘、托盘与中英双语界面 | CHANGELOG「v1.0.0」条目 |
| v1.1.2 | 托盘窗口与紧凑仪表盘（`/tray` 路由与托盘 API） | CHANGELOG「v1.1.2」条目 |
| v1.2.0 | 应用内更新检查与 `electron-updater` 接线（下载进度、一键安装重启、错误重试与双语界面） | CHANGELOG「v1.2.0」条目 |
| v1.4.1 | 品牌更名 ModelPort，Electron profile 固定 | CHANGELOG「v1.4.1」条目 |
| v1.4.2 | 开机自启；日志广播 IPC 与请求日志趋势保留策略 | CHANGELOG「v1.4.2」条目 |
| v1.4.5 | 品牌更名完成（**BREAKING**）：启动时迁移 `<appData>/chat2api` 与 `~/.chat2api`，保住 `store.key` 解密 | CHANGELOG「v1.4.5」条目 |
| v1.4.6 | 修复打包安装后存储不可用：`electron-store` 重新打进主进程 bundle，并由构建测试守住 | CHANGELOG「v1.4.6」条目 |
| v1.4.11 | 渲染进程开启 sandbox；导航只认应用自身文档；IPC 经 `trustedSender`；`openExternal` 只认 http(s) | CHANGELOG「v1.4.11」条目 |
| v1.5.2 | 配置表单等持久化配置加载后再渲染，修“重启后被默认 127.0.0.1 / HTTPS 关闭覆盖” | CHANGELOG「v1.5.2」条目 |
| v1.7.0 | 设置页可选模型清单刷新周期（天/周/月） | CHANGELOG「v1.7.0」条目 |
