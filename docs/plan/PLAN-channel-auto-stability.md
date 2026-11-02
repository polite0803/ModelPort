# PLAN: 渠道与 auto 路由的连接稳定性（192.168.85.131 实测驱动）

> 取证条件：服务 `http://192.168.85.131:8080/v1`（API Key 由用户提供）；SSH 走
> `刘小平@192.168.85.131`（Windows OpenSSH，本机 `~/.ssh/id_ed25519` 已在
> `authorized_keys`）。远程 `%USERPROFILE%\.modelport\request-logs\request-logs.ndjson`
> 取到 200 行（滚动上限），时间跨度 2026-11-01T10:01:49Z → 10:46:32Z。
> 本 PLAN 只记录判据与取舍；交付以代码与门读数为准。

## 实测基线（改动前的读数，必须能在改动后被同一把尺子复测）

单模型矩阵 58 笔（`say OK` 最小提示，非流式，客户端 90s 封顶）：

| 结果 | 笔数 |
|---|---|
| 200 | 29 |
| 404 `模型不存在或已停用`（OpenCode 付费档） | 13 |
| 502 `opencode: 没有可用通道` | 10 |
| 400 `模型 ID 无效：<裸 id>`（旧别名） | 8 |
| 502 `凭据未配置，请先登录`（MiniMax） | 2 |
| 400 `workbuddy: 请求被拦截…request illegal` | 2 |
| 404 `The model X does not exist.`（ovh 目录漂移） | 2 |
| 502 cline/OpenRouter 上游失败 | 1 |
| 无响应（客户端 90s 放弃） | 3（同一模型 `Qoder / Qwen3.8-Flash`） |

远程日志 200 行的延迟读数：p50 **2 280ms**、p90 **23 228ms**、max **525 793ms**。
最慢三笔（同一账号 `Qoder (channel)`）：

- `auto` **525s** → `502 qoder: Billing daily count exceeded`
- `Qoder / Qwen3.8-Flash` **306s** → 200（真的答了）
- `Qoder / Qwen3.8-Flash` **245s / 244s / 214s** → `502 qoder: no usable credential; log in first`

## 根因（每条都指到具体代码位置）

### R1 「请求超时」这个设置根本没接线
- UI 里可改的 `config.requestTimeout`（默认 60 000ms，校验 1s–300s）在
  `src/main/store/config.ts:272` 有 getter `getTimeout()`，**全仓零调用者**。
- HTTP 转发读的是 `proxyStatusManager.getConfig().timeout`
  （`src/main/proxy/forwarder.ts:803/896/926/1205`），而 `ProxyStatusManager` 的
  `timeout: 120000` 是 `src/main/proxy/status.ts:27` 的出厂字面量，`updateConfig()`
  全仓也没有调用者 ⇒ 那一格永远等于 120s，与设置无关。
  （对照：同表的 `retryCount` **是**接线的 —— `forwarder.ts:262` 读
  `config.retryCount`，所以本批只修 timeout 这一边，不声称重试档位也曾失效。）
- 账号渠道的非流式完成读 `bridge.ts:315` 的 `timeoutMs = 0` —— 永不超时。

### R2 账号渠道的非流式完成**没有任何宿主截止时间**
- `src/main/channelPack/bridge.ts:315`：`this.request('complete', { request }, 0)`
  —— `timeoutMs=0` 即永不超时（同文件的 `request()` 本身支持超时 + `cancel` + 504）。
- 渠道包内部的排队总预算默认 **30 分钟**
  （`vendor/channel-pack/src/qoder-adapter.ts:239` `return 30 * 60_000`，
  `QUEUE_MAX_ATTEMPTS = 180`），宿主侧从未覆盖它。
- 后果：`AUTO_WALL_CLOCK_BUDGET_MS = 90_000`（`failover.ts:137`）只在换家**尝试之间**
  检查，单次尝试永不返回时它永远等不到检查点 —— 这条注释在 `failover.ts:177-185`
  已经为**流式**写过一次结论（`FIRST_EVENT_TIMEOUT_MS`），非流式那条路径漏了。
  525s 那笔就是这么来的。

### R3 流式只有「等首块」有超时，首块之后的停摆无上限
- `firstStreamEvent`（`failover.ts:387`）覆盖首事件；`upstream.pipe(stream)`
  （`forwarder.ts:704`）之后没有任何静默检测。实测两笔 `auto` 流式请求 120s 零字节。

