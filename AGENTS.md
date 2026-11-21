# AGENTS.md

## 强制要求（最高优先级，不得以任何理由搁置）

1. **一律用中文对话。** 回复、解释、提问、总结、提交说明、变更清单、报错分析全部使用简体中文；代码、标识符、命令、日志原文、上
  游报错报文、路径保持原样不翻译。用户用英文提问也用中文回答。硬性要求，没有「本次例外」。
2. **唯一的「完成」证据是 `npm run gate`**：`npm run build` + `build:daemon` + 两个 tsconfig 的 `tsc --noEmit` + 全量
  `node --test`。四项全过才算做完；只说「应该没问题」等于没做。
3. **不做破坏性操作**（`reset --hard`、`push --force`、`rebase`、`clean -fd`、`restore`、`stash` 等）除非先列清风险并取得明确同
  意。用户未开口就不提交、不推送。
4. **报告要如实**：测试失败就贴输出说失败，跳过的步骤就说跳过，不要用「已解决」掩盖未验证。

## 定位与门禁

ModelPort：OpenAI 兼容代理网关的桌面控制台（本地 / WSL / 远程）。本文件是短规则手册：只写「会改变你做法」的硬约束与指针，
**必须保持在 200 行以内**——测量数据、证据、测试名、逐特性叙事一律写进完整参考 [`docs/AGENTS-full.md`](docs/AGENTS-full.md)
（按 § 名查章节）。`docs/README.md` 是智能体的全局文档索引与唯一入口（新增 / 移动文档先读它的归类规则并同步登记，
`node scripts/check-doc-index.mjs` 已接入门禁）。两者冲突以代码为准，并在同一次改动里修正文档。

`electron-vite build` 只转译不做类型检查，两个 tsc 程序必须 0 错误；绝不在两个 tsconfig 之间加 `references` / `composite`（真
错误会变成 TS6305）。Node 必须原生剥离 TS（22.18+ / 24，CI 钉 24）。管道沙箱的 `spawn EPERM` 与 Windows 下两个
`tests/skills/` 用例是环境噪声，动源码前先在普通 shell 复跑。asar 与 daemon 包**不含 `node_modules`**：主进程每个运行时依赖都
必须由 rollup 打包，外置一个就是启动崩溃。发布只出 **dmg**、不签名公证，`build.publish` 必须与发布仓库一致；仓库可能带未提交改
动，失败文件先确认是不是你自己改的。

## 架构

`src/main/`（ipc/、proxy/、oauth/、channelPack/、providers/、store/、runtime/、daemon/、shell/、gateway/、scheduler/）、
`src/preload/`、`src/renderer/`（React）、`src/shared/`。主链路：`server.ts` → `routes/chat.ts` → `forwarder.ts`
（`providerForwarders` 注册表）→ `adapters/<provider>.ts` → 上游；`loadbalancer.ts` 选账号，`modelMapper.ts` 解析名字，
`quota/` 计量。

## 代理 / API 不变量

- **鉴权失败即关闭。** 只要启用了 key，`/v1/*` 就必须带（Bearer 或 `X-API-Key`，常量时间比较）。没有 key 时只能绑回环地址，
  `start()` 拒绝其他 host。不接受 `?api_key=`。
- **`usage` 是 `null`，绝不编造**；`/v1/models` 的 `context_window` 宁可省略这个键，也不写 `0` 或猜测值。判据是**错误的偏向**
  而不是来源标签：人工标注、上游声明与 `probe` 下界可以对外报；`catalog`、`family-rule` 与第三方表不行。
  `X-ModelPort-Context-Window` 必须读 `advertisedContextWindow`，绝不能用未过闸的 `contextWindow`。§Public API Contract。
- **`/v1/models` 只公布路由。** 列表与 `GET /v1/models/:model` 共用一个名字域；启用状态决定池成员与具名请求是否受理，从不决定
  客户端看到什么。停用的别名是 `ModelMapping.disabled`（经 `isMappingActive` 读），不是 `excludedModels`。
