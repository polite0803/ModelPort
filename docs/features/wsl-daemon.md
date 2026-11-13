# 无头守护进程与远程管理

> 适用版本：v1.7.7 ｜ 最后核对：2026-11-08 ｜ 状态：现行

## 这个功能点是什么

网关进程（Koa 服务 + 供应商 + 路由 + 配额 + 渠道包 Worker）可以**不带任何窗口**运行，
由同一台机器或另一台机器上的图形界面管理。安装包是一个**控制台**，它自己不承载网关，
只负责启动、安装或连接网关：

| 形态 | 网关在哪 | 谁安装它 | 界面从哪来 |
| --- | --- | --- | --- |
| 本地 | 本机 `ModelPort --gateway` 子进程（同一二进制、无窗口） | 控制台首启 `--init-local`：建数据目录、写管理口令、起监听 | 控制台窗口 `loadURL` 到 `http://127.0.0.1:<port>/ui/` |
| WSL | WSL 内 systemd（`modelport-daemon-<ver>-<arch>.tar.gz`） | 控制台探测到不存在时全自动安装（含 Node），见下节 | 同上（NAT localhost forwarding） |
| 远程 | 另一台主机 | **控制台不安装**，只连接；面板行的「部署指南」给出 daemon 包 + `.sha256` 与部署命令 | 同上，地址由用户填写 |
| Docker | 有 Docker 的主机上的容器 | **控制台不安装**，只连接；「部署指南」给出镜像包 + `.sha256` 与 `docker load`/`run` 命令 | 同上 |

控制台本体是 `src/shell/main.ts`；本地网关入口是 `src/main/gateway/entry.ts`（Electron 无窗口，
因为 `store.key` 由 `safeStorage` 封装，纯 Node 宿主没有密钥库）。WSL 与 headless Linux 用
`src/main/daemon/entry.ts`（纯 Node）。三者共用 `src/main/gateway/bootstrap.ts`。

网关管理是控制台里的一页（`/gateways`），与其它页面共用外壳，列出地址簿里的全部网关：形态徽标、
运行状态、版本，以及按形态与状态给出的动作。入口有三个：托盘右键、快捷键 `Ctrl+Shift+G`、
**侧边栏底部的「网关管理」**。侧边栏入口只在控制台里注入（`window.modelportShell.gateways`
存在时）——同一页面用浏览器打开时不显示，因为浏览器里没有宿主进程。

托盘与快捷键先导航这一页；只有在主窗口当前显示的不是控制台页面（例如网关打不开时的失败页）时，才退回
`data:` 列表窗口（`shell:gateway-list-open`），那是唯一能在这时工作的界面。两个文档问同一组
`shell:gateway-*` 通道，主进程对调用方分两种校验：`data:` 列表窗口按身份信任（它的 origin 由
构造决定为 `null`），控制台页面是网关托管的远端文档，必须与更新动作一样证明自己是**当前网关**
的页面（`activeGatewayForSender`）。

- 公共：连接（当前网关除外）／编辑／删除（只删地址，不删网关）。
- 本机：启动／停止／修复／升级（与控制台同一个安装包）；未安装时给安装。
- WSL：装后给启动／停止／重启／升级／卸载；未安装或 WSL 不可达时给安装。服务态由
  一次 root `wsl.exe` 调用探得（`systemctl cat` + `is-active`），与 HTTP 探测并行；
  网关有应答时以 HTTP 为准（条目可能指向别的机器的 WSL）。卸载先从单元解析真实安装
  目录、确认后移除程序与服务，**保留 `~/.modelport`**。
- 远程：部署指南（下载链接 + 校验 + systemd 部署命令，由操作者在目标主机执行；
  控制台没有那台主机的凭据，不遥控）。

切换是对 `activeId` 的一次写入，主窗口随之重连。

关掉界面（窗口或标签页）**不影响网关继续服务**——这是这一条存在的全部理由。本地网关由控制台
以独立进程启动并常驻，关窗口只是隐藏托盘；WSL/headless 由 systemd 常驻。

## 安装与启动（WSL 实测过的路径）

tar.gz 解开后的布局：

