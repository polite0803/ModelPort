# 方案：Prompt 缓存命中的实现与强化（P0–P3）

> 成文版本：v1.7.9 ｜ 最后核对：2026-11-08 ｜ 状态：**实施中（P0/P1/P2-D/P3-A 已落地；P3 测量与真机读数待补）**
> 优先级：**DeepSeek 缓存命中率优先**；**按模型的缓存命中统计是硬交付项**。
> 关联：[`docs/design/PLAN-token-compression.md`](../design/PLAN-token-compression.md)（缓存经济性、live-zone 硬约束）
> 结论先行：DeepSeek 走自动前缀缓存，**不需要断点**，它的问题是"前缀被我们自己改动"和"账号/模型轮换把缓存丢在半路"；Anthropic 才需要 P0 的显式断点。两者共用 P1 的读数与仪表盘。

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| DeepSeek 怎么提命中率？ | 不改写前缀（压缩默认关/"缓存优先"）+ 账号与模型按缓存 TTL 钉住 + 不在 chat 与 reasoner 之间轮换。 |
| Anthropic 怎么提命中率？ | 三条 `anthropic-messages` 端点现在零显式缓存，P0 注入 `cache_control`。 |
| 仪表盘要显示什么？ | 按 `(provider, model)` 的请求数、上游输入、缓存读、命中率、上游覆盖率；可切今天/7 天/30 天/全部。 |
| 先做什么？ | P1 数据面 + 仪表盘（读数是一切判据的前提）→ P2-D DeepSeek 专项 → P3 压缩门。P0 可与 P1 并行。 |
| 最需要先拍板的？ | P2-D1：DeepSeek 上压缩默认关（缓存优先）是否接受；P3-1：压缩路线 A/B。 |
| 绝不能破的？ | 前缀逐字节稳定；usage 不伪造；不写任何提示词文本。 |

---

## 1. 现状（2026-11-08 核对）

已有的能力（复用，不重造）：

| 能力 | 落点 | 口径 |
|---|---|---|
| 缓存命中 token 解析 | `src/main/proxy/quota/usage.ts:13-54`；Anthropic 两字段归一在 `src/main/proxy/adapters/anthropic.ts:331-355` | `prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens` / `cache_read_input_tokens`；是 `prompt_tokens` 的子集 |
| 日聚合 | `src/main/store/store.ts:2145`、`src/shared/tokenAccounting.ts:64` | `upstreamCacheRead` 只从上游来源累加；估算请求不进池 |
| 按供应商聚合 | `src/shared/providerUsage.ts:201-240`、`src/renderer/src/stores/dashboardStore.ts:76-96` | 按天桶的 `byProvider` 在时间窗内求和 |
| 仪表盘展示 | `src/renderer/src/components/dashboard/TokenUsageCard.tsx:96-112`、`src/renderer/src/pages/Dashboard.tsx:158-197` | 今日全局缓存读；仅在 `>0` 时显示，缺失不渲染 0 |
| 时间窗控件 | `src/renderer/src/components/dashboard/ProviderStatusCard.tsx:43-48` | 今天 / 7 天 / 30 天 / 全部，状态在 `dashboardStore.providerWindow` |
| `prompt_cache_key` 透传 | `src/main/proxy/forwarder.ts:1464-1490` | 客户端给了就原样带走 |
| 会话键解析 | `src/shared/clientSessionKey.ts:59` | `prompt_cache_key` → `user` → `metadata.user_id` → `session_id` 头 |
| 会话粘性（缓存归属的现有实现） | `src/main/proxy/autoRouter.ts:675-687`、`:712-719`、`:909` | 按 route+会话键钉 `providerId/accountId/displayName`；默认 30 分钟（`src/shared/types.ts:278-281`），硬优先默认开 |
| 压缩只动 live zone | `src/main/proxy/compression/liveZone.ts:86` | 只改写最新 tool / 最新 user；历史与 assistant 冻结 |
| **压缩默认开启** | `src/shared/types.ts:858-861` | `enabled: true`；对 DeepSeek 这类 0.1x 缓存读的家是净亏风险（见 P3 账） |
| DeepSeek 接入形态 | `src/main/providers/aggregate/registry.ts:394-438` | 仅聚合条目，`wire: openai-chat`，8 个模型（含 chat/reasoner 两条不同缓存域）；条目 notes 明确 "Cache usage is reported on this endpoint" |

