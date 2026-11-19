# AGENTS.md

## 强制要求（最高优先级，不得以任何理由搁置）

1. **一律用中文对话。** 面向用户的每一条回复、解释、提问、总结、提交说明、变更清单、报错分析，全部使用简体中
   文。代码、标识符、命令、日志原文、上游报错报文、文件路径保持原样不翻译。用户用英文提问也用中文回答。
   这是硬性要求，不是偏好，不存在「本次例外」。
2. **唯一的「完成」证据是 `npm run gate`**：`npm run build` + `build:daemon` + 两个 tsconfig 的 `tsc --noEmit`
   + 全量 `node --test`。四项全过才算做完；只说「应该没问题」等于没做。
3. **不做破坏性操作**（`reset --hard`、`push --force`、`rebase`、`clean -fd`、`restore`、`stash` 等）除非先列
   清风险并取得明确同意。用户未开口就不提交、不推送。
4. **报告要如实**：测试失败就贴输出说失败，跳过的步骤就说跳过，不要用「已解决」掩盖未验证。

## 定位与门禁

ModelPort：OpenAI 兼容代理网关的桌面控制台（本地 / WSL / 远程）——102 个聚合条目 / 626 个模型、15 个账号渠道、
自定义供应商。短规则手册：只写「会改变你做法」的硬约束与指针。**`docs/README.md` 是智能体查找项目文档的全局索引与
唯一入口**：新增/移动文档先读它的归类规则并同步登记，查设计、计划、审计、功能手册、供应商笔记与上游快照都从它出发；
`node scripts/check-doc-index.mjs` 核对无孤立文档与失效链接（已接入门禁）。完整参考见
[`docs/AGENTS-full.md`](docs/AGENTS-full.md)（按 § 名查章节）。文档与代码冲突以代码为准，并在同一次改动里修正文档。
**本文件必须保持在 200 行以内：测量数据、证据、测试名、逐特性叙事一律写进完整参考。**

`npm run dev` / `dev:win` 用于开发。`electron-vite build` 只转译不做类型检查，两个 tsc 程序必须 0 错误。绝不要
在两个 tsconfig 之间加 `references` / `composite` 链接（真错误会变成 TS6305）。Node 必须原生剥离 TS（22.18+ /
24，CI 钉 24）。管道沙箱里的 `spawn EPERM`、Windows 下两个 `tests/skills/` 用例属于环境噪声，动源码前先在普通
shell 复跑。

asar 与 daemon 包里**不含 `node_modules`**：主进程的每个运行时依赖都必须由 rollup 打包，外置一个就是启动崩溃。
发布：macOS 只出 **dmg**，不做签名与公证，`build.publish` 必须与发布仓库一致；仓库可能带未提交的改动，失败文件
先确认是不是你自己改的。

## 架构

`src/main/`（ipc/、proxy/、oauth/、channelPack/、providers/、store/、runtime/、daemon/、shell/、gateway/、
scheduler/）、`src/preload/`、`src/renderer/`（React）、`src/shared/`。主链路：`server.ts` → `routes/chat.ts`
→ `forwarder.ts`（`providerForwarders` 注册表）→ `adapters/<provider>.ts` → 上游；`loadbalancer.ts` 选账号，
`modelMapper.ts` 解析名字，`quota/` 计量。

## 代理 / API 不变量

- **鉴权失败即关闭。** 只要启用了 key，`/v1/*` 就必须带（Bearer 或 `X-API-Key`，常量时间比较）。没有 key 时只
  能绑回环地址，`start()` 拒绝其他 host。不接受 `?api_key=`。
- **`usage` 是 `null`，绝不编造**；`/v1/models` 的 `context_window` 宁可省略这个键，也不写 `0` 或猜测值。判据
  是**错误的偏向**而不是来源标签：人工标注、上游声明与 `probe` 下界可以对外报；`catalog`、`family-rule` 与第三
  方表不行。`X-ModelPort-Context-Window` 必须读 `advertisedContextWindow`，绝不能用未过闸的 `contextWindow`。§
  Public API Contract。
