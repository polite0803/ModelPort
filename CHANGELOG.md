# Changelog

本文件记录 ModelPort（早期名为 Chat2API / Chat2API Manager）对用户可见的变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

条目按"为什么改、影响什么"描述；每条末尾括号里的短哈希指向产生该变更的提交，可在 `git show <哈希>` 中核对。
版本边界与溯源说明见文末。

## [1.7.7] - 2026-11-08

版本边界：tag `v1.7.7`（相对 1.7.6）。本版补齐控制台的多网关管理——面板、WSL 网关的
装后生命周期、远程部署指南——并修掉托盘里两个网关对话框点开即关。非破坏性升级，
数据、地址簿与已保存口令不受影响。

### Added（新增）

- 网关管理面板：托盘或 `Ctrl+Shift+G` 打开一个独立窗口，列出地址簿里的全部网关——形态徽标、运行状态灯、版本与地址，按形态给动作（连接／编辑／删除；本机再加启动／停止／修复，WSL 加安装）。切换只是对 `activeId` 的一次写入，当前网关不给「连接」，点一下不会把页面重载掉；动作文案随快照下发，用户文本一律 `textContent` 写入。(`92e654d`)
- WSL 网关的装后生命周期：已安装的行不再恒显「安装」，按探测到的服务态给 启动／停止／重启／升级／卸载。服务态用一条 `sh -lc` 脚本单次探测（`systemctl cat` + `is-active`），与 HTTP 探测并行且 HTTP 应答优先；卸载先从单元文件解析真实安装目录（手动部署的目录可能不在 `/opt/modelport`），确认框写明**保留 `~/.modelport`**，地址簿条目与管理口令不动。(`20444fb`)
- 逐行升级：托盘与面板行共用 `checkForUpdatesForEntry(entry)`——任何一行都能触发检查与执行；本地行点明「与控制台是同一个安装包」，WSL 行「可一并升级」，未托管的 WSL 行保持「只升级控制台」，远程行不给升级（升级控制台不是管理那台网关）。(`20444fb`)
- 远程网关的「部署指南」：拉 Release feed 列出 x64／arm64 的 daemon tarball 与 `.sha256` 下载链接，给出下载→校验→解包→写 systemd 单元→`enable --now`→`--init-host` 的可复制命令；feed 不可达时降级为 Release 页面链接。控制台没有远程主机的凭据，部署步骤交给操作者，不做遥控。(`20444fb`)

### Fixed（修复）

- 托盘「添加网关」「编辑当前网关」点开即关：对话框页的取消按钮写成 `onclick = send('cancel')`，赋值拿到返回值的同时调用已经在页面加载时发出，`settle(null)` 立即执行。取消改为函数引用（页面抽成 `gatewayPromptPage.ts`），托盘在窗口隐藏时先 `show()`（模态子窗的父窗不可见时对话框点不动）。(`3c13864`)

### Tests（判据）

- 全量 `npm run gate`：**1942 通过 / 0 失败，exit 0**（2026-11-08）。
- 新增门：`shell/gateway-list-plan`（动作矩阵覆盖各形态各服务态）、`shell/wsl-install-plan`（服务态解析、启停重启脚本、注入拒绝）、`shell/deploy-guide`（资产链接／校验命令／转义／降级）、`shell/gateway-manage`（通道注册、卸载确认与数据保留、具名桥接、页面分发）。

### 未取读数

- WSL 启停／重启／卸载只在脚本层断言过（正反向、等 active 的循环），尚未在一台真实发行版上执行整条动作链。

## [1.7.6] - 2026-11-07

版本边界：tag `v1.7.6`（相对 1.7.5）。本版是**破坏性**的发布形态变更：安装包从此是
控制台 + 网关安装器，原「主应用」不再单独发布。

### Added（新增）

- 控制台三形态：本地（同一个二进制以无窗口角色 `--gateway` 起独立网关进程，保住系统密钥库封装的 `store.key`）、WSL（网关装在 WSL 里）、远程（只连接）。窗口一律加载网关自己的 `/ui/`，三种「网关不存在」各自的画面与动作不同。空地址簿首启自动落一条本地网关，安装即等于「取代主应用」。(`2586da8`)
- 网关按需安装：本地形态首启执行 `--init-local`（建数据目录、生成管理口令、起监听），口令经 0600 一次性文件交给控制台密封后删除，用户无需粘贴；WSL 形态在网关不存在时全自动安装——读发行版与架构（`wsl.exe` 是 UTF-16LE）、Node 缺失或过低时装 nodejs.org 官方构建并按 `SHASUMS256.txt` 校验、daemon 包缺 `.sha256` 直接拒绝、写 system 作用域 systemd 单元、执行 `--init-host` 取口令、等 `/health` 应答；任一步失败自动回滚且**不动 `~/.modelport`**。(`2586da8`)
- 渠道页的自动领取签到积分现在显示逐渠道结果，以及「今天还有 N 个渠道未完成，稍后自动重试」；有待重试渠道时用 30s 慢轮询，而不是 5s 空转。(`061f57f`)

### Changed（变更）

- 发布收敛为单产品：删除 `electron-builder.shell.yml` 与 `build:shell`，`package.json` 的 `build` 段成为唯一配置；移除 `publish` 段，**不再产出 `latest.yml`**。CI 三平台各打一条安装包，daemon tarball 单独构建上传，其余资产逐一生成同名 `.sha256` 后 `gh release upload`。在线升级资产名改为 `ModelPort-<ver>-<arch>-setup.exe`。(`2586da8`)
- 安装控制台更新前先停本地网关子进程：两者是同一个 exe，留着它会锁住二进制；安装器随后重新拉起控制台，由它启动新版本网关。macOS / Linux 不再尝试静默安装，明确提示从 Release 页面下载。(`2586da8`)
- 地址簿以形态（`local` / `wsl` / `remote`）取代「允许在线升级此 WSL 网关」开关；旧 `gateways.json` 按 `manageWsl === true ? 'wsl' : 'remote'` 迁移。(`2586da8`)
- 自动签到改为**逐渠道**记账：每个渠道按 UTC+8 记自己的完成状态，失败或声明 `retryLater` 的留在待办，由 30 分钟的重试定时器（`DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS`）只重跑这些渠道；已完成的当天不再发请求，跨日后第一轮重跑全部。(`061f57f`)
- 开发通路改走生产同款传输：控制台窗口加载 Vite 页面，`/v1` 由 dev server 代理到本地网关（HTTP + SSE），不再依赖桌面 preload 的 IPC。(`2586da8`)

### Fixed（修复）

- Qoder 每日额度在 10:00（UTC+8）刷新前被记成「今天已处理」，导致当天新额度整天漏领：刷新前那一轮现在保留为待重试，10:00 之后自动补领。(`061f57f`)
- 自动签到「一个渠道成功就把当天记完成」：失败渠道当天不再重试，也不再有逐渠道结果；现在按渠道记账并按 30 分钟补领，全部完成后的重试轮是零上游请求。(`061f57f`)
- 本地网关的三种失败不再长得一样：未安装（可一键装）/ 已安装未运行（可启动，附退出后的日志）/ 在跑但 `/health` 不应答（列出进程与端口）。端口被占用时网关不会自行换端口。 (`2586da8`)

### 发布（Breaking）

- **主应用发布形态取消**：`ModelPort-<ver>-<arch>-setup.exe` 仍是唯一 Windows 安装包，但它装下来的是控制台；`ModelPort-Shell-*` 资产不再发布。appId 仍为 `com.modelport.manager`，老用户覆盖升级即可，`data.json`、`store.key` 与凭据不受影响。
- macOS / Linux 也出控制台（本地 + 远程形态；WSL 项只在 Windows 出现）；WSL / 无头 Linux 继续用 `modelport-daemon-<ver>-<arch>.tar.gz`。

### Tests（判据）

- 全量 `npm run gate`：**1892 通过 / 0 失败，exit 0**（build + build:daemon + 两个 `tsc` + 全量）。
- 新增门：`gateway-entry`（三产物与动态加载、网关角色无窗口/无托盘/保留密钥库）、`gateway/local-init`（首启计划与握手形态、状态文件拒绝坏数据）、`shell/local-gateway-plan`（未安装/未停止/不应答三态与 argv）、`shell/wsl-install-plan`（UTF-16LE、Node 供给、unit 与脚本同源、init 后才重启、回滚不动数据）。
- 实跑读数：隔离 profile 起 daemon，`/health 200`、`/ 200`、`/ui/ 200`、RPC 无口令 `401` / 带口令 `200`。

### 未取读数

- 本地形态的真机运行（`--gateway` 会读写这台机器的真实 `~/.modelport`，未在作者正在使用的数据上执行）。
- WSL 首装的真机失败路径（无 systemd、无 sudo、端口占用）。
- macOS dmg 的 Gatekeeper 行为与 NSIS 覆盖安装时子进程是否停干净。

## [1.7.5] - 2026-11-06

版本边界：tag `v1.7.5`（相对 1.7.4）。

### Added（新增）