四个缺口：

1. **DeepSeek 的前缀稳定性没有门、没有读数**：压缩默认开，且只压最新块；下一轮客户端把原文送回，上一轮的压缩字节在上游缓存里作废。30 分钟粘性对"按小时/天计"的前缀缓存也可能太短（TTL 待 P2-D0 取证）。
2. **Anthropic 上游零显式缓存**：`buildAnthropicRequest`（`src/main/proxy/adapters/anthropic.ts:215`）把 system 拼成字符串（`:268`）、tools 重建（`:274`）、内容块重建（`:185-201`），客户端的 `cache_control` 在两次转换里全部丢失。Anthropic 不做自动缓存，这三条链的命中率**必然为 0**。
3. **按模型看不到缓存读数**：`RequestLogEntry` 没有 usage 字段；日桶只有 `byProvider`，没有 `byModel`。现有卡片只能回答"今天全局命中多少"。
4. **缓存归属不是独立信号**：粘性可以被用户设为 0、被降质守卫 revoke；客户端不给会话标识时只有内容指纹；没人代生成 `prompt_cache_key`（这条对 DeepSeek 无意义，对声明支持的家才有价值）。

---

## 2. 不变量（本计划新增，继承既有）

1. **前缀稳定**：同一会话第 N+1 轮请求，第 1..N 轮的 `messages`、`tools`、`model` 序列化必须与第 N 轮逐字节相同。任何变换不得依赖时间、请求 id、随机数、Map 迭代顺序。
2. **不写文本**：`cache_control` 是元数据；不得改动任何 `content` / `system` / tool 描述文本。仍受 AGENTS.md「网关不注入任何提示词」约束。
3. **usage 不伪造**：缓存命中数只来自上游；估算请求不进命中率分子，分母只算 `source === 'upstream'` 的请求，覆盖率单列。
4. **能力未知即不做**：没有文档/实测证据的供应商记 `unknown`——不注入断点、不合成 `prompt_cache_key`，不得按名字猜。
5. **失败开放**：断点超限、上游 400、备忘不可用 ⇒ 回退原请求形态；缓存优化不得把请求打死。
6. **分模型的格子不替代总账**：按模型表是 `byProvider`/日桶的再切分；旧桶没有 `byModel` 时显示"无分模型数据"，不是 0。

---

## 3. 阶段

### P0 — Anthropic 显式断点（`cache_control`）

> 说明：这一阶段**不提升 DeepSeek**（DeepSeek 自动缓存，不需要断点）；它与 P1 并行，不阻塞 DeepSeek 专项。

**目标**：让三条 `anthropic-messages` 端点（anthropic / z.ai `/api/anthropic` / minimax-cn）在多轮会话里真的读到缓存。

**落点**

- `src/shared/aggregate.ts:66`：`AggregateEntry` 增加 `promptCache?: PromptCacheCapability`。能力是数据，不是按厂商名的 if。
- 新 `src/shared/promptCache.ts`：

  ```ts
  export type PromptCacheMode = 'explicit-breakpoints' | 'implicit-prefix' | 'unknown'

  export interface PromptCacheCapability {
    mode: PromptCacheMode
    /** 显式断点上限（Anthropic = 4） */
    maxBreakpoints?: number
    /** 缓存读相对单价（1 = 未缓存输入） */
    readDiscount?: number
    /** 缓存写附加倍率（Anthropic 5m = 0.25，1h = 1.0） */
    writeMultiplier?: number
    /** 低于该估算长度不加断点（Anthropic 1024；Haiku 3.5 为 2048） */
    minCacheableTokens?: number
    /** 该家是否接受顶层 `prompt_cache_key` */
    acceptsPromptCacheKey?: boolean
    /** 缓存存活时长；未知就不填，不用猜测值 */
    ttlMinutes?: number
    evidence?: { docUrl: string; asOf: string }
  }
  ```

  缺省 `unknown`：什么也不做。