- **`/v1/models` 只公布路由。** 列表与 `GET /v1/models/:model` 共用一个名字域。启用状态决定池成员、决定具名请
  求是否受理，从不决定客户端能看到什么。停用的别名是 `ModelMapping.disabled` （经
  `modelServing.ts::isMappingActive` 读取），不是 `excludedModels`。
- **每个流有且只有一个 `[DONE]`。** 流后失败发 `data: {"error": …}` 帧，绝不当成助手文本；预填充是 `: PING` 注
  释，不伪造 token。错误保留上游状态码与 `type`/`code`/`param`；兜底为 401 `authentication_error`、403
  `permission_error`、404 `not_found_error`、429 `rate_limit_error`、5xx `api_error`。**绝不把 403 改写成
  401。**
- **自由格式（`custom`）工具在 Responses 通道上必须保持条目类型。** Codex `apply_patch` 是 `custom_tool_call`
  / `custom_tool_call_output`，`input` 为必填字符串；出站要回同样类型（回成 `function_call` 会静默丢掉写入），
  这些条目也必须能从历史里读回。**并行工具调用在 chat 通道上合并成一条 assistant 消息**。`type:'namespace'`
  分组**必须把子工具展开送出**（`mcp__<namespace>__<child>`，客户端 `tools/router.rs` 认这个形状），整组丢弃会
  让 Codex 的 22 个 app 能力彻底消失、模型只能自己发明调用语法；只有无名托管工具才丢弃并写
  `X-ModelPort-Tools-Dropped`。**非法工具名（点号/斜杠/超 64 字符）必须改名后发送、响应里还原**
  （`shared/toolNameSafety.ts`）——直接透传会让严格上游整条 400，一个坏名字连累全部工具。§Tool Calling。
- **网关不向用户对话写入任何提示词（铁律）。** 压缩标记自己说明取回方式（`markers.ts::retrievalHint`），
  「少说」是客户端参数（Codex 的 `model_verbosity`）——都不是网关该替用户说的话。唯一写进请求的自造结构是
  自由文本工具的参数形状（`freeform-input-schema`：只有 schema 无句子）。新增自造文本必须打 `GATEWAY-TEXT: <id>`
  并登记台账：`gateway-authored-text.test.ts` 精确集合对拍 + `no-gateway-system-text.test.ts` 扫全部 system 落点。
- **跑到复读的回合整发丢弃、重发一次，绝不把复读交给客户端。** 判据：客户端带了工具、零工具调用增量、
  可见正文 ≥6000 字、尾部去重率已过重复守卫（`streamRepetition.ts::judgeRunawayTurn`）。只认「这一轮退化」，
  **不按钉/供应商归因**——同一钉两点会话一个跑飞一个健康时，分水岭是单轮塌进复读。流式在 responses 入口
  压到首个工具调用或流结束再交付；重发打不通才交第一发。非流式同判据（`judgeRunawayText`）。§Degenerate
  Stream Detection。
- **DSML 工具调用标记不得进客户端正文。** DeepSeek 系上游（实测 OpenCode Go 与百炼）会把工具调用写进
  `delta.content`：`<｜DSML｜ calls>` / `<｜DSML｜ invoke name="…">` / `<｜DSML｜ parameter …>`（`｜` 为 U+FF5C
  全角竖线，`DSML｜` 后可带空格，关键字有 `calls` 与 `tool_calls` 两种写法）。`dsmlToolCallTap` 只在三个条件
  同时成立时还原成 `tool_calls`：请求声明了工具、正文整体就是 DSML 块、调用名都在声明集合里；带前言或名字
  不符一律按纯文本原样放行，因此不影响其它供应商。上游已经给了结构化调用时，正文里那份是重复意图，丢弃。
  上游给完 `[DONE]` 却没有 `finish_reason` 时补一个结束帧（有调用 → `tool_calls`，否则 `stop`），否则严格客户端
  判「流没完成」。§Degenerate Stream Detection。