### R4 注定失败的凭据/额度故障被当瞬时故障对待
- `no usable credential; log in first` / `凭据未配置，请先登录` / `没有可用通道`
  都需要**人来处理**（重新登录或补 Key），重试与换号都无解；现在按 502 走
  普通账号故障退避（`accountRuntime.ts:26` 15s 起、最多 2 分钟），下一笔照样撞上它，
  且每次都再付 30–245s。

### R5 旧别名的裸 id 让渠道 100% 失败
- 目录里仍有 `opencode/big-pickle` 这类旧写法行，其 `actualModelId` 是**裸** `big-pickle`
  （日志：`model="opencode/big-pickle" actualModel="big-pickle" providerId="opencode"`）。
- `src/main/channelPack/worker.ts:249` 要求 `<channel>/<model>` 形状
  （`slash <= 0` 直接 400 `模型 ID 无效`），宿主手里明明有 `provider.id`，
  却在 `forwarder.ts:138` 把它丢掉了（注册表第三个参数 `_provider` 未使用）。

### R6 强制 tool_choice 撞上不支持的候选即整场 400
- `only tool_choice auto and none are supported`（Cline 背后 Vercel 网关 / MiniMax）
  是**这一家装不下这个请求形状**，与工具数超限同类，但不在 `forwarder.ts:562` 的
  `capabilityMismatch` 名单里 ⇒ 400 不属于 `isFailoverEligibleStatus`，换家循环
  在第一个候选就 `return last`（实测 `att=1`）。

## 决策（含代价与被推翻时改哪一格）

**D1：一个旋钮管住全部上游等待。** `planRequestDeadlines(requestTimeout)` 放在
`retryPolicy.ts`（与 `planForwardRetries` 同处，保持「重试/等待的唯一决策点」），
产出 `completeMs / firstEventMs / idleMs / packQueueMs`，经无依赖镜像模块
`proxy/requestBudget.ts` 供 `bridge.ts` 读取（与 `accountChannels/runtimeState.ts`
同一手法，避免 bridge 拉进 store/electron）。
- `completeMs = clamp(requestTimeout, 1s, 300s)`，默认 60s；
- `firstEventMs = min(60s, completeMs)` ⇒ 默认值下**流式首块行为不变**；
- `idleMs = clamp(completeMs, 15s, 60s)`（首块之后两块之间的最长静默）；
- `packQueueMs = max(10s, completeMs - 10s)`，在 `bridge.spawn()` 以
  `DSH_QODER_QUEUE_TIMEOUT_MS` 注入 ⇒ 渠道**先于宿主**答「模型排队中」，客户端拿到
  的是有 Retry-After 语义的排队错误，而不是宿主自己造的 504。
- **代价**：先前 306s 才成功的那笔排队请求，默认配置下会在 ~50s 被判排队失败。
  要等满队列就把「请求超时」调到 300s（上限），`packQueueMs` 会跟着走到 290s。
  被推翻时的改法：把 `completeMs` 与 `packQueueMs` 拆成两格设置即可，其余不动。

**D2：凭据/额度终态故障走专用冷却档。** `failover.ts` 加窄文案判据
`isChannelCredentialFailure`；命中时换家仍继续（502 本就 failover-eligible），但
冷却用 `accountRuntime.recordCredentialFailure`（5 分钟起、上限 30 分钟），
宿主重试直接停手，且渠道池状态变化（`notifyChanged`）时清除该冷却 —— 用户重新登录
不必等冷却自然到期。账号渠道每家只有一个本机占位账号（`manager.ensureLocalAccount`），
所以「账号级冷却」在这一类里天然等于「渠道级冷却」，不需要新建表。

**D3：裸 id 用宿主已知的 providerId 补回前缀**（`qualifyChannelModel` 放进
`accountChannels/modelCatalog.ts`，那里本来就是渠道命名的唯一解析处）。
不撤这些目录行：让它们能用比撤下更符合用户预期；`/v1/models` 的别名暴露面不动。

**D4：强制 tool_choice 类 400 归 capability 类。** 只加进 `capabilityMismatch`
（换下一家、不记冷却、不计账号故障）。**不**伪造「这家支持强制 tool_choice」的能力位：
`ModelCapability` 没有这一维，硬加会变成没有证据的申报。

## 明确不做（以及为什么）