- `src/main/proxy/adapters/anthropic.ts`：
  - `AnthropicRequest.system` 改为 `string | AnthropicTextBlock[]`；`tools[]` 与文本块加可选 `cache_control`。
  - 新纯函数 `applyCacheBreakpoints(body, capability, config)`：
    - 断点 1：最后一个 tool 定义（tools 非空且 `tool_choice:none` 未删除时）；
    - 断点 2：system 最后一个块；
    - 断点 3：**上一轮**最后一条消息的最后一个内容块（`messages.length >= 3` 才加，单轮请求不加）；
    - 断点 4（预留）：当前轮末尾——**默认不加**。
    - 上限 `maxBreakpoints`（4）；文本零改动；幂等；估算 prompt < `minCacheableTokens` 时整体跳过。
  - 触发条件：`capability.mode === 'explicit-breakpoints'` 且全局开关开。
- **成本边界**：缓存写比未缓存输入贵 1.25x（5m）/ 2x（1h）。断点 1/2 是所有请求共享的稳定前缀；断点 3 要求至少两轮；当前轮末尾断点每轮都是写、下一轮才能读，先由 P1 读数决定。
- 配置：`AppConfig`（`src/shared/types.ts:700`）增加

  ```ts
  promptCaching: {
    enabled: boolean          // 默认 true
    anthropicTtl: '5m' | '1h' // 默认 '5m'
  }
  ```

  normalize 放 `src/main/store/`（手改 `data.json` 不认识的值回落默认，显式 `false` 保持关闭）；设置页在 `ProxySettings` 增加开关 + TTL 选择；`en-US` / `zh-CN` 两份 i18n 同批补。
- 能力表数据：先只给 **anthropic 官方条目**写 `explicit-breakpoints`；z.ai / minimax 先 `unknown`，等真机读数再填。证据写入 `docs/providers/` 对应文件与条目 `notes`。

**验收**

1. 单测：断点数量 ≤ 4；无 system / 无 tools / `tool_choice:none` 时不产生悬空断点；除 `cache_control` 外与原 body deep-equal；二次调用幂等；低于最小长度不加。
2. 集成：假上游抓包（沿用 `tests/routes/anthropic-inbound.test.ts` 的 mock server 形态），三轮会话第 2/3 轮断点位置符合预期。
3. 真机：任一真实 Anthropic key 跑 3 轮，`usage.cache_read_input_tokens > 0`，且第 2 轮出现 `cache_creation_input_tokens`。读数写回本计划。
4. 反例：上游对 `cache_control` 回 400 ⇒ 能力表改 `unknown`，同一请求重放必须回到原形态成功。

**风险 / 回退**：断点放错只多付写成本，不会错内容；配置总开关关掉即完全恢复原形态。

**拍板项 P0-1**：Anthropic 官方条目是否默认开启（推荐：是；其余家 `unknown`）。

---

### P1 — 缓存读数 + 前缀稳定门 + **按模型仪表盘**

> 硬交付项：用户已明确要求"仪表盘显示缓存命中统计，可分模型查看"。

#### P1-A 逐请求读数（数据面）

- `RequestLogEntry`（`src/shared/types.ts:1155`，字段区在 `:1240` 之后）增加：

  ```ts
  usage?: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens?: number
    source: 'upstream'
  }
  ```

  只在上游报了 usage 时写；估算请求写 `undefined`，不写 0。
- 非流式：把 `readOrEstimateUsage(...)` 提前算一次，供 `addRequestLog`（`src/main/proxy/routes/chat.ts:1097`）与 `meterQuota`（`:1194`）共用；流式：在 `updateRequestLog`（`:1293` 附近）随结束态一起落。
- `meterQuota`（`:170-196`）调用 `recordTokenUsage` 时补 `modelId: actualModel`。
- `recordTokenUsage`（`src/main/store/store.ts:2145`）签名加 `modelId?: string`。

#### P1-B 按模型日桶（数据面）