- Windows Shell 在线升级：托盘「检查更新（Shell + WSL 网关）…」和设置 → 关于的「在线升级（Shell + 网关）」卡片可以同时升级 Shell 与标记为 WSL 托管的 daemon。Shell 读 GitHub Release API，下载 `ModelPort-Shell-<ver>-x64-setup.exe` 与 `modelport-daemon-<ver>-<arch>.tar.gz`，每个资产必须带同名 `.sha256` 才允许安装；daemon 安装前备份到 `<install>.bak-<时间戳>`，失败自动回滚，升级前还会比对「本机 WSL daemon 版本」与「网关 URL 报的版本」。(`0703641`)
- 壳安装包在静默安装后自启动：`/S` 会跳过 NSIS 完成页的运行勾选框，`build/installer.nsh` 的 `customInstall` 在静默安装结束时拉起新 Shell，升级后不会留下无窗口/无托盘的进程。(`0703641`)
- 地址簿新增每个网关的「允许 Shell 在线升级此 WSL 网关」开关（`manageWsl`，默认关闭）与 `wslDistro`；远程网关只升级 Shell，daemon 仍在宿主机手动升级。(`0703641`)

### Fixed（修复）

- 管理面自限流：8 小时窗口里 71 条 429（09:01 一分钟 50 条）都来自远程 UI 自己的刷新风暴。限额从 60/分钟提到 240/分钟，客户端对相同 `channel+args` 做在途合并并对 429 按 `retryAfterMs` 退避一次；Channels 的 `changed` 事件 1.5s 去抖、积分 fan-out 10s 节流、自动签到/登录轮询 2.5s→5s，ProxyStatus 5s→15s。(`0703641`)
- 首块后停摆不撤粘性：`qodercn/dmodel` 在 09:13/09:15/09:19 三笔都是 `reason:"sticky"`、`totalMs` 132s/182s/156s，超时只记了账号失败却没撤锚点。现在 `timeout` 与上游 `error` 也撤粘性，`client_gone` 保持不撤。(`0703641`)
- 上游目录缺失模型冷却：ModelScope/BazaarLink 的静态目录会把已下架模型一直当候选（8 小时里 ModelScope 11 次 400、BazaarLink 10 次 402）。命中窄口径目录缺失文案后，对 `(provider, model)` 记 6 小时冷却；只影响选路，不记账号故障，不影响 `/v1/models` 广告。(`0703641`)
- 日志 redaction 误伤：`missing_api_key: API key is required` 被键值对规则改成 `"[REDACTED]" key is required`（15 条 401 全是这个形状）。规则加词边界后不再命中 `missing_api_key` 内部的 `api_key`；正常 `api_key=...`/`x-api-key: ...` 不受影响。拒绝行同时补 `userAgent`，下次能直接指认未带 Key 的客户端。(`0703641`)
- 日志降噪：keychain 不可用的 stdout 警告只报一次；`desktop-only` 403 降为 info 且不写访问日志。(`0703641`)

### 发布

- CI 在 shell 与 daemon 步骤生成并上传同名 `.sha256`；`latest.yml` 仍然只有主应用一份，Shell/daemon 走 GitHub Release API + `.sha256`，不产生第二份更新描述文件。(`0703641`)
- 本版是首个带 Shell/daemon `.sha256` 资产的 Release；1.7.5 之前的 Release 没有校验文件，在线升级会拒绝安装并提示缺少校验。(`0703641`)

### Tests（判据）

- 全量 gate：**1852 通过 / 0 失败**，两个 `tsc` program 零报错；新增 Shell 更新计划/接线、About 合并升级、目录缺失冷却、粘性撤锚、redaction/UA 等测试。(`0703641`)
- 线上验证：壳桥接真实返回 `shell 1.7.4 / gateway 1.7.4 / managed:true`；用本地 1.7.5 假 Release 跑通完整升级（`daemonUpdated:true, shellUpdated:true`，daemon/Shell 均变为 1.7.5），随后恢复到 1.7.4；静默安装器自启动实测 `BEFORE=0 → AFTER=4`。(`0703641`)

## [1.7.3] - 2026-11-04

版本边界：tag `v1.7.3`。

本版每一项都由运行实例的证据驱动，不是预防性加固；证据数字写在各条里，可对着 `docs/audit/DEFECT_ANALYSIS_REPORT.md` 复核。

### Added（新增）

- 管理 API 速率限制：只作用于 `/v1/management` 前缀，按客户端 IP 计固定窗口，默认 60 次 / 60 秒，挂在鉴权之前（所以计数键只能是 IP）。理由不是「本地可信」，而是本机任意进程都能直连回环端口 —— 一段 `while true` 的脚本就能把含 `PUT /config` 的管理面打到主进程忙不过来，而这台机器上同时还在跑用户真正的推理流量。(`a966a57`)
- 账号渠道的服务清单预检：请求进入路由前先问渠道包「这一家愿意服务这个模型吗」，本地必败的名字不再打上游。带成功 30s / 失败 5s 的 TTL 与过期宽限期 —— 预检在选路热路径上，而一次 `bridge.models()` 的 RPC 上限是 120s，在请求路径上等目录读取等于把「一次本地必败」换成「一笔可能卡两分钟的请求」；所以过期只触发后台刷新，宽限期内旧清单照用，超过宽限期按未知处理（不剔除）。渠道包整组缺席记 `null` = 未知并放行，一次目录故障不许把整池打死。(`a966a57`)
- 未申报工具名诊断：客户端报 `Model generated invalid tool call: finish` 时，网关侧每笔都是 200、`endReason=done`、`sawDone=true` —— 是上游模型自己造了一个不在 `tools` 里的名字、客户端按自己的工具表拒收，而请求日志不记工具名，事后判不了这个案子。现在把「请求声明集」与「响应里真实出现的名字」的不一致记进日志。**纯观测**：不校验、不丢弃、不改写任何响应字节。(`a966a57`)
- 被网关拒绝的请求也进请求日志：这类请求没到供应商、没有路由记录，同一块面板上「客户端一直报错」与「这里没有流量」原本读不出因果关系；现在每笔拒绝带方法、路径、状态码、错误码与被点名的模型。(`a966a57`)

### Changed（变更）

- 主进程调试输出默认静默：打包后的主进程没有终端，`console.log` 只落进平台 stdout 捕获，Windows 上任何能读进程输出的程序都能看到账号名与映射到的模型名一类运行期情报。只在 `MODELPORT_DEBUG=1` 或 `NODE_ENV=development` 时输出。判据用 `=== 'development'` 而不是 `!== 'production'`：打包产物里 `NODE_ENV` 根本没设置，反向判断会让生产环境恰好落在开启分支上。(`a966a57`)
- 配置脱敏收进一个递归工具，管理 API 的 `/config` 响应不再自己写一份规则：敏感键在管理面响应、诊断包与应用日志三条出口上按同一套规则变 `***`。(`a966a57`)
- 探测新增两道纯判定 —— 模态闸门与确定性失败的终局结论。当天的读数里 100 条错误请求行有 73 条是 `kind:'probe'`，且按 provider 100% 全失败：SiliconFlow 32/32（上游原话 `Model does not exist`）、ModelScope 30/30（403 邮箱未验证）、讯飞星火 8/8（500 `AppIdNoAuthError`，而该 provider 当时 `enabled:false`）、阿里云百炼 2/2（400 产品未开通）。规划层此前每轮都重探这些条目，因为它只看「这个字段还没测出来」。终局结论只回答「当前能不能服务」，**永不**折成上下文窗口或输出上限，也永不进路由候选筛选与对外广告；缺席即未知、未知放行，判据只认已声明字段与 `declared` 置信度。(`a966a57`)
- 供应商状态巡检加进程内 5 分钟 TTL：Dashboard 每 60s 全量巡检 23 个 provider，等于每分钟 23 次整份 940KB 加密 store 的序列化 + 加密 + 原子重命名落盘，外加约 10 次真上游 `GET /models`；一天因此写下 3829 行 `Update provider` 日志，并有 1130 条 `slowRequest`（>1500ms）告警与这 23 连发全量写盘同时段集中。健康是分钟级够用的指标，不是实时量 —— 状态真的翻转时，请求路径上的 failover 会立刻体现。(`a966a57`)
- 标注页的覆盖口径重定义为「关键属性完整 / 待补」：分母只算适用行（聚合与自定义行的倍率不适用，不计入缺口），第三方旁表一类参考项单列为「参考」，不再把「只剩参考项没填」的模型说成不能路由。(`a966a57`)

### Tests（判据）

- 新增 108 条测试（门禁总数 1575 → 1683，本机全量 **1683 通过 / 0 失败**，两个 `tsc` program 零报错）：管理面限流、未挂载路径的 404、配置脱敏、探测模态闸门与终局处置、账号渠道服务前预检（含命名模型那一支）、provider 状态巡检缓存、未申报工具名审计。`koa-ratelimit` 作为新增运行时依赖同时进 rollup 的 exclude 名单与 `tests/build/main-bundle-deps.test.ts` 守卫 —— 外部化它会让安装包启动即 `ERR_MODULE_NOT_FOUND`，与 1.4.5 那次外部化 `electron-store` 是同一个坑。

### 文档

