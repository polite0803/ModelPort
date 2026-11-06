# 壳三形态（本地 / WSL / 远程）+ 网关按需安装

> 成文：2026-11-07 ｜ 状态：**M1–M4 已随 v1.7.6 发布；M5 的文档与开发通路已完成，代码退役待收口** ｜ 目标版本：v1.7.6（破坏性）
>
> 目标一句话：**只发一个产品**。它既是控制台，也是网关的安装器；网关可以跑在本机、
> WSL、或另一台主机，前两种在网关不存在时由它安装。
>
> 这条改造取消现有「主应用」发布形态：`ModelPort-<ver>-x64-setup.exe` 仍是唯一安装包，
> 但它装下来的东西从此是「控制台 + 本地网关宿主」，不再是一个自带窗口的网关。

---

## 1. 已拍板决策（2026-11-07，四项问答）

| # | 事项 | 裁定 | 代价（已告知并接受） |
|---|---|---|---|
| M-1 | 本地形态的网关进程 | **独立进程**，不是与窗口同进程 | 多一个进程；关界面不影响服务，但同一安装包 ⇒ 卸载同停 |
| M-2 | macOS / Linux | **壳补 mac + linux**（只出本地 + 远程，无 WSL） | CI 矩阵与产物门全改；mac 仍无自动更新（dmg 未签名） |
| M-3 | 老用户落地 | **复用主应用身份**（`com.modelport.manager` / `ModelPort` / `dist/`），就地覆盖升级 | 需一次旧安装残留清理，且控制台状态目录要与网关 profile 分开 |
| M-4 | WSL 首装自动化 | **全自动，含 Node 供给**（nodejs.org 官方 tarball 解到 `/opt/modelport/node`） | 多一个下载源；全程 root；每步失败要能报清停在哪并回滚 |
| M-5 | 本地网关的宿主绑定 | **同一 Electron 二进制、无窗口模式**（`--gateway`），不是纯 node daemon | 第二份 Electron 运行时（~60–90 MB RSS）；换来密钥库可用 |

**M-5 是 M-1 + M-3 合推出的唯一解**，不是新选项：`store.key` 由 `safeStorage` 封装
（`src/main/index.ts:19-24` 的钉死注释），而 `safeStorage` 只在有 `app` 的 Electron 主进程里存在；
纯 node 宿主拿到的是 `UNAVAILABLE_SEALER`（`src/main/runtime/host.ts:148-156`）。用纯 node 跑本地
网关，要么老用户 `data.json` 解不开（违背 M-3 就地升级），要么给 node 重写一套 DPAPI 封装——
与既有密文形态不兼容，同样要重填全部凭据。WSL/远程继续用现有 node daemon（那台主机本来没有
密钥库，D7 已裁明文 + 显式降级）。

**同时退役的旧裁定**：`PLAN-wsl-headless-daemon-and-shell.md:556`「壳是否需要 macOS/Linux 版本
（当前裁定不出）」→ 推翻，改为出；同文件 S3/S4 关于「壳不自更新、`latest.yml` 只能有一份、
壳走 `gh release upload`」的三条约束 → 随主应用发布形态一起作废（见 M4）。

---

## 2. 现状读数（本轮实测）

### 2.1 已经具备、可直接复用的

| 能力 | 位置 | 三形态里的作用 |
|---|---|---|
| HTTP 管理面 + SSE | `proxy/routes/management/rpc.ts`、`events` | 远程/本地窗口都用它驱动界面 |
| 渲染层的远程传输 | `src/renderer/src/api/headless.ts:1-16`、`:323-336` | **`createElectronAPI` 造出同一个 `electronAPI` 对象**，141 个调用点零改动 |
| `/ui/` 静态宿主 | `src/main/proxy/routes/web.ts:44-101` | 三形态统一 `load <origin>/ui/` |
| host 抽象 | `src/main/runtime/host.ts:58-86` | 加一个「无窗 Electron」绑定即可 |
| 无头 daemon | `src/main/daemon/entry.ts:257-324` | WSL / headless Linux 直接复用 |
| daemon 产物与 unit 模板 | `scripts/build-daemon.mjs:86-146` | WSL 首装的安装物 |
| 下载 + 校验 + WSL 执行 | `src/shell/updater.ts:98-204` | WSL 首装的执行器骨架 |
| 壳客户端骨架 | `src/shell/main.ts`（托盘/地址簿/口令密封/失败态） | 三形态客户端 |

