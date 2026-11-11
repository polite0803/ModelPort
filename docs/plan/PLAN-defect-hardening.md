# PLAN：缺陷核实与加固（2026-11-11）

> 来源：2026-11-11 一轮「审计项目缺陷」的结论。原审计由子代理产出 24 条，本文件**逐条读码复核后**只保留成立项。
> 结论先行：**没有 P0**；24 条中 18 条不成立或属文件里写明的刻意设计。真正值得做的 3 件事是
> D3（Electron 主进程日志在生产里丢失）、D1（构建产物入库且无新鲜度门）、D2（会话子系统整条不可达）。

## 一、核实表（原判 vs 实测）

| 原编号 | 原判 | 核实结论 | 证据 |
|---|---|---|---|
| 1 | `...process.env` 把凭证泄漏给 worker | **不成立**。Node `Worker` 缺省即继承 `process.env`，显式展开只是把它写出来，不是新增泄漏面 | `src/main/channelPack/bridge.ts:163-172` |
| 2 | 会话定时器只在 `destroy()` 时清 | **半成立，且真问题在另一头**：`destroy()` 有调用，但 `initialize()` 零调用 ⇒ 定时器从未启动；且 `addSession()` 零调用 ⇒ 请求路径从不建会话 | `sessionManager.ts:12-33`、`server.ts:704`、`store.ts:2305`（无调用方） |
| 3 | `backup/crypto.ts` 空 catch 静默失败 | **不成立**。注释写明「刻意不区分口令错/密文被改」，加日志会造出离线爆破旁路 | `src/main/backup/crypto.ts:70-76,93-95` |
| 4 | `worker.ts:363` 空 catch 吞错 | **不成立**。停机阶段刻意静默，注释在行上 | `src/main/channelPack/worker.ts:362-364` |
| 5 | `syncProviders()` 并发无锁 | **不成立**。promise 守卫 + `finally` 复位，注释写明「并发运行共享一次」 | `accountChannels/manager.ts:960-1006` |
| 6 | `bridge.request` 超时回调可能双 settle | **不成立**。`settle()` 幂等（先摘 job 再清 timer），resolve 后再 reject 是 no-op | `bridge.ts:327-334,460-474` |
| 7 | sticky / cacheAffinity 无限增长 | **不成立**。有容量上限 500 + `expiresAt` TTL + LRU 淘汰 | `autoRouter.ts:89,989-1009` |
| 8 | `MainHandler` 用 `any[]` 是缺陷 | **不成立**。这是「一套表两种传输」的刻意签名，表本身异质 | `src/main/ipc/registry.ts:1-15` |
| 9-14 | 内存泄漏 / 事件监听未移除 / 竞态 | **未找到可复现证据**。dashboard/requestLog 等 interval 均在卸载或依赖变更时清理 | `Dashboard.tsx:57-68`、`RequestLogList.tsx:134-145` |
| 15-18 | 各类 `as unknown` 转型 | **属取舍不属缺陷**（见 D4 的收口范围，只收请求路径那一处） | — |

## 二、成立缺陷

### D1 [P1] 构建产物入库，且没有任何新鲜度门
- **现象**：仓库根跟踪了 `modelport-daemon.cjs`（4,711,231 B / 126,658 行）与 `renderer/`（51 个文件 / 2.4 MB），来自提交 `423ece3 build: bundle modelport application and update assets`。
- **它们是产物不是源码**：`.gitignore` 忽略了 `out/`、`dist/`；`electron.vite.config.ts:137` 的渲染器根是 `src/renderer`；daemon 打包从 `out/renderer` 取 UI（`scripts/build-daemon.mjs:65`）。根 `renderer/` 只被 `bin/modelport` 的检出内运行用到。
- **已经漂移**：根 bundle 与本机构建产物 sha256 不同（`1b1314…` vs `936804…`），渲染器资产名 50 vs 51（内容一变文件名就变）。仓库没有任何门校验两者一致；`check-source-artifacts.js` 只查「`.js` 旁边有 `.ts`」，`.cjs` 与根 `renderer/` 都不在扫描面内。
- **影响**：仓库膨胀 ~7 MB；`bin/modelport` 可能跑一份陈旧代码；review 时产物 diff 淹没真实改动。
- **修法**：见 §四 Q1（三选一）。

