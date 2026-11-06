# WSL 无头守护进程与 Windows 原生壳

> 成文：2026-11-05 ｜ 状态：**S1–S4 完成；壳的发布形态已被 [`PLAN-shell-three-modes.md`](PLAN-shell-three-modes.md) 取代（2026-11-07：控制台三形态 + 取消主应用发布形态、单产品身份、无 `latest.yml`）** ｜ 目标版本：v1.8.0
>
> S2 收口前唯一没取到的读数：**真实浏览器里看一眼 `/ui/`**（列模型、建路由、日志实时滚动）。
> HTTP 层已证（文档+资产出得来、RPC 四态、SSE 推得出帧），但壳的窗口就是这一页，所以它
> 是 S3 的第一步而不是 S2 的尾巴。
>
> 目标一句话：**把网关进程和图形界面拆成两个可分别启动的东西**——网关在 WSL 里以
> 无窗口进程常驻，宿主机用图形界面连它；关掉界面（窗口或标签页）不影响网关继续服务。
>
> 非目标：不在 WSL 里跑 WSLg 窗口；不伪装官方客户端；不把 `data.json` 做成跨系统可
> 拷贝的形态；不在本轮引入付费签名/公证或新的基础设施。

---

## 1. 现状量数（本轮实测，不是估计）

| 量 | 读数 | 取数方式 |
|---|---|---|
| 网关依赖闭包 | 以 `proxy/server.ts`+`store/store.ts`+`scheduler/*`+`accountChannels/manager.ts` 为根的静态 import 闭包 **124 个文件** | 脚本解析相对 import（含动态 `import()`） |
| 其中触碰 electron 的 | **5 个文件** | 同上 |
| IPC 通道声明 / 注册 | 168 / 148 | `ipc/channels.ts`、`ipc/handlers.ts` |
| 管理面端点 | 11 个模块、43 条 | `proxy/routes/management/` |
| renderer 调用点 / 体量 | `window.electronAPI` 141 处 / 24,923 行 | grep |
| handlers 里真正的本机专属 API | `dialog.` 1、`shell.` 2、`TrayManager` 3、`updaterManager` 8 | grep |
| 需要变成推送通路的 | `webContents.send` 12 处 | grep |
| 路由形态 | 已是 `HashRouter` | `renderer/src/main.tsx:14` |

五个 Electron 依赖点（S1 要全部变成可注入）：

1. `proxy/server.ts:341` — `app.getVersion()`；
2. `store/store.ts` — `safeStorage` 12 处 + `electron-store`；
3. `autostartHost.ts` — `app` 登录项（daemon 不装载即可，不需改造）；
4. `providers/accountChannels/manager.ts:758` — `shell.openExternal(loginUrl)`；
5. `channelPack/bridge.ts:18` — `process.resourcesPath` 定位渠道包产物。

### 关于 `electron-store` 的两条事实

- v10 在模块顶层 `import electron from 'electron'` 并解构 `{app, ipcMain, shell}`，
  纯 Node 下拿到的是二进制路径字符串，`app` 为 undefined ⇒ **daemon 不能带它**。
- 它只是 `conf` 的转发壳：构造时把 `name` 改成 `configName`、`delete options.name`、
  相对 `cwd` 拼到 `app.getPath('userData')`，然后 `super(options)`；加密完全由 `conf`
  负责。⇒ **换成 `conf` 不改变 `data.json` 的文件名与密文形态**。
  已实测：`new Conf({configName:'data', cwd, encryptionKey})` 落在 `<cwd>/data.json`，
  写读往返、`defaults` 合并、错密钥抛 JSON 解析错（与现有损坏文件恢复逻辑的入口一致）。

## 2. 已拍板决策

| # | 事项 | 裁定 | 落地位置 |
|---|---|---|---|
| D1 | 壳内 preload | 做，只做「在浏览器打开 / 重新连接 / 退出」三项 | S3 |
| D2 | 壳的连接地址 | 可填多台（本机 WSL + 远程网关共用一个地址簿） | S3 |
| D3 | 远程 https 自签 | 壳不代装信任；首连手工信任一次，界面给可诊断的一屏 + CA 下载入口 | S3 |
| D4 | 壳的版本 | 跟主程序同版本号一起发，哪怕壳自身没变 | S4 |
| D5 | daemon 运行时形态 | 纯 Node 产物（档二），不是「Electron 不建窗」（档一） | S1 |
| D6 | GUI 载体 | daemon 自托管 `out/renderer`，浏览器与壳共用同一份页面 | S2 |
| D7 | WSL 内凭据后端与配置搬迁 | **沿用既有降级（无密钥库 ⇒ 明文 + 显式声明），配置从 Windows 侧走备份导出/导入带进 WSL**；入口是 `--import-backup`，S2-D 已实测走通 | 完成 |

**已拍板（D7，2026-11-05）**：WSL 内凭据加密后端取第三种——沿用 `planKeySetup` 既有的
「keystore 不可用 ⇒ 明文 + 显式降级标记」，配置搬迁走备份导出/导入。备份件本就是
**口令封装（scrypt + AES-256-GCM）、与机器无关**的形态（`backup/crypto.ts` 的注释写明不用
`store.key` 正是因为「换台机器解不开」），所以这条路不需要新密码学通路。落点见 S2。
S1 已把这条通路的**结论**测出来，见「S1 完成记录」判据 6。

## 3. 阶段

### S1 — 网关脱离 Electron，产出可运行的 Node 守护进程

**落点**

- 新增 `src/main/runtime/host.ts`：宿主绑定单点（版本号、资源根、外部浏览器打开器、
  系统密钥库探针），Electron 与 Node 两份实现，未绑定时抛明确错误而不是静默回退。
- 改 `server.ts`（版本）、`accountChannels/manager.ts`（打开登录 URL，**该文件与并行批
  重叠，只改不提交**）、`channelPack/bridge.ts`（资源根）。
- 改 `store/store.ts`：`electron-store` → `conf`（4 处构造：主实例、损坏探针、legacy
  读、重写），`safeStorage` 调用折进 host 绑定。
- 新增 `src/main/daemon/entry.ts`：`store.initialize` → provider/账号就绪 →
  `scheduler.start()` → `proxyServer.start()`，全程不建窗口、不装托盘、不装更新器。