- **证书进系统库不等于客户端信任。** `installCertificateTrust()` 只满足 Chromium/Schannel；Node 客户端需要
  `NODE_EXTRA_CA_CERTS`（PEM 来自 `GET /v1/management/tls/ca`）。握手被拒时不写行、也没有 `X-Request-Id`：先看
  `handshakeRejections` 再断言网关没收到。
- **失败转移状态策略。** 400 终结（能力不匹配的 400 除外）；401-407、404、409-499、5xx 与网络错误切换；
  408/504/524 切换但不对同一目标重试。404 切换不计冷却；客户端造成的 400/404/422 不惩罚账号。pack 返回「这个请
  求本身无法被服务」的机器码（`isDeterministicChannelRejection`）时，即使包在 502 里也要停掉原地重试；换候选仍
  然允许。§In-place retries。
- **单候选静默渠道快速失败。** 连续两次首块超时且 10 分钟内无成功，就为 `(account, model)` 开一个 60 s → 5 min
  的窗口；此后每条通道直接答 503 `first_block_silent_skip` + `Retry-After`，不派发、不惩罚账号。判据不是「慢」，
  是「从不成功」。
- **历史裁剪绝不清空历史，且上限是硬的。** 最新的非 system 消息必须保留（`messages: []` 会被上游拒）；超预算
  的消息要**截断**并留下可检索的 CCR 指针，绝不原样转发。采纳判据是 `ContextProcessResult.changed`（字节变了，
  不是条数变少）。system 块只在供应商指定 `maxSystemTokensByProvider` 时才裁。CJK 按 1.5 字符/token 计价。
  **输出上限**来自 `max_tokens` 或 `max_completion_tokens`，由 `normalizeOutputCap` 折叠（别名优先）。
- **裁剪预算按这一跳真正服务的模型取：模型标注 > `contextWindowTier`（200k/400k/1m）> 渠道/全局数。**
  模型声明了窗口就用它，**不取 min**（`resolveTrimBudget`；按供应商写的数结构上就不对，同一家同时挂 128K 与
  1M）。「模型标注」只认手工 / 同步记录 / 聚合官方旁表 / probe 四层（`modelTrimWindow.ts`，与
  `advertisedContextTokens` 同一道闸），静态表与家族规则不进。同一判据决定 `/v1/models` 的窗口，**钉住的路由
  报钉住那个模型自己的窗口**。**成本目标（`costBudgetByProvider`）是另一个数**：只收紧、不放大、无全局兜底，
  装不下 system + 任务预留 + 256 token 尾部时**拒绝**它并退回窗口（`budgetFor`）—— 照字面兑现就是 2026-11-16
  的丢对话分支，所以成本闸到不了 `availableTokens <= 0`。
- **参数。** 内置供应商会静默丢弃 `response_format`、`stream_options`、`logit_bias`、`seed`、`max_tokens`、
  `top_p`、`stop` 与各 penalty（`parameterPolicy.ts`）；只有 `n > 1` 返回 400；自定义 / 聚合全部透传。**动态
  header 值**必须经 `toHeaderValue`；直接塞供应商原名会 `ERR_INVALID_CHAR` → 500。
- **每个 `/v1/*` 响应都带 `X-Request-Id`**，与它的请求日志行一致。

## 路由、降级、配额

只列规则——每条的叙事都在完整参考里对应的 § 章节。

- **一轮只服务一个模型。** `ModelRoute.modelScope`：`single`（默认）/ `family` / `pool`。裁剪在
  `autoRouter.select()` 里、**在** pin 与熔断重排**之后**执行。**零输出容量拒绝**（429/402/配额措辞，且还没流
  出任何字节）会重选，最多多两跳，且必须在第一个字节到达客户端之前——但绝不越过 pin。墙钟上限 40 s。跨模型切换
  是**轮与轮之间**的行为。`pool` 保持「分区即顺序」：不许在它内部重新引入按模型的围栏，也不许把 `single` 放宽
  成一个。裸 400 无账号惩罚地切换，上限 2 次；客户端中止即终结。§Architecture A。