- 缺陷分析报告从仓库根目录归入 `docs/audit/` 并接入文档索引；10 份状态为现行的文档适用版本对齐到 `package.json` 的当前版本，消掉原先 8 份写 1.7.1、2 份写 1.7.2 的漂移。

## [1.7.2] - 2026-11-04

版本边界：tag `v1.7.2`。

### Added（新增）

- 模型元数据分层解析链（v1.7.1 首发，本版延续）：模型类型、输入模态、`vision` / `tools` / `reasoning`、上下文窗口、输出上限、消耗权重与免费位由一条带来源、置信度与 `asOf` 的解析链给出，优先级为**人工标记 > 上游声明 > 标准库 > 实测探测 > 家族规则 > 成本台账**；同字段取第一条有值的层，缺席不写默认值，权重与免费位拿不到就是 `unclassified`，绝不折算为 0。(`dd8bc97`)
- 标准模型库补全：models.dev / LiteLLM / OpenRouter 快照台账之外，抓取新增端点回退（主站失败依次尝试 jsDelivr 与用户配置的镜像，镜像只接受 https）与随包内置的 LiteLLM 快照 `resources/catalog/litellm.json`，全新安装、离线或三个端点都不通时仍有一份可用的候选台账；采用仍按字段写入 adoption ledger、可单字段或整模型撤销，标准库的许可与价格只作展示，不进入路由打分或计费。(`ed61a55`)
- 「全部补齐」重做为真正的后台批量任务：任务由主进程持有，同一时间只跑一份；界面只订阅进度，关掉再打开仍是同一份快照。支持暂停 / 继续 / 取消、失败项单独重试、断点续跑，自动跳过已停用或没有被任何路由引用的模型；探测是显式一次性开关，确认总量后不再逐模型弹窗。阶段、已处理数、成功 / 跳过 / 失败、已采用字段与探测用量都可见。
- 探测能力（v1.7.1 首发，本版延续）：上下文按 `4k→200k`、输出上限按 `1k→32k` 阶梯向上试，给出「≥64K, <128K」式区间结论；429 / 401 / 403 / 5xx / 网络错误 / 超时一律 `inconclusive` 且不写上限，本地准入与额度闸门记 `deferred`；探测流量与真实流量隔离，不记账、不计统计、不触发冷却。(`dd8bc97`、`713dc51`)
- 实测探测读数参与选路：探测层插在「标准库采用」与「家族规则」之间，带窗口的长请求会在本地淘汰装不下的候选，而不是发出去吃一次上游 context 类 400 再换家；过期行与非 `measured` 行不进入这一层。每轮响应新增 `X-ModelPort-Context-Window`，中途换到更小窗口的模型时客户端可据此调整压缩时机。(`f16f5aa`)
- 完整备份与迁移：设置 → 数据安全新增整份导出 / 导入，覆盖供应商、账号与解密后的凭据、配置与路由、模型标注、标准库采用台账、渠道登录态，可选统计、Token 账本与日志；支持明文与口令封装（scrypt + AES-256-GCM），导入前给出文件自带的计数预览，支持覆盖与合并两种语义。覆盖模式落库前先留 `data.pre-restore.<时间戳>.json`。导入必须重启后生效。

### Changed（变更）

- 对外广告的判据从「按来源标签放行」改为「按误差方向放行」：人工标记、上游声明与 `probe` 的实测下界可以承诺给客户端；家族规则、标准库快照与第三方旁表只进路由内部与界面。要对外承诺某个标准库值，通路是把它改写成人工标记。`AutoRouteDecision` 因此并排 `contextWindow`（日志与界面）与 `advertisedContextWindow`（响应头），两者不许互换。(`f16f5aa`)
- LiteLLM 抓取口径收窄并补诊断：`mode` 只保留 `chat` / `vision`（缺 `mode` 的旧条目按对话模型保留），输入 / 输出上限按字段直取、不做二次推断；重定向改为手动逐跳跟随（不把凭证带去跨域目标），失败结果按每次尝试记录 `attempts`，界面能显示每一跳失败在哪。
- 标准库镜像地址在配置写入侧清洗：只接受 https，非法或非字符串一律丢弃，管理 API 不会报告一个没人读的值。

### Fixed（修复）

- 批量补全的部分成功不再被当成整体失败：成功 / 跳过 / 失败三态分别累计并汇总，单个模型失败不中断整轮。
- 标准库采用台账的归属键补上供应商与显示名：同名模型跨供应商时不会再串台，撤销只影响对应的那条采用。
- 探测相关的网关自撰文本纳入 `GATEWAY-TEXT` 登记与两向对账测试，避免新文案绕过受控集合。
- 探测任务裁剪改按 `startedAt` 排序并优先删已结束任务；所有任务都在跑时按上限收敛最旧记录，但只移除可查询性、不中断真实请求。进度广播对每个窗口单独 `try/catch`，单个窗口销毁不再打断推送。
- 跨平台测试稳定性：调度器测试改用注入的假时钟，换行断言先规范化 CRLF 再匹配，Windows 检出不再因时序与换行失败。(`7da99be`)

### Tests（判据）

- 新增标准库解析、端点回退、adoption 归属、批量补全三态与断点续跑的测试；`tests/backup/` 覆盖备份格式解析、口令封装 / 解封与落库前清洗三条纯逻辑路径。备份的 UI 流程（原生选文件、覆盖 / 合并确认、重启）没有自动化测试，只有主进程编译与手工核对覆盖。

### 适用范围与已知限制

- 备份文件含**明文**账号凭据；不带口令导出的文件应视为敏感数据。`store.key`、会话、额度账本与 `derived/` 快照不进入备份，导入后需要重新登录渠道或等待快照重建。
- 合并模式本地优先，统计、日志与渠道登录态不落库（统计相加会把同一批请求记两遍，渠道包是整份替换语义）；需要完整状态时用覆盖模式。
- 备份线目前只有纯逻辑测试，端到端导入流程未纳入 CI。

## [1.7.1] - 2026-11-04

版本边界：tag `v1.7.1`（重发；首个 1.7.1 的 tag 指向 `70eb487`，那一批 17 个产物已作废）。

### Added（新增）

- 模型元数据自动标注：模型类型、输入模态、`vision` / `tools` / `reasoning`、上下文窗口、输出上限、消耗权重与免费位不再只靠人工逐条填，改由一条带来源、置信度与 `asOf` 的解析链给出，优先级为**人工标记 > 上游声明 > 标准库 > 实测探测 > 家族规则 > 成本台账**。同字段取第一条有值的层，缺席的层不参与、不写默认值；权重与免费位拿不到就是 `unclassified`，绝不折算为 0。模型页新增「标注」标签页，逐属性显示取值与出处。(`dd8bc97`)
- 手动探测：对单个模型发可达性、工具调用接受性、图片输入接受性三条极小请求；上下文窗口按 `4k→200k`、输出上限按 `1k→32k` 阶梯向上试，取首个明确超限档的前一档为下界、失败档为上界（如「≥64K, <128K」）。发请求前界面确认框给出「请求条数上限 + 输入/输出 token 预估」，用户确认后才发；命中家族规则或声明推定值时只试相邻三档。429 / 401 / 403 / 5xx / 网络错误 / 超时一律记 `inconclusive` 且**不写任何上限**，本地准入或额度闸门命中记 `deferred`，不抢占真实流量、不触发冷却。已有声明级来源的模型默认跳过并明示「已声明，无需探测」，`force` 才重测且只新增 `measured` 证据。(`dd8bc97`)
- 探测流量与真实流量完全隔离：探测请求带 `probe: true`，跳过派发账本、AIMD/Bandit/冷却与上下文裁剪；请求日志行标 `kind: 'probe'`，不计入请求统计。全局串行队列保证同一模型串行、跨模型并发上限 1。(`dd8bc97`)
- 探测有可见进度、可取消、有超时上界：探测登记为主进程的后台任务，弹窗显示阶段（准备 / 第 N 档 / 等待响应）、已用秒数与已发请求数/上限，并提供「取消探测」——取消只停止后续档位，已完成档位的结论照常保留；关掉弹窗再打开会回显同一个任务（`providers:getProbeJobs` 回读进行中与最近完成，进度经 `providers:probeProgress` 单向推送）。超时显式分两段：单请求 30s、整体 5min，超时一律按 `inconclusive` 收敛而不无限等待；401/403、429、5xx、网络不可达与超时在界面上分别成句（鉴权失败 / 被限流 / 上游错误 / 网络不可达 / 上游超时）并各自给重试入口，不再是一句笼统的失败。(`713dc51`)
- 一键补全：待标注队列新增统一入口。预演**只读本地标准库候选、不联网**，先列出模型数、预计采用字段数、探测请求条数与 token 合计，逐模型可勾选——`exact` 默认勾选、`alias` 提示确认、`family` 默认不勾选。执行跨模型串行（并发 1）、可暂停可取消，逐模型显示待处理 / 匹配中 / 探测中 / 已完成 / 跳过 / 失败，单个模型失败不中断整体，结束后汇总成功/跳过/失败。采用仍是逐字段写入 adoption ledger、可撤销；已声明字段（含人工标记）不进入候选采用列表。(`713dc51`)
- 标准模型库：新增 models.dev（主）、LiteLLM、OpenRouter 三个可选来源的快照台账，落盘 `~/.modelport/derived/model-catalog.json`，属可删除重建的衍生数据。打开页面不联网——唯一的网络路径是用户点击的「刷新」；刷新失败（非 2xx、超时、JSON 损坏、解析为空）保留磁盘上的上一份快照；写入用唯一临时文件 + rename 且只覆盖被刷新的来源。外部数据逐字段校验（正整数、上下文 ≤1 亿、输出上限 ≤100 万、价格 0–1000 万 USD/1M、模态只接受已知集合），元数据字段缺一即整份降级为空台账，界面显示「尚未抓取」而不是报错。失败结果带 `errorKind`（`network` / `timeout` / `http` / `parse` / `empty`）与耗时：HTTP 非 2xx 附响应体前 200 字符，网络失败带 `cause.code`，超时写明 60s 上限；界面按来源分别显示原因，单个来源失败既不影响其它来源也不清空整份快照。(`ed61a55`、`713dc51`)
- 按字段采用、可撤销：采用记录写在 `data.json::catalogAdoptions`，与手工标注 `userModelMarks` 语义分开，同步与快照刷新都不会擦除；同 `(供应商, 模型, 字段)` 只留一条，重复采用覆盖旧值。可撤销单字段或整模型全部字段，撤销后立即回退到自动解析结果。auto 路由的候选过滤与打分只消费已采用的条目，快照里未被采用的候选不参与；标准库的价格与第三方许可只作展示，永远不进入路由打分，也不参与计费。(`ed61a55`)
- 渠道包模型清单同步除 `context_window` 外也读取 `max_output_tokens`（同样只认上游明说的数，缺失保持未知）；路由池编辑器补上输出上限的人工标记入口，留空即「未标注」，非数字 / 0 / 小数 / 超上界都被拒绝并给出原因。(`dd8bc97`)
- 仓库治理面补齐：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、PR 模板、Dependabot、`CODEOWNERS`、`.editorconfig`、`.nvmrc`；`package.json` 补 `repository` / `bugs` / `keywords`；CI 与发布工作流统一从 `.nvmrc` 读取 Node 24，消掉本地最低版本与门禁版本的漂移。(`05b944d`)
- 文档：`docs/` 按 `design/`（方案）/ `plan/`（计划）/ `audit/`（审计）重组，每份文档补「适用版本 / 最后核对 / 状态」元信息块，索引按「覆盖 `docs/` 下每一份文档、没有孤立文件」重新核对；README 中英双版、代码概览与文档索引统一；新增 `docs/features/` 四篇按功能点成篇的功能手册（桌面界面与更新、HTTPS 与证书信任、日志与诊断、渠道与账号），写行为、必守不变量、配置默认值与代码落点。(`9a82a8c`、`b454fa9`)