- 新增 `scripts/build-daemon.mjs`：esbuild 出 `out/daemon/index.cjs`（CJS，运行时依赖全内联），
  `package.json` 加 `build:daemon`。
- 改既有守卫 `tests/build/main-bundle-deps.test.ts`（它钉的是 electron-store 留在
  `exclude` 列表，依赖退役后这条判据要折进 `conf`，不能留着报一个不存在的包），并新增
  `tests/build/daemon-bundle.test.ts`。

**验收判据**

1. `node out/daemon/index.cjs` 在 Windows 本机起得来，`/v1/models`、
   `/v1/management/health`、`GET /v1/management/tls/ca` 三条 curl 有读数；
2. daemon bundle 内 `require('electron')`/`from 'electron'` 命中数为 0（守卫断言）；
3. daemon bundle 内无对外部运行时依赖的裸 `require`（与主包同规格，asar 无 node_modules
   那条规则在这里同样成立）；
4. 老用户数据不迁移即读：现有 GUI 写的 `data.json` 用同一把 key 被 daemon 读出，
   `provider`/`config` 计数一致；
5. GUI 路径不回归：`npm run gate` 全绿（S1 收尾跑一次，不逐修逐跑）。

**代价与回退**：动 `store.ts` 是本轮最高风险面，坏在「读不到现有 data.json」。回退 =
`git checkout` 那一个文件，daemon 入口与新构建脚本可保留（它们不被 GUI 引用）。
若第 4 条判据不过（密文形态有出入），改法是在 host 绑定里同时提供 electron-store 实现、
只在 Node host 用 conf——不共享一份 store 实例的构造参数。

### S1 完成记录（2026-11-05，读数为本轮实测）

改动落点（新增 6 个文件、改 12 个）：

- 新增 `src/main/runtime/host.ts`（宿主绑定 + `hostResourceRoot()`：未绑定时调用方按
  「资源缺席」退化，测试进程不必伪造 Electron）、`src/main/runtime/electronHost.ts`、
  `src/main/daemon/entry.ts`、`scripts/build-daemon.mjs`、`tests/build/daemon-bundle.test.ts`、
  `tests/store/sealed-datastore-refusal.test.ts`。
- 改 `proxy/server.ts`、`store/store.ts`、`store/keyMigration.ts`、`channelPack/bridge.ts`、
  `providers/accountChannels/manager.ts`（与并行批重叠，**只改未提交**）、
  `providers/modelCatalogStore.ts`、`main/index.ts`、`electron.vite.config.ts`、`package.json`、
  `package-lock.json`、`tests/build/main-bundle-deps.test.ts`、`tests/main/autostart-wiring.test.ts`、
  `tests/routes/harness.mjs`。

判据读数：

| # | 判据 | 读数 |
|---|---|---|
| 1 | daemon 起得来 | `node out/daemon/modelport-daemon.cjs` 在临时 HOME 下启动，`[Daemon] ModelPort 1.7.3 listening on 127.0.0.1:8080`；`GET /` → `{"name":"ModelPort Proxy","version":"1.7.3"}`（版本来自构建期内联，不是硬编码）；`GET /v1/models` 无 Key → **401**（fail-closed 未松动）；带新生成的 `sk-mp-*` → **200**，列出 5 条路由名（`auto/codex/daily/...`），符合「只advertise路由」；`/v1/management/proxy/status` 与 `/v1/management/tls/ca`（开开关后）→ **200**，CA 1675 字节 PEM；`https://127.0.0.1:8443/v1/management/tls/status` → **200**，说明 `selfsigned`/node-forge 在纯 Node 下能自签（SAN 含 127.0.0.1 与 ::1），证书落在 `<home>/.modelport/tls/` |
| 2 | 产物不含 electron | `tests/build/daemon-bundle.test.ts` 5/5；负控自证：同一组匹配器打在 `runtime/electronHost.ts` 上三条全命中（`from 'electron'`／`safeStorage.`／`process.resourcesPath`），说明门有牙 |
| 3 | 运行时依赖全内联 | bundle 4,304 KB，esbuild 无 external；`conf` 进入 `externalizeDepsPlugin` 的 exclude（原 `electron-store` 位），`tests/build/main-bundle-deps.test.ts` 2/2 |
| 4 | ~~老数据不迁移即读~~ **判据作废** | 见下方「新发现的硬约束」 |
| 5 | GUI 不回归 | `npm run gate` 第一轮 **1752 tests / 0 fail / GATE-EXIT:0**（含 electron-vite build、两个 tsc、daemon 构建与全量测试）；S1 收尾在 `keyMigration` 改动后再跑一轮，读数记在本表下方 |

判据 6（D7 的落地证据，S1 收尾补测）：`tests/backup/headless-import.test.ts` 在无密钥库主机上
跑真导入引擎——`stageBackupFile()`（`pickBackupFile()` 去掉对话框的那半，不碰窗口）→ `applyBackup(token,'replace')`
→ 回读磁盘字节：凭据以可读明文落在 `data.json`、目录里没有 `store.key`、`isCredentialEncryptionDegraded()` 为真。
`tests/backup/*.test.ts` + `tests/build/*.test.ts` 合计 28/28 绿，`tsc -p tsconfig.node.json` exit 0。

**新发现的硬约束（S1 的实测产物，影响 §2 待拍板项）**

`store.key` 是 safeStorage 按机器封的，WSL 里没有 safeStorage ⇒ **一份 Windows 装好的
`data.json` 在 daemon 下根本打不开**。已核：本机 `~/.modelport/` 存在 `store.key`，`data.json`
首字节是二进制（不是 JSON）。

更糟的是原逻辑的走法：`planKeySetup` 在「无密钥库」时一律返回 `unencrypted`，于是 `store.key`
在场也当没看见，`conf` 用明文口径读那份密文 → 解析失败 → `initialize()` 的「不许替换真实数据」
护栏要求 `keyFilePath` 非空，而此时它是 null → 落到 `recoverFromCorruptedData()`：把
`data.json` 改名成 `data.corrupted.<ts>.json` 并新建一个空台账。也就是说 daemon 一旦指向同一份
数据目录，凭据文件会被静默挪走、界面变成「什么都没配」。