- `DayTokenBucket`（`src/shared/tokenAccounting.ts:64`）增加：

  ```ts
  byModel?: Record<string, ModelDayUsage>

  interface ModelDayUsage {
    providerId: string
    model: string
    /** 全部请求（含估算）。 */
    requests: number
    /** 上游报了 usage 的请求；命中率的分母口径。 */
    upstreamRequests: number
    /** 上游报的输入 token（含缓存读）。 */
    upstreamPrompt: number
    /** 上游报的缓存读 token（`upstreamPrompt` 的子集）。 */
    upstreamCacheRead: number
  }
  ```

  - 键：`${providerId}::${model}`（含 `::` 等分隔符时替换为 `_`）。**不按模型名合并跨供应商**——同名模型在不同家的缓存域不同，合并会造出一个谁的账单都对不上的命中率。
  - 估算请求只进 `requests`，绝不进 `upstreamPrompt/upstreamCacheRead`（与顶层 `upstreamCacheRead` 同一条理由）。
  - 每日最多 200 个键；超出并入 `__other__`（保留四个数字，`providerId/model` 写 `__other__`）。
- `accumulateDayBucket`（`src/shared/tokenAccounting.ts:220-250`）按同一套规则累加 `byModel`。
- **归一化必须同步**：`normalizeDayBucket`（`:295-315`）目前把 `byProvider` 当唯一的 map 例外；加 `byModel` 时要把 `Exclude<keyof DayTokenBucket, 'byProvider'>` 改成 `Exclude<…, 'byProvider' | 'byModel'>`，否则数字清洗循环会把整张分表抹成 0。这是本阶段最容易静默毁数据的一格。

#### P1-C 按模型聚合与仪表盘（呈现层）

- 新 `aggregateModelTokenUsage(days, window)` 放 `src/shared/providerUsage.ts`，复用 `windowDayKeys`；返回 `Record<key, { providerId, model, requests, upstreamRequests, promptTokens, cacheReadTokens, coveredFrom? }>`。
- `dashboardStore`：`tokenDays` 已经在拉（`src/renderer/src/stores/dashboardStore.ts:221-232`），在 `providerStatsOf` 同层计算并暴露 `modelCacheStats`，随 `providerWindow` 切换重算；不新增后端接口。
- 新组件 `src/renderer/src/components/dashboard/ModelCacheCard.tsx`：
  - 标题："缓存命中（按模型）"；周期控件复用 `providerWindow` / `setProviderWindow`（与 `ProviderStatusCard` 同步）。
  - 列：模型（`provider · model`，模型名主、供应商次）、请求数、上游请求数（覆盖率）、上游输入、缓存读、命中率。
  - 排序：按上游输入 token 降序；默认显示前 8 行 + "展开全部"。
  - 命中率 = `upstreamCacheRead / upstreamPrompt`；`upstreamPrompt === 0` 时显示 `-`，不是 `0%`。
  - 覆盖率 = `upstreamRequests / requests`；整行无上游读数时显示"未报告"，并在这张卡底部写一行与 `TokenUsageCard` 一致的口径说明（缓存读是上游报的、且是输入的子集）。
  - 合计校验：各行 `upstreamPrompt` 之和必须等于同一窗口的顶层 `upstreamPrompt`（有 `__other__` 时也成立）；写进单测，避免 UI 自己再造一套口径。
  - 位置：`Dashboard.tsx` 在 `RequestChart` 下方新增一整行（宽度足够放 6 列）；不挤占现有卡片。
- i18n：`src/renderer/src/i18n/locales/en-US.json` 与 `zh-CN.json` 同批添加 `dashboard.modelCache.*`（标题、列名、覆盖、未报告、展开/收起、口径说明）。只收两份语言，不扩第三份。

#### P1-D 前缀稳定门

- 新门 `tests/routes/prompt-prefix-stability.test.ts`（或 `tests/proxy/`，按 harness 复用情况定）：
  - 用本地 mock 上游捕获**原始请求体**；
  - 同一 fixture 会话构造三轮：第 N+1 轮请求序列化后，`messages[0..N-1]`、`tools`、`model` 必须与第 N 轮逐字节相同；
  - 组合矩阵：compression on/off、aggregate `dropParams`、tool sanitize（`src/main/channelPack/toolCallValidation.ts:163`）、anthropic wire、Responses wire；
  - 压缩幂等单独断：同一输入两次 `applyCompression` 输出字节相同。