### 2.2 缺失（本次要新建的）

1. **本地网关的宿主**：没有「无窗口 Electron 网关」入口，也没有本地首启的
   `--init-local`（现有 `--init-host` 固定写 `0.0.0.0` + API Key，`daemon/entry.ts:95-135`）。
2. **本地网关的监督者**：壳目前只会 `loadURL` 到用户手填地址（`src/shell/main.ts:60-72`），
   不会启动/守护/停止一个本地进程。
3. **WSL 首装**：`readServiceUnit()` 解析不到 unit 就直接抛错（`src/shell/updater.ts:192-204`），
   ⇒ 只有「升级已装实例」，没有「安装」。文档里 node 是手工步骤（`docs/features/wsl-daemon.md:32`）。
4. **三形态的入口**：地址簿只有 `url + manageWsl + wslDistro`（`src/shell/addressBook.ts:19-33`），
   没有「这一格是什么形态」，也没有「网关不存在」与「网关没起来」的区分。
5. **发布形态**：壳是第二套身份（`electron-builder.shell.yml:19-28`），只出 Windows x64
   （`:44-49`），`publish: null`（`:63`）；主应用仍是 `dist/` + `latest.yml`。

---

## 3. 目标架构

```
ModelPort.exe（唯一安装包，三平台）
│
├─ 默认：控制台（client role）
│   ├─ 窗口总是 load  <origin>/ui/        ← 三形态统一，preload 只给 modelportShell 桥
│   ├─ 托盘：地址簿（kind = local | wsl | remote）
│   ├─ 监督器：本地网关的启停/健康/握手；WSL 的安装/升级
│   └─ profile：<appData>/modelport-shell（地址簿 + 密封管理口令，0600）
│
├─ --gateway：本地网关（gateway role，独立进程，无窗口）
│   ├─ Electron 主进程 + safeStorage 封装的 store.key（凭据继续加密）
│   ├─ 启 proxyServer + /ui/ + /v1/management/*
│   └─ profile：<appData>/modelport（沿用老安装，就地升级零迁移）
│
└─ --init-local：本地首启（loopback + 管理面 secret + 一把 API Key，打印一次性握手行）

modelport-daemon-<ver>-<arch>.tar.gz（WSL / headless Linux，纯 node，D7 明文降级）
```

| 形态 | 网关在哪 | 窗口连哪 | 「网关不存在」时 |
|---|---|---|---|
| 本地 | 本机 `--gateway` 子进程 | `http://127.0.0.1:<port>/ui/` | 首次运行即安装：建 `~/.modelport`、生成密钥、写管理口令、登记登录项、起进程 |
| WSL | WSL 内 systemd（node daemon） | `http://127.0.0.1:<port>/ui/`（NAT localhost forwarding） | 全自动安装（M-4）：发行版 → node → tarball → unit → `enable --now` → `--init-host` |
| 远程 | 另一台主机 | `<用户填的 origin>/ui/` | **不安装**；界面说清「远程主机上要自己部署」，给部署入口 |

三形态的「不存在」必须长得不一样（沿用现有判据风格）：**未安装**（可一键装）／
**已安装未运行**（可一键起 + 显示 `systemctl status` 退出码）／**在跑但连不上**
（沿用现有 `failurePageUrl` 的三条线索，`src/shell/main.ts:105-119`）。

### 3.1 入口拓扑（关键，决定门怎么写）