已修（属 S1 范围内，不是新增功能）：`planKeySetup` 增加 `sealed-unreadable` 一格，store 在拿到
这个计划时置位 `keystoreBlocked` 并抛错，`initialize()` 的护栏条件扩成
`keyFilePath || keystoreBlocked`，`recoverFromCorruptedData()` 不再有机会执行。
`tests/store/sealed-datastore-refusal.test.ts` 用真 `storeManager` 验了三件事：抛出可核证的
原因、`data.json` 仍在原位、目录里没有 `data.corrupted.*`。7/7 绿（含 `key-migration` 的表）。

由此 §2 的「WSL 内凭据加密后端」不再是可选优化，而是 **WSL 安装形态的前置**：三选一里
只有「Node 侧 keyfile/AES」和「导出导入换明文形态」两条能让人把配置带进 WSL；沿用降级那条
只支持「在 WSL 里新配一套」。这一项请在 S2 开工前拍掉。

### S1 的 WSL 实机读数（补测 2026-11-05，Ubuntu-24.04 / kernel 6.18 / NAT + localhostForwarding=true）

现场：Node 22.14.0 解包在 `/root/opt`（未动 apt），daemon 产物 7.9 MB 拷到 `/root/mpd`，
数据目录 `/root/.modelport`（新装，无 `store.key`）。

| # | 读数 | 结果 |
|---|---|---|
| 1 | 起服务 | `listening on 0.0.0.0:8080`，`GET /` → 200 且版本 1.7.3；无 Key 打 `/v1/models` → 401 |
| 2 | 宿主可达 | **绑 127.0.0.1 时宿主打不开**（`TcpTestSucceeded=False`）；改绑 `0.0.0.0` 后宿主 `http://localhost:8080/` → **200** |
| 3 | fail-closed 是否成立 | `proxyHost=0.0.0.0` 且 `apiKeys=[]` ⇒ **拒绝监听**（监听数 0）并说明原因，不是悄悄起来 |
| 4 | SIGTERM | `[Daemon] SIGTERM: stopping` → `[SessionManager] Destroyed` → 进程消失、端口释放 |
| 5 | 常驻 | `systemctl --user` 起 `modelport.service` 后 `active`，**换一个 WSL 会话再查仍然在跑并回 200**（journal 里能读到启动期三行） |
| 6 | 资源根 | 新增 `--print-paths`：`resourceRoot=/root/mpd/resources`、`channelPack .../channel-pack (worker.mjs found)`、`sealedKey absent`、`keystore unavailable` |

**撤回一条上一轮的判断**：我说过「WSL2 会把 WSL 内监听端口转发到宿主 localhost，绑 127.0.0.1
也够用」——**错**。实测只在监听者绑非回环时宿主才连得上；绑 WSL 内回环的监听宿主侧一律失败。
于是宿主可达这件事变成「`config.proxyHost` 必须非回环」，而它又必须与 fail-closed 一起成立
（第 3 条已经证明这套闸门在无头主机上照旧生效），所以 S2 的首启入口必须同时落
`proxyHost` + 一把 API Key，不能只开管理面。

**测量口径的坑（记下来，别再犯）**：Git Bash 里的 `curl` 打 WSL IP 与宿主 localhost 全部回 000，
而 Windows 原生 `Test-NetConnection` / `Invoke-WebRequest` 同一时刻回 True/200。宿主→WSL 的可达性
只能按 Windows 侧的原生 HTTP 客户端判定。

未验证的一格：渠道包 worker 在 WSL 里**实际执行** WASM 并跑通一笔渠道请求——需要 S2 的管理面
入口才能驱动（现在只有本地 IPC 能触发 worker），第 6 条只证明资源根与 `worker.mjs` 定位正确。

现场残留（都是本机 WSL，未提交进仓库）：`/root/mpd`（产物与三个日志）、`/root/opt/node-v22.14.0-linux-x64`、
`~/.config/systemd/user/modelport.service`（已装、当前 inactive、未 enable）。重开：
`systemctl --user start modelport`。

### S2 — 管理面走网络，界面变成网页

**落点**：handler 注册表（`ipc/handlers.ts` 里已是「通道名 → 纯函数」）复用，挂一条
带**显式白名单**的 RPC 入口进 `/v1/management`（沿用 `managementAuth` + 限流 + 开关闸门），
12 处 `webContents.send` 收敛成一条 SSE；renderer 侧把 141 处调用点收到一个 transport
出口（IPC 实现 / HTTP 实现），daemon 静态托管 `out/renderer`。首启需要一个写
`managementApi.enableManagementApi` + secret 的入口：**改既有配置键，不另造旁路**。

S2 还要补 D7 的两个入口（引擎已在，缺的是无窗口调用）：管理面加 `backup` 模块
（`stageBackupFile` / `unlockBackup` / `applyBackup`，导入需要口令输入），以及一次性首启
导入的命令行入口。同时「明文落盘」这条缺席必须在界面上说清（哪个目录、为什么、怎么收口），
不能只显示成一个正常的凭据列表。

首启入口还要多写一格：WSL 实测要求 `config.proxyHost` 非回环宿主才能连上，而 `checkStartupSecurity`
要求非回环必须带 Key，所以**同一个入口要一起落 `proxyHost` + `apiKeys` + 管理面开关与 secret**，
少任一个都会以「服务起来了但没人能管」的形态失败。

**验收判据**：浏览器打开管理页可完成「列模型、建路由、看请求日志实时新增、改档位、
取 CA」；本机专属能力（备份文件对话框、开机自启、自动更新、托盘）在远程模式下要么
撤下要么明确标注「仅本机」，不留灰按钮。

**代价**：这是本计划最大头（白名单约 130 个通道量级），且安全面变宽——管理面一旦可走
网络，绑定仍限 127.0.0.1、secret 必填，`checkStartupSecurity` 目前只约束 `/v1/*` 数据面，
S2 要给管理面补一条独立策略并写明。

### S2 进度记录（2026-11-05 深夜）

**已完成：handler 注册表 + 宿主能力缝 + 管理面 RPC。**

- 新增 `src/main/ipc/registry.ts`（通道名 → handler 的一张表，宿主无关；Electron 侧用
  `setIpcTransport` 把 `ipcMain.handle` 接进来，无头侧只填表）。