### D2 [P1] 会话子系统整条不可达
- **现象**：`sessionManager.initialize()` 在全仓零调用 ⇒ 1 分钟清理调度器从未启动；`storeManager.addSession()` 在全仓零调用 ⇒ 任何请求都不会产生会话；`forwarder.ts:142` 的 `shouldDeleteSession()` 因此恒无意义（结果无人可观测）。
- **对外还挂着接口**：`src/shared/api.ts:830-861` 暴露 10 个 `sessionAPI` 方法、`src/main/ipc/channels.ts:197-206` 注册 10 个通道。渲染层**不是零调用**（早先那条结论来自只 grep 了 `sessionConfig`）：`components/proxy/SessionManagement.tsx` 在 `pages/ProxySettings.tsx:75` 的「高级」页签里挂载，`getConfig()` / `updateConfig()` 都真的发 IPC。但它只暴露一个 `deleteAfterTimeout` 开关，而这个配置读的会话表永远为空（`addSession()` 零调用）——仍是「看着存在但其实到不了」，且比零调用更误导：用户改了一个不生效的开关。
- **影响**：典型「看着存在但其实到不了」的死路——配置项 `deleteAfterTimeout` 改动无效果，IPC 面扩大而无消费者。
- **修法**：见 §四 Q2。

### D3 [P1] Electron 主进程的 `console.*` 在生产里不可见
- **现象**：`src/main/` 有 233 处 `console.*`，其中 `error`/`warn` 136 处；全仓无任何 console 拦截（无 `console.error =` 赋值）。桌面安装版主进程没有终端，这些输出直接丢失。
- **已有正路**：`storeManager.addLog(level, message, meta)` 会写入 `AppLogManager` 并落盘 + UI 可见，全仓已有 66 处用它。
- **影响**：线上故障只剩 UI 日志里那些「已迁移」的路径，迁移外的错误（IPC 失败、备份失败、额度预检异常）无处可查。
- **修法（已落地，比原方案更彻底）**：不逐个改 118 个调用点，而是在 `gateway/bootstrap.ts` 装一次 `console.error/warn` 拦截（`src/main/logging/consoleBridge.ts`）：原 console 照常输出（daemon 终端不变），再脱敏 + 截断后送 `storeManager.addLog`。所有宿主共用 bootstrap，所以 Electron 无窗口进程从此有日志；`store → console` 不引入反向依赖，sink 由宿主注入。`setCrashLogWriter()` 的注入模式只用于「store 就绪前」，本缺陷不需要。
- **验收**：`tests/logging/console-bridge.test.ts` 覆盖双写、脱敏、重入自保、重复 install 幂等、无 sink 降级。

### D4 [P2] 请求路径的类型黑洞
- **现象**：`src` 内 `: any` 47 处、`as any` 4 处、`as unknown` 46 处；其中请求主干最要命——`forwarder.ts:1468 buildRequestBody(): any`、`1562 extractHeaders(headers: any)`、`1611 body: any`、`proxy/types.ts:296 body?: any`、`shared/api.ts:104-107 Promise<any>` 与 `payload: any`。
- **影响**：请求体一旦字段名写错，`tsc` 全绿、测试也可能绿（测试用的是同一份 `any`），只有线上 400 才暴露。
- **修法**：只收主干——`buildRequestBody` 返回 `Record<string, unknown>`，`extractHeaders` 收 `unknown` 后窄化，`body?: unknown`，`ApiWire.invoke` 泛型化。**只改类型不改行为**，现有 2134 个测试即回退网。

### D5 [P2] 备份失败丢因
- **现象**：`backup/service.ts:197-202、214-219` catch 后只返回字符串码 `storage-not-ready` / `write-failed`，原始 error 只进 `console.error`（即 D3 的盲区）。
- **修法（由 D3 自然闭环）**：console 桥把 `console.error('[Backup] collect failed:', error)` 原样（含 `Error: <message>`）写进 app 日志，原因不再只落在无读者的流上。**不再额外 `addLog`**：同一失败会出两行，且 UI 日志里两行措辞不同才是真的误导。返回码 `storage-not-ready` / `write-failed` 保持不变，不改 UI 契约。