**验收**

1. 门的负控：测试内变异成"改写一条历史消息"，门必须红；不改代码必须绿。
2. 日志行逐请求可见 `usage.cacheReadTokens`，流式/非流式读数一致；估算请求不写该字段。
3. **仪表盘按模型可用**：用真实 DeepSeek key 跑 3 轮（带工具结果），第 2/3 轮能在 DeepSeek 行看到 `cacheRead > 0` 与命中率；切 7 天/30 天数字随之变化。
4. 旧数据：没有 `byModel` 的桶不渲染任何模型行，卡片显示"无分模型数据"，不显示 0。
5. 合计校验：模型行之和 = 顶层 `upstreamPrompt`（含 `__other__`）。
6. `npm run gate` 全绿（build + build:daemon + 双 tsc + 全量测试）。
7. 单测落点：`tests/shared/token-accounting.test.ts`（累加、估算不进缓存、旧桶、200 键溢出）、`tests/shared/provider-usage.test.ts`（时间窗、`__other__`、覆盖）。

**风险 / 回退**：日志行只多 4 个数字；`byModel` 每日最多 200 键 + 1 个 `__other__`，不随流量无限增长。若体积仍超预期，只保留 top-50 有上游读数的模型。

---

### P2 — DeepSeek 优先：缓存归属与"缓存优先"压缩策略

#### P2-D0 取证（先做，改代码前必须完成）

- 抓 DeepSeek 官方 KV / context cache 文档，确认四件事并写入新文件 `docs/providers/deepseek.md`（带 URL 与 `asOf`）：
  1. 缓存作用域（按 API key / 组织 / 全局）；
  2. 最小缓存单位与最小长度；
  3. TTL（"hours to days" 还是别的）；
  4. 命中/未命中字段名（仓库已解析 `prompt_cache_hit_tokens`，`src/main/proxy/quota/usage.ts:47-49`）。
- 取不到证据的项写"未取证"，不得用猜测值。`promptCache` 能力表对 DeepSeek 先按 `mode: 'implicit-prefix'`、`acceptsPromptCacheKey: false`，`ttlMinutes` 留空。

#### P2-D1 账号/模型亲和窗口与缓存 TTL 对齐

- 复用现有粘性（`src/main/proxy/autoRouter.ts:675-687` / `:909`），新增独立于 `stickyMinutes` 的缓存亲和：
  - `autoRouting.cacheAffinityMinutes`（新配置，默认 `60`：DeepSeek 官方写"a few hours to a few days"，一小时在文档下界之内，不会比缓存先过期；上限 1440）。
  - 仅在 `promptCache.mode !== 'unknown'` 的供应商上生效；只钉**健康、未被池策略/手动增删/契约过滤筛掉**的 `(providerId, accountId, displayName)`。
  - 与 `stickyHardPin` 的关系：亲和是"缓存优先"的硬提示，但冷却/额度/能力闸门永远先于它。`revokeSticky`（降质守卫）不撤销缓存亲和，只撤销打分粘性——两者分开记。
- **模型钉定**：DeepSeek 的 `deepseek-chat` 与 `deepseek-reasoner` 是不同缓存域；同一会话不得在两个模型之间轮换。路由如有多模型，亲和命中时模型也必须钉住。

#### P2-D2 "缓存优先"压缩策略（DeepSeek 默认）

- 背景账（详见 P3）：DeepSeek 缓存读约 0.1x，压缩最新块后下一轮原文重新送回 ⇒ 压缩需省 ~90% 才不亏。当前 `DEFAULT_COMPRESSION_CONFIG.enabled = true`（`src/shared/types.ts:858-861`），对 DeepSeek 是净亏风险。
- 策略：按 `promptCache.mode === 'implicit-prefix' && readDiscount <= 0.2` 判定为"缓存敏感"家，**默认跳过 live-zone 压缩**（`cache-first`），只有用户在压缩设置里显式开启、或走 P3-A 的缓存感知门时才压缩。
- 落点：压缩调用在 `src/main/proxy/forwarder.ts:290-302`，此处 `provider/actualModel` 已在作用域（`:227`）；用 `resolveCompressionConfig(config.compression, provider)` 解析，不改 `applyCompression` 的签名。
- 配置：`CompressionConfig` 增加 `providerOverrides?: Record<string, { enabled?: boolean }>`；normalize 只认布尔值，未知键丢弃；设置页在 `CompressionSettings.tsx` 增加"缓存优先（对支持前缀缓存的供应商默认关闭压缩）"总开关，默认开。
- 上下文保护：关闭压缩不是放弃长度管理；溢出仍走既有 failover/报错链。若用户开启压缩，走 P3-A 的门而不是旧 10% 门。