```
package.json.main = out/main/index.js        ← 薄编排器
  src/main/index.ts: 解析 argv
      ├─ --gateway | --init-local  →  dynamic import('./gateway/entry')
      └─ 其他                       →  dynamic import('../shell/main')
```

必须是**动态 import**：控制台进程里不能求值任何网关模块（否则又回到「一个进程两个网关身份」，
`tests/build/shell-entries.test.ts:28-56` 防的就是这个事故），网关进程里也不能建窗口。
动态 import 在 CJS 产物里被 rollup 切成独立 chunk，产物门可以按文件断言。

---

## 4. 阶段

每阶段结束都要 `npm run gate` 绿；阶段之间不并行改同一文件。全量门只在收尾跑一次，
逐阶段用定点门 + 两个 tsc。

### M1 — 网关宿主拆分（无窗 Electron + 本地首启）

**落点**
- `src/main/gateway/bootstrap.ts`：从 `daemon/entry.ts:257-324` 抽出 `bootstrapGateway(host)`，
  node daemon 与无窗 Electron 共用（含 `chat2api → modelport` 的迁移，**只在这条路径上存在**）。
- `src/main/gateway/entry.ts`：Electron 无窗口宿主；`getResourceRoot = process.resourcesPath`、
  `getWebRoot = <dirname>/../renderer`、`sealer = safeStorage`、`syncLoginItem` 落登录项。
- `src/main/runtime/electronGatewayHost.ts`：`desktop` 能力**分档**——保留
  `pickSavePath/pickOpenPath/openWithSystemHandler/restart`，去掉窗口/托盘/自动更新
  （现在 `DesktopCapabilities` 是一整包，`host.ts:27-48`，要拆成「文件与系统」和「窗口与托盘」两组）。
- `--init-local`：loopback + 管理面开 + 生成 secret + 一把 API Key；最后一行
  `MODELPORT_HANDSHAKE <base64(json)>` 交给父进程，**不写应用日志**。

**判据**
1. `tests/build/gateway-entry.test.ts`：gateway chunk 不含 `new BrowserWindow`/`Tray`；
   daemon chunk 仍零 `require('electron')`（沿用 `build-daemon.mjs:43-52` 的手法）；
   两端都调 `bootstrapGateway`；argv 分支早于任何 `app.setPath`。
2. `tests/main/gateway-init-local.test.ts`：纯函数产出的配置对象 ⇒ `proxyHost=127.0.0.1`、
   管理面开、secret 长度 ≥ 32、API Key 一把；**不含** `0.0.0.0`。
3. 真机：`ModelPort.exe --gateway` 起后用 curl 打 `/health`、`/`（版本一致）、`/ui/`
   （200 + `index.html`）、`/v1/management/rpc`（无 secret ⇒ 401）。

### M2 — 控制台三形态

**落点**
- `addressBook.GatewayEntry.kind: 'local' | 'wsl' | 'remote'`；读取旧文件时迁移
  （`manageWsl === true` → `wsl`，其余 → `remote`；无 `kind` 不报错）。
- `src/shell/localGatewayPlan.ts`（纯）：状态文件形状、spawn argv、端口归属判定、
  健康探测节奏、三种缺席的分类。
- `src/shell/localGateway.ts`：spawn `process.execPath --gateway`（detached、`stdio: pipe`
  只为握手第一行，之后再收即转 `stderr`）、健康轮询、退出码/重启、停止（先 SIGTERM，
  Windows 用 `taskkill` 兜底）。
- 窗口三态页 + 托盘：`安装本地网关 / 启动 / 停止 / 修复`；`kind` 徽标。
- 管理口令：安装期握手拿到 ⇒ 走现有 `secretStore` 密封（`src/shell/secretStore.ts`），
  页面 `loadRememberedSecret()` 直接过 `ConnectGate`，**用户不粘贴口令**。

**判据**
1. 纯函数测试：状态文件损坏 ⇒ 归为「未安装」而不是崩；端口被别人占用 ⇒ 不静默换端口，
   报占用者；`kind` 迁移双向可测（旧文件 → 新结构 → 再写回不变形）。