- **每个流有且只有一个 `[DONE]`。** 流后失败发 `data: {"error": …}` 帧，绝不当成助手文本；预填充是 `: PING` 注释，不伪造
  token。错误保留上游状态码与 `type`/`code`/`param`；兜底为 401 `authentication_error`、403 `permission_error`、404
  `not_found_error`、429 `rate_limit_error`、5xx `api_error`，**绝不把 403 改写成 401**。每条 `/v1/*` 响应都带
  `X-Request-Id`，与它的请求日志行一致。
- **Auto mode 的审核现场与判决「成对」走，只发给真能执行审核的一方。** 请求带 `anthropic-beta: dangerous-tool-use-2026-09-03`
  + body 顶层 `safeguards`，上游在 `message_delta.delta.safeguard_results` 回判决（非流式在 message 顶层）。判据只有
  `anthropicSafeguardsCapable` 一处（聚合 + `anthropic-messages` + 条目 `serverSideSafeguards`），**闸在出站适配器**——路由层不
  知道这一发落到谁；**只在 body 真带字段时才发 beta 头**，回程用同一判据。§Anthropic server-side safeguards。
- **自由格式（`custom`）工具在 Responses 通道上必须保持条目类型。** Codex `apply_patch` 是 `custom_tool_call` /
  `custom_tool_call_output`，`input` 为必填字符串；出站回同样类型（回成 `function_call` 会静默丢掉写入），历史里也要能读回。
  **并行工具调用在 chat 通道上合并成一条 assistant 消息**；`type:'namespace'` 分组**必须展开子工具送出**
  （`mcp__<namespace>__<child>`，客户端 `tools/router.rs` 认这个形状），整组丢弃会让 Codex 的能力消失；只有无名托管工具才丢弃
  并写 `X-ModelPort-Tools-Dropped`。**非法工具名必须改名后发送、响应里还原**（`shared/toolNameSafety.ts`）。§Tool Calling。
- **网关不向用户对话写入任何提示词（铁律）。** 压缩标记自己说明取回方式（`markers.ts::retrievalHint`），「少说」是客户端参数
  （Codex 的 `model_verbosity`）——都不是网关该替用户说的话。唯一写进请求的自造结构是自由文本工具的参数形状
  （`freeform-input-schema`：只有 schema 无句子）。新增自造文本必须打 `GATEWAY-TEXT: <id>` 并登记台账：
  `gateway-authored-text.test.ts` 精确集合对拍 + `no-gateway-system-text.test.ts` 扫全部 system 落点。
- **跑到复读的回合整发丢弃、重发一次，绝不把复读交给客户端。** 判据（`judgeRunawayTurn`）：带工具、零工具调用增量、可见正文
  ≥6000 字、尾部去重率过守卫；只认「这一轮退化」，不按钉 / 供应商归因。非流式同判据（`judgeRunawayText`）。重发打不通才交第一
  发。responses 流式先压到首个工具调用或两窗健康（`earlyReleaseMinChars`）再交付；**放行不等于免检**——交付后判据照跑，判中就
  地 `cancel()` 并发 `response.failed`。**先看字符量再看行数**：单行滚到 `REPETITION_RUN_CHARS_LIMIT` 即判。第八类退化
  `output-cap-cutoff`：`length` + 客户端**没**点上限 + 带工具却零调用 ⇒ 残文。§Degenerate Stream Detection。
- **模型用文本写出的工具调用必须还原成 `tool_calls`，不得进客户端正文。** 两种格式：DSML 标记（`invoke` / `parameter`，根标签
  `<｜DSML｜ calls>`，关键字 `calls` / `tool_calls`，`｜` 为 U+FF5C）与 `<tool_call>{"name":…,"arguments":…}</tool_call>` JSON
  （另认 `input` / `tool`+`parameters`）。`dsmlToolCallTap` 只看响应形态：正文在首个非空白前就是调用块、块后再无正文；带前言的
  按纯文本放行。**还原不看调用名是否在声明集合里**（丢掉等于作废模型的决策，由越界审计报）。上游已给结构化调用时正文那份丢弃；
  给完 `[DONE]` 却无 `finish_reason` 时补结束帧。**尾部只有闭合标签的残片要剥掉**，正文保留、整轮按退化记
  （`danglingCallMarkup`）。§Degenerate Stream Detection。