### Changed（变更）

- 推定值不出现在对外响应：新增的 `catalog` / `probe` / `family-rule` 三层只进路由过滤打分与界面，`/v1/models` 的 `context_window` 仍只输出声明级事实（供应商官方声明或人工标记），没有时省略键——沿用既有对外门槛，本次把它写进设计文档并让新增层遵守。(`dd8bc97`、`ed61a55`)
- LiteLLM 台账的取数口径收窄：只保留 `mode` 为 `chat` / `vision` 的条目（`embedding` / `rerank` / `image_generation` 这些不是对话模型，混进来只会稀释候选；缺 `mode` 的老条目按对话模型保留），输入/输出上限按字段直取，不做「上下文减输出」之类的二次推断；原始文件约 3.2MB、4,500+ 条，抓取显式跟随重定向并带产品 User-Agent，整体超时放宽到 60s 给慢链路留余量。价格换算固定为「先按上限反推（`max / 1e6`）避免先乘后溢出，再乘 1e6 并保留 6 位小数」，超上限的字段丢弃而不是截断成上限值。(`713dc51`)

### Fixed（修复）

- 调度器与代理测试的两类不稳定：调度器测试此前用真实 `setTimeout` 赌并发时序，换行相关断言又只匹配 `\n`，在 Windows 的 CRLF 检出下必挂。给 `Scheduler` 注入最小时间源接口（生产默认仍是系统时钟，调度语义不变），测试改用假时钟做精确断言；proxy 测试先把源码换行规范化再匹配。(`7da99be`)

### 本版为 v1.7.1 的重发

首个 1.7.1 于 2026-11-04 发布后，`main` 上又落了一批元数据线的收口（探测进度与取消、超时收敛、一键补全、标准库失败分类与 LiteLLM 取数口径），按用户指令以**同一版本号**重发。`package.json` 的 `version` 未变，因此**已装上首个 1.7.1 的机器不会收到更新提示**，需要手动下载本版产物；旧 tag 的 17 个产物已随重发作废。

## [1.7.0] - 2026-11-04

版本边界：tag `v1.7.0`（`326f734`）。

### Added（新增）

- 供应商模型清单定时刷新：账号渠道、聚合目录、内置三类来源收进统一调度器，按天/周/月周期在内存中预热，设置页可选周期；同时修掉 Node `setInterval` 的 2^31-1 毫秒上限问题——1/3/6 月档位此前会退化成每毫秒打上游。(`78c3f13`)
- 路由"份额轮转"：auto 候选链改为整池展开，按 30 分钟滚动窗口内每个（供应商, 模型）的派发次数排序，手动添加的模型不再在第一轮就被同账号的高分模型挤掉；新增 `ModelRoute.fairnessLead`（默认 2、上限 20）可调份额领先档；请求日志新增 `chainLength`/`skipped`，日志里的 10 个候选名不再被误读成"池子就这么大"。(`7d9cd47`)

### Changed（变更）

- 换家循环不再把候选链裁到 `maxAttempts + 3` 家，整条排序结果交给换家：可恢复失败由墙钟预算收口，账号故障由账号上限收口；单次请求最多记录的失败尝试数 8→20。(`7d9cd47`)
- 补齐 BazaarLink 402（credits）的说明文案，并把某渠道"所有通道对该模型均受限"从普通 502 中摘出，避免一家渠道受限就吃掉整个账号故障预算。(`7d9cd47`)
- 客户端识别补充 DSH UA 的 `deepseek-harness` 标识。(`7d9cd47`)

### Fixed（修复）

- 注销定时任务后不再续订 `setTimeout` 链（此前注销后仍会再跑一轮）。(`7d9cd47`)

## [1.6.1] - 2026-11-03

版本边界：tag `v1.6.1`（`42c1697`）。

### Fixed（修复）

- 主进程"选号卡顿"：加密 `electron-store` 每次 `get` 都要整份读盘 + PBKDF2 + AES 解密，选号闸门按候选逐条查询，一次请求约 750 次整库解密并卡住主线程；改为一次选号复用余额快照与账号表，并新增成本门测试。(`3a19a71`)
- 上游目录不认模型（ModelScope / BazaarLink 的文案）时按能力类 400 换下一家，不记账号失败；probe 的错误帧同样保持 400。(`3a19a71`)
- SiliconFlow 官方 `/user/info` 已下线（HTTP 410），撤下其额度探测声明。(`3a19a71`)

## [1.6.0] - 2026-11-03

版本边界：tag `v1.6.0`（`5fe993e`）。

### Removed（移除）

- 网关不再向模型注入任何提示词（裁定：本网关不注入任何提示词）。退役四条通路：托管工具提示词、尾随 user 守卫、输出风格转向、上下文摘要，连同 UI、配置键与测试一并删除；不支持工具的模型改由能力路由（`needsTools`）处理；退役配置键在 `normalizeConfig` 中剥离，管理 API 不再报告没人读取的开关。(`f6b7f1b`)

### Added（新增）

- 协议正确但内容退化的流成为第二类 degraded：对拼接后的 `content`/`reasoning` 增量做尾部 128 行去重比，命中即撤销粘性锚点；读数只以聚合形式落到 `streamTrace.repetition`，非流式响应不参与判定。(`f6b7f1b`)
- 新增日志/搜索压缩器与 CCR 存储接线，压缩节省可被真实计量。(`f6b7f1b`)
- 新增 `GET /v1/api-definition/providers`：以网关自定义形状列出可用路由名与保守的 `context_window` 下界，口径与 `/v1/models` 同源。(`f6b7f1b`)
- Bandit 成功率改 Beta 后验采样（Thompson sampling）：强候选大概率得高分，弱候选保留探索概率；连续退化、尝试连败与显著慢仍走确定性罚项，避免随机性稀释事故证据。(`de41a61`)
- 聚合目录新增国内主站与套餐端点：百炼按量 / Token Plan、火山方舟按量 / Agent Plan、阶跃星辰 / Step Plan、讯飞星火、零一万物、百川、硅基流动中国站共 10 条；套餐与按量严格分条，避免 Key 混用走错计费域，四类订阅端点标为 included。(`e3fe5c1`)

### Changed（变更）

- 客户端显式选择推理档位（`reasoning_effort`）的请求按能力对待：候选明确不接受该参数时，400 改判为"换一家"，不再整单失败。(`7b2c82c`)