2. `tests/build/shell-entries.test.ts` 扩写：`src/shell/**` 仍不许 `from '../main/'`；
   控制台 chunk 仍不含 store 标记；**新增**：控制台 chunk 不含 `--gateway` 之外的 gateway
   入口求值（按 chunk 文件断言）。
3. 真机：关窗口后 `curl /health` 仍 200；杀掉网关进程后窗口从「连不上」自动回落到
   「已安装未运行」并给重启按钮。

### M3 — WSL 首装（全自动，含 Node）

**落点**
- `src/shell/wslInstallPlan.ts`（纯）：`wsl -l -v` 输出解析（**wsl.exe 是 UTF-16LE**，
  必须显式解码，否则拿到一串 NUL）、arch 映射、node 供给决策（无 node / 过低 / 已有）、
  安装脚本、回滚脚本、unit 文本（ExecStart 用实测 node 路径）。
- `src/shell/wslInstall.ts`：下载（复用 `updater.ts:150-170` 的 sha256 拒绝规则）→
  `sh -lc` 执行 → 失败按脚本 stdout 的 `BACKUP=` 回滚 → `--init-host` → 解析一次性口令人工确认
  → upsert `kind:'wsl'` → 密封 secret → 健康轮询。
- 无 WSL：**不静默启用 Windows 功能**（要管理员 + 重启），给 `wsl --install` 指引并停在这一步。

**判据**
1. 纯函数：`wsl -l -v` 的 UTF-16LE 夹具（含 `Default` 标记与 `Stopped`/`Running`）；
   node 缺失 ⇒ 计划里出现 node 下载项且版本矩阵按 arch 正确；已有 node ≥ 20 ⇒ 不下载。
2. 脚本断言：unit 的 `ExecStart` 与解出的安装目录同源；`MODELPORT_RESOURCE_ROOT` 指向
   `resources`；`systemctl enable --now` 是 system scope；脚本在**停服务前**打印 `BACKUP=`。
3. 幂等：已装实例（`systemctl cat` 能解析）走升级路径而不是首装；缺校验文件 ⇒ 拒绝执行。

### M4 — 发布形态收敛（取消主应用）

**落点**
- 删 `electron-builder.shell.yml`；`package.json.main` 指向编排器；主 `build` 段成为唯一配置。
- 产物：win `nsis + portable`、mac `dmg`、linux `AppImage + deb + tar.gz`（照现状），
  **加** mac/linux 的控制台（同包同身份，WSL 项按 `process.platform` 隐藏）。
- 更新通路：控制台走**现有 GitHub Release API + `.sha256` + 静默 NSIS**（`src/shell/updater.ts`
  已验证）；`electron-updater` 与 `latest.yml` 一并退役（`publish` 段删除，CI 全用
  `gh release upload`）。理由：两个产品合并后唯一性约束消失，但**本地网关子进程与安装包是同一个
  exe**，安装前本来就得先停子进程，electron-updater 并不省这一步；一套机制更好解释。
- `build/installer.nsh`：静默安装后重启控制台（已存在），并在此之前停本地网关子进程。

**判据**
1. `tests/build/release-artifacts.test.ts` 重写：CI 的 glob 与每个 `artifactName` 同源；
   无 `publish` 段；三个 OS 矩阵都构建控制台；daemon 仍单独上传；`dist/` 在 `.gitignore`。
2. `tests/shell/update-plan.test.ts`：`selectReleaseAssets` 改认
   `ModelPort-<ver>-<arch>-setup.exe`（不是 `ModelPort-Shell-*`），并保留「缺 sha256 即拒」。
3. 一次真 tag 发布后的资产清单（需 CI）：三平台安装包 + 每份 `.sha256` + 两个 arch 的 daemon tarball，
   **没有任何 `.yml`**。

### M5 — 退役、迁移、开发通路