#### P2-D3 不做 `prompt_cache_key` 代生成（DeepSeek）

- DeepSeek 自动缓存，不认这个键；保持 `acceptsPromptCacheKey: false`，不向 body 加任何新字段（避免严格家 400）。
- 通用代生成留到 P2-G（可选、默认关、只对能力表声明 `true` 的家），不与 DeepSeek 专项捆绑。

**验收**

1. 同一 DeepSeek 会话连续 3 轮：开亲和时第 2/3 轮 `(providerId, accountId, actualModel)` 与第 1 轮一致；关亲和时同一 fixture 必须能观察到候选变化（负控）。
2. 命中率读数（真实 key，3 轮工具会话，P1 仪表盘）：记录三组 `prompt_cache_hit_tokens / prompt_tokens`——
   (a) 现状（压缩开、亲和 30 分钟）；
   (b) 仅缓存优先（压缩关）；
   (c) 缓存优先 + 亲和 TTL。
   验收判据：**b 相对 a 命中率上升；c 相对 b 不下降**；若 b 反而下降，说明压缩不是主要矛盾，回到 P2-D0 重查前缀变动源（工具顺序、sanitize、dropParams）。
3. 关压缩后 token 总量会上升：同一读数必须同时记录 `upstreamPrompt` 与 `savedTokens`，不能只报命中率；若"省下的压缩 token"大于"丢掉的缓存折扣"，回退该策略（用 P3 的公式核算）。
4. 设置页开关生效、normalize 对旧 `data.json` 不炸；`npm run gate` 全绿。

**风险 / 回退**：关压缩会让长会话更容易撞窗口 ⇒ 保留用户显式开启；若命中率不升，回退为 `enabled: true` 并只保留亲和，不硬推策略。亲和会削弱负载均衡 ⇒ 只对缓存敏感家、只对健康候选、默认跟随粘性。

**拍板项 P2-D-1**：DeepSeek 默认"缓存优先"（压缩关）是否接受（推荐：接受，先按上面三组读数验收；不接受则只做亲和）。
**拍板项 P2-D-2**：`cacheAffinityMinutes` 的取值（**已按文档下界拍为 60 分钟**；等真机 TTL 读数再调）。

---

### P3 — 压缩与缓存的净收益门（DeepSeek 为试点）

**两轮账**：设 `R` 原文 token、`R'` 压缩后、`c` 缓存读折扣（1 = 未缓存）、`w` 缓存写附加倍率：

- 无压缩：第 N 轮 `R + wR`，第 N+1 轮命中 `cR`；
- 有压缩：第 N 轮 `R' + wR'`，第 N+1 轮从 `R` 起 miss，付 `R + wR`；
- 压缩更便宜 ⇔ `R'(1+w) < cR`。

DeepSeek `c ≈ 0.1` ⇒ 需省 ~90%；OpenAI `c ≈ 0.25~0.5` ⇒ 需省 50–75%；Anthropic `c=0.1, w=0.25` ⇒ 需省 ~92%。**当前 10% 门（`src/main/proxy/compression/types.ts:59`）在缓存敏感的家上大概率净亏**。

**前置测量（先做，结论可以是不实现）**

1. 用 P1 的逐请求数据统计 7 天：按内容类型的压缩率分布、`cacheRead/prompt`、`R'(1+w) − cR` 的符号占比。
2. 判据：若压缩请求中该项为负的比例 > 30%，进入 A 或 B；否则维持现状，把读数写进本计划作为"不实现"的证据。

**P3-A 按家设门（小改）**