- **证书进系统库不等于客户端信任。** `installCertificateTrust()` 只满足 Chromium/Schannel；Node 客户端需要
  `NODE_EXTRA_CA_CERTS`（PEM 来自 `GET /v1/management/tls/ca`）。握手被拒时不写行、也没有 `X-Request-Id`。
- **失败转移状态策略。** 400 终结（能力不匹配的 400 除外）；401-407、404、409-499、5xx 与网络错误切换；408/504/524 切换但不对
  同一目标重试。404 切换不计冷却；客户端造成的 400/404/422 不惩罚账号。pack 返回「这个请求本身无法被服务」的机器码
  （`isDeterministicChannelRejection`）时，即使包在 502 里也要停掉原地重试；换候选仍然允许。§In-place retries。
- **单候选静默渠道快速失败。** 连续两次首块超时且 10 分钟内无成功，就为 `(account, model)` 开一个 60 s → 5 min 的窗口：此后直
  接答 503 `first_block_silent_skip` + `Retry-After`，不派发、不惩罚账号。判据不是「慢」而是「从不成功」。
- **历史裁剪绝不清空历史，且上限是硬的。** 最新非 system 消息必须保留（`messages: []` 会被拒）；超预算消息要**截断**并留可检索
  的 CCR 指针。采纳判据是 `ContextProcessResult.changed`（字节变了，不是条数变少）。system 块只在供应商指定
  `maxSystemTokensByProvider` 时才裁；CJK 按 1.5 字符/token。**裁剪点按会话单调**（`trimCutLedger`）：装得下就沿用上一轮起点，
  前移时一次多让 5% 余量（`TRIM_CUT_HEADROOM_RATIO`）——只挪最短距离等于每轮都断一次前缀。**输出上限**来自 `max_tokens` /
  `max_completion_tokens`，由 `normalizeOutputCap` 折叠（别名优先）。
- **裁剪预算按这一跳真正服务的模型取：模型标注 > `contextWindowTier`（200k/400k/1m）> 渠道 / 全局数。** 模型声明了窗口就用它，
  **不取 min**（`resolveTrimBudget`；同一家可同时挂 128K 与 1M）。「模型标注」只认手工 / 同步记录 / 聚合官方旁表 / probe 四层
  （`modelTrimWindow.ts`，与 `advertisedContextTokens` 同一道闸），静态表与家族规则不进；同一判据决定 `/v1/models` 的窗口，
  **钉住的路由报钉住那个模型自己的窗口**。**成本目标（`costBudgetByProvider`）是另一个数**：只收紧、不放大、无全局兜底，装不
  下 system + 任务预留 + 256 token 尾部时**拒绝**它并退回窗口（`budgetFor`）。
- **参数。** 内置供应商会静默丢弃 `response_format`、`stream_options`、`logit_bias`、`seed`、`max_tokens`、`top_p`、`stop` 与
  各 penalty（`parameterPolicy.ts`）；只有 `n > 1` 返回 400；自定义 / 聚合全部透传。**动态 header 值**必须经 `toHeaderValue`；
  直接塞供应商原名会 `ERR_INVALID_CHAR` → 500。

## 路由、降级、配额

- **一轮只服务一个模型。** `ModelRoute.modelScope`：`single`（默认）/ `family` / `pool`。裁剪在 `autoRouter.select()` 里、
  **在** pin 与熔断重排**之后**执行。**零输出容量拒绝**（429/402/配额措辞，且还没流出任何字节）会重选，最多多两跳，且必须在第
  一个字节到达客户端之前——但绝不越过 pin。墙钟上限 40 s。跨模型切换是**轮与轮之间**的行为；`pool` 保持「分区即顺序」，不许在内
  部重引按模型的围栏，也不许把 `single` 放宽成一个。裸 400 无账号惩罚地切换，上限 2 次；客户端中止即终结。
  **`minTier` 是下限，不是相等**（`applyMinTier` 在名字 pin 之后、池策略与手动包含之前执行，后两者捞不回低于下限的模型）；空
  集 → `missing: ['min_tier']`，预览 `below-tier`。§Architecture A。