- `ipc/handlers.ts` 的 147 个注册全部改走注册表；12 处 `webContents.send` 改
  `getHost().push(...)`；窗口按钮 / 更新器 / 托盘 / 保存对话框 / 系统链接处理器全部改走
  `requireDesktop(...)`；`oauth/manager.ts`、`oauth/adapters/base.ts`、
  `logging/diagnosticBundle.ts` 一并去 Electron 化。来源校验（trustedSender）与备份处理器
  这两个真桌面专属的注册从共享表里移回 `index.ts`——无头宿主根本不注册它们。
- 结果：`handlers.ts` 的闭包 **140 文件 / 0 处 electron**；`src/main` 里还剩 **11 个**
  真桌面文件 import electron，这条集合本身成了判据（`daemon-bundle.test.ts` 新增一条，
  fs 递归扫描，未跟踪文件也算）。

**白名单口径与本文档原写法不同（记在这儿）**：原本写「显式白名单」，实现取的是
**注册表本身即可调用集，减去两条安装级动作**（`app:installUpdate`、`app:downloadUpdate`）。
理由是第二份手工清单正是两侧漂移的来源，而注册表就是「这台宿主真能做什么」。缺席的桌面
能力不是被放进来，而是自己回答 `desktop-only`。

WSL 实测读数（Ubuntu-24.04，systemd --user 起，宿主侧 Windows 原生 HTTP 调用）：

| 调用 | 结果 |
|---|---|
| `GET /v1/management/rpc/channels` | **145 条**可调用通道 |
| `POST {channel:"config:get"}` | 200，返回真配置对象 |
| `POST {channel:"app:getVersion"}` | 200 `"1.7.3"`（宿主注入的版本） |
| `POST {channel:"app:minimize"}` | 403 `desktop-only`，文案点名「no window, tray or dialog」 |
| `POST {channel:"app:installUpdate"}` | 403 `not_exposed` |
| `POST {channel:"nope:ghost"}` | 404 `unknown_channel` |
| 不带口令 | 401（到不了注册表） |

同一批日志里还有一个意外收获：**渠道包 worker 在 WSL 里真起来了**——`DSH_OPENAI_GATEWAY_ENABLED`
生效、建了 OpenCode 匿名通道、并从更新站现取到 gemini 身份版本。于是 S1 那条「worker 执行 WASM」
的未验格基本补上（一笔真实渠道对话请求仍未验）。

运维读数：`nohup … &` 起的进程在 `wsl.exe -e bash <script>` 会话结束时会被带走（前台跑满 14s 不退，
`ss` 里也确认过它曾监听）——**常驻必须走 systemd**，这条与 S4 的安装文档直接相关。

**S2 已完成（同日续）：SSE 事件流。** `GET /v1/management/events` 把 `getHost().push(...)`
在无头宿主上的订阅总线转成 SSE 帧（心跳是注释行 `: ping`，不冒充数据事件）。鉴权走管理口令头，
所以浏览器端必须用 `fetch().body.getReader()` 读，**不能用 `EventSource`**（它带不了请求头，
而把口令放进查询串会落进沿途每一处日志）。`tests/routes/management-rpc.test.ts` 8/8，其中两条
钉这条流：帧里必须是宿主推的那份载荷、缺口令必须 401。

**两条既有门随接线改名**（判据不变，改的是被钉的调用形态）：`aggregate-credit-wiring` 的
`ipcMain.handle(` → `registerMainHandler(`；`in-app-update-flow` 的「check update 必须交给
UpdaterManager」原来只查 handler 一处，现在拆成两段——handler 只许问宿主能力袋，
Electron 宿主那一侧才真调 `updaterManager.checkForUpdates()`，三处 GitHub REST 反例断言
在两段上都跑。

**S2 剩余**：①renderer 的 transport 出口（141 处 `window.electronAPI` 调用 → IPC / HTTP 两份实现，
通道名映射必须收进与 preload 同一张方法表，否则又是一处两份真相）+ daemon 静态托管 `out/renderer`；
②首启入口（一次落 `proxyHost` + `apiKeys` + 管理面开关与 secret）——本轮 WSL 测试是直接改
`data.json` 打开管理面的，那是人工步骤，不算交付。

**S2-C 的实现口径（写死在这儿，避免下次重新权衡）**：preload 实测是 **150 处
`ipcRenderer.invoke(IpcChannels.X, …)` 直透 + 14 处 `ipcRenderer.on` 监听**。做法取
「新增 `src/shared/apiChannels.ts` 两张表（方法→通道、事件→通道）供浏览器桥消费」，
**不重写 preload 的 150 个函数体**，而是加一条门：解析 preload 里的
`name: (…) => ipcRenderer.invoke(IpcChannels.X` 形状，与表逐条对照，不一致就红。
这样单一权威由门保证，代价是多一条门而不是动一个 1015 行的脏文件。
浏览器桥把对象直接挂到 `window.electronAPI`，141 处调用点因此一行不改。

WSL 复验（终局一轮，gate 1763/1763 exit 0 之后重建的产物）：`channels=145`；
`store:set` 这笔 RPC 走完后，另一个 HTTP 客户端在同一条 `/v1/management/events` 上收到
`event: config:changed` + 真载荷（先是 `events:ready`）。
第一次测出「0 帧」是我自己的部署错——脚本只 `systemctl restart` 没重拷产物，跑的是加 SSE 之前
那一版；重拷后同一条命令立刻出帧。留这条是因为它暴露了一个真实的运维坑：**daemon 的版本只能靠
产物本身核对**，`--print-paths` 里没打 bundle 的构建时间，S4 的安装文档要带上「拷完再重启」的顺序。

### S2-C 完成记录（2026-11-06 凌晨，gate 1770/1770 exit 0）

落点：

- **方法表只有一个载体。** `~1000` 行的 API 对象从 `src/preload/index.ts` 整段搬进
  electron-free 的 `src/shared/api.ts`，150 处 `ipcRenderer.invoke(` → `wire.invoke(`；
  preload 缩到 20 行（装 ipcRenderer 线 + `contextBridge.exposeInMainWorld`）。
  浏览器侧 `src/renderer/src/api/headless.ts` 用同一张表架 HTTP 线（`POST /v1/management/rpc`）
  与 SSE 线（`GET /v1/management/events`），`main.tsx` 在渲染前装好，
  **141 处 `window.electronAPI` 调用一行未改**，也不存在第二份通道清单。