- `acceptCompression`（`src/main/proxy/compression/policy.ts:37`）增加 `cacheDiscount` / `writeMultiplier`；
- 门改为 `savedRatio > 1 − c/(1+w)`；capability `unknown` 时维持 0.1；
- 代价：缓存敏感的家上压缩基本停用，收益从"省钱"退回"省上下文"。

**P3-B 粘性全历史压缩（大改，推荐若 P1 显示压缩使用率高）**

- 把"只动 live zone"升级为"确定性、幂等的整段变换"：
  - 变换只依赖内容 + `transformVersion`（不含时间/请求 id）；`isAlreadyCompressed` 保持；
  - 用 CCR store（`src/main/proxy/compression/ccr/store.ts`）做 `(transformVersion, originalHash, contentType) → transformed` 备忘，后轮只查表；
  - 因为上游缓存的前缀本来就是压缩后的字节，压缩与缓存同时成立；
  - 300ms 预算必须"全做或全不做"：超时回退原文，禁止半段变换造成每轮抖动；
  - 与 `/v1/management/compression/retrieve`（`src/main/proxy/routes/management/compression.ts:32`）兼容。
- **代价**：开启/改配置/备忘丢失那一次会造成整段失效（一次性）；必须在该文档与 `docs/design/PLAN-token-compression.md` §6.1 写退役说明，并同步更新 AGENTS 的压缩条目——这是对既有硬不变量 1 的**显式推翻**。

**验收**

1. 前置测量完成，判据与读数入档。
2. 选 B 时：同一会话连续两轮请求的**完整字节序列**相等（P1 的门扩展为全量相等）；备忘命中率 > 95%；真机命中率曲线上升。
3. 选 A 时：缓存敏感家上的压缩报告 `insufficient_savings` 可解释；非缓存家行为不变。

**拍板项 P3-1**：A 还是 B（推荐先测再拍；若押长期形态，推荐 B）。

---

## 4. 顺序与依赖

```
P1-A/B/C（读数 + 按模型仪表盘） ──┬─→ P2-D（DeepSeek 亲和 + 缓存优先压缩）
                                  └─→ P3（前置测量 → A/B）
P0（Anthropic 断点） 与 P1 并行，不阻塞 DeepSeek
```

- 仪表盘必须先于 DeepSeek 策略调整：没有按模型的命中率与 `upstreamPrompt` 读数，`b 相对 a 上升` 这条验收无法判定。
- P0 独立可发布；P2-D 的开关可独立回退。
- P3-B 落地前必须完成文档退役与门禁更新。

## 5. 不做

- 不注入任何提示词文本（包括"请利用缓存"之类）。
- 不伪造 `usage` / cached tokens；估算值不进命中率。
- 不按供应商名字启发式推断缓存能力；无证据即 `unknown`。
- 不为提高命中率牺牲健康过滤、契约过滤、额度门槛。
- 不做跨账号缓存迁移（缓存是账号级的，物理上办不到）。
- 不在仪表盘把"未被上游报告的模型"显示成 0% 命中率——显示"未报告"。

## 6. 风险登记

| 风险 | 影响 | 对策 |
|---|---|---|
| DeepSeek 缓存 TTL/作用域未取证 | 亲和窗口拍错 | P2-D0 先取证；取不到就维持现状并写明"未取证" |
| 默认关压缩被用户读成"省 token 功能没了" | 体验/口径 | 设置页写清"缓存优先"含义；同时展示 `savedTokens` 与命中率两组读数 |
| `cache_control` 位置错（P0） | 多付写成本 | 只加 3 个稳定断点；真机读 write/read 比 |
| 代生成 key 被严格家拒收（P2-G） | 400 | capability + `dropParams` 双门 |
| 亲和削弱负载均衡 | 单账号过热 | 仅缓存敏感家 + 健康检查 + 默认跟随粘性 |
| `byModel` 归一化漏改 | 整张分表被抹成 0 | 改 `normalizeDayBucket` 的 `Exclude` 类型并联测旧桶 |
| 模型行之和 ≠ 顶层总数 | 两套口径 | 单测断言相等；`__other__` 承接溢出 |

## 7. 待拍板汇总