- **空池必须说明原因。** 剪枝 / 能力不匹配 → 503 `no_available_model` + `details.missing`。仅被自恢复状态清空的池（配额窗口、
  耗尽标记、日限额）→ 429 `model_temporarily_unavailable` + `Retry-After`；具名路径共用同一投影。冷却永不清空池（保留最早醒来
  的那一组）。`todayUsed` 按天分键（`dailyUsageOf`）。预检剥空这一轮时会重选（有界，3 次）并排除那些模型 → 同样是 429，
  `cause: 'rate_limit'`。§An empty pool。
- **只有一个 pin 概念：「固定」。** 每条路由最多钉一个模型，由 `routes:switch` 写入配置 `preferredModel`——一个持久硬钉
  （`until: 0`），绝不存在第二份存储；钉住期间该路由**只**服务那个模型（`pool` 也要被裁剪到它），算法不跑。pin **不**被模型熔
  断否决；每次未命中都是**拒绝并保留** pin；只有 `routes:switch` / `routes:unpin` 能改。事实状态从不清除，`lastSuccessAt` 从不
  伪造（用 `clearManualOverride`）。未命中处置都报 `pinMiss`（`pin_stale` 503 / `pinCooling` / `pinTransient` /
  `pinBlocked`），且都不报池的 `transientUnavailable`。`reason` 在作用域裁剪**之前**算。**与路由同名的映射别名永不生效**
  （`findModelRoute` 里路由名优先）。§Architecture A。
- **八个降级类**撤销粘性锚点；其中三类同时计入 AIMD/Bandit。⑤ 上游截断与 ⑥ 首字慢只抬锚点，不产生 AIMD、Bandit 或账号惩罚。⑧
  撤销锚点并投熔断票，但绝不收缩 AIMD（账号答了，是模型没做完）。降级读数嵌在 `streamTrace` 下进 Bandit 表。**模型熔断**
  （`(route, model)` → 5 min，仅内存）只由 `modelQualityDegradation` 触发；触发后降到最后，首次成功即清除。
  **一个菜单，三根线。** `routes:menu` / `routes:switch` / `routes:unpin` → `routeMenu()` / `switchModel()` / `clearPin()`。渠
  道行的账号数来自 Worker 池，绝不用本地占位；不可达就保留占位，绝不写 0。托盘不持有管理密钥：页面发布 `shell:route-menu`，点
  击以 `shell:route-command` 返回，两条都以 `event.sender === window.webContents` 为闸。三种「没有」要能区分：还没快照、读取失
  败、没有启用的路由。§The console side。
- **粘性**默认是硬钉（`stickyHardPin`，缺省即开）；关掉只剩 +0.12/+0.06 加分。**延迟是闸**：候选超过池的 p75
  `ewmaFirstTokenMs`（`poolLatencyGateMs`；不足 4 个读数不判定）就不提升。「池」= **作用域**。**具名车道同样按会话粘账号**
  （`sessionAffinity`，缺省开）：只由成功一轮写入、只对缓存能力已知的供应商生效，映射里点名的账号仍最高。切换账号 / 模型都必然
  全冷一次，粘性只保证它断一次而不是每轮断。
- **渠道说了算时价格随时间变。** 折扣窗口是目录事实（`ChannelModelInfo.discountWindow`），倍率**在选路那一刻按本地时钟**计算——
  路由、`/v1/models`、渠道页与模型列表共用同一把尺。窗口优先于静态 `free` 标记；时区或时段读不出来时按**生效**（更便宜）算，绝
  不按关闭算。§Time-varying discounts。
- **AIMD** 按 `(account, model)`：并发 4，夹在 2..16；429/超时/5xx 乘性收缩；5 次干净成功 +1。本地拒绝是 429
  `local_concurrency_limit`——切换，不惩罚账号。**耗尽链**：`endAttempt` 之后只有一次内部等待（`planRecoveryWaitMs`），所以它不
  占 AIMD 名额；欠费 / 未订阅与 `permanentRefusalCooldownMs` 判定的都排除在外。**冷却档位**刻意收窄，绝不匹配裸 429 或泛化的
  rate-limit 措辞。§AIMD admission。