```
modelport-daemon-<version>/
  modelport-daemon.cjs        # 单文件 bundle，运行时依赖全部内联（不需要 npm install）
  resources/channel-pack/     # 渠道包 Worker + wasm
  resources/catalog/          # 内置标准模型库快照
  renderer/                   # 管理界面（daemon 自己托管在 /ui/）
  bin/modelport               # 转发命令行
  systemd/modelport.service   # 单元模板（NODE 路径与安装路径要替换）
```

需要 Node 20+（实测用 22.14.0；`conf` 声明 `engines: node >= 20`）。WSL 里默认没有 node，
解一份官方 tarball 到 `/root/opt` 即可，不必动 apt。

常驻**必须用 system 作用域单元并 `enable`**：

```bash
sudo cp systemd/modelport.service /etc/systemd/system/   # 先把里面的 NODE 与路径替换成实际值
sudo systemctl enable --now modelport
```

`systemctl --user` 的单元会跟着启动它的那次登录会话一起结束；而发行版本身会在最后一个
WSL 客户端退出后被回收（`wsl -l --running` 能看到「没有正在运行的分发」）。两者叠加的结果
是「服务昨天还在，今天连不上」。`enable` 之后 `wsl --shutdown` 冷启动回来会自己起来。

## Docker 部署

与 systemd 形态同一份 daemon，只是跑在容器里。发布资产
`modelport-daemon-<ver>-docker-<arch>.tar.gz` 是 `docker save` 导出的镜像归档
（基础镜像 `node:24-slim`，与 `.nvmrc` 同基线），`docker load` 即用，不依赖 registry。
镜像由 `npm run build:docker` 构建（消费 `build:daemon` 的 staged 树，构建机要有
Docker daemon；CI 在 ubuntu runner 上构建并上传，WSL 开发机没有 docker 时该脚本明确报错）。

```bash
sha256sum -c modelport-daemon-<ver>-docker-x64.tar.gz.sha256
docker load -i modelport-daemon-<ver>-docker-x64.tar.gz
docker volume create modelport-data

# 一次性初始化：非回环监听 + API Key + 管理口令，打印 MODELPORT_HANDSHAKE 一行
docker run --rm -v modelport-data:/data modelport-daemon:<ver> --init-host --port 8080

# 常驻；宿主发布端口与容器监听端口保持相同（恒等映射）。
# 宿主 8080 被占时，把监听端口改成同一个空闲端口（--init-host --port 18080，
# 或管理 RPC config:update proxyPort），再 -p 18080:18080。不要做 18080:8080 这类
# 非恒等映射：控制台「监听端口」显示的是网关进程自己的端口，非恒等映射会让它
# 与客户端可达端口不一致（235 首装踩过，界面显示 8080 而可达的是 18080）。
docker run -d --name modelport --restart unless-stopped \
  -p 8080:8080 -p 8443:8443 -v modelport-data:/data modelport-daemon:<ver>
```

- **数据在卷里**：daemon 的数据目录跟 `homedir()`，容器里 `HOME=/data`，于是
  `data.json`、TLS 证书、ccr、日志全落在 `/data/.modelport`。命名卷升级重建容器不丢数据；
  换 bind mount 要先 `chown 1000:1000`（容器以 node 用户运行）。
- **升级** = `docker load` 新镜像 → `docker stop modelport && docker rm modelport` →
  用新 tag 重跑上面的常驻命令；卷不动。控制台不自动安装/升级 Docker 形态（与远程同档）。
- 管理口令在 `--init-host` 打印的 `MODELPORT_HANDSHAKE` 行里；重跑 init 会再打印同一行
  （只补缺失项，不覆盖已有 Key 与口令）。

## WSL 首装（控制台自动，v1.7.6 起）

网关不存在时，控制台（托盘 →「安装 WSL 网关…」或新增网关时选 WSL）会按顺序做：

1. `wsl.exe -l -v` 读发行版（**UTF-16LE**，按 UTF-8 解会得到一串 NUL）、`uname -m` 定架构；
2. `systemctl is-system-running` 确认 systemd 可用（否则给 `/etc/wsl.conf` 的 `systemd=true` 指引）；
3. `command -v node` 探测 Node；缺失或低于 20 时下载 nodejs.org 官方 tarball 并按 `SHASUMS256.txt` 校验，
   解到 `/opt/modelport/node`（不动 apt）；