### Fixed（修复）

- 聚合额度查询失败改为保留上游原话并先脱敏，界面能区分"Key 无效"与"端点异常"；401 正文反射的 Key 不会随 IPC 到界面。(`194419c`)
- 补 en/zh 叶子键一致性门并清理孤儿文案，避免新增文案只落一种语言。(`5fe993e`)

## [1.5.5] - 2026-11-03

版本边界：tag `v1.5.5`（`dfde837`）。

### Added（新增）

- 粘性改为路由级开关 `ModelRoute.stickyHardPin`（缺省即开，`!== false` 判据，老 `data.json` 不需迁移）；关掉后只剩 `+0.12`/`+0.06` 的分数加成，预设播种继承该格，避免用户关掉的硬钉被下次播种悄悄打开。(`9c1115d`)
- 聚合实时额度接通：聚合详情页点一次问一次（无轮询、开页不自动发）。实时余量只当闸门不当数字——美元额度、人民币余额与本应用 token 是三个不可比的计数域；命中条件严格（整行成立、非 unlimited、问到数、`<=0`、`asOf` 在 15 分钟内），命中只把 `aggregateHeadroom` 折成既有的 `-1`，`QuotaWindowBlockReason` 增加 `no-credit`。(`9c1115d`)
- `GET /v1/models/:model` 按 `anthropic-version` 返回 anthropic 形状，且与清单行同源，避免"列表承认、单查否认"。(`9c1115d`)
- 粘性键升级为客户端会话标识（`prompt_cache_key` → `user` → `metadata.user_id` → `session_id` 头），优先于内容指纹：agent 客户端自行压缩历史后不再把会话换到别家；来源写入日志 `auto.sessionKeySource`，标识值本身不入日志。(`69a0686`)

### Fixed（修复）

- Codex 的 `apply_patch`（自由文本工具）两端按 `custom` 形状处理：入向补必填字符串 `input` 契约，出向回 `custom_tool_call` + 原文，历史里的 `custom_tool_call`/`custom_tool_call_output` 也读回；修掉"总说完成、文件没变"的静默失败。(`213ddb5`)
- HTTPS 的系统信任库不等于"客户端能连"：补齐 `NODE_EXTRA_CA_CERTS` 通路、`GET /v1/management/tls/ca`（只回 PEM，不带私钥）与 `/v1/management/tls/status`（握手被拒计数），Node 系客户端（Codex CLI、WorkBuddy 等）不再静默连不上。(`fda4d81`)

## [1.5.4] - 2026-11-03

版本边界：tag `v1.5.4`（`3ee88f6`）。

### Added（新增）

- 上下文窗口读数：只让已公布窗口参与 `/v1/models` 下界，一家都没公布就省略 `context_window`；"没公布上限"也不再作为淘汰候选的依据，避免长上下文请求被整池误杀成 503。(`ef51ee0`)
- 每轮读数：`shared/requestContextFit.ts` 估算入量、窗口与 fits/overflow，写进请求日志并在详情页分三档显示；估算值绝不进 `usage`。(`ef51ee0`)
- "装不下就换家"：`isContextOverflowError` 认 OpenAI、Anthropic 与中文的超限文案，接进能力不匹配的四个调用点，换下一家且不给账号记冷却；无关 400 仍然终止。(`ef51ee0`)
- 池策略预览透出 `conflicts`：哪条策略、新纳入多少、各自不满足前面的哪几条，便于解释"怎么又落到免费弱模型"。(`76c440a`)

### Fixed（修复）

- 池策略"或"的提示只报跨类作废：成本/档位/渠道类的 `or` 作废能力筛选时才提示；同类并集是 low-cost、vision-first 等预设的本意，不再狼来了。(`64b3630`)

## [1.5.3] - 2026-11-03

版本边界：tag `v1.5.3`（`d18cd7e`）。

### Added（新增）

- 质量感知降权与按模型 AIMD 并发：`finish_reason=length` 且客户端未请求 `max_tokens` 记为 degraded，连续两次即时降权；每（账号, 模型）默认并发 4，拥塞 ×0.7（5s 冷却），5 次干净成功 +1（30s 静默期）；本地准入拒绝返回可重试 429 `local_concurrency_limit` 且不惩罚账号；短窗口 EWMA 首包延迟与 429/超时/degraded 率进入候选打分。(`bf25f02`)

### Changed（变更）

- Codex 会话粘性改为路由层硬优先：同一会话上一轮成功的模型排到候选队首，避免 agent 每轮换模型导致上下文与工具协议漂移；模型停服/冷却时自然让位。(`dd7adf4`)
- 账号渠道默认工具能力改为 yes。(`33e3aa2`)

### Fixed（修复）

- 工具定义清洗：清掉 Codex 空名 `tool_search` 占位与缺 `parameters` 的定义，修 Raccoon 502 与 Agnes 400；WorkBuddy 11140 的 HTTP 400 按账号风控换号并冷却；OpenCode 匿名槽全部限流时报 429 而不是伪装成"重新登录"；Qoder 池内账号全不可用时不回退默认凭据；Bandit 将失败尝试计入候选健康分。(`63a1543`)
- 余额门控渠道统一在池耗尽时抛出：全部限流保持 429，池内有账号但全不可用直接 403 并说明余额/停用/凭据原因；只有池内完全没有账号条目时才允许历史单凭据回退。(`b46fd4c`)
- 校正 Codex `exec_command` 的 shell/workdir，Windows 客户端一律改用 `pwsh`。(`5f9880d`, `d18cd7e`)

## [1.5.2] - 2026-11-02

版本边界：tag `v1.5.2`（`fff1380`）。

### Changed（变更）

- 对齐 new-api 的错误/换家/协议语义：保留上游 `status`/`type`/`code`/`param`，403 不再改写 401；流内错误帧收尾并支持 200 首帧探测；客户端错误不再误伤账号；流式增加心跳与静默看门狗；Anthropic/Responses 补齐 thinking、工具结果附件、cache usage 与 reasoning。(`0e0cc6b`)
- 请求日志补尝试链、流生命周期、错误栈、诊断包与单请求 trace；崩溃与 worker 日志落盘；代理设置页等持久化配置加载后再渲染，修掉"重启后被默认 127.0.0.1 / HTTPS 关闭覆盖"的问题。(`0e0cc6b`)

### Fixed（修复）

- Anthropic 连续 user 轮按官方语义合并：Claude Desktop 3P 先发"上下文 + 问题"再发环境说明，原样转 chat 会被多数上游只读最后一条，导致每轮都答"你想做什么"。(`8adc746`)
- OVH 拒收 `prompt_cache_key`，该聚合条目用 `dropParams` 剥离。(`fff1380`)

## [1.5.1] - 2026-11-02

版本边界：tag `v1.5.1`（`cf3f94a`）。

### Added（新增）

- 路由可被 Anthropic 客户端按档位发现：`routeTiers` 发 `anthropic_family_tier`，`routeDisplayNames` 控制清单行显示名；非法档位宁可不发，避免客户端整行丢弃。(`16914c5`)
- 新增只允许一跳的池引用 `basedOnRoute`：一条路由可整体借用另一条的选择行为（池策略、钉名、手动增删、打分档、尝试数、粘性），但名字与日志仍是自己的；写入侧拒绝自引用、未知目标与二级引用，引用断掉时返回 404 `route_reference_broken` 并点名，不静默回落全目录。(`16914c5`)

### Changed（变更）

- Anthropic 配置卡片只保留一张名字表，每行直接给"在 Claude 里点不点得到"；补客户端名改为随保存自动完成；档位表补三列表头；"全 0"时明确说"无事可做"而不是报失败。(`b81f89b`, `1aa6a24`, `ffe0966`, `dacc29d`)

### Fixed（修复）

- 聚合条目返回空错误体（Unknown error）的 400 继续换家且不计账号故障；自动路由试过多家仍 404 时返回 503 `no_available_model`，避免 Claude 误判模型被删；Anthropic 兜底只解析 routable 路由；客户端断开产生的 ECONNRESET/EPIPE 记 debug；滑动窗口裁掉全部非 system 消息时保留最新一条。(`cf3f94a`)
- 流式 4xx 交出上游原文，不再把"序列化失败"当原因；Anthropic 入向不再透传客户端的 `device_id`/`session_id`（OVH 会以 extra arguments 整笔拒绝）。(`03ac9f0`)

## [1.5.0] - 2026-11-02

版本边界：tag `v1.5.0`（`dd6d273`）。

### Added（新增）

- HTTPS 监听（默认 8443，与 HTTP 共用同一套 Koa 中间件与路由）：首次启用自动生成本机证书（SAN localhost/127.0.0.1/::1，397 天，到期前 7 天重签，落 `~/.modelport/tls/`），也支持成对填写自有 PEM；设置页提供开关、端口、证书状态与"安装到系统信任"（Windows certutil、macOS `security`、Linux 给命令），只在用户点击时改动信任库。(`571e673`)
- 证书可加入远程地址（`httpsSanHosts`，IP 走 SAN type 7、域名走 type 2）；重签判据从"快过期"改为"是否覆盖当前名单"，名单不变时指纹稳定，不会每次启动作废已装好的信任；新增"从系统信任移除"。(`dd6d273`)
- 渠道按上游能力决定签到按钮：`ChannelDefinition.dailyCheckin` 必填，判据是渠道包 `credits.claimAll` 有无该家分支，没有接道的渠道不再点出 `unsupported provider`。(`dd6d273`)

