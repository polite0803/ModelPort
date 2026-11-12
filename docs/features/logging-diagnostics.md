# 日志与诊断

> 适用版本：v1.7.3 ｜ 最后核对：2026-11-04 ｜ 状态：现行

## 这个功能点是什么

ModelPort 有两套日志：请求日志记录每个 `/v1/*` 请求的结果，应用日志记录主进程、渠道 worker 与配置变更等运行事件。应用日志存在 `data.json` 这个 electron-store 数据文件里，请求日志则单独落在 `~/.modelport/request-logs/`；两者都以 `~/.modelport/` 为根，界面分别对应“日志”页与“应用日志”面板。

请求行不是一句“成功/失败”，而是一份可复盘的证据：`requestId`、每个失败或成功尝试的供应商/账号/状态码/错误码/延迟、流生命周期读数 `streamTrace`、上游错误 `type`/`code`/`param`、`upstreamStatus`、`upstreamRequestId`，以及脱敏并截断后的 `errorStack`。每个 `/v1/*` 响应头都带 `X-Request-Id`，与请求行一一对应。

诊断能力分三层。第一层是全局请求日志配置，可开/关、限制条数、是否记录请求与响应体。第二层是单请求 trace：客户端发 `X-ModelPort-Trace: 1`，即使全局不记录 body，这一次请求的请求/响应体也会被捕获，响应头回 `X-ModelPort-Trace: captured`。第三层是诊断包：日志详情弹窗把某条请求行、同 `requestId` 的应用日志、脱敏后的配置与版本快照打包成 JSON，供用户导出后提交。

进程级崩溃也有兜底。`uncaughtException` 与 `unhandledRejection` 会写入应用日志；存储尚未就绪或初始化失败时，条目落到 `~/.modelport/logs/crash-fallback.ndjson`，保证“启动就崩”至少留下原始堆栈。

日志页是只读视图：它按时间倒序列出请求行，支持从仪表盘或错误提示带 `?highlight=<requestId>` 深链跳转并高亮那一行。详情弹窗展示尝试链、流读数、错误字段与客户端信息，底部提供“导出诊断包”。应用日志面板则按级别与时间过滤，可导出、可清空；清空只影响展示的日志，不影响统计。

统计不是另一份账本，而是从请求日志滚存出来的派生读数：仪表盘趋势用日滚存，因此“请求日志被条数上限截断”不会把历史趋势一起清零。任何需要“今天用了多少”的判断都应读统计或日滚存，而不是数当前列表里还剩多少行。

## 关键行为与不变量（必守约束）