4. 下载 daemon tarball + `.sha256`（缺校验文件即拒绝）；
5. root 执行：解包 → 写 system 作用域 unit（`ExecStart` 用实测 Node 路径）→ `enable` →
   `--init-host --port <port>`（写 `proxyHost=0.0.0.0`、API Key、管理口令）→ `restart` → 等 `is-active`；
6. 解析 `--init-host` 打印的 `MODELPORT_HANDSHAKE {...}` 一行，把管理口令封进控制台的密钥库，
   地址簿记为 WSL 形态。任一步失败会执行回滚（移除 unit 与 `/opt/modelport`，**不动 `~/.modelport`**）。

## 在线升级（控制台编排）

控制台的托盘和界面里的 About 页可以一键升级 **控制台 + 本机 WSL daemon**：

- 地址簿的形态本身就是授权：只有 WSL 形态的条目才会执行 `wsl.exe -u root` 的 daemon 替换；远程形态只升级控制台自身。
- 版本来自 GitHub Release 的 tag；资产名固定为 `ModelPort-<ver>-<arch>-setup.exe` 与
  `modelport-daemon-<ver>-<arch>.tar.gz`，每个资产必须带同名 `.sha256`，缺校验文件时**拒绝安装**。
- 安装控制台更新前会先停本机网关子进程：两者是同一个 exe，留着它安装器无法替换二进制。
- macOS / Linux 不自动安装更新（dmg / AppImage 没有静默安装通路），界面指向 Release 页面。
- daemon 升级会先解析 `systemctl cat modelport.service` 的 `ExecStart` 安装目录，备份到
  `<dir>.bak-<timestamp>`，停服、替换、启动，再等网关返回新版本；失败自动用备份回滚。
  版本化 symlink 布局会先 `readlink -f` 解析，避免把链接本身当成备份。
- 升级前会比较「本机 WSL daemon 版本」与「当前网关 URL 报的版本」，不一致时拒绝，
  防止把远程网关误当成本机实例后去替换本机 daemon。
- 控制台安装包用 NSIS `/S` 静默安装，随后控制台退出并由安装器重新拉起。`/S` 会跳过完成页的
  「运行应用」勾选框，所以自动启动来自 `build/installer.nsh` 的 `customInstall` 钩子；
  没有这个钩子的旧安装包只能手动启动一次。
  界面本身由 daemon 的 `/ui/` 托管，所以 **daemon 升级会同时更新壳里看到的 UI**；
  壳的 Electron/托盘二进制则跟随 Shell 安装包更新。
- 限制：发布物没有代码签名，SHA-256 只防传输损坏；GitHub 不可达时检查/下载会失败。
  没有第二份 `latest.yml`：Shell/daemon 走 GitHub Release API + `.sha256`，主应用的
  `latest.yml` 仍唯一。

发布流水线负责为两个资产生成 `.sha256`（见 `.github/workflows/release.yml`）。

## 三个命令行开关

| 命令 | 作用 | 注意 |
| --- | --- | --- |
| `--print-paths` | 打印版本、资源根、渠道包是否就位、数据目录、`store.key` 有无、密钥库可用性 | 排查「起来了但某块能力不见了」先看这条 |
| `--init-host` | 一次落 `proxyHost=0.0.0.0` + 一把 API Key + 管理面开关与 secret，并打印一次明文值 | 只补缺失项，不覆盖已有 Key 与口令；改完要重启服务 |
| `--import-backup <path> [--merge]` | 导入桌面端导出的备份件 | 口令走 stdin 或 `MODELPORT_BACKUP_PASSWORD`，**不走 argv** |

## 导入备份有三条入口，只有一条引擎

桌面的文件对话框、`--import-backup` 的路径、远程界面的浏览器文件选择器，三条都汇进
`src/main/backup/service.ts::stageBackupFile()`：格式判定、口令件、一次性 token 因此不可能分叉。