- **`minTier` 是下限，不是相等。** `applyMinTier` 在名字 pin 之后、池策略与手动包含之前执行，后两者无法把低于
  下限的模型捞回来。空集 → `missing: ['min_tier']`，预览 `below-tier`。
- **空池必须说明原因。** 剪枝 / 能力不匹配 → 503 `no_available_model` + `details.missing`。仅被自恢复状态清空
  的池（配额窗口、耗尽标记、日限额）→ 429 `model_temporarily_unavailable` +`Retry-After`；具名模型路径共用同一
  投影。冷却永不清空池（保留最早醒来的那一组）。`todayUsed` 按天分键（`dailyUsageOf`），绝不读原始值。预检剥空
  这一轮时会重选（有界，3 次）并排除那些模型 → 同样是 429，`cause: 'rate_limit'`。§An empty pool。
- **只有一个 pin 概念：「固定」。** 每条路由最多钉一个模型，由 `routes:switch` 写入配置 `preferredModel`——一个
  持久硬钉（`until: 0`），绝不存在第二份存储。钉住期间该路由**只**服务那个模型（即使 `pool` 也要被裁剪过滤到
  它），算法不跑。pin **不**被模型熔断否决；每次未命中都是**拒绝并保留**pin；只有 `routes:switch` /
  `routes:unpin` 能改。事实状态从不清除，`lastSuccessAt` 从不伪造（用 `clearManualOverride`，不用
  `recordSuccess`）。未命中处置都报 `pinMiss`（`pin_stale` 503 /`pinCooling` / `pinTransient` /
  `pinBlocked`），且都不报池的 `transientUnavailable`。`reason` 在作用域裁剪**之前**算。**与路由同名的映射别名
  永不生效**（`findModelRoute` 里路由名优先）。§Architecture A。
- **八个降级类**撤销粘性锚点；其中三类同时计入 AIMD/Bandit。⑤ 上游截断与 ⑥ 首字慢只抬起锚点，不产生 AIMD、
  Bandit 或账号惩罚。⑧ 撤销锚点并投熔断票，但绝不收缩 AIMD（账号答了，是模型没做完）。**模型熔断**
  （`(route, model)` → 5 min，仅内存）只由 `modelQualityDegradation` 触发；触发后降到最后，首次成功即清除。降
  级读数**嵌在 `streamTrace` 下**进 Bandit 表。§Degenerate Stream Detection。
- **一个菜单，三根线。** `routes:menu` / `routes:switch` / `routes:unpin` → `autoRouter.routeMenu()` /
  `switchModel()` / `clearPin()`。渠道行的账号数来自 Worker 池（`accountChannelManager.accountCounts()`），绝
  不用本地占位；不可达就保留占位，绝不写 0。托盘不持有任何管理密钥：页面发布 `shell:route-menu`，点击以
  `shell:route-command` 返回，两条都以 `event.sender === window.webContents` 为闸。三种「没有」要能区分：还没
  快照、读取失败、没有启用的路由。§The console side。
- **粘性**默认是硬钉（`stickyHardPin`，缺省即开）；关掉只剩 +0.12/+0.06 加分。**延迟是闸**：候选超过池的 p75
  `ewmaFirstTokenMs`（`poolLatencyGateMs`；不足 4 个读数不判定）就不提升。「池」= **作用域**，不是整张排名表。
- **渠道说了算时价格随时间变。** 折扣窗口是目录事实（`ChannelModelInfo.discountWindow`），倍率**在选路那一刻按
  本地时钟**计算——路由、`/v1/models`、渠道页与模型列表共用同一把尺。窗口优先于静态 `free` 标记；时区或时段读不
  出来时按**生效**（更便宜）算，绝不按关闭算。§Time-varying discounts。
- **AIMD** 按 `(account, model)`：并发 4，夹在 2..16；429/超时/5xx 乘性收缩；5 次干净成功 +1。本地拒绝是 429
  `local_concurrency_limit`——切换，不惩罚账号。**耗尽链**：`endAttempt` 之后只有一次内部等待
  （`planRecoveryWaitMs`），所以它不占 AIMD 名额；欠费 / 未订阅与 `permanentRefusalCooldownMs` 判定的都排除在
  外。**冷却档位**刻意收窄——绝不匹配裸 429 /"rate limit" / "for your subscription tier"。§AIMD admission。