- **一个请求一行，一行有稳定 id**。`requestId` 同时用于响应头 `X-Request-Id`、尝试链、流读数与诊断包；没有请求行就不是“网关看见了这次请求”。
- 尝试行记录 `providerId`/`providerName`、`accountId`/`accountName`、`model`、`status`、`errorType`、`errorCode`、`errorMessage`（截断 1000 字符）、`latencyMs`、`outcome`（`success` / `client_abort` / `capability` / `failover` / `fatal`）与 `retryIndex`。
- 单次请求最多记录 20 条失败尝试（v1.7.0 由 8 提到 20）；持久化时单条日志只保留最后 12 条尝试（`sanitizer.ts` 的 `MAX_ATTEMPTS`）。〔v1.7.0 起〕
- `streamTrace` 记录首 token 时间、总时长、字节数、结束原因、是否见到 `[DONE]`、ping 次数与上游 request id；`repetition` 只以聚合读数落盘，不保存被判定重复的原文。
- `errorStack` 是先脱敏再截断（上限 16 000 字符），不是直接丢弃；Bearer、裸 `sk-`、URL 查询串等敏感片段在这一步被替换。〔v1.4.11 起〕
- **错误行有保留下限，但下限有时限**：请求日志保留最新的 100 条错误、应用日志保留最新的 500 条错误，且只覆盖 `logRetentionDays`（缺省 7 天）以内的错误行。一次成功流量洪峰不能把正在排查的那条失败挤掉；反过来，跨过保留窗的旧错误不再无限期占位 —— 无时限的下限会让列表与级别计数一旦攒到 100/500 就永远停在那个条数上，把保底值读成测量值。
- 请求日志默认最多 200 条、默认不记录 body；打开 body 后单条截断到 200 000 字符（旧配置里的 8000 会在归一化时迁移）。body 截断是**从头截**，所以位于 `messages` 尾部的 `tool_calls` 往往看不到，工具调用形状的统计因此改用计数旁证，而不是读 body。
- `X-ModelPort-Trace: 1` 是**单请求**开关，不改变全局配置，也不影响其他请求；它必须同时满足“客户端显式要求”才捕获 body。
- 诊断包包含：该请求行、`requestId` 关联的至多 500 条应用日志、版本/Electron/Node/平台/架构，以及脱敏配置快照（端口、HTTPS 开关、负载均衡策略、日志配置、路由名与模型数量）；**不包含**消息正文、凭据或供应商密钥。
- 被拒绝的请求也要有行：错误 API Key、未挂载路径、`route_disabled` 等由 `rejectionLog` 生成同格式的错误行，否则“拒绝流量”在仪表盘上会读成“没有流量”。
- 日志持久化是异步且原子的：先写唯一临时文件再 rename；退出路径用 `flushSync()` 收口，并作废仍在途的旧快照。升级安装前会先 flush，避免“升级出问题”时恰好丢掉相关日志。
- `data.json` 是唯一 electron-store 文件，保存配置、供应商、账号、会话、统计与应用日志；没有独立的 `providers.json` / `accounts.json`。详细的请求日志落在 `~/.modelport/request-logs/`。
- 应用日志与请求日志是两套独立存储，保留策略也各自计算；应用日志默认上限 7000 条，worker 日志在可得时携带 `providerId` / `requestId`。
- 请求日志行 id 由 `randomUUID()` 生成；它与上游 request id 不是同一个值，`upstreamRequestId` 单独记录、截断 200 字符。
- 新请求行通过 `requestLogs:new` 实时推送到渲染层；应用日志通过 `logs:new` 广播。广播只用于界面增量刷新，落盘仍走各自的异步队列。
- 日志清空是独立操作（`requestLogs:clear` / `logs:clear`），只删日志行：`statistics` 与 `tokenUsage` 两块计量账本、供应商、账号一律不动，1.8.x 上「清空请求日志顺手把统计写回默认值」的连带已移除并有判据守住。日志面板的「今日请求 / 今日成功 / 今日错误」取自 `statistics.dailyStats`，不再是数保留窗里的行 —— 保留窗只有 200 行，数出来的会是上限而不是当天事实。应用日志清空不会删除 `crash-fallback.ndjson` 中尚未归档的崩溃条目。
- 导出与诊断包是两个入口：`logs:export` 导出当前应用日志文本，`requestLogs:bundle` 生成内存中的诊断对象，`requestLogs:bundleSave` 才弹保存对话框写盘。
- `userInput` 在落盘前截断到 500 字符，`responsePreview` 与 `errorMessage` 截断到 1000 字符，`upstreamRequestId` 保留 200 字符；截断标记会写明丢掉了多少字符。
- 每个 `/v1/*` 响应都带 `X-Request-Id`，包括鉴权失败、路径不存在与路由禁用产生的拒绝行；没有这个头，就不能把客户端看到的错误对回任何一行日志。
- 诊断包按 `requestId` 精确查找请求行；找不到时不生成“半份包”，避免用户导出一份没有主行的诊断文件。
- 日志写入失败不阻断请求：持久化异常被捕获并写进应用日志（`Failed to persist request logs`），界面仍能收到内存中的新行；退出前的 `flushSync()` 再尝试一次。
- 日志中的用量、失败原因只写上游真实值；拿不到就是缺失，不用 0 或推测值填补。

## 配置项与默认值

| 配置键 | 默认值 | 作用 |
| --- | --- | --- |
| `logLevel` | `info` | 应用日志最低级别（debug / info / warn / error） |
| `logRetentionDays` | `7` | 日志保留天数，允许 1–365 |
| `requestLogConfig.enabled` | `true` | 是否持久化请求日志 |
| `requestLogConfig.maxEntries` | `200` | 请求日志条数上限 |
| `requestLogConfig.includeBodies` | `false` | 是否记录请求/响应体 |
| `requestLogConfig.maxBodyChars` | `200000` | 单条 body 截断长度 |
| `requestLogConfig.redactSensitiveData` | `true` | 是否先脱敏再落盘 |