远程界面那条走 `POST /v1/management/backup/stage`（管理面鉴权与限流与其它路由同一套）：
页面用 `<input type=file>` 取操作员机器上的文件，把字节发过去，网关**自己**在数据目录里生成
`import.<uuid>.json`（0600），读进内存后立刻删除——客户端永远说不出落盘路径，超上限的流在
到达上限时就断掉，不留半份文件。导出没有对应的无头入口（界面里会直接这么说），
要备份请用桌面端导出，或直接备份该宿主的 `data.json` 目录。

## 管理口令存在哪里（以及为什么不总是存在）

| 客户端 | 存放位置 | 关掉之后 |
| --- | --- | --- |
| 浏览器标签页 | `sessionStorage`（按标签页） | 关闭即忘，下次要重输 |
| Windows 壳 | 系统密钥库封装（DPAPI）后存 `<壳的 userData>/secrets.json`（0600），按网关 origin 分条 | 下次启动自动取用，不再问 |

三条硬规则：

1. **壳里没有密钥库就拒绝写盘**。`safeStorage` 不可用时（无密钥服务的 Linux 桌面、受限账户）
   答案是「不存」，界面继续每次问 —— 绝不允许退化成明文落盘，也不允许假装已经记住。
2. **封装串绑定当前 Windows 用户**。把 `secrets.json` 拷到另一台机器或另一个账户下解不开，
   此时报 `unreadable` 并重新问一次，不静默当成「没有存」。
3. **只存在网关接受的口令**。`probeGateway` 成功之后才写盘；401 会同时清掉标签页副本和壳里
   的那条，否则每次启动都拿同一个被拒过的口令去撞。

地址簿（`gateways.json`）里永远没有凭据 —— 这条由 `tests/build/shell-entries.test.ts` 钉着。

## 必守不变量

1. **网关代码不许 import electron。** 宿主差异只经 `src/main/runtime/host.ts`（版本、资源根、
   外部浏览器、登录项、推送、密钥封装、`desktop` 能力袋）。当前闭包 146 文件 / 0 处 electron，
   `src/main` 里剩 9 个真桌面文件，这个集合本身被 `tests/build/daemon-bundle.test.ts` 钉住。
2. **`store.key` 在场而本机无密钥库 ⇒ 拒绝，不改名。** 机器封存的密钥在别的宿主解不开；
   把它当「文件损坏」走恢复流程会把 `data.json` 改名并新建空台账，用户看到的是「我的供应商没了」。
   配置跨机只有一条路：**备份导出/导入**（备份件由用户口令封装，与机器无关）。
3. **无密钥库主机上凭据是明文，且必须说出来。** daemon 启动日志、导入输出都点名目录与
   `chmod 700`；这不是可关掉的开关，是 `planKeySetup` 既有的降级分支。
4. **非回环绑定必须带 API Key**（`checkStartupSecurity`）。`--init-host` 之所以同时写两样，
   就是因为少了 Key 时 `start()` 直接拒绝监听——这是 fail-closed，不是 bug。
5. **管理面可调用集 = handler 注册表 − 两条安装级动作**（`app:installUpdate`、`app:downloadUpdate`）。
   不许再维护第二份清单；桌面专属能力在无头宿主回答 `desktop-only`，缺席通道回答 `unknown_channel`，
   两者与「没这个能力」文案互不混用。
6. **方法表只有一份。** `src/shared/api.ts` 是唯一的「方法 → 通道」映射，preload 与浏览器线各自
   注入自己的传输；141 处 `window.electronAPI` 调用点因此不需要知道自己在哪。
7. **`/ui` 免 API Key，与 `/`、`/health` 同一档。** 文档本身不含数据，页面每个调用仍需管理口令；
   在这里放 Key 只能进 URL，而 `?api_key=` 是明令禁止的形态。
8. **`latest.yml` 只能有一份。** 壳不带 `electron-updater`，CI 里也不给它 `--publish=always`，
   产物用 `gh release upload` 传——否则两个产品写同一个更新描述文件，主程序的自动更新会去下载壳。
   壳/daemon 的在线升级因此走 GitHub Release API + 同名 `.sha256`，不产生第二份更新描述文件。