- **OpenCode 13 条付费档仍被广告**（R-未修）：`model.list` 用 `listAllModels()`
  （不套身份档），worker 请求前校验用 `listModels`（只有匿名槽时只放免费）。
  auto 已有 `isChannelModelUnavailableError` 换下一家；单模型请求得到的是真 404。
  要修得让宿主拿到「当前凭据可供哪几条」，缺的是渠道侧的一份分档视图 —— 记在这里，
  不在本批动手。
- **ovh 两条上游已下线的 id**：`syncModels` 的「只增不减」是既有裁定（撤掉会把
   curated 列表与每模型参数一起弄丢），改判据需要单独一轮。
- **WorkBuddy `request illegal`**：7 笔全部同文案，出自
  `vendor/channel-pack/src/buddy-adapter.ts:433`（腾讯侧风控）。本仓没有可改的宿主判据，
  属于渠道包/账号侧问题，先记账。

## 第二批：Anthropic 入站协议完成度（用户追加「检查完 Anthropic 协议的完成度后一并修复」）

审的对象：`src/main/proxy/routes/messages.ts`（新文件，未提交）、`src/shared/anthropicWire.ts`
（650 行编解码，此前**零测试**）。分派已注册（`routes/index.ts`）✅、鉴权已回
anthropic 信封（`server.ts:145`）✅、`count_tokens` ✅、块骨架/工具/图片/tool_choice
映射 ✅（这批由 `tests/shared/anthropic-wire.test.ts` 25 条把四条纪律钉住）。
真缺口按「会让真实客户端坏掉」排序：

| # | 缺口 | 证据 | 处置 |
|---|---|---|---|
| A1 | `modelsToAnthropicList()` 全仓零调用者 ⇒ anthropic 客户端来列模型拿到的是 OpenAI 形状（有 `data` 键但 `type/display_name/created_at/has_more` 全缺） | grep 结果只有定义处 | `routes/models.ts` 的 `GET /v1/models` 按 `anthropic-version` 请求头分派；`GET /v1/models/:model` **仍**是 OpenAI 形状（SDK 的 `models.retrieve` 会拿到缺字段的一条）——这条留在案上未动 |
| A2 | 流式 `usage` 两处断链：① 回环请求不带 `stream_options.include_usage`；② 即使上游报了，`stream.ts::transformChunk` 会把只带 usage 的帧判成「什么都没有」丢掉，带在 finish_reason 帧上的 usage 也不转发 | 本地替身上游实测：上游收到 `{"model":"up-m","stream":true}`（无 stream_options），网关发出的流里没有 usage，`message_delta.usage.output_tokens=0` | 两处都接：`anthropicToChatRequest` 补 `stream_options.include_usage`；`transformChunk` 保留并透传 `usage`（原样，不重塑，`prompt_tokens_details` 之类才不被抹掉）。这条**不只修 anthropic**：所有客户端的流式 `usage` 之前都是 null |
| A3 | `/v1/messages` 两条出口都不发 `X-Request-Id`，违反本仓「每个 `/v1/*` 响应带且与日志行一致」 | 读代码 + 改后实测 | 先挂本路由 id，拿到回环响应后换成产生日志行那一笔的 id |
| A4 | 客户端点名的模型（`claude-*`）在网关不存在时**静默落到 `auto`**，而函数注释写的是「报错比随便挑一个模型顶上好」；响应体又回显客户端的名字 ⇒ 说的模型与跑的模型不一致且无人告知 | `resolveAnthropicModel` 第 3/4 档 vs 注释 | 保留兜底（硬 400 等于这个入口对 Claude Code 永远不可用），但加响应头 `X-ModelPort-Anthropic-Resolved: <真实名> (<来源>)`（走 `toHeaderValue`，渠道名带中文），并把注释改成与行为一致 |
| A5 | `tools`/`tool_choice`/`parallel_tool_calls`/`response_format`/`reasoning_effort`/`seed` 不在 `buildRequestBody` 白名单里 ⇒ 引擎判定「本轮走原生工具」时工具**根本出不了网**，`response_format`/`reasoning_effort` 同样静默失效 | 替身上游实测收到的键只有 `model,messages,stream(,max_tokens)` | 补齐白名单；`tools` 的唯一来源改成引擎的裁决值 `transformed.tools`（不是 `request.tools`）——托管模式仍走提示注入、**不**双发（默认配置行为不变，`providerProfiles` 默认 `managedSupport: true`），只有关掉工具托管（或 `tool_choice:'none'`）才是原生直通，于是那个开关第一次真的等于它说的意思 |