- **实时额度是闸，不是一个数字**：唯一判据是 `creditSnapshotExhausted`；美元额度、人民币余额、token 台账之间永
  不换算；一次点击 = 每个 key 一次 GET，不轮询。**亲历的配额拒绝**（`aggregateQuotaExhaustion.ts`）按
  `(entry, account, model)` 标记到 `Retry-After` 或 30 min，首次成功即清除；裸 429 绝不标记。**用户自声明的窗
  口**（`declaredQuota.ts`）是第五层：`declared-exhausted` 对**所有**供应商类型都拦截；单位永不互换。§The
  Fifth Quota Layer。
- **`/routes` 队列是展示 + 一个用户 pin。** `status`（配置态）与 `blocked`（这一轮）正交：一行可既 `kept` 又
  `blocked`；被挡候选绝不进 `rankInputs`，被过滤的模型绝不带 `blocked`，`sortByRating` 只排展示——唯一的写操作
  是 `routes:switch`。
- **配额上限与定价是生成的附属数据**（`shared/aggregate*.ts`）：改 `docs/data/**` 下的回执，重跑构建器，绝不手
  改产物。`undocumented` 永不拦截；非 token 类上限永不换算；重置时间靠推导。**缓存优先压缩**（`cacheFirst`，默
  认开）在省下的量超过盈亏点时跳过在线压缩。`LoadBalanceStrategy` 有意声明两遍外加 UI 映射与两份语言包。
  §Aggregate Provider Catalogue、§Prompt Cache。

## 数据与存储

- 数据在 `~/.modelport/`；Electron 的 `userData` 钉在 `<appData>/modelport`（`safeStorage` 用它对 `store.key`
  加密——不要取消钉住）。`data.json` 是单一配置文件；`userModelMarks` 必须留在 `userModelOverrides` 之外，否则
  一次同步就能抹掉人工纠正。**一个名字只有在没有任何已发布定义认领它时才算退休**（`isRetiredProviderId`：内置
  + 聚合 + 渠道），绝不能只看 `RETIRED_PROVIDER_IDS`。
- **读取按 `(mtimeMs, size)` 缓存**（`installStoreReadCache`）：曾经每次 `get` 都重读、解密、解析整份文件，把
  回环中继拖成 502 `internal_relay_failed`。缓存交出同一个共享对象，所以结构快照要存 `structuredClone`，且
  `lastUsed`/`requestCount`/`todayUsed`/`updatedAt` 这类簿记项必须在深比较前投影掉——否则每个请求都会推高
  `structuralRevision` 并推送 `pool-changed`。§Data Storage。
- 启动时用代码强制覆盖内置的 `apiEndpoint`/`chatPath`/`supportedModels`/`modelMappings`/`headers`/
  `credentialFields`/`description`，并删除未知的内置 id：只改 `providers/builtin/<provider>.ts` （当前
  `builtinProviders` 为空）。

## 宿主边界

- 三个宿主共用 `bootstrapGateway()`：无窗口 Electron（本地）、无头 Node daemon（`daemon/entry.ts`，WSL）、以及
  已退役的 `--desktop` 开发宿主。宿主相关逻辑走 `runtime/host.ts`。**`proxy/`、`providers/`、`store/`、
  `scheduler/`、`channelPack/` 下的任何代码都不许 import `electron`**。§Host boundary。
- 无 keystore 的宿主上 `store.key` 是 `sealed-unreadable`：`initialize()` 抛错并原样保留文件，绝不走「数据损
  坏」备份流程。`/v1/management/rpc`（+ `/events`）是 handler 注册表减去 `app:installUpdate`/
  `app:downloadUpdate`——绝不是第二份清单。`/ui/` 在 `getWebRoot()` 存在时提供构建好的渲染层。