- 原来写在 preload 尾部的安全规则（不暴露通用 `invoke/send/on`）随表搬走，并被
  `tests/ipc/api-wire-single-source.test.ts`（7 条）钉住，含「passthrough 不许回来」。
- SSE 帧解析抽成纯函数 `src/shared/sseFrames.ts` + 3 条用例，负控覆盖：`: ping` 心跳、
  无 data 的帧、无通道名的帧、坏 JSON 一律**不成事件**（「没数据」与「没回答」不许混）。
- 静态托管 `src/main/proxy/routes/web.ts`：`/ui` → 302、`/ui/` 出文档（no-store）、
  `/ui/assets/*` 出哈希资源（immutable）、路径逃逸 404。两处实测踩坑：构建产物本来就是
  相对 URL（`./assets/…`），文档必须落在带斜杠的 `/ui/`；koa-router 非 `strict` 会把
  `/ui` 与 `/ui/` 当同一条，301 自环。
- **契约例外（已写进 AGENTS）**：`/ui` 与 `/`、`/health` 一样免 API Key——文档本身不含数据，
  页面每个调用仍需管理口令；在这里塞 Key 只能放 URL，而 `?api_key=` 是明令禁止的形态。
- 首启入口 `modelport-daemon --init-host [--port]`：一次落 `proxyHost=0.0.0.0` + 一把 API Key
  + 管理面开关与 secret，全走 `updateConfig` 写既有键，无旁路；`--print-paths` 增加 webRoot。
- 三条既有门随「桥」搬家重钉（`aggregate-credit-wiring`、`anthropic-inbound-settings` 的四环链、
  `in-app-update-flow`），判据不变、读的文件从 preload 改成 `src/shared/api.ts`，第二环标题同步改名。

WSL 实机读数（空安装一路跑下来）：`--init-host` 打印一次性 Key/secret；`--print-paths` 的
`webRoot=/root/mpd/renderer`；systemd 起监听 1；`GET /ui`=302、`GET /ui/`=200 748B、
`/ui/assets/index-h1SPHAak.js`=200 876KB（含浏览器线的新哈希）；`channels=145`；
`app:getVersion`→`"1.7.3"`；`app:minimize`→`desktop-only`；数据面带完整 Key→200 列 5 条路由、
不带 Key→401；RPC 写配置后第二个 HTTP 客户端在同一条事件流上收到 `config:changed`；
`systemctl stop` 后监听数归 0。

一处红是我脚本自己的错：`sk-mp-` 后面是 48 位 hex，我的 grep 只取了 40 位 ⇒ 拿截断串去请求
得到 401。用 `data.json` 里的完整 Key（54 字符）复跑即 200，fail-closed 无误。

**没取到的一格（不许说成已完成）**：浏览器里人眼点验远程界面（列模型、建路由、日志实时新增）。
本轮证到的是 HTTP 层：文档与资产出得来、方法表在浏览器线那头能被 RPC 满足、事件流推得出帧。
界面真实渲染需要一次真实浏览器访问，留作 S3 壳开工前的第一件核对事项。

**D7 还差一个入口（说清楚，不算完成）**：导入引擎本身已经在无窗口条件下测通
（`stageBackupFile` → `applyBackup`，`tests/backup/headless-import.test.ts` 证明凭据以可读明文
落到 `data.json` 且原文件不被改名），但**daemon 现在还调不到它** —— `backup/service.ts` 仍
`import { app, dialog, BrowserWindow } from 'electron'`，所以它在无头闭包之外。修法与 S2-A
同一套：`app.getVersion()` 走宿主、两个对话框与默认下载目录走 `desktop` 能力袋，导出侧留作
桌面专属。做完之后才谈得上「把 Windows 的配置带进 WSL」这条路径真的可用；目前它只可用到
「手工执行」都不行的程度，因此 D7 的验收要挂在这一项完成之后。

### S2-D 完成记录（2026-11-06）

**D7 现在真的能走通了。** `backup/service.ts` 去掉 electron（版本走宿主，两个文件对话框与
「重启应用」走 `desktop` 能力袋，`BrowserWindow` 参数删掉——对话框自己找焦点窗口），于是
daemon 闭包 **146 文件 / 0 处 electron**，命令行入口 `--import-backup <path>` 用的就是那套引擎。
`src/main` 里 import electron 的文件从 11 个降到 10 个，那条集合门同步收窄。

补记（同日，导入修好那一轮）：`backup/ipc.ts` 的六条通道从 `ipcMain.handle` 搬进注册表后不再引用 electron，集合从 10 个降到 **9 个**；那条集合门的期望清单同步收窄，`docs/features/wsl-daemon.md` 的计数一起改。

口令走 stdin 或 `MODELPORT_BACKUP_PASSWORD`，**不走 argv**（命令行留在 shell 历史与 `ps` 里）。

两条命令行用例真起发布产物跑：口令封装件 → 退出 0 + 凭据以可读明文落在 `data.json`；
缺口令 → 退出 2 且**一个字节都不写**。

### 导入备份补上第三条入口（2026-11-06，你一句「不能裁剪」推翻了 D7 的收尾形态）

D7 当时把「WSL 里怎么导入」收在命令行 `--import-backup` 上，界面里只留一句「这里没有文件对话框」。
实机眼验证明那个收尾不合格：操作员手上的备份件在**宿主**上，不在 WSL 里，界面却把这件事报成
「读取文件失败（可能过大或没有权限）」——既推卸了能力，又归错了因。现在的形态：

- 页面用浏览器自己的 `<input type=file>` 取文件（`src/renderer/src/api/headless.ts`），
  `POST /v1/management/backup/stage` 发字节；`src/shared/api.ts` 的方法表仍然只有一份，
  `pick` 改成「传输层自己能答就自己答，否则走 IPC 通道」，桌面行为一字未动。
- 网关在**自己**的数据目录里生成 `import.<uuid>.json`（0600），`stageBackupFile()` 读进内存后
  立刻删除：客户端说不出落盘路径；`readCapped()` 在流到达上限时就断，不把超规格件读完；
  鉴权与限流沿用 `/v1/management` 前缀那一套。