### D6 [P3] 渠道 worker 全量环境变量透传（可选硬化）
- **现象**：`bridge.ts:163-172` 把宿主 `process.env` 整包交给 worker。
- **判断**：不是新增泄漏（缺省行为相同），但没必要把宿主全部变量交给子进程。
- **修法**：改为显式白名单（`PATH`、`NODE_EXTRA_CA_CERTS`、`MODELPORT_*`、三个 `DSH_*`）。风险：漏一项会让渠道运行时找不到状态目录或证书——必须逐项对照 `bridge.ts:159-171` 注释里点名的变量。

## 三、阶段安排

| 阶段 | 内容 | 预计 | 状态 |
|---|---|---|---|
| A | D3 日志双写 + D5 备份丢因（同一块改动） | 1 天 | 已完成：`consoleBridge` + bootstrap 装配 + `console-bridge.test.ts`；D5 由桥覆盖，未重复 addLog。附带修掉 app 日志持久化失败的自持回路（改 stderr） |
| B | D4 请求路径类型收口 | 1 天 | 已完成：`buildRequestBody` → `Record<string, unknown>`、`extractHeaders(unknown)`、`ForwardResult.body?: unknown`、`ApiWire.invoke<T>`；两套 `tsc --noEmit` 零错误 |
| C | D1 产物处理 + D2 会话处理 | 0.5 天 | 已完成：删根产物 + `.gitignore` + `bin/modelport` 指向 `out/daemon`；会话子系统整条删除（含渲染层假开关） |
| D | D6 白名单（可选） | 0.5 天 | 按 Q4-A 不做 |

- 编译/类型在每阶段后用 `tsc --noEmit` 快速自证；**全量 `npm run gate` 只在最后收口跑一次**，不逐改逐跑。
- 与并行未提交工作（`vendor/channel-pack/*`、`Channels.tsx`、两个 locale）**零文件交集**，本计划不触碰这些文件，也不替并行会话提交。

## 四、需拍板

**Q1 — D1 仓库内构建产物怎么处置**
- **A（推荐）** 删除根 `modelport-daemon.cjs` 与根 `renderer/`，`bin/modelport` 改为指向 `out/daemon/`（要求先 `npm run build:daemon`）。仓库瘦 ~7 MB，产物永远与源码一致。代价：检出内直接 `./bin/modelport` 不能再免构建运行。
- **B** 保留，但在 `gate` 里加「产物新鲜度」检查（重算 sha256 比对，不一致即红）。保住便捷运行，代价是每次门禁多一次 daemon 构建产物比对。
- **C** 原样不动。代价：漂移继续，review 噪音继续。

**Q2 — D2 会话子系统**
- **A（推荐）** 整体删除：`sessionManager.ts`、`store.ts` 的 sessions 字段与 8 个方法、`api.ts:830-861`、`channels.ts:197-206`、IPC handler 10 条、`forwarder.ts:142` 的死调用，以及渲染层那条假开关——`SessionManagement.tsx`、`ProxySettings.tsx` 的挂载与导入、`components/proxy/index.ts` 的导出、两份 locale 的 `session` 块。理由：零写入方；UI 开关写的是一个无人读取的配置。
- **B** 保留并接通：在 `server.ts` 启动时调 `initialize()`。但**没有写入方**，接通后清理的仍是空表——等于把死路修成空转，不推荐。
- **C** 接通成真功能（按会话粘性/超时删除）。**超范围**，需要单独 PLAN。

**Q3 — D3 迁移范围**
- **A（推荐）** 只覆盖 Electron 侧（daemon/gateway/desktop 入口保留 console，终端宿主需要）。落地方式选「bootstrap 装一次桥」而不是逐点改：同一效果、118 个调用点零改动、后续新增调用自动覆盖。
- **B** 全迁 136 处，入口也改走 addLog。代价：store 未就绪时的早期错误会丢，且 daemon 终端看不到。

**Q4 — D6 做不做**
- **A（推荐）** 暂不做。当前实现与 Node 缺省行为等价，改白名单只增加「漏配就崩」的风险。
- **B** 做白名单硬化，按 `bridge.ts:159-171` 注释逐项核对。

## 五、边界与回退