- 备份导入三个入口、一个引擎（`stageBackupFile`）；导出在桌面端走保存对话框，无头宿主返回 payload。管理密钥：
  浏览器 `sessionStorage`，或按来源 `0600` 的 `secrets.json`；没有 keystore 时控制台拒绝写入。无头持久化必须是
  **系统作用域**单元（`systemctl --user` 随登录会话死）；更新源绝不读匿名 REST API——配额会把预算耗尽变成裸
  403。控制台只是薄 argv 编排层：只允许动态 import，不发布 `latest.yml`。§Host boundary。
- **客户端改写是控制台能力，不是新监听端口**（`shell/clientSync*.ts`，页面 `/clients`）：就地改客户端自己的存
  储，并通过 `config:update` 分发唯一一把规范 key。页面只说客户端 id、不说路径，也只看掩码后的 key；fork 运行
  期间 SQLite 写入会被拒绝。
- **「谁发来的」按三层判**（`shared/clientProfile.ts`）：声明头 > 命中的网关 key 名 > UA。Node 系客户端
  （Qoder、Claude Desktop）不发 UA，纯 UA 口径下都是 `undici`、分不开——所以给客户端各配一把**命名 key**，
  归属靠 key 名落。按天计数在 `dailyStats[day].clientUsage`（日志保留窗只有 200 行，跨天分析只能读这本账）。
  三层都只是标签，不作安全判据。§Client attribution。

## 日志

- **保留量是「有下限」而不是「无上限」。** 至少 100 条错误请求行与 500 条错误应用日志，同时被 `logRetentionDays`
  封顶——无上限的下限会把「留错误」变成「留全部」。日志面板计数读 `statistics.dailyStats`，绝不靠数留存行数。
- **请求体只有三个开关：** `includeBodies`、按请求的 `X-ModelPort-Trace: 1`、以及 `bodySampleRate`（按
  `requestId` 哈希，绝不掷硬币；默认 0）。`bodyRetentionDays` 到期剥离请求体但保留整行，计数与错误分类因此能活
  过请求体过期。
- **定时日志写入异步且原子；`flushSync()` 是退出路径。** sink 不许用 `console.*` 汇报失败（会递归）——用
  `process.stderr`。设置表单在 `appConfig` 载入前不得渲染可编辑控件。§Logging

## 扩展供应商

一个供应商要动五个地方（§Adding a New Provider）：`providers/builtin/<provider>.ts`（或聚合注册表）→
`builtin/index.ts` 注册 → `oauth/adapters/<provider>.ts` + 该目录 `index.ts` → `proxy/adapters/<provider>.ts`
（流处理同文件）+ `adapters/index.ts` → `forwarder.ts` 的 `providerForwarders` 加一条，外加图标映射与 i18n。

## 会话形态

同一份 checkout，三种进入方式；先认清自己是哪一行，不要混用。CodeBuddy WSL remote（直接 Linux 路径）：加载
`~/.codebuddy/rules/*.mdc`、`CODEBUDDY.md`、`memory/MEMORY.md`。Qoder 本地（`Z:\ModelPort`）：经
`ssh ... wsl "cd /home/polit/projects/ModelPort && <cmd>"` 执行，并加载 `.qoder/rules/00-execution-ssh.md`。
WorkBuddy 本地：按 `.workbuddy/` 规则。`Z:` 是 WSL 目录的 SMB 视图（同一份，不是副本）：绝不在其上构建、测试、
全库搜索，也不读 `~/.codebuddy/...`。统一入口 `scripts/wsl-project.sh`。

## 编码约定

返回新对象，绝不就地修改；只在校验边界信任外部数据；暴露的密钥要轮换；UI 给人话错误、服务端记细节；绝不吞异常。
macOS ARM64 保留 `app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')`。

上面引用的每个 § 名都在 [`docs/AGENTS-full.md`](docs/AGENTS-full.md) 里对应一个章节，该文件另外还含 §Auto
Routing、§Pool failover、§Aggregate Free-Quota Layer、§Account Channels、 §HTTPS Listener and Certificate
Trust 与推荐队列。设计 / 计划 / 审计 / 手册见[`docs/README.md`](docs/README.md)。