**落点**
- 退役：`src/preload/index.ts`、`src/main/window/manager.ts` 的窗口控制、`src/main/tray/`、
  `src/main/updater/`、`electron-updater` 依赖、IPC 的 `window:*` 与 `app:{install,download}Update`
  通道、`About.tsx:37` 的 `isDesktopApp` 分支与对应 i18n、`docs/features/desktop-ui-updates.md`
  里 electron-updater 的部分。
- `registerIpcHandlers(mainWindow)` 的 `RendererSink` 参数退役（`ipc/handlers.ts:161`），
  handler 表只做 RPC 后端。
- 开发：`electron.vite.config.ts` 的 dev 用 vite `server.proxy` 把 `/v1` 转发到本地网关，
  壳的窗口在 dev 下加载 `:5173`——与生产同一条传输（HTTP + SSE），不再依赖 preload 的 IPC。
- 文档/门：`AGENTS.md` 三条不变量改写（`latest.yml` 唯一性作废；新增「控制台进程不得求值网关模块」
  「本地网关是独立进程且用同一 profile 保住 store.key」）；README 产物表与平台表；
  `docs/features/wsl-daemon.md` 首装章节；`PLAN-wsl-headless-daemon-and-shell.md` 的状态行。

**判据**
1. 就地升级实测：装 1.7.5 → 覆盖装新包 → `~/.modelport/data.json` 与 `<appData>/modelport`
   原样、凭据可解、供应商/账号/路由都在；控制面板只有一项。
2. 渲染层门：`about-shell-update.test.mjs` 三态按新语义改（shell / remote / dev-desktop 不再存在）。
3. `npm run gate` 全绿一次（收尾）。

---

## 5. 风险与回滚

| 风险 | 后果 | 处置 |
|---|---|---|
| 本地网关与老主应用抢同一 profile | safeStorage 解不开 / 锁冲突 | 控制台用 `modelport-shell`、网关用 `modelport`，角色在 `app.setPath` 前按 argv 决定；门钉住 |
| 覆盖安装时网关子进程还占着 exe | NSIS 替换失败、装出半个版本 | 安装前停子进程（`installer.nsh`），失败时报进程名与 PID |
| 本地网关崩溃没人拉起 | 用户以为「又连不上」 | 监督器区分退出码与端口占用，托盘显示「已停止（退出码 N）」+ 重启 |
| WSL 里没有 systemd | `enable --now` 失败 | 首装脚本先 `systemctl is-system-running`，失败给 `wsl.conf` 的 `systemd=true` 指引并回滚 |
| node tarball 供应链 | 国别镜像不一致 | 只认 nodejs.org 官方 + 与 daemon 同规则拒绝无校验；`MODELPORT_NODE_MIRROR` 覆盖（https 限定） |
| 远程形态的「装不了」被写成假按钮 | 用户点了没结果 | 远程只给部署指引 + 「在浏览器打开」，不出现安装按钮（门钉文案） |

回滚：本次是单产品合并，回滚单位是**整批**——保留 1.7.5 的安装包与 `latest.yml` 在 Release 里不动，
新包同 appId 覆盖即可；`data.json` 与 profile 形态不变，所以降级回 1.7.5 不丢数据。

---

## 6. 待取读数（我取不到的）

1. WSL 首装的真实失败路径：发行版 No systemd、无 sudo、端口被占——需要一台干净 WSL 机器。
2. mac 安装包能否在未签名状态下被 Gatekeeper 放行（现状 README 已有 xattr 步骤，但要复验新包）。
3. 覆盖安装时子进程是否真被 `installer.nsh` 停干净（要真跑一次 NSIS）。

---

## 7. 实施记录（2026-11-07）

### M1 完成：网关宿主拆分

- `src/main/gateway/bootstrap.ts`：`bootstrapGateway()` + `installGatewayShutdownHandlers()`，
  Node daemon 与无窗 Electron 共用（`daemon/entry.ts` 已改为调用它，启动顺序与告警文案不变）。
- `src/main/gateway/entry.ts`：`--gateway` / `--init-local`，profile 钉 `<appData>/modelport`，
  `chat2api → modelport` 迁移只在这条路径上。