| 编号 | 事项 | 推荐 |
|---|---|---|
| P0-1 | Anthropic 官方条目默认开启断点 | 是；其余家 `unknown` |
| P2-D-1 | DeepSeek 默认"缓存优先"（压缩关） | 是；按三组读数验收，不达标回退 |
| P2-D-2 | `cacheAffinityMinutes` 取值 | **60**（文档下界内），真机 TTL 读数后再调 |
| P3-1 | 压缩路线 A / B | 先测；长期押 B |

## 8. 交付物清单（按阶段）

- P0：`shared/promptCache.ts`、`shared/aggregate.ts`、`proxy/adapters/anthropic.ts`、`AppConfig.promptCaching`、设置页 + 两份 i18n、单测/集成测试。
- P1：`shared/types.ts`（RequestLogEntry.usage）、`shared/tokenAccounting.ts`（byModel + normalize）、`shared/providerUsage.ts`（aggregateModelTokenUsage）、`main/store/store.ts`（recordTokenUsage）、`proxy/routes/chat.ts`（同口径传值）、`renderer/components/dashboard/ModelCacheCard.tsx`、`Dashboard.tsx`、两份 i18n、两组 shared 测试、前缀稳定门。
- P2-D：`docs/providers/deepseek.md`（取证）、`shared/promptCache.ts`（能力表）、`shared/types.ts`（`cacheAffinityMinutes`、`CompressionConfig.providerOverrides`）、`proxy/autoRouter.ts`（亲和）、`proxy/forwarder.ts`（缓存优先压缩解析）、`CompressionSettings.tsx` + 两份 i18n、DeepSeek 真机三组读数。
- P3：`proxy/compression/policy.ts`（A）或 `proxy/compression/index.ts` + `ccr/store.ts`（B）、设计文档退役说明、门禁更新、7 天前置测量报告。

---

## 9. 实施记录（2026-11-08）

已落地：

- **P1-A/B/C**：`RequestLogEntry.usage`（只收上游值）、`DayTokenBucket.byModel`（键 `provider::model`，每日 200 + `__other__`，归一化同步）、`aggregateModelTokenUsage`、仪表盘 `ModelCacheCard`（按模型、可切窗口、缺测显示 `-`、行合计与顶层总数一致）。
  - 补了一条计划外的必要字段：`cacheReadReported`。上游报 `0` 与完全没报必须可分，否则分模型命中率会把"没报缓存"的家显示成 0%。
- **P0**：`shared/promptCache.ts` 能力类型；`AggregateEntry.promptCache`；Anthropic 适配器 `applyCacheBreakpoints`（tools / system / 上一轮末尾，最多 4 个，文本不动，幂等）；`AppConfig.promptCaching` + 设置页开关与 TTL。
- **P2-D**：
  - `docs/providers/deepseek.md` 取证：自动缓存、按完整前缀命中、`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`、"几小时到几天"清退；作用域与最小单位官方页未写，不填。
  - `autoRouting.cacheAffinityMinutes` 默认 **60**（文档下界内），只对能力表已知的供应商写亲和；降质守卫同时撤销亲和。
  - `CompressionConfig.cacheFirst` 默认开 + `providerOverrides`；DeepSeek 默认跳过 live-zone 压缩。
- **P3-A**：`acceptCompression` 增加 `cachePolicy`，门从固定 10% 改为 `1 - c/(1+w)`；只在能力表已知时生效，未知家维持 10%。

仍待：

1. **真机读数**：DeepSeek 三组（现状 / 缓存优先 / +亲和）与 Anthropic 三轮 `cache_read_input_tokens > 0`。本机没有可用的真实 key 会话，未伪造读数。
2. **P3 前置测量**：需要 7 天真实流量才能判断压缩请求中 `R'(1+w) − cR` 为负的比例；A 已落地，B 未拍。
3. **Anthropic 文档逐段复核**：`platform.claude.com` 在本机被区域网关 307 拒；能力表数值标为待复核（见 `docs/providers/anthropic.md`）。
4. `prompt_cache_key` 代生成（P2-G）未做：原计划就是可选项，DeepSeek 不需要，先不向未知家加字段。