- **实时额度是闸，不是一个数字**：唯一判据是 `creditSnapshotExhausted`；美元额度、人民币余额、token 台账之间永不换算；一次点
  击 = 每个 key 一次 GET，不轮询。**亲历的配额拒绝**（`aggregateQuotaExhaustion.ts`）按 `(entry, account, model)` 标记到
  `Retry-After` 或 30 min，首次成功即清除；裸 429 绝不标记。**用户自声明的窗口**（`declaredQuota.ts`）是第五层：
  `declared-exhausted` 对**所有**供应商类型都拦截；单位永不互换。§The Fifth Quota Layer。
- **`/routes` 队列是展示 + 一个用户 pin。** `status`（配置态）与 `blocked`（这一轮）正交：一行可既 `kept` 又 `blocked`；被挡候
  选绝不进 `rankInputs`，被过滤的模型绝不带 `blocked`，`sortByRating` 只排展示——唯一的写操作是 `routes:switch`。
- **配额上限与定价是生成的附属数据**（`shared/aggregate*.ts`）：改 `docs/data/**` 下的回执，重跑构建器，绝不手改产物。
  `undocumented` 永不拦截；非 token 类上限永不换算；重置时间靠推导。**缓存优先压缩**（`cacheFirst`，默认开）在省下的量超过盈亏
  点时跳过在线压缩。**压缩后预热**（`promptCaching.warmAfterCompaction`，默认开）：客户端压缩后，网关用逐字相同的前缀多发一次
  `max_tokens: 1` 的请求写进缓存；判据只看「本轮 prompt 比上一轮少一半以上」、5 分钟冷却、缓存能力未知时不做，走 `probe` 通道
  不影响路由统计。`LoadBalanceStrategy` 有意声明两遍外加 UI 映射与两份语言包。§Aggregate Provider Catalogue、§Prompt Cache。

## 数据与存储

- 数据在 `~/.modelport/`；Electron 的 `userData` 钉在 `<appData>/modelport`（`safeStorage` 用它加密 `store.key`——不要取消钉
  住）。`data.json` 是单一配置文件；`userModelMarks` 必须留在 `userModelOverrides` 之外，否则一次同步就抹掉人工纠正。
  **名字只有在没有任何已发布定义认领它时才算退休**（`isRetiredProviderId`），不能只看 `RETIRED_PROVIDER_IDS`。
- **读取按 `(mtimeMs, size)` 缓存**（`installStoreReadCache`）：否则每次 `get` 都重读、解密、解析整份文件，把回环中继拖成 502
  `internal_relay_failed`。缓存交出同一个共享对象，所以结构快照要存 `structuredClone`，且
  `lastUsed`/`requestCount`/`todayUsed`/`updatedAt` 这类簿记项必须在深比较前投影掉——否则每个请求都会推高 `structuralRevision`
  并推送 `pool-changed`。§Data Storage。
- 启动时用代码强制覆盖内置的
  `apiEndpoint`/`chatPath`/`supportedModels`/`modelMappings`/`headers`/`credentialFields`/`description`，并删除未知的内置 id：
  只改 `providers/builtin/<provider>.ts`（当前 `builtinProviders` 为空）。

## 宿主边界

- 三个宿主共用 `bootstrapGateway()`：无窗口 Electron（本地）、无头 Node daemon（`daemon/entry.ts`，WSL）与已退役的
  `--desktop` 开发宿主；宿主相关逻辑走 `runtime/host.ts`。
  **`proxy/`、`providers/`、`store/`、`scheduler/`、`channelPack/` 下的代码都不许 import `electron`**。§Host boundary。