- 三条入口（桌面对话框 / `--import-backup` / 上传路由）共用一条引擎，格式判定、口令件、
  一次性 token 不可能再分叉；AGENTS.md 里加了这条不变量。
- 导出**没有**无头入口，界面直说（`desktop-only-export`），没顺手造一个 `--export-backup`：
  那是新能力，等你裁。旧网关没有上传路由时报 `upload-unavailable`，文案里给出 CLI 退路。

门：`tests/routes/management-backup-upload.test.ts`（6 条，含「上传→apply 后 provider 真的进了
store」这条端到端，以及临时文件必须不留在数据目录）与
`tests/renderer/headless-absence.test.mjs`（6 条：能力表、路由已挂载、文案不再归因错误）。
### 壳记住管理口令（2026-11-06，D1 的最小 preload 在此处扩容）

你问「每次启动都要输入这个吗」——按 D1 的形态答案是「是」，但那不是安全收益：40 个字符每次重输，
只会把人训练成把口令记在文本文件里。裁定改为：壳替你记住，浏览器标签页维持关闭即忘。

- 纯逻辑层 `src/shell/secretStore.ts`（注入式 `SecretSealer`，因此能在 `node --test` 里真跑）：
  按 origin 分条、只存封装串、空口令等于忘掉、坏文件不炸壳。Electron 相关的只有 main 里那
  12 行 safeStorage 封装。
- 三条硬边界：**没有密钥库就拒绝写盘**（不降级明文、不假装记住）；封装串绑当前 Windows 用户，
  换机/换用户解不开时报 `unreadable` 而不是 `none`；只在 `probeGateway` 成功之后才保存，
  401 同时清掉 `sessionStorage` 与壳里那条。
- `gateways.json` 仍然零凭据（既有门继续有效）；`secrets.json` 0600。
- D1 的 preload 从三条动作扩到六条具名方法，**没有**通用 `invoke`/`send`，桥面不暴露
  `ipcRenderer`（新门按桥接对象那一段查，不是整文件，避免把 import 行误判成暴露）。

门：`tests/shell/secret-store.test.ts` 6 条（含「拒绝写入时连文件都不创建」「盘上找不到明文」）、
`tests/build/shell-entries.test.ts` 8 条、`tests/renderer/headless-absence.test.mjs` 7 条。
仍未取的一格：这台 Windows 机器上 DPAPI 的真往返——要你把壳关掉再开一次，看它是否不再问。

### 首启顺序是有语义的（实测踩到后写死在这儿）

导入是「备份里的配置全赢」（`restoreConfig` 的定义），所以它会把 `proxyHost`、`apiKeys`、
管理面开关一起换回备份里的值。先 `--init-host` 再 `--import-backup`，结果就是一个绑在回环、
没 Key、管理面关着的守护进程——表现成「连不上」而不是「导入过」。两处处置：

1. 导入完直接把现值播出来（`proxyHost=127.0.0.1 proxyPort=8080 apiKeys=0 managementApi=off`）
   并点名下一步该再跑一次 `--init-host`；这条被 CLI 用例钉住，不许只存在于文档里。
2. 正确顺序是 **先导后暴露**，WSL 实测：导入（providers=1 accounts=1）→ `--init-host` →
   systemd 起 → RPC `providers:getAll` 看见导进来的 `prov-win`（3 家）、`channels=145`、
   `GET /ui/`=200、带新 Key 的 `/v1/models`=200 列 5 条路由 → stop 后监听 0。

不改覆盖式语义：那是备份的定义，不是 bug。

### S4 前置：WSL 安装形态实测结论（2026-11-06，Ubuntu-24.04 / WSL 2 / systemd=true）

这四条都是被真实读数逼出来的，写文档时不能凭直觉：

1. **常驻必须 system 作用域 + `enable`。** `systemctl --user` 的单元会跟着调用它的登录会话一起死
   （root 的 `Linger=no`；开了 linger 也只让 user manager 活着，发行版本身还是被关），而
   `wsl -l --running` 实测出现「没有正在运行的分发」——最后一个 WSL 客户端退出后发行版被整体回收。
   改成 `/etc/systemd/system/modelport.service` + `systemctl enable --now` 之后，`wsl --shutdown`
   冷启动回来 `unit=active`、监听在、宿主可达。
2. **mirrored 模式在这台机不成立。** 改完 `networkingMode=mirrored` 后 WSL 的 eth4 拿到和宿主 WLAN
   **同一个地址** 192.168.0.239：WSL 内自连 200，宿主连自己的 IP 只命中自己的协议栈 ⇒ 拒绝；
   连 `127.0.0.1:8080` 也是 refused。已按备份 `~/.wslconfig.bak-modelport` **逐字节回退**
   （那条 pin IP 的 `kernelCommandLine` 与 mirrored 原理冲突，是回退的一部分）。
3. **NAT + 非回环绑定 + `localhostForwarding=true` 就够，不需要 portproxy、不需要防火墙放行。**
   实测宿主 `http://127.0.0.1:8080/ui/` = 200 / 748B、`http://172.29.147.201:8080/ui/` = 200。
   因此「按 1→2 顺序试」的第 2 步**不执行**：不能给一个测量证明不必要的口子去改机器网络姿态。
4. **探针口径要两个一起看。** 我原先写的「只认 `Test-NetConnection`」被本轮推翻一次：它在
   `127.0.0.1:8080` 上报过 `tcp=True`，而同一时刻宿主监听数为 0、`curl.exe --noproxy` 明确
   `Connection refused`。可达性的判据取 **`curl.exe --noproxy '*'` 的 HTTP 码 + 宿主
   `Get-NetTCPConnection -State Listen` 计数**，两者一致才算；`Invoke-WebRequest` 仍受 WinHTTP/代理
   口径污染，不用作判定。

对 S1 那节「宿主可达需要非回环绑定」的补充：仍然成立，但它是**必要不充分**——真正的失败模式是
上面第 1 条（服务随会话死）与截图那次的第 0 因（我的验证脚本最后一步 `systemctl stop`）。

### S3 — Windows 原生壳

**落点**：独立入口 `src/shell/`（窗口 + 托盘 + 地址簿 + D1 的三项 preload 能力），
`appId=com.modelport.shell`、userData 钉 `<appData>/modelport-shell`、自己的单实例锁；
**不带 electron-updater**（Windows 更新描述文件名固定 `latest.yml`，两个产品发进同一
Release 会互相覆盖，被覆盖侧的自动更新会去下载另一个产品的二进制）。D3 的错误页复用
`/v1/management/tls/status` 的握手拒绝计数。