- `src/main/runtime/electronGatewayHost.ts`：无窗宿主；保留 `safeStorage`、文件对话框与系统打开器，
  `desktop` 包缺席（更新/窗口/托盘走控制台）。`host.ts` 因此拆出 `SystemCapabilities` / `requireSystem()`。
- 编排器 `src/main/index.ts` 改为 25 行 argv 开关，三个角色全部动态 import。
- 读数：`out/main/index.js` 430 B；`gateway.js` 9.6 KB 且无 `new BrowserWindow` / `new Tray(`；
  `shell.js` 仍无网关存储标记。隔离 profile 下真起 daemon：
  `/health 200`、`/ 200`、`/ui/ 200`、RPC 无口令 `401`、带口令 `200`，版本 1.7.5。

### M2 完成：控制台三形态

- 地址簿 `kind: local | wsl | remote`；旧文件按 `manageWsl === true ? 'wsl' : 'remote'` 迁移。
- `localGatewayPlan.ts`（纯）+ `localGateway.ts`（I/O）：spawn/健康/停止/端口归属/三态分类。
- 控制台窗口一律 `load <origin>/ui/`；本地口令经 `local-gateway.handshake`（0600，网关写）交给
  控制台密封后**删除**，用户不粘贴。
- 三种缺席各有自己的屏：未安装（可一键装）/ 已安装未运行（含重启）/ 在跑但不应答（含日志尾巴）。
- 空地址簿首启自动落一条本地条目——安装包从此就是「取代主应用」的那一个。

### M3 完成：WSL 首装（含 Node）

- `wslInstallPlan.ts`（纯）：UTF-16LE 解码、发行版表、Node 供给决策、SHASUMS256 校验、
  systemd 单元、首装脚本、回滚脚本、握手行解析。
- `wslInstall.ts`：探测（WSL / systemd / node / 已安装）→ 下载 + 校验（daemon 与 Node 各自拒绝无校验）
  → root 执行 → `--init-host` → 重启 → 等 `/health` → 返回口令；失败自动回滚且不动 `~/.modelport`。
- `daemon/entry.ts::initHost` 增加一行 `MODELPORT_HANDSHAKE {…}`（机器可读，不刮人类文案）。
- 共用传输抽到 `wslExec.ts`（`runWsl` / 下载 / sha256 / 路径映射），升级与首装共享同一校验规则。

### M4 完成：单产品发布

- 删除 `electron-builder.shell.yml` 与 `build:shell`；`package.json` 的 `build` 段成为唯一配置，
  `publish` 段删除（不再产生 `latest.yml`）。
- `release.yml`：三平台各一条 `electron-builder … --publish=never`，daemon 单独构建上传，
  其余资产按扩展名扫 `dist/` 并逐一生成同名 `.sha256` 后 `gh release upload`。
- 在线升级资产名改为 `ModelPort-<ver>-<arch>-setup.exe`；Windows 安装前先停本地网关子进程；
  macOS / Linux 明确返回「请从 Release 页面下载」而不是假装能静默装。
- `build/installer.nsh` 的静默安装后重启接到唯一打包配置（`nsis.include`）。

### M5 完成面与未完成面

已完成：README（中英）产物表与三形态说明、`AGENTS.md` 的发布/宿主不变量、`docs/features/wsl-daemon.md`
的三形态与 WSL 首装章节、旧 PLAN 的裁定更新；开发通路改为控制台 + Vite `/v1` 代理（与生产同一条
HTTP + SSE）。

**未做（有意留到下一次收口）**：删除 `src/preload/index.ts`、`src/main/window/manager.ts` 的窗口控制、
`src/main/tray/`、`src/main/updater/`、`electron-updater` 依赖、`window:*` / `app:{install,download}Update`
通道、`About.tsx` 的 `isDesktopApp` 分支与对应 i18n、`--desktop` 角色本身。理由是这些路径只在
`--desktop`（开发宿主）里可达，而发货产物根本不带这个参数；现在删会让开发态失去最后一个 A/B 参照。
删除前必须先确认开发通路在新控制台形态下稳定（见下一条未取读数）。