- 本计划**不改任何请求行为**（D3/D4/D5 是日志与类型，D2 删除的是零消费者路径，D1 处理的是产物）。任一阶段行为变化即视为超范围。
- 回退成本：A/B/D 三阶段均为新增/替换调用点，`git revert` 可整体还原；C 阶段删除项的还原依赖 git（`bin/modelport` 与两处产物都在提交 `423ece3` 里）。
- D2-A 删除前需确认：无外部脚本调用 `sessionAPI`（`skills/` 与 `scripts/` 在执行时再 grep 一次；渲染层已核实只有 `SessionManagement.tsx` 一个消费者，随本阶段一起删）。

## 六、收口读数（2026-11-11）

| 项 | 读数 |
|---|---|
| `npm run gate` | `EXIT=0`；`tests 2141 / pass 2141 / fail 0`（约 97s） |
| `tsc --noEmit -p tsconfig.json` | 0 错误 |
| `tsc --noEmit -p tsconfig.node.json` | 0 错误 |
| 根产物 | `renderer/` 与 `modelport-daemon.cjs` 已不存在；`./bin/modelport --print-paths` 解析到 `out/daemon/{resources,renderer}` |
| tar.gz 布局 | `dist/daemon-stage/.../bin/modelport` 仍 exec 同级 bundle（打包脚本自写，未受检出内改动影响） |
| 改动面 | 27 个源码/文档文件，`+83 / -707`（不含被删的 51 个根 renderer 产物） |

**附带发现并修掉**：`AppLogManager` 的持久化失败原本走 `console.error`，桥接后会被回灌成新日志条目并再次触发 persist —— D3 落地即形成自持循环。现改为直写 `process.stderr`（`appLogs/manager.ts:257`），终端宿主仍可见，GUI 侧由「store 本身已坏」兜底。
## 七、复盘补修（2026-11-11 二轮）

发布后按「修复面自身是否完整」再核一遍，出两条真遗漏，本轮都修了。

| 缺口 | 修前读数 | 修法 | 判据 |
|---|---|---|---|
| 控制台进程自己的 `console.error/warn` 仍无人读：桥只装在网关侧，`src/shell` 里还有 10 处（证书被拒、地址簿读坏、渲染进程消失、网关子进程没起来） | `grep -c console.error/warn src/shell/` = 10，且 shell 不拥有 store | 新增 `src/shell/consoleLogSink.ts`：落自己 profile 的 `logs/console.ndjson`，2 MB 上限 + 一份 `.1` 轮转，同步写（异步队列丢的正是崩溃前最后几行）。桥与脱敏按 `shared/certificateTrust` 的先例下沉到 `src/shared/logging/`——`shell-entries` 门禁止 shell 导入 `src/main`，这是唯一不用写第二份实现的位置 | `tests/shell/console-log-sink.test.ts` 三条：落盘 + 脱敏、写满即轮转、目录建不出来时返回 false 且不吞原 console；门再加两条：install 必须早于单实例锁、sink 内部禁止 `console.*` |
| 旧 `data.json` 顶层的 `sessions` 死键永存（config 侧 `sessionConfig` 已被 `normalizeConfig` 剥离，顶层这个没管） | 现网 `/root/.modelport/data.json` 实测 `sessions=True / sessionConfig=False` | `keyMigration.ts::retiredTopLevelKeys`（纯判据，`isRecord` 兜非对象快照）+ `store.ts::dropRetiredTopLevelKeys`，在 `orphanSystemPrompts` 之后执行 | `tests/store/key-migration.test.ts` 新增一条：空数组、有行、已迁移、非对象四种输入 |

**代价与回退**：桥下沉改了 4 处 import（`requestLogs/sanitizer.ts`、`logging/crashReporter.ts`、`gateway/bootstrap.ts`、`tests/logging/console-bridge.test.ts`），运行期行为不变；本轮提交整体 `git revert` 即可还原。1.8.3 已发布内容不受影响，两条留给下一个版本，CHANGELOG 也留到发版时一并写。

**明确不做的部分**：控制台日志只保证事后可取证，不给它做 UI 入口——控制台的界面是远端 `/ui/`，把自己的日志塞进去等于再造一个应用日志页面。

**核过确认不是遗漏的三处**：`applyReplace` 是 `store.clear()` + 逐键写，含 `sessions` 的旧备份导入后不会把死键写回来；`/v1/management/sessions` 仍返回 501 `sessions_api_retired`；`scripts/deploy-wsl-daemon.sh` 的 `SRC_DIR=out/daemon`，与 Q1-A 一致，没有指向根产物的残留。