客户端请求头 `X-ModelPort-Trace: 1` 是单请求 body 捕获开关；响应头 `X-ModelPort-Trace: captured` 表示已接受。崩溃兜底文件为 `~/.modelport/logs/crash-fallback.ndjson`。

应用日志的 7000 条上限是存储层默认值，不是 `AppConfig` 中的用户可调键；请求日志的 200 条上限才是设置页可改的 `requestLogConfig.maxEntries`。两者都以“错误行保底”为约束：先按上限裁剪普通行，再把 `logRetentionDays` 窗口内的错误行补回到保底条数——窗口外的旧错误不再占位，否则保底条数本身会被当成读数。

## 相关代码位置

- `src/main/requestLogs/manager.ts` — 请求日志增删、异步原子落盘
- `src/main/requestLogs/sanitizer.ts` — 脱敏、截断、100 条错误下限
- `src/main/requestLogs/types.ts` — 默认配置（200 条、body 开关）
- `src/main/appLogs/manager.ts` — 应用日志存储与 500 条错误下限
- `src/main/appLogs/types.ts` — 应用日志条目形状
- `src/main/logging/crashReporter.ts` — 进程崩溃捕获与 ndjson 兜底
- `src/main/logging/diagnosticBundle.ts` — 诊断包组装
- `src/shared/logging/redaction.ts` — 先脱敏再截断的公共实现（放 `shared/` 是因为控制台的日志链路也要用它，而 `src/shell` 不许导入 `src/main`）
- `src/shared/logging/consoleBridge.ts` — `console.error/warn` 双写拦截，sink 由宿主注入；只收 error/warn
- `src/main/gateway/bootstrap.ts` — 网关侧 sink：送 `storeManager.addLog`，进 UI 可见的应用日志
- `src/shell/consoleLogSink.ts` — 控制台侧 sink：落自己 profile 的 `logs/console.ndjson`（2MB 上限 + 一份 `.1` 轮转）
- `src/main/proxy/attemptTrace.ts` — 单次尝试行分类
- `src/main/proxy/rejectionLog.ts` — 被拒请求的统一行格式
- `src/main/proxy/routes/chat.ts` — `X-Request-Id`、trace 头、客户端识别
- `src/main/ipc/logBroadcast.ts` — `requestLogs:new` 增量广播
- `src/main/ipc/handlers.ts` — `requestLogs:bundleSave`、日志导出
- `src/main/store/types.ts` — `DEFAULT_REQUEST_LOG_CONFIG`
- `src/renderer/src/pages/Logs.tsx` — 日志列表、深链高亮与诊断导出

## 版本沿革

| 版本 | 变化 | 证据 |
| --- | --- | --- |
| v1.1.2 | 持久化请求日志与统计系统，仪表盘改用持久数据 | CHANGELOG「v1.1.2」条目 |
| v1.1.4 | 请求日志记录响应体、`web_search` 与 `reasoning_effort`，详情新增“响应”页 | CHANGELOG「v1.1.4」条目 |
| v1.3.0 | 请求日志持久化重设计，降低日志 I/O | CHANGELOG「v1.3.0」条目 |
| v1.4.0 | 独立应用日志存储，与请求日志分离 | CHANGELOG「v1.4.0」条目 |
| v1.4.2 | 新增拒绝日志与请求日志趋势保留策略 | CHANGELOG「v1.4.2」条目 |
| v1.4.11 | 请求/应用日志改为“先脱敏、再截断”，补三类敏感模式 | CHANGELOG「v1.4.11」条目 |
| v1.5.2 | 请求日志补尝试链、流生命周期、错误栈、诊断包与单请求 trace；崩溃与 worker 日志落盘 | CHANGELOG「v1.5.2」条目 |
| v1.5.4 | 每轮上下文适配读数写入请求日志，详情页分三档显示；估算值不进 `usage` | CHANGELOG「v1.5.4」条目 |
| v1.7.0 | 单次请求最多记录的失败尝试数 8→20，日志新增 `chainLength` / `skipped` | CHANGELOG「v1.7.0」条目 |