### 发布记录（v1.7.6，2026-11-07）

- 首次 tag 推送后 windows job 报 `release not found`：`--publish=always` 退役后**
  没有任何步骤创建 Release**，而所有上传都是 `gh release upload`，失败还取消了整个矩阵。
  修法是在 gate 与 release 之间加 `prepare` job（`gh release create --generate-notes
  --verify-tag`，已存在则跳过），提交 `72d2af3`；本次发布用同标签重跑（`gh run rerun
  --failed`）+ 手工建 Release，没有改版本号。
- 资产读数：Windows setup/portable、Linux AppImage(两种 arch)/deb/tar.gz、两个 arch 的
  daemon tarball，各自带同名 `.sha256`；构建侧不再产出任何 `.yml`。
- 兼容桥：≤1.7.5 的客户端用 electron-updater 读 `latest.yml` / `latest-linux*.yml`，
  而新控制台不读。为不让老用户失去应用内升级，本次**手工生成并上传**了这三份 yml
  （sha512 由发布侧 `.sha256` 交叉校验过的字节算出）。这是一次性桥，不是新的发布步骤。
- macOS：首次运行时两个 mac job 都被取消且无法在**已结束的 run** 上重跑（job 重新排队后随
  run 收尾又被取消）。按「同版本号重发」处理：删 Release + 删标签，在当前 main（含 `prepare`
  与 `fail-fast: false`）重打 v1.7.6 并重跑整条矩阵，本次两枚 dmg 都产出了。
- 发现一处冗余：`build.mac.target` 写死 `arch: ["arm64"]`，而矩阵又给了 `--mac --x64`，
  两者取并集 ⇒ **mac x64 那个 job 实际产出 arm64 + x64 两份 dmg**，矩阵里的 mac arm64
  job 是重复的（仍在排队，且反复被取消，使每次 release run 以 `failed` 收尾）。
  **收口（2026-11-07）**：`build.mac.target` 的 arch 改成显式 `["x64","arm64"]`，矩阵删掉
  mac arm64 行——只留一个 mac job，仍产出两份 dmg。
- 旧客户端的资产名：1.7.5 的壳（`com.modelport.shell`）只找 `ModelPort-Shell-<ver>-x64-setup.exe`，
  它在 1.7.6 上报「缺少安装资源或校验文件」——升级链路断在名字上，不是校验上。已补同字节别名
  （同名 `.sha256`，`parseSha256` 接受该格式），并把生成动作写进 Windows 打包步骤，
  注释与 `AGENTS.md` 都标了「旧壳清空后可删」。
- 另一个同类事实：旧壳装的是**另一个产品**（`com.modelport.shell`），新安装包是
  `com.modelport.manager`，所以升级完成后「ModelPort Shell」仍会留在程序列表里，需要手动卸载一次。
- 终局资产：**25 项** = 20 个构建产物（Win setup/portable、mac dmg×2、Linux AppImage×2/
  deb/tar.gz、daemon×2，各带 `.sha256`）+ 3 份一次性兼容 yml + 旧壳资产名的别名两份（exe 与 `.sha256`）。

### 仍未取到的读数

1. **本地形态的真机运行**：`ModelPort.exe --gateway` 会读写这台机器的真实 `<appData>/modelport` 与
   `~/.modelport`，我没有在你正在用的数据上跑它。产物级（无窗口/无托盘/密钥库在/无控制台 profile）
   与共享启动序列（daemon 实跑四端点）都已取到，缺的是这一格。
2. **WSL 首装的真机路径**：需要一台干净发行版验证无 Node、无 systemd、端口占用三条失败路径。
3. macOS dmg 在未签名下的 Gatekeeper 行为；NSIS 覆盖安装时子进程是否被停干净（要真跑一次安装器）。