9. **升级只对当前网关页面开放，且 daemon 只对显式 `manageWsl` 的条目执行。** IPC 入口检查
   `senderFrame.url` 的 origin 与地址簿中的活动网关一致；没有校验文件的资产不安装；daemon
   安装脚本在停服前打印备份路径，失败必须能回滚。

## 默认值

| 项 | 出厂值 | 说明 |
| --- | --- | --- |
| `proxyHost` | `127.0.0.1` | 宿主想连必须改非回环（`--init-host`） |
| `proxyPort` | `8080` | |
| `managementApi.enableManagementApi` | `false` | 关着时管理面一律 404 |
| `managementApiSecret` | `''` | 空值 + 开关开着 = 拒绝服务 |
| `store.key` | 无（无头主机） | 有则本机读不了，见不变量 2 |

## 代码落点

| 面 | 位置 |
| --- | --- |
| 宿主绑定 | `src/main/runtime/host.ts`、`electronHost.ts`；daemon 侧在 `src/main/daemon/entry.ts` 绑定 |
| Node 产物与 tar.gz | `scripts/build-daemon.mjs`（含 systemd 单元模板与 `bin/modelport`） |
| 管理面 RPC / SSE / 备份上传 | `src/main/proxy/routes/management/rpc.ts`、`events.ts`、`backup.ts` |
| 静态 UI 托管 | `src/main/proxy/routes/web.ts`（`/ui` 302 → `/ui/`，资产 `immutable`，逃逸 404） |
| 浏览器传输 | `src/renderer/src/api/headless.ts`、`src/shared/sseFrames.ts`、`src/renderer/src/components/ConnectGate.tsx` |
| 壳 | `src/shell/main.ts`、`addressBook.ts`、`secretStore.ts`、`preload.ts`、`promptPreload.ts`；打包配置 `electron-builder.shell.yml` |
| 在线升级 | `src/shell/updatePlan.ts`（纯逻辑）、`src/shell/updater.ts`（下载/校验/WSL 安装/Shell 安装）、`src/shared/shellBridge.ts`（桥接类型）、`build/installer.nsh`（静默安装后自启动）；测试 `tests/shell/update-plan.test.ts`、`tests/shell/update-surface.test.ts`、`tests/renderer/about-shell-update.test.mjs` |
| 门 | `tests/build/daemon-bundle.test.ts`、`daemon-import-cli.test.ts`、`shell-entries.test.ts`、`renderer-bundle-browser-safe.test.ts`、`tests/routes/management-rpc.test.ts`、`management-backup-upload.test.ts`、`tests/ipc/api-wire-single-source.test.ts`、`tests/renderer/headless-absence.test.mjs`、`tests/shell/secret-store.test.ts` |

## 排查

| 现象 | 先查 |
| --- | --- |
| 浏览器 `ERR_CONNECTION_REFUSED` | 服务在跑吗（`systemctl is-active modelport`）；绑的是不是 `127.0.0.1`（宿主连不上回环监听）；`--print-paths` 的 `dataDir` 对不对 |
| 起来了但渠道卡片全空 | `--print-paths` 的 `channelPack` 是否 `worker.mjs found`；资源根由 `MODELPORT_RESOURCE_ROOT` 覆盖 |
| 管理面 404 | `enableManagementApi` 是否被导入换回出厂值（导入是「备份里的配置全赢」，顺序应当**先导后 `--init-host`**） |
| 界面列表不实时刷新 | 事件流是否连着：`GET /v1/management/events` 要带 `X-Management-Secret` 头，`EventSource` 带不了头，必须 `fetch` 流读 |
| 宿主侧可达性判定 | 用 `curl.exe --noproxy '*'` 的 HTTP 码 + 宿主监听计数一起看；`Invoke-WebRequest` 受 WinHTTP 代理口径污染，`Test-NetConnection` 出现过假 True |
| `networkingMode=mirrored` | 本机实测：WSL 拿到与宿主 WLAN 同一个 IP，宿主连该地址只命中自己协议栈 ⇒ 拒绝。结论交由配 WSL 的会话给现值，不在此处下定论 |