### Changed（变更）

- 凭据加封 `v1:` 前缀；解不开的密文按"凭据不可用"返回并留错误日志，不再把一串 base64 当明文发给上游；编辑账号不再把已存凭据下发渲染层；Anthropic 路由播种带 `skipNames`，用户删掉的名字不复活；全新安装且无 Key 时生成一把。(`571e673`)
- 新增依赖 `selfsigned`，并按 `electron-store` 同一理由打进主进程 bundle（安装包内没有 `node_modules`）。(`571e673`)

### Fixed（修复）

- Windows 撤销信任不能直接用 `certutil -delstore`：实测序列号不匹配时仍返回 0 并删掉库中第 0 条；改用按 SHA-1 精确过滤的 PowerShell 删除。(`dd6d273`)

## [1.4.11] - 2026-11-02

版本边界：tag `v1.4.11`（`201a3bd`）。

### Added（新增）

- 新增 `/v1/responses` 入向：翻成 chat 请求回环到本进程，`usage` 缺失保持 `null`，`response.completed/incomplete/failed` 三选一，`previous_response_id`/`background`/`item_reference` 显式 400。(`74ec217`)
- Anthropic 模型发现改为生成 pinned 路由而非别名；`/v1/models` 只剩路由后，Claude Desktop 仍能按真实模型名选中。(`74ec217`)

### Security（安全）

- 渲染进程开启 sandbox；导航只认建窗时登记的应用自身文档（原 `file://` 前缀判据允许磁盘上任意 HTML 带着本应用 preload 被加载）；IPC 经 `trustedSender` 校验 senderFrame；`openExternal` 只认 http(s)；拒绝 attach webview。(`74ec217`)
- CORS 撤掉"没配 Key 就回 `*`"（出厂默认无 Key 时任何网页都能读走完整响应），`/stats` 不再免鉴权；管理 API 密钥改常量时间比较；自定义厂商头共用禁头清单；导出件脱敏自定义头里的凭据（Key 常被写进 `x-api-key`）。(`74ec217`)
- localStorage 与配置导出只保留界面偏好，含 `apiKeys`/`managementApiSecret` 的 config 不再落浏览器存储；请求/应用日志改为"先脱敏、再截断"，补 Bearer、裸 `sk-`、URL 查询串三类。(`74ec217`)
- dev server 默认只绑 127.0.0.1（`MODELPORT_DEV_HOST` 显式放开）；不再替 root 自动加 `--no-sandbox`；同时在途请求封顶 100。(`74ec217`)

### Changed（变更）

- `/v1/models` 与单查只广告启用中的路由；别名停用位落到 `ModelMapping.disabled`，所有读路径收口到 `modelServing.isMappingActive`；路由卡片显示候选数并对空池给警示。(`74ec217`)
- 发布流程：`release.yml` 先跑 gate（build + 两个 tsc + 全量测试）再 publish，Node 统一 24。(`74ec217`)

### Fixed（修复）

- 限流退避改按（账号, 模型）记档：同一渠道别的模型成功一次，不再抹掉本模型的 429 冷却与连击计数（此前解禁时间每分钟只后移约 60 秒，反复付整段 system 的 prefill 去撞墙）；每账号限流档上限 64，并先摘到期/最久未碰的。(`9bbb0e7`)

## [1.4.10] - 2026-11-01

版本边界：tag `v1.4.10`（`025fa8a`）。

### Added（新增）

- Gemini 线路可诊断：`lane_retired`、出口地区、产品线三类确定性 4xx 从"一律归 SERVER"中摘出并直接给可读原因；客户身份头里的 antigravity 版本与 changelist 改为从自动更新站现取；模型目录改为按当前凭据的 `fetchAvailableModels`，静态一行退为兜底。(`70ec39b`)

### Removed（移除）

- OpenCode 本机运行时退役：删除 `src/main/opencode/*`、`builtin/opencode.ts`、`proxy/adapters/opencode.ts`、`oauth/adapters/opencode.ts` 及 7 个测试，`modelListSource` 去掉 runtime 分支（分发前提"npm 上有可用 2.x 客户端"不成立，留着的分支永远走不到）。(`70ec39b`)

### Fixed（修复）

- 等待全部改为有界：`planRequestDeadlines` 由请求超时算出非流式截止、流式首事件、块间停摆与渠道排队预算，换家循环把剩余墙钟折算成单次截止；修掉实测"一笔 525 秒才报当日额度用尽、两笔 214/245 秒才报凭据不可用"。(`f607710`)
- 旧别名留下的裸模型 id 补回渠道前缀（此前 8 笔 100% 400）；凭据/匿名槽这类要人处理的故障不再重试，改走 5 分钟起的冷却档且渠道池一变即解除，错误带 `channel_relogin_required` 但状态仍 502，避免指挥客户端轮换它自己的 Key。(`f607710`)
- 强制 `tool_choice` 撞到不支持的候选归入"换一家就能成"；上游上报的 `usage` 不再被 `transformChunk` 当空帧丢掉（这条同时修掉所有客户端流式 `usage` 恒为 null）。(`f607710`)
- Anthropic 入站五处缺口：清单按 `anthropic-version` 分派、回环主动要 usage、补 `X-Request-Id` 不变量、点名模型落到 auto 时用响应头声明、把工具引擎裁决出的 `transformed.tools` 接进出站体。(`f607710`)
- 两类只在高频真实流量里出现的失败单独归类：渠道包发请求前的 `QUOTA_EXCEEDED`（定时限流，换一家就能成）不再计入账号故障上限；上游安全策略拦截按账号生效，不再"第一个候选就 return"，客户端 `code` 的风控判据排在 401/403 之前。(`a32f957`)
- `/v1/completions` 空 prompt 本地返回 400，不再投影成网关的空 messages 报错；历史 `tool_calls.arguments` 非法 JSON 先修再发；末条工具结果的出站序列补一条极简 user（修 VS Code agent 第 2 轮装死）；末条 tool 兜底挂到 `doForward`，造的这句不再被当成用户本轮输入。(`20aab4d`, `025fa8a`, `fb720f9`, `cb49a5c`)
- "这一家不认这个模型"类 404 改为换下一家。(`a3e3406`)

## [1.4.9] - 2026-11-01

版本边界：tag `v1.4.9`（`9f6a7c6`）。

### Added（新增）

- 仪表盘按供应商显示请求数、成功率、平均延迟、token 与美元费用；拿不到就显示 `-`，绝不折算成 0；成功率只除以"已覆盖请求"，旧构建起始的整天保持"未覆盖"。(`d06dbbe`)
- 逐请求费用：仅在上游上报用量且端点有定价时计价，free/included 记 0 且算已定价，unknown 不写数字；日桶新增 `byProvider` 分表。(`d06dbbe`)
- 最新活动显示从 UA 解析出的客户端标识。(`964fe53`)

### Removed（移除）

- 移除没有消费方的 `SecuritySettings` 开关（`credentialEncryption` / `logDesensitization`），管理面不再展示不生效的选项。(`d06dbbe`)

### Fixed（修复）

- lobsterai 积分查询区分"上游确实说 0 分"与"字段缺失/未登录"，查询前对临期/失效凭据先续期；逐账号 `enabled` 一路带到界面，停用账号读数显示但不计入渠道总额；API Key 页掩码示例与真实长度一致。(`d06dbbe`)

## [1.4.8] - 2026-10-31

版本边界：tag `v1.4.8`（`e331342`）。

### Added（新增）

- 上下文压缩默认开启，仪表盘"压缩节省"随之生效；显式关过的用户保持关闭（归一仅认 `enabled === true`），升级安装继承新的出厂默认。(`4c26f92`)
- 活跃账户卡片可点击并与今日 token 同排；活动列表补充实际模型与账号。(`02eb832`)

### Fixed（修复）

- raccoon 频率超限改判 429 走短冷却换号；补全 `outputSteering` 等缺失文案的 i18n。(`1da4b3d`)

## [1.4.7] - 2026-10-31

版本边界：tag `v1.4.7`（`c0eafa4`）。

### Added（新增）

- auto 路由升级为可增删改的普通路由，策略按路由生效：`AppConfig.routes` 每条自带 strategy / prefer / maxAttempts / stickyMinutes / poolStrategies，粘性键变为 `${route.name}|${conversationKey}`；旧 `config.autoRouting` 在首次启动迁移为唯一一条 `auto` 路由（以 `routes` 键是否存在为判据，幂等）；删掉 `auto` 后 `/v1/models` 不再广告它；改配置不需要重启代理。(`f77cda7`)
- `/v1/models` 为每条启用路由合成条目，`context_window` 取该路由候选池的下界，空池省略该键。(`f77cda7`)
- 手工能力标注独立成 `modelMarks` 表，模型同步不会抹掉用户纠正；聚合能力旁车与生成脚本；`outputCap` 别名折叠；客户端画像 `clientProfile`。(`f77cda7`)