**验收判据**：壳连 WSL 网关成功；把网关进程 kill 掉后壳显示可诊断的一屏而不是空白页；
关掉壳窗口后 WSL 里网关仍在服务（curl 复验）；同机与主程序并存时互不抢单实例、
主程序 `chat2api → modelport` 迁移逻辑不被二次执行。

### S3 完成记录（2026-11-06，代码与门；画面待眼验）

新增四个文件 + 三处构建接线：

- `src/shell/main.ts`：`userData` 钉 `<appData>/modelport-shell`、`AppUserModelID=com.modelport.shell`、
  自己的单实例锁、`window-all-closed` 什么都不做（关窗只隐藏到托盘，这是这条需求的全部意义）。
  窗口 `loadURL` 到 `<gateway>/ui/`（不是 `/ui`，那只会多一次 302）。
- `src/shell/addressBook.ts`：D2 的多台地址簿，独立 JSON（`mode 0600`），只收 http(s) origin；
  **管理口令不落在这里**——它在页面自己的 sessionStorage 里，随标签页死。
- `src/shell/preload.ts` + `promptPreload.ts`：D1 的三项能力（在浏览器打开 / 重新连接 / 退出），
  加一个「添加/编辑网关」的独立小窗（它只有 submit/cancel 两条消息，不暴露通用 invoke）。
- 失败态与空态都是自包含的 `data:` 文档，带一个回链和三条排查线索（服务在跑吗 / 绑的是不是非回环 /
  CA 从 `${url}/v1/management/tls/ca` 取），**不需要任何额外 IPC 面**，也不把「连不上」和
  「还没配网关」画成同一张图。
- 接线：`electron.vite.config.ts` 的 main 多一个 `shell` 入口、preload 多两个；
  `tsconfig.node.json` 的 include 加 `src/shell/**/*.ts`。产物 `out/main/shell.js` 11.4 KB，
  实测不含任何网关存储符号。

新增门 `tests/build/shell-entries.test.ts`（5 条，产物级优先）：三个产物存在；shell bundle 带自己的
身份且**不含**网关存储标记（`Storage not initialized` / `resolveEncryptionKey` / `planKeySetup` /
`.modelport/data.json`）；`src/shell/*` 不许 import `src/main/*`；`window-all-closed` 不许 quit；
地址簿必须拒非 http(s) 且不许存 secret。这条防的是具体事故：壳一旦引用网关模块，就变成两个进程抢
同一份 `data.json`、两个托盘、两把单实例锁，还会把 `chat2api → modelport` 迁移跑第二遍。

**没取到的一格**：壳的真实画面（窗口里远程 UI 长什么样、托盘菜单、添加网关对话框）。
`npm run build` 之后本机起它：`npx electron out/main/shell.js`。我没有替你启动 GUI。

补记（2026-11-06，S4 期间逐行复读 `src/shell/main.ts` 揪出三处，都不是画面能看出来的那种）：

- 编辑网关是坏的：预填值走的是 `encodeURIComponent`，而整份 HTML 又要为 `data:` URL 编一次，
  于是地址框里显示 `http%3A%2F%2F127.0.0.1%3A8080`，保存时 `normalizeOrigin` 直接拒——改成只按
  HTML 属性口径转义（`escapeHtml`），顺带把用户可命名的网关名在失败页里的文本注入面一起封了。
- 用窗口自带的 X 关掉「添加/编辑网关」不会 resolve 那个 Promise，两个 `ipcMain.once` 留在注册表里；
  下一次对话框的 submit 会被**上一个调用方**接走，界面表现为「点了保存没反应」。加 `dialog.on('closed')`
  兜成取消。
- `window.modelportShell`（D1 那三条：在浏览器打开／重连／退出）现在**没有任何页面在调**：
  三条动作的实际入口是托盘菜单。桥按 D1 保留，但别把它读成已接通的功能——接通它要给
  `/ui/` 的远程页加按钮，那是 S3 画面验之后的事。

### S3 画面眼验的两个缺陷（2026-11-06 实测，壳真起来之后才看得见）

**一、`/ui/` 在纯浏览器与壳里是黑屏，桌面窗口里从来没这个问题。**
根因一处：`src/shared/api.ts` 的 `app.platform` 直接写 `process.platform`。Electron 给渲染进程
和 preload 都挂了 `process` 全局，所以桌面里永远是对的；同一份 bundle 被无头守护进程当静态文件
发出去以后，模块求值阶段就抛 `process is not defined`，React 根本没挂载，而控制台**一条都不打**
（浏览器与壳都一样），窗口只剩 `backgroundColor` 那片深色。
取证方式：用受控浏览器打开同一 URL，`#root.childElementCount === 0`、`performance` 里那个
chunk `responseStatus: 200`，再在页面里手动 `import()` 那个 chunk 才把真实异常拿到。
修法是给这个字段加宿主判断：桌面照旧 `process.platform`，非桌面给 `'browser'`——它的唯一消费点
是 `Header.tsx` 判断 Win/Linux 要不要给系统标题按钮让位，远程页面本来就没有可让位的按钮。
新门：`tests/build/renderer-bundle-browser-safe.test.ts`（2 条，含把守卫剥掉就红的负控）扫
`out/renderer/assets/*.js`，任何 `process.` 出现在没有 `typeof process` 守卫的位置就红。

**二、托盘菜单一动就「闪退」，进程是干净退出的（exit 0，事件查看器里没有任何
Application Error / WER 记录），所以不是 native crash。**
真因是我写错了一条 Electron 语义：Windows/Linux 上 `window-all-closed` 的**默认行为就是退出**，
注册一个空 body 的监听器并不改变默认，只有 `event.preventDefault()` 才改。原来那行
`app.on('window-all-closed', () => undefined)` 配着一句「故意不在所有窗口关闭时退出」的注释，
读起来对、跑起来是退出。改成 preventDefault，并把 `tests/build/shell-entries.test.ts` 里
**钉住错误写法**的那条断言一起换掉（它当时把 `() => undefined` 当成了正确形态）。
这一条要复验：托盘里点「添加网关」需要人手点一次，我点了不算。