未做的两条，理由写在案上：入站 `thinking` 块仍按「不猜就丢掉」处理（账号渠道那半边
由 `channelPack/reasoningReplay.ts` 兜历史缺思考的问题）；`GET /v1/models/:model`
的 anthropic 形状。

## 第三批：部署后从真流量日志补的两类（探针矩阵看不见）

装完 1.4.10 新产物后跑了同一套 66 笔探针（客户端上限提到 150s，必须长于宿主 120s 截止，
否则「无响应」这一格会被客户端自己的超时污染）：

| 读数 | 改动前（58 笔 / 90s 上限） | 改动后（66 笔 / 150s 上限） |
|---|---|---|
| 200 | 29 | 单模型 60 笔里 28；含 auto 全 66 笔里 31 |
| `400 模型 ID 无效` | 8 | **0**（这些名字现在能落到渠道，报的是真话 `502 没有可用通道`） |
| `404 模型不存在或已停用` | 13 | 13（未修，见「明确不做」第 1 条） |
| 无响应 | 3 | **0** |
| 宿主日志 max / p90 | 525 793ms / 23 228ms | 126 065ms / 8 400ms |
| 宿主截止·首帧超时·停摆 触发 | — | 0 / 0 / 0（当前真流量没有再出现无界等待，所以下限没被触发） |

`max=126s` 是一笔 **200 成功**（`agnes/agnes-2.5-flash`，聚合 HTTP 线），不是超时：axios 的
`timeout` 计的是响应到达，正文落完在它之后。最慢的五笔里只有它过 100s，其余都在 25s 内。

远程 200 行日志（11:33–12:11，含用户真实客户端流量）里冒出两类探针测不到的失败：

1. **`502 …模型 X 的可用账号均在限流中…`（15 笔）**：渠道包在**发请求之前**就报
   （`QUOTA_EXCEEDED`），原文明确写「无需重新登录」⇒ 定时限流，不烧积分、换一家就能成。
   旧判据里 `限流` 两个字不在 `isRecoverableChannelFailure` 的关键词表内，于是它按普通 502
   计入账号故障上限 —— 三家限流就能把 90s 预算的链判死，而池里其余候选都活着。
   处置：只放宽上限，**不**进人工介入冷却档（它自己会解禁）。
2. **`workbuddy: 请求被拦截…request illegal`（400×7 + 502×2）**：上游安全策略拦截。
   渠道包 2026-09-27 的逐账号实测已推翻「内容问题」初判 —— 同一请求体发往 7 个账号得到
   2×200 / 4×403 / 1×429，**按账号生效**。所以：`auto` 必须继续往下试（400 不在 failover
   状态码里，原先第一个候选就 `return last`，实测 3 笔 `auto` 整场失败），且按人工介入档
   冷却（渠道包内部就给这类账号定了 30 分钟）。单模型路径仍返回原始状态码，但 `code` 给
   `channel_risk_control`，且**分类顺序把这条判据放在 401/403 之前** —— 上游也用 403 表达
   风控，先按状态码分就会指挥客户端去轮换它自己的 Key。

合成为 `isChannelHumanRequiredFailure`（凭据 ∪ 风控）：宿主不重试、按人工介入档冷却、
换家分支排在记账点之后与状态码判定之前（这三条顺序都有独立断言，见
`tests/proxy/failover.test.ts` 的「人工介入类的换家分支…」与
`tests/api/response-contract.test.ts` 的 risk-control 那条）。

## 第四批：VS Code agent 第 2 轮起「装死」（末条 tool 兜底）

来源是另一工具给的实施指令（`Qoder-提示词-末条tool兜底修复.md`，随后被它自己发布的
`对比证据与判定修正-给Qoder.md` 更正）。审查结论分三层：

- **症状属实**，从网关自己的请求日志取证：本机 VS Code（客户端标签 `GitHubCopilotChat`）
  打到 131 的 9 笔里 4 笔是故障形状，回包原文分别是
  `I don't see a request in your message — what would you like me to do in ModelPort?`、
  `I'm ready — what would you like me to work on in ModelPort?`、中文变体一条、
  以及一次 `ask_user` 反问；四条全部落在 `conversationTurn ≥ 2`，第 1 轮 5 笔全部正常。
  ⚠️ 我第一轮用正则扫 `responseBody` 得到「0 命中」是**错的**：流式正文是逐 token 到达的
  （`"I"` `"'m"` `" ready"`），短语在原始 SSE 里从不连续；必须先把帧拼回正文再判。