### Fixed（修复）

- 历史缺 `reasoning_content` 的 400 参与换家（渠道能力不匹配），不再整单失败。(`c0eafa4`)
- store 归一 overrides 记录，写入口不再因缺键抛 TypeError。(`663a357`)

## [1.4.6] - 2026-10-30

版本边界：tag `v1.4.6`（`b0c4788`）。

### Fixed（修复）

- 修复 1.4.5 引入的"打包安装后存储不可用"：`electron-store` 被移出 externalize 列表，而 asar 不含 `node_modules`，`await import` 抛 `ERR_MODULE_NOT_FOUND`，且该 import 在 `initialize()` 的 try 之外，初始化错误保持 null，所有依赖存储的 IPC 都报 "Storage not initialized"；重新打进 bundle，把 import 移进 try，模块加载失败时跳过损坏恢复，并用 `tests/build/main-bundle-deps.test.ts` 守住这条。(`d4839e9`)

## [1.4.5] - 2026-10-30

版本边界：tag `v1.4.5`（`cda3f58`）。

### Changed（变更）

- 完成品牌更名 Chat2API → ModelPort（**BREAKING**）：响应头改 `X-ModelPort-*`，opencode agents 改名；启动时在 store/runtime/缓存初始化之前迁移两处持久化根（`<appData>/chat2api → <appData>/modelport` 同卷重命名以保住 `store.key` 解密，`~/.chat2api → ~/.modelport`），目标已存在则跳过、失败只告警不半迁移；`localStorage` 键一次性迁移到 `modelport-settings`。(`85286a3`)
- vite 配置路径改为从 cwd 解析（支持映射盘），`electron-store` 保持 external（1.4.6 撤回该决定）。(`f7bd2ee`)

### Fixed（修复）

- 渠道装不下工具清单时换下一个 auto 候选：工具数超过上游上限（如 128）属渠道能力不匹配，换家且不记冷却/账号失败；`forwarder` 等首个流事件再判定成功，客户端断开即中止上游。(`74b1ca9`)

## [1.4.4] - 2026-10-30

版本边界：tag `v1.4.4`（`8566ea1`）。

### Added（新增）

- 余额门控选号：8 个渠道选号前探测账户额度（fail-open，60s/5s TTL，in-flight 去重，`DSH_ACCOUNT_BALANCE_GATE` 可关）；确认余额为 0 的账号被跳过，避免池首的"烧干账号"吃掉所有请求；loomy/buddy 保持自己的选号器。minimax 补 402 处理：标记该模型到 UTC+8 日边界并轮转到下一账号。(`9de5790`)

### Changed（变更）

- 新增跨平台 CI gate workflow 与 Node 运行版本自检，`npm run gate` 成为唯一验收口径。(`62ee5d1`, `0307fec`)

### Fixed（修复）

- 渠道额度只统计启用账号，开关账号会改变用户看到的渠道总额；渠道页与模型页不再每次 revalidate 都闪回 loading。(`8566ea1`)
- 非拉丁供应商名导致自动路由 500：`X-Chat2API-Route` 原样拼中文名（如 "TRAE (字节)"）触发 `ERR_INVALID_CHAR`，改走 `routeHeaderValue`，非 ASCII 按 UTF-8 百分号编码；`Aggregate-Chain` 同口径。(`d9078ea`)

## [1.4.3] - 2026-10-30

版本边界：tag `v1.4.3`（`98ef5df`）。

### Fixed（修复）

- OpenCode 运行时把非法工具上报当成原生工具活动展示的问题。(`ee1ffe5`)

## [1.4.2] - 2026-10-30

版本边界：tag `v1.4.2`（`2e2ae10`）。

### Added（新增）

- auto 路由 v2：按供应商的重试预算（账号渠道一次短重试）、路由错误策略与拒绝日志、`/v1/models` 上下文窗口服务、能力表、聚合参数丢弃、上下文压缩管线、账号渠道目录同步（成本分桶、停用/死模型处理）。(`9d07417`)
- 免费额度账本与成本分级：`docs/data` 下的额度凭证生成 `aggregateQuota`/`aggregatePricing` 旁车，账本与限额器逐请求计量，`smart`/`pace` 按派生重置时间路由，`aggregateCost` 对每个模型回答 free/included/priced/unknown。(`ddc566a`)
- WorkBuddy 登录渠道族（按 v2.5.1 upstream 快照适配，出处见 `docs/upstream`）；Qoder 会话复用、plan-gate 112、切片队列等待、usage 缓存约定、MiniMax 增量 tool-call 名；宿主侧 reasoning replay 与工具调用预校验。(`55a6540`)
- 开机自启；日志广播 IPC 与请求日志趋势保留策略。(`a805cf4`)
- 聚合页额度/费用徽标与筛选、代理设置压缩面板、仪表盘 token 用量卡与趋势图修复、账号数、供应商认证标签，全部新文案支持 en/zh。(`018306b`)

### Fixed（修复）

- 仪表盘趋势改用日滚存，不再受被截断的请求日志影响。(`2e2ae10`)

## [1.4.1] - 2026-10-29

版本边界：tag `v1.4.1`（`ac62cea`）。

### Added（新增）

- 聚合渠道目录：API Key / 免费额度 / 本机三类条目，支持 openai-chat 与 anthropic-messages 两种线路。(`ac62cea`)
- 十个登录账号渠道（vendored channel pack），账号渠道提供在线模型目录、额度权重、免费模型徽标、逐模型开关与死模型恢复。(`ac62cea`)
- OpenCode 作为运行时内置供应商：本地 runtime bridge、延迟流（响应头先于 30–60 秒的一轮结束发出）、免费池额度错误转 429、死亡进程下次请求替换；provider 状态不启动 runtime，`opencode://local` 豁免 http(s) 规则。(`5075873`)
- 解码层强制 OpenCode 工具契约：`tool_choice: required`、强制函数、`parallel_tool_calls: false` 由 JSON envelope（`anyOf` + `minItems`/`maxItems`）约束；非文本内容开流前 400；`usage` 映射上游计数、缺失保持 `null`。(`3e96b9b`)

### Changed（变更）

- 应用更名为 ModelPort（包名、产品名、界面）；Electron profile 固定，已有安装保留加密 store key 与凭据可读。(`ac62cea`)
- 代理 API 契约加固：fail-closed 鉴权（有 Key 时 `/v1/*` 恒需 Bearer 或 `X-API-Key` 且常量时间比较，无 Key 只绑 loopback）；流式/非流式统一 OpenAI 形错误帧，每流恰好一个 `[DONE]`，`usage` 只用上游真实值，响应带 `X-Request-Id`；内置供应商静默丢弃不支持的采样参数，仅 `n > 1` 返回 400；在线模型清单同步存 `userModelOverrides` 并并入 `/v1/models`。(`e48c3e5`)

### Removed（移除）

- 移除提示词注入管线、Perplexity 供应商、服务端 session 表与旧 logs/session 界面。(`e48c3e5`)
- 退役 8 家基于网页会话（Web UI）接入的供应商，启动时清理其供应商、账户与模型映射（DeepSeek / GLM / Kimi / Mimo / MiniMax / Qwen / Qwen AI / Z.ai）。(`ac62cea`；名单另见 CODE_WIKI §13)

### Fixed（修复）

- 修正供应商默认值与 Z.ai 认证头；Z.ai 验证码受限在文档标注。(`d71d304`, `59f03ab`)

## [1.4.0] - 2026-05-27

版本边界：无 tag；以 `package.json` 升至 1.4.0 的提交 `c81dfe1`（"prepare v1.4.0 release"）为准。

### Added（新增）

- 重设计托管工具调用流程。(`04e7ad2`, `9854357`)
- 独立应用日志存储（与请求日志分离）。(`99d7663`)
- 应用内更新检查与更新管理器接线（状态透出渲染层、按事件驱动 UI）。(`2a2e290`, `a88241b`, `35d931a`, `c5bcfe4`)
- Chat2API 工具测试 skills 与工具配置恢复命令文档。(`95a6d47`, `1fa0244`, `c0bed31`)

### Changed（变更）

- 供应商模型清单刷新（Z.ai 新模型、Qwen AI 模型表、代理徽标）。(`82a63a4`, `2de8b88`, `09349ca`)
- 清理源码产物并简化 provider 分发。(`318a8ef`)

### Fixed（修复）

- DeepSeek web2 模式保留搜索文本；选择映射模型时同步供应商；内置模型映射与持久化模型迁移；模型映射表单控件易用性。(`be83a68`, `20d56a0`, `d0d363a`, `ab4c7d5`, `306e573`, `98ba370`)

## [1.3.0] - 2026-05-07

版本边界：无 tag；以 `package.json` 升至 1.3.0 的提交 `d22e4f6` 为准。

### Changed（变更）

- 请求日志持久化重设计，降低日志 I/O 并修复会话清理。(`fea5f12`, `7215512`)
- 供应商模型流程更新。(`8c6d7b2`)

### Added（新增）