### S4 — 发布

win 增加 1 个 nsis 产物（壳），Linux 增加 1 个 daemon tar.gz，macOS 不出壳。
`.github/workflows/release.yml` 在 windows-latest job 追加一步、ubuntu job 追加
`build:daemon` 与打包，`publish` 仍指向同一个 GitHub Release。README 产物表与
`docs/features/` 增加 WSL 安装页并接 `docs/README.md` 索引。

**验收判据**：一次 tag 发布后 Release 资产清单里三类产物齐全，`latest.yml` 只有一份且
指向主程序安装包。

### S4 完成记录（2026-11-06）

落地的东西与读数：

- daemon 产物：`dist/modelport-daemon-1.7.3-x64.tar.gz`，2,368,654 字节，解包清单里
  `./modelport-daemon.cjs`、`./bin/modelport`、`./renderer/index.html`、
  `./resources/channel-pack/worker.mjs`、`./systemd/modelport.service` 五条都在。
- 壳产物配置：`electron-builder.shell.yml`（独立 `appId`/`productName`、`extraMetadata.main`
  改指 `out/main/shell.js`、`publish: null`）。
- CI：`release.yml` 的 windows job 追加壳的一步（`gh release upload`，不带 `--publish`），
  ubuntu job 追加 `build:daemon` + 上传。YAML 解析通过，步骤清单逐条确认。
- 文档：README 下载表 + 平台支持表 + dev 命令 + 下面那条本机限制；`docs/features/wsl-daemon.md`
  并接 `docs/README.md` 索引；AGENTS.md 三条（RPC 可调用集＝注册表减两条安装级、`/ui` 与
  `/`「`/health`」同样豁免 API Key 闸门、三类产物 + `latest.yml` 唯一 + systemd **system-scope
  且 enable**）。
- 门：`tests/build/release-artifacts.test.ts` 6 条，本轮新增两条并带变异负控——
  「`artifactName` 与 CI 的 `gh release upload` glob 必须同源」（否则发布那一步静默上传 0 个文件）、
  「`dist-shell*/` 必须在 `.gitignore` 里」（壳是第二个构建根，60–90 MB 安装包离 `git add -A` 一步）。

**壳的安装包在本机取不到，且不是壳的配置问题**——A/B 实测：同机同命令跑**主程序**
`npx electron-builder --win --x64`，停在同一行
`⨯ Exit code: null. Command failed: dist-main-check\ModelPort-1.7.3-x64-setup.exe`；
壳那次同位置报 `Exit code: 2`。机制是 electron-builder 为了写卸载器会**执行刚编出来的 NSIS 桩**
（`app-builder-lib/out/targets/nsis/NsisTarget.js:347` → `execWine`，win32 上就是本机直接跑），
这台开发机把那个子进程干掉了，于是构建判定失败，落在那个路径上的 223 KB exe 是桩不是安装包
（主程序 223,446 字节 / 壳 223,290 字节，真载荷是同一目录里 84.7 MB 的 `*.nsis.7z`）。
⇒ 壳安装包的证据只能在 CI 的 windows-latest 上取；`--dir` 出解包版，
`npx electron out/main/shell.js` 不经过安装包就能跑壳。
副作用：被杀的桩在 `dist-shell*/win-unpacked/resources/app.asar` 上留了滞留句柄，本轮删不掉
（`Win32_Process` 全量清单里已无对应进程，也不是 node/app-builder/makensis 存活），重启即清；
该目录已进 `.gitignore`，不会进提交。

**仍未取的一格**：三类产物同现于一个 Release、`latest.yml` 只有一份——只有真发一次 tag 才有读数。
CHANGELOG/更新日志与 tag 推送本身等你点头，不在我自行收尾的范围里。

终局读数（2026-11-06，S4 全部改动落盘之后）：`npm run gate` **1786/1786 绿，exit 0**；
导入第三条入口落地后复跑：**1801/1801 绿，exit 0**（同一链条：build + build:daemon + 两个 tsc + 全量）。
含 `build` + `build:daemon` + 两个 `tsc --noEmit` + 全量测试。安装包不在 gate 里（本机打不出，
见上），所以这一条不是壳安装包的证据。

## 4. 风险与回滚

| 风险 | 后果 | 处置 |
|---|---|---|
| `conf` 与 `electron-store` 语义差在边角（`projectVersion`、相对 `cwd`） | 数据读不到 | 判据 S1-4 用真机 `data.json` 验；相对 `cwd` 现有代码传的是 `homedir()` 绝对路径，不受影响 |
| WSL 里无系统密钥库 | 凭据明文落盘 | 沿用既有降级 + 显式告警；不做「静默明文」，界面与日志都要能看见 |
| daemon 产物忘带渠道包/catalog/wasm | 13 个账号渠道整体不可用 | S1-1 的验收里必须包含一次渠道路由实测；资源根由 host 注入，缺省即报错 |
| 管理面开在网络可达的绑定上 | 管理 secret 变成主攻击面 | 绑 127.0.0.1 + 限流 + 强 secret；文档明确「不要因为 WSL 连不通去绑 0.0.0.0」 |
| 两个 Windows 安装包同仓 | `latest.yml` 互相覆盖 | 壳不自更新（S3 落点已写），发布判据 S4 明确只允许一份 yml |

## 5. 已确认 / 待确认

- 已确认：D1–D7（§2）。加密后端那条已随 D7 关掉，不再占用后续决策位。
- 已推翻（2026-11-07）：壳是否需要 macOS/Linux 版本——现在的裁定是**出**，且壳就是唯一产品（见 PLAN-shell-three-modes.md）。
- 已处理：`docs/features/` 下 WSL 文档的归目——`docs/features/wsl-daemon.md` 已建并已接进
  `docs/README.md` 索引，不是孤立文件（`tests/build/release-artifacts.test.ts` 钉着）。
- 已取：WSL 实机六条读数（见「S1 的 WSL 实机读数」），其中**宿主可达需要非回环绑定**推翻了我
  原来的假设，并把「首启同时写 `proxyHost` + API Key」变成 S2 的必做项。
- 仍未取：渠道包 worker 在 WSL 里执行 WASM 跑通一笔真实渠道请求（要 S2 的入口才能驱动）。