- 无 keystore 的宿主上 `store.key` 是 `sealed-unreadable`：`initialize()` 抛错并原样保留文件，绝不走「数据损坏」备份流程。
  `/v1/management/rpc`（+ `/events`）是 handler 注册表减去 `app:installUpdate`/`app:downloadUpdate`——绝不是第二份清单。`/ui/`
  在 `getWebRoot()` 存在时提供构建好的渲染层。
- 备份导入三个入口、一个引擎（`stageBackupFile`）；导出在桌面端走保存对话框，无头宿主返回 payload。管理密钥在浏览器
  `sessionStorage` 或按来源 `0600` 的 `secrets.json`；没有 keystore 时控制台拒绝写入。无头持久化必须是**系统作用域**单元
  （`systemctl --user` 随登录会话死）；更新源绝不读匿名 REST API。控制台只做 argv 编排：只允许动态 import，不发布
  `latest.yml`。§Host boundary。
- **客户端改写是控制台能力，不是新监听端口**（`shell/clientSync*.ts`，页面 `/clients`）：就地改客户端自己的存储，经
  `config:update` 分发唯一一把规范 key。页面只说客户端 id、不说路径，也只看掩码后的 key；fork 运行期间 SQLite 写入被拒绝。
- **「谁发来的」按三层判**（`shared/clientProfile.ts`）：声明头 > 命中的网关 key 名 > UA。Node 系客户端（Qoder、Claude
  Desktop）不发 UA，纯 UA 口径下都是 `undici`——所以给客户端各配一把**命名 key**，归属靠 key 名落。按天计数在
  `dailyStats[day].clientUsage`。三层都只是标签，不作安全判据。§Client attribution。

## 日志

- **保留量是「有下限」而不是「无上限」。** 至少 100 条错误请求行与 500 条错误应用日志，同时被 `logRetentionDays` 封顶——无上限
  的下限等于留全部。日志面板计数读 `statistics.dailyStats`，绝不数留存行数。
- **请求体只有三个开关：** `includeBodies`、`X-ModelPort-Trace: 1`、`bodySampleRate`（按 `requestId` 哈希，绝不掷硬币；默认
  0）。`bodyRetentionDays` 到期剥离请求体但保留整行，计数与错误分类因此活过请求体过期。
- **定时日志写入异步且原子；`flushSync()` 是退出路径。** sink 不许用 `console.*` 汇报失败（会递归）——用 `process.stderr`；设置
  表单在 `appConfig` 载入前不得渲染可编辑控件。§Logging

## 扩展供应商

一个供应商要动五处（§Adding a New Provider）：`providers/builtin/<provider>.ts`（或聚合注册表）→ `builtin/index.ts` →
`oauth/adapters/<provider>.ts` + 目录 `index.ts` → `proxy/adapters/<provider>.ts`（流处理同文件）+ `adapters/index.ts` →
`forwarder.ts` 的 `providerForwarders`，外加图标映射与 i18n。

## 会话形态

三种进入方式，先认清自己是哪一行。CodeBuddy WSL remote：加载 `~/.codebuddy/rules/*.mdc`、`CODEBUDDY.md`、`memory/MEMORY.md`。
Qoder 本地（`Z:\ModelPort`）：经 `ssh ... wsl "cd /home/polit/projects/ModelPort && <cmd>"` 执行，并加载
`.qoder/rules/00-execution-ssh.md`。WorkBuddy 本地：按 `.workbuddy/` 规则。`Z:` 是 SMB 视图（同一份，不是副本）：绝不在其上构
建、测试、全库搜索，也不读 `~/.codebuddy/...`。统一入口 `scripts/wsl-project.sh`。

## 编码约定

返回新对象，绝不就地修改；只在校验边界信任外部数据；暴露的密钥要轮换；UI 给人话错误、服务端记细节；绝不吞异常。macOS ARM64 保
留 `app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')`。

上面引用的每个 § 名都在 [`docs/AGENTS-full.md`](docs/AGENTS-full.md) 里对应一个章节；该文件另有 §Auto Routing、
§Pool failover、§Aggregate Free-Quota Layer、§Account Channels、§HTTPS Listener and Certificate Trust 与推荐队列。设计 / 计划
/ 审计 / 手册见 [`docs/README.md`](docs/README.md)。