- DeepSeek Expert 模型可通过模型映射接入。(`d969bd8`)

### Fixed（修复）

- 语言设置在应用重启后丢失。(`e22b202`)
- 生产构建找不到 `electron-updater`：先补 `asarUnpack`，再改为 external 策略。(`280a1f6`, `23da35d`)

## [1.2.0] - 2026-04-07

版本边界：无 tag；以 `b0f3255`（"implement automatic application update system ... Update version to 1.2.0"）为准。

### Changed（变更）

- **BREAKING**：会话管理改为无状态单轮，移除多轮模式；新增上下文管理服务（滑动窗口、token 上限、摘要策略）。(`8e744ec`)
- 移除会话设置与上下文管理字幕，界面不再展示已删除的能力。(`449bf51`)

### Added（新增）

- Mimo 供应商，并做了一轮架构优化。(`a9edc38`)
- 多供应商聊天记录批量删除；Kimi 思考模式增强。(`a224a83`)
- 应用内更新检查：主进程请求 GitHub Release 对比版本，规避渲染层 CORS；Qwen AI 与 Z.ai 适配器随之改进（思考模式自动判定、`reasoning_content` 实时下发）。(`e2549f1`)
- 自动更新：`electron-updater` 接线、实时下载进度、一键安装重启、错误重试与双语界面。(`b0f3255`)
- 自定义模型管理（新增/删除/重置）。(`4ffb09c`)
- 供应商动态模型更新；MiniMax 流式处理修复。(`2463120`)

### Fixed（修复）

- Mimo 思考模式解析；forwarder 工具调用处理重构。(`953118a`)

## [1.1.4] - 2026-03-26

版本边界：无 tag；以 `package.json` 升至 1.1.4 的提交 `38abf6b` 为准。

### Added（新增）

- 新增 Perplexity 供应商（OAuth、流式适配与界面资源）。(`5754074`)
- 管理 API（远程管理）：账号、API Key、配置、模型映射、供应商、代理、会话、统计，带密钥鉴权与设置界面。(`3576813`)
- Qwen AI 与 MiniMax 的"清空聊天记录"（含确认弹窗）；Qwen AI 模型名后缀 `-thinking` / `-fast` 控制思考模式；MiniMax 积分改用会员端点并显示到期时间。(`8ef30c2`)
- 请求日志记录响应体、`web_search` 与 `reasoning_effort`，日志详情新增"响应"页。(`08e8982`)

### Changed（变更）

- 模型映射配置增加未保存更改保护。(`6b60637`)
- 多供应商适配器改进：Kimi 思考阶段跟踪、Qwen/Qwen-AI `parent_id`、MiniMax 工具调用、DeepSeek fold/search 流式。(`08e8982`)
- 清理 store 中未使用的方法与属性。(`506493b`)

### Fixed（修复）

- Qwen AI 非流式空内容与重复 resolve；Perplexity 错误处理；Z.ai 与 MiniMax 的 `handleNonStream` 参数处理；Z.ai 非流式响应。(`a013849`, `2595230`, `255e915`, `1190304`)
- 多轮对话 `parent_id` 更新与 DeepSeek web search 模型处理。(`b2170c1`)

## [1.1.3] - 2026-03-11

版本边界：无 tag；以 `package.json` 升至 1.1.3 的提交 `39d1f62` 为准。

### Changed（变更）

- 日志详情弹窗重设计，并修复文本溢出。(`1d2c51d`, `4c80743`)
- 发布工作流支持带后缀的版本 tag，并为产物上传补 actions write 权限。(`1903981`, `2709c43`)

### Fixed（修复）

- 固定加密密钥：原实现用 `safeStorage.encryptString()` 生成密钥，每次结果不同，导致 `electron-store` 读不回旧数据、配置每次重启被重置。(`a300b94`)
- 补齐缺失的日志组件并修正 `.gitignore`。(`403ed1e`)

## [1.1.2] - 2026-03-11

版本边界：无 tag；以 `3784b78` 同时修复问题并升至 1.1.2 为准。

### Added（新增）

- 持久化请求日志与统计系统：`RequestLogEntry`、`PersistentStatistics`/`DailyStatistics`、日志与统计 IPC，仪表盘改用持久数据。(`81800b8`)
- 托盘窗口与紧凑仪表盘（`/tray` 路由与托盘 API）。(`14a49e3`)
- 代理重启对话框与配置处理改进。(`6f44c3c`)

### Changed（变更）

- 更新 macOS 图标。(`0f7d1a5`)

### Fixed（修复）

- `data.json` 损坏时的启动崩溃（"Storage not initialized"）：备份损坏文件、以默认值重建，并新增 `STORE_INIT_ERROR`/`STORE_RETRY_INIT` 前端错误处理。(`3784b78`)

## [1.1.0] - 2026-03-09

版本边界：无 tag；以 `3f08369` 升至 1.1.0 为准（初始版本见 1.0.0）。

### Added（新增）

- Function Calling 模拟：面向不原生支持工具的模型，用文本协议模拟工具调用，并新增 SystemPrompt 管理。(`aee98eb`)
- 多轮会话管理：`SessionConfig`/`SessionRecord`、单/多轮模式、设置页会话标签。(`2a100b1`)
- 工具提示词注入：三种模式（always/smart/never），smart 按消息长度阈值决定是否注入；识别 Cline、KiloCode、RooCode、VS Code Copilot、Cherry Studio 等客户端并按配置跳过；按模型提供多套提示词变体。(`9e81c23`, `1d3d6db`)
- DeepSeek 网页搜索与推理：支持 `web_search`、`reasoning_effort`，新增 `DeepSeek-Search`、`DeepSeek-R1`、`DeepSeek-R1-Search` 模型变体，并支持通过请求头传递特性参数。(`d85e274`)

### Changed（变更）

- 统一工具调用处理：GLM、MiniMax、Qwen、Z.ai 等适配器改为"内容即时下发、刷新时解析工具调用"，统一按 `[function_calls]` 检测，并补全 `finish_reason`（`tool_calls` 与 `stop`）。(`10416c7`)
- 统一各适配器的会话上下文处理。(`94d8c9b`)
- 发布流水线修复：Actions 权限、产物上传与图标步骤；国内网络改用 npmmirror 的 Electron 镜像。(`754f036`, `17502f8`, `cde52cd`, `bf93807`, `89f5aec`)

### Fixed（修复）

- 流重复结束：Qwen/Z.ai 增加 `safeEnd` 与 `streamEnded` 守卫，避免流结束后继续处理数据。(`ef2d8e1`)
- 代理绑定地址在重启后回落 127.0.0.1，改为持久化 `proxyHost`。(`8db3e11`)

## [1.0.0] - 2026-02-26

版本边界：初始提交 `c55dae2`（"initial commit - Chat2API v1.0.0"）。

### Added（新增）

- 首次发布（Chat2API）：Electron + React 桌面应用，为 DeepSeek、GLM、Kimi、MiniMax、Qwen、Z.ai 等服务商提供 OpenAI 兼容 API；含仪表盘、API Key 管理、模型管理、请求日志、代理设置、托盘与中英双语界面。(`c55dae2`)

---

## 版本边界与溯源说明

- **有 tag 的版本**：`v1.4.1` – `v1.7.1` 共 21 个 tag，边界即 tag 指向的提交；每个 tag 内 `package.json` 的 `version` 与 tag 名一致（已逐一核对）。
- **无 tag 的早期版本**：以 `package.json` 的版本号变更提交为边界：
  - `1.0.0` = `c55dae2`；`1.1.0` = `3f08369`；`1.1.2` = `3784b78`；`1.1.3` = `39d1f62`；`1.1.4` = `38abf6b`；`1.2.0` = `b0f3255`；`1.3.0` = `d22e4f6`；`1.4.0` = `c81dfe1`；`1.4.1` = `ac62cea`。
  - `1.0.0` 与 `1.1.0` 之间、`1.2.0` 与 `1.3.0` 之间的提交在 `package.json` 中仍沿用旧版本号，按"提交在下一个版本号提交之前即归入下一版本"处理。
- **仓库中没有 `v1.1.1`**：`git log -- package.json` 的版本序列为 1.0.0 → 1.1.0 → 1.1.2 → 1.1.3，不存在 1.1.1 的版本提交；CODE_WIKI §13 中"v1.1.1"一条缺乏证据，本文件未收录。
- **`CODE_WIKI.md` §13 的归属错误已在此纠正，但未改动该文件**：
  - 其 "v1.5.0" 条目描述的是退役 8 家 Web UI 供应商与聚合渠道目录，实际发生于 `1.4.1`（`ac62cea`，2026-10-29）；`1.5.0` 的真实内容是 HTTPS 监听、证书与凭据 `v1:` 封装。
  - 其 "v1.1.3" 条目称"新增函数调用支持"，函数调用模拟实际落在 `1.1.0`（`aee98eb`，2026-03-02）。
- **条目取舍**：只写能从提交、tag 或仓库文档核对到的用户可见变更；纯内部测试、注释与文档整理一般不单列，除非它改变了运行方式（例如 CI gate、Node 版本、发布流程）。提交历史中无法确认归属的零散改动不写入任何版本。