- **它给的落点不成立**：`worker.ts::complete()` 只有 `provider.type === 'account'` 才到得了
  （`forwarder.ts` 注册表 → `forwardAccountChannel` → `accountChannelManager.complete/openStream`），
  而该文档自己把 ovh（聚合条目）列为同现象。按其 §2.5 的规则就等于「存在绕过路径，须补挂」，
  它没写补挂到哪。故本仓挂在 `doForward` —— 三类供应商分派前的最后一个共用点。
- **有效性已由真实请求体分两次确认**（`对比证据与判定修正-给Qoder.md` + 本仓重跑）：
  我第一轮用自造请求体（23–35KB）重放 4/4 都能继续调工具，因此判过「复现不出来」——
  那个结论的错因现已定位：**精简的 system 拿不到易感态**，与尾部形状无关。
  对方随后用未截断的真实抓包体（`request_round2.json`，186KB，system 71,889 字符 / 75 tools /
  末三条 `assistant, tool, tool`）做了 10 组消融，并在 2026-11-01 修正了判定：
  **大 system 决定易感，末条 tool 决定发作，两者缺一不可**。我用自己的手在同一网关重跑
  `--variant base --n 10`：**5/10 判空或 `ask_user` 反问**（3 次 ask_user + 2 次判空话术），
  5/10 正常发起 `powershell` 调用 —— 达到对方 §六.1 的复现门槛（≥5/10）。

### 落地形态

- 纯函数 `src/main/proxy/trailingUserGuard.ts`（`TRAILING_USER_TEXT` 一行、无插值、无换行，
  文案与对方验证过的 `TAIL_USER` 逐字一致，所以那批 0/15 的数据可以直接当本修复的效果）。
- 挂点是 `doForward` 内部（`cb49a5c`）。为什么不能更早：上下文裁剪/摘要跑在
  `forwardChatCompletion` 的重试循环里，若兜底排在它前面，那句合成的 user 会被裁剪器当成
  「最新的用户消息」而保住它、反而丢掉客户端真实那句；重复度/存活观测、内容压缩同样只该读
  客户端原样字节。四个内部消费者 ⇒ 全部前置，兜底 ⇒ 紧挨三个分派出口
  （渠道 `dedicatedForwarder.forward` / `forwardResponsesWire` / 默认 chat 装配）。
  产的是一份局部 `guardedRequest`，不改写调用方传进来的 `request`。
- 开关 `config.trailingUserGuard`，**缺省即开**（判据写 `!== false`：老 `data.json` 没有这一格，
  写成 `=== true` 会让全部老装机静默失去兜底）；`shared/types.ts` 与 `store/types.ts` 两处声明
  + `proxyStore.ProxyConfig` 映射 + 高级设置面板复选框 + `en-US`/`zh-CN` 两条文案，
  读写两头都有断言（「面板加开关必须写清哪段代码读它」）。
- 端到端证据：`tests/routes/trailing-user-guard-e2e.test.ts` 4 条 —— 默认开时上游实收
  末条是那句 user 且前三条一字未动；关掉后出站字节完全不变；末条非 tool 时零副作用；
  **请求日志的 `userInput` 仍是客户端原话**（这条是「这个不是最后请求作为用户输入」的直接断言）。
  挂点顺序另有一条源码门（`tests/proxy/trailing-user-guard.test.ts`）：四个消费者必须早于
  `doForward`，兜底必须早于三个分派调用，缺一即红。

### 部署后必须复验的一件事

在 131 上装带本批的构建，同一 `request_round2.json` 再跑 `--variant base --n 10`（这次由
服务端补，脚本不改）：判空/反问要 ≤1/10。真实 VS Code 会话侧的复验同一条：第 2 轮起不再
出现 `I don't see …` 或 `ask_user` 反问。若仍出现，把该次未截断的真实请求体取回来做消融，
而不是继续加长提示词。

## 第五批：限流退避的键太粗（`9bbb0e7`）

第四批验收期间被真流量直接暴露：把 DeepSeek-V4.1-Flash 打进限流后，网关每次拒绝都报
「最近一个将于 X 解禁」，而 X **每轮只往后挪约 60 秒**（实测 21:45:29 → 21:46:32 →
21:47:35 → 21:48:39）。这就是自维持循环：冷却到期→放一笔出去→上游又 429→再冷却 60s。

机制在 `accountRuntime`：账号渠道在宿主侧只有**一个本机占位账号**（整条线路共用），而
上游限流窗按**模型**计；原先 429 与网络/5xx/凭据挤在同一个账号键上，`chat.ts` /
`completions.ts` 的成功路径调 `clearAccountCooldown` —— 于是同渠道**别的模型**（用户在
VS Code 里跑的另一个名字）成功一次，就把这个模型的退避连同连击计数一起抹掉。后果是
10 分钟封顶那一档永远够不到，而每一轮要再付一次 71,889 字符 system 的完整 prefill。

改动与代价：

- 429 改按 `(账号, 模型)` 档独立翻倍；网络/5xx/凭据**仍按账号**（那三类的成因是出口本身
  坏了，与请求哪个模型无关）。判据分成两个键域是本批唯一的新概念，记在模块头。
- 每账号限流档上限 64，超限先摘到期、再按插入序摘最久未碰的。必须设上限：`actualModel`
  里含自定义供应商能接受的任意模型名，不设上限就是一张随请求增长的表。
- `snapshot` / `isCooling` 的 `model` 是**可选尾参**，不带 model 的老调用行为一字不变；
  发了 `coolingUntil` 时取两个键域里**更晚**的到期时刻（报早了等于再送去撞一次）。
- 不带 model 的 `recordSuccess` = 清该账号全部档，这是渠道池变化/重新登录的语义，
  `accountChannels/manager.ts` 那一处**故意不带**（换凭据等于上游窗口重开）。
- 负控：`同渠道别的模型成功，不得解除本模型的限流档` —— 旧实现在这条必红。接线门钉五个
  调用点，其正则已用旧写法做过去相关验证（漏 model ⇒ 红）。

未闭环的一条：本批改的是「被限流后别再反复撞」，**没有**改「什么时候算限流结束」。渠道包
报的解禁时刻仍然只往前推 60s，宿主现在会在自己的模型档里记到 10 分钟，但派单前不读渠道包
那句时刻。真实效果要在 131 上装带本批的构建后，用同样的重放节奏（每 20s 一笔 ×10）看
「均在限流中」的笔数与解禁时刻的推进是否停下。

## 验收

1. `npx tsc --noEmit -p tsconfig.json` 与 `-p tsconfig.node.json` 均 0 错；
2. 新增/改动的单测：`planRequestDeadlines` 与 `planAttemptDeadline` 的取值与两侧封顶、
   `qualifyChannelModel` 的三种输入（已带前缀 / 裸 id / 别的渠道前缀）、
   `isChannelCredentialFailure` 与 `isForcedToolChoiceUnsupported` 的命中与不命中、
   `accountRuntime` 凭据档冷却、`createIdleWatchdog` 的四条时序（真定时器，非读源码）、
   `tests/shared/anthropic-wire.test.ts`（25 条，协议编解码四条纪律）、
   `tests/routes/anthropic-inbound.test.ts`（10 条，真 HTTP + 真回环 + 替身上游，
   含 usage 与原生 tools 两条通路的端到端）；
3. 接线门（forwarder / bridge / store 不能被 `node --test` import，沿用本仓既有的
   源码文本门）10 条，并已用 `git show HEAD:` 的**改动前**源文做过反向自证：
   10 条全部不命中 ⇒ 门不是恒真；
4. `npm run gate` 全绿（build + 两个 tsc + 全量测试）。
5. **部署与前后对拍由用户手动完成**（本批裁定：暂不由 agent 替换 192.168.85.131 上
   的安装）。复测脚本已就位：`C:/Users/polit/AppData/Local/Temp/mpdbg/probe.cjs`
   + `jobs_all.json`（58 笔单模型）与 `probe2.cjs`/`probe3.cjs`（auto 全形状），
   基线读数见本文件开头表格；装完后用同一套矩阵重跑即可对比。
   要看的三件事：挂死笔数应归零（最坏 ≤ 请求超时那一格）、`400 模型 ID 无效` 归零、
   `auto` 撞强制 tool_choice 与凭据死渠道时 `attempts` 应 >1 而不是整场失败。
