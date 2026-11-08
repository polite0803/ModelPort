# 方案：Prompt 缓存命中的实现与强化（P0–P3）

> 成文版本：v1.7.9 ｜ 最后核对：2026-11-08 ｜ 状态：**P0/P1/P2-D/P3-A 已落地；DeepSeek 三组真机读数已取（见 §9.1）；Anthropic 真机读数待补**
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

**读数落库（2026-11-08 已实现）**

请求日志只留约 1–2 天（`maxEntries=200` + 100 条错误保底），7 天测量不能靠日志。压缩判决改为写进按日桶 `DayTokenBucket.compression`：

- `analyzed` / `applied` / `skipped{reason}`：按请求计；`applied=0` 时把拒因记进 `skipped`；
- `byContentType[ct]`：`candidates` / `accepted` / `tokensBefore` / `tokensAfter` / `ratioBuckets`；
- `ratioBuckets` 的边界是 1 / 2 / 5 / 8 / 10 / 25%：2% 是 DeepSeek 的 `c`，8% 是 Anthropic 的 `c/(1+w) = 0.1/1.25`，两条判据不能被一个粗桶抹平；
- 被拒候选原本在 `skipReport` 里被清零，现在 `CompressionReport.candidates` 保留原投影（`accepted=false` + `reason`），否则"本来会赢"永远等于"没有候选"。

读法：管理 RPC `statistics:getTokenUsageDays` 返回的按日桶直接带 `compression`，不再依赖请求日志。两条局限要一起读：桶里没有该供应商的 `c`/`w`（符号判定要按 `AggregateEntry.promptCache` 离线算），候选单位是"进 accept 门的段"而不是请求。

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

1. **真机读数**：DeepSeek 三组已取（§9.1）；Anthropic 三轮 `cache_read_input_tokens > 0` 仍缺——本机没有直连 Anthropic 的账号（只有 bazaarlink 等转售渠道，走的是 OpenAI wire，`cache_control` 到不了真 Anthropic），未伪造读数。2026-11-08 复核了"能不能借道"：网关 25 个供应商全部 `wire=openai-chat`（无 Anthropic wire）；OpenRouter 的 24 个 Claude 型号一律 403「not available in your region」；bazaarlink 的 15 个 Claude 型号全部 402「can only afford 0」（额度为零）。三条指向同一结论：这台机器上不存在通往真 Anthropic 的通路，要取读数只能由用户提供 Anthropic wire 的端点 + key。仓库能力表里现成有三条 `wire=anthropic-messages` 的条目——`anthropic`（api.anthropic.com/v1）、`glm`（api.z.ai/api/anthropic/v1）、`minimax-cn`（api.minimaxi.com/anthropic/v1）——给任何一家的 key 即可，不必是 Anthropic 直连。
2. **P3 前置测量**：需要 7 天真实流量才能判断压缩请求中 `R'(1+w) − cR` 为负的比例；A 已落地，B 未拍。§9.1 已经用单请求读数证明 DeepSeek 上该项为负。§9.2 另有一条硬限制：请求日志只留约 1–2 天（`maxEntries=200` + 100 条错误保底），跨天样本要靠把压缩判读写进按日桶，否则 7 天测量无从取数。
3. **Anthropic 文档逐段复核**：`platform.claude.com` 在本机被区域网关 307 拒；能力表数值标为待复核（见 `docs/providers/anthropic.md`）。
4. `prompt_cache_key` 代生成（P2-G）未做：原计划就是可选项，DeepSeek 不需要，先不向未知家加字段。

## 9.1 DeepSeek 三组真机读数（2026-11-08，WSL 网关 1.7.9）

环境：本机 WSL systemd 单元 `modelport`，HTTP 8080 / HTTPS 8443，仅 1 个 DeepSeek 官方账号（`deepseek`，account `78ab20ab…`）。夹具：`system + user + assistant(tool_calls, reasoning_content 回传) + 7.4 KB 同构 JSON 工具结果`，第 2/3 轮只在尾部追加；同一模型 `deepseek/deepseek-flash`，`temperature=0`。逐请求读上游自己的 `prompt_cache_hit_tokens / prompt_tokens`，不用账本估算。

| 组 | 配置 | 第 1 轮 | 第 2 轮 | 第 3 轮 | 2+3 合计 |
|---|---|---|---|---|---|
| C | `cacheFirst=true`，亲和 60 | 2627 / 384 | 2647 / 2432 | 2663 / 2432 | **4864 / 5310 = 91.6%** |
| B | `cacheFirst=true`，亲和 0 | 2633 / 384 | 2653 / 2432 | 2669 / 2432 | **4864 / 5322 = 91.4%** |
| A | `cacheFirst=false`，亲和 0 | 2594 / 256 | 2614 / 2432 | 2630 / 2432 | **4864 / 5244 = 92.8%** |

结论（三条都必须一起读，否则会误判）：

1. **缓存确实在生效**：同一前缀第 2/3 轮命中 2432 / 约 2650 token（≈92%），与仪表盘今天 `deepseek::deepseek-flash` 的 93.9%（151 条请求）同向。
2. **A 组并没有真的压缩**：关掉 `cacheFirst` 后日志写的是 `compression.skipped = "insufficient_savings"`——P3-A 的经济门按 DeepSeek `c=0.02` 要求省 `1 - 0.02/(1+0) = 98%`而该夹具只省 78%，被正确拒绝。所以 A 组与 B/C 同是未压缩路径，三组命中率一致不是"策略无效"，而是**经济门先于内容压缩生效**。要看到 A 组下降，前提是内容省幅 > 98%，这在真实工具输出里几乎不存在；这也意味着 P3-B（整段重写）在 DeepSeek 上同样过不了这道门。
3. **亲和在这台网关不可观测**：唯一 DeepSeek 账号 ⇒ 没有第二个缓存域可漂移，亲和是空转；验收第 1 条（负控能观察到候选变化）在这里无法做，需至少两个同模型缓存候选才能复测。代码侧由 `tests/proxy/autoRouting.test.ts` 的粘结/亲和成对断言守住。

顺带修正的一处口径：今天日级 `requests=1086` 而按模型明细只有 175 条（升级前的桶没有 `byModel`）。卡片现在会显式写出覆盖缺口（`dashboard.modelCache.coverageNote`），不再让表内合计静默低于旁边的日总量。（同一缺口随时间增长的读数见 §9.2。）

## 9.2 真实流量读数（2026-11-08 07:55，网关 1.7.9，systemd 启动 07:18:10）

来源两个，交叉核对：`/root/.modelport/request-logs/request-logs.ndjson`（294 行，2026-11-06 17:19 → 11-08 07:52）与 `tokenUsage['2026-11-08']`（经管理 RPC `statistics:getTokenUsageDays` 取回，再用 `src/shared/providerUsage.ts` 现算，不手算）。

**缓存命中（只用上游自报值，token 加权）**

| 模型（`provider::model`） | 请求 | prompt | cache | 命中率 |
|---|---|---|---|---|
| `deepseek::deepseek-flash` | 361（355 上游） | 34,605,302 | 33,566,336 | **97.0%** |
| `loomy::loomy/GLM-5.3-Flash` | 52 | 7,410,726 | 6,897,280 | **93.1%** |
| `bailian_token_plan::deepseek-v4.1-flash` | 19（18 上游） | 1,824,811 | 1,624,320 | **89.0%** |
| 当日合计 | 1343（1336 上游） | 127,978,869 | 115,457,600 | **90.2%** |

按会话轮次：DeepSeek 第 2 轮起普遍 97–99.9%，第 1 轮 40.8%（新会话 prefill）——"前缀不动就命中"在真实 agent 流量里成立，不是夹具特有。

**覆盖缺口**：当日分模型明细只覆盖 **425 / 1336（31.8%）**。原因是 07:18:10 才换成 1.7.9，此前的请求由旧版本写入、桶里没有 `byModel`。三条证据：`deepseek` 的 byModel 行 361 条 = 该供应商当日 361 条（升级后的请求全部有归因）；`loomy` 只留下升级后的 52 条（769 − 52 = 717 条在升级前，且该账号随后已不可用）；`raccoon` 的 153 条完全不在表里。所以这是**版本边界**，不是丢数。

**压缩实况（同一保留窗口）**：123 条请求带压缩判读，**全部 skipped**——`below_min_tokens` 57、`below_threshold` 53、`unsupported_type` 13；当日 `savedTokens` 仅 6,036（≈ 当日 prompt 的 0.005%）。P3-A 的新门（`insufficient_savings`）在这个窗口里一次都没成为拒因，说明真实流量的瓶颈在门外两道（最小 token、节省率门槛），缓存折扣门还没轮到发言。

**P3 七天测量的可行性**：`requestLogConfig.maxEntries=200` + 100 条错误保底 ⇒ 日志只保留约 1–2 天（本次 294 行 = 1.6 天），**网关自己产不出 7 天样本**。要真的量 `R'(1+w) − cR` 的符号分布，得先把压缩判读（applied/skipped 原因、before/after、是否缓存候选）落进按日桶，才能跨天累计；该落库已在 §P3「读数落库」实现：从下一次发版起按日桶带 `compression` 计数，7 天样本改由桶累计。

## 9.3 Agnes 三轮回放：能验读数通路，不能验 Anthropic 断点（2026-11-08 08:10）

问题来源：本机没有任何 `wire: "anthropic-messages"` 的可用账号（`anthropic` / `glm` / `minimax-cn` 三家都没配 key；OpenRouter 的 Claude 全是 403 区域限制、bazaarlink 的 Claude 是 402 余额为零），于是提出用 `agnes` 代替。

事实先摆清：`agnes`（`src/main/providers/aggregate/registry.ts:55`）是 `category: apikey`、`wire: "openai-chat"`、`baseUrl https://api.agnes-ai.cn/v1`，模型 `agnes-3.0-flash` / `agnes-2.5-flash`。它**不是** Anthropic wire。

三轮回放（同一稳定前缀 ≈21 KB，第 2/3 轮仅在尾部追加，`agnes/agnes-3.0-flash`，`temperature=0`，经 8080 网关转发）：

| 轮 | HTTP | 延迟 | prompt | 上游 `usage` 缓存字段 |
|---|---|---|---|---|
| 1 | 200 | 8102 ms | 8426 | 无 |
| 2 | 200 | 2014 ms | 8443 | `prompt_tokens_details.cached_tokens = 8192` |
| 3 | 200 | 2062 ms | 8460 | 无 |

结论，必须分两件事说：

1. **读数通路：Agnes 可以当样本。** 第 2 轮 `cached_tokens=8192/8443 ≈ 97%`，延迟 8.1s → 2.0s，走的是 `quota/usage.ts:56` 的 `prompt_tokens_details.cached_tokens` 分支，也就是 OpenAI 风格读数；它证明了网关能读、能归因、能进 `byModel` 桶。
2. **P0 断点注入：Agnes 验不了。** `cache_control` 只在 Anthropic adapter 里由 `applyCacheBreakpoints` 写到 `wire === 'anthropic-messages'` 的请求体上；Agnes 走 `openai-chat`，那段代码一次都不会执行。P0 的验收条件（第 2 轮 `cache_creation_input_tokens` 非零、第 2/3 轮 `cache_read_input_tokens > 0`）只能由 `anthropic` / `glm` / `minimax-cn` 三者之一给出。
3. **附带的一条真实缺口证据**：第 3 轮上游干脆不返回 `prompt_tokens_details`。这正是 `cacheReadReportedRequests` / `upstreamPromptWithCache` 存在的理由——未上报必须显示 `-`，不能在分母里当成 0% 命中。Agnes 是这条口径的现成回归样本。

## 9.4 GLM 的 key 到不了 anthropic wire（2026-11-08 08:18）

用用户提供的 Z.ai key 直接打上游（不经网关，key 只从 stdin 读入、不落盘、不打印），三个目标各一次：

| 目标 | 路由 | 结果 |
|---|---|---|
| `api.z.ai/api/paas/v4/chat/completions` | OpenAI 兼容 | **200**，`prompt_tokens_details.cached_tokens` 有值 |
| `open.bigmodel.cn/api/paas/v4/chat/completions` | OpenAI 兼容 | **200**，同上 |
| `api.z.ai/api/anthropic/v1/messages` | Anthropic 兼容（`glm` 条目的 baseUrl） | **429 `1113` 余额不足或无可用资源包** |
| `open.bigmodel.cn/api/anthropic/v1/messages` | Anthropic 兼容 | **429 `1113`**，同一文案 |

所以不是 key 无效：同一把 key 在两条 OpenAI 兼容路由上都返回 200。z.ai 官方 Claude Code 文档（`https://docs.z.ai/devpack/tool/claude`）把 `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` 只写在 **GLM Coding Plan** 的配置里，从未说明按量余额可走这条路由——与 `1113` 的「无可用资源包」一致：Anthropic 路由要的是订阅资源包，不是 API 余额。

**结论：这把 key 不能当 P0 的验证目标**，而且即使换成 Coding Plan key 也无法直接验收，还缺第二块：

1. **z.ai 只文档化了隐式缓存**（`https://docs.z.ai/guides/capabilities/cache`：`usage.prompt_tokens_details.cached_tokens`、约 50% 折扣、无最小长度、TTL 未给数字），**没有任何 `cache_control`**。
2. 因此 `glm` 条目（`registry.ts:560`）没有 `promptCache` 证据 ⇒ `promptCacheOf` 返回 `unknown` ⇒ `applyCacheBreakpoints` 在请求进入前就返回（`adapters/anthropic.ts:370`），网关根本不会写断点。在补上 `explicit-breakpoints` 证据之前，用 GLM 测 P0 只会得到 `cache_creation_input_tokens` 恒 0 的假失败。
3. 唯一有 `explicit-breakpoints` 证据的条目是 `anthropic`（`registry.ts:130`，`minCacheableTokens=1024`、`readDiscount=0.1`、`writeMultiplier=0.25`）。

**P0 真机验收的剩余路径**：`anthropic` 直连 key（能力表已就绪，插上即可验），或 `minimax-cn`（须先确认其 Anthropic 兼容路由是否文档化支持 `cache_control`，否则同样要先补证据）。**不要**为了凑读数给 `glm` 添加没有文档支撑的 explicit 证据。

## 9.5 MiniMax CN 的 key：鉴权通过、余额为零（2026-11-08 08:26）

同一把 key 直接打上游（只从 stdin 读入，不落盘、不打印）：

| 目标 | 模型 | 结果 |
|---|---|---|
| `api.minimaxi.com/anthropic/v1/messages` | `MiniMax-M3` | **402** `insufficient_balance_error (1008)` |
| 同上 | `MiniMax-M2.7` / `M2.5` / `M2.1` | **404** `no longer available (2069)` |
| `api.minimaxi.com/v1/chat/completions`（OpenAI 兼容） | `MiniMax-M3` | **402 (1008)**；`M2.5` → **404 (2069)** |
| `api.minimax.io`（国际站，两条 wire 各一次） | `MiniMax-M3` | **401** `invalid api key` |

结论三条：

1. **key 是真的、且只属于国内站**：国际站一律 401，国内站的失败是业务错误（402/404），不是鉴权错误。但**账户余额为零**，两条 wire 都跑不出一笔请求 ⇒ 这把 key 同样不能当 P0 的验证目标。
2. **`minimax-cn` 的模型清单已过期**：条目里 4 个模型有 3 个（M2.1 / M2.5 / M2.7）被上游回 404「no longer available」，只有 `MiniMax-M3` 还活着。这是真机事实，与 P0 无关，单独记为待修（改清单前应先跑一次在线同步确认当前 id）。
3. **能力证据是现成的**：MiniMax 有专门的《Anthropic 主动缓存》文档（`https://platform.minimaxi.com/docs/api-reference/anthropic-api-compatible-cache`），示例就是在 system 块上放 `cache_control: {type:'ephemeral'}`，并说明 `cache_creation_input_tokens` / `cache_read_input_tokens` 的语义。所以 `minimax-cn` 一旦账户有余额，就是合法的 P0 目标——但仍需**先补 `promptCache` 证据**（当前为 `unknown`，adapter 一次都不会注入），且补证据与真机验收必须在同一轮完成。

P0 代码侧的覆盖没有缺口：`tests/proxy/anthropic-cache-breakpoints.test.ts` 的 8 条用例已经钉住断点位置、上限、1h TTL、`tool_choice:none` 不产生悬空断点、幂等，以及「剥掉 marker 后与原 body 深度相等」。**唯一缺的仍然只有上游接受度这一条真机读数。**

## 9.6 复测：MiniMax 通了，但它是隐式缓存（2026-11-08 08:49）

复测同一把 MiniMax CN key：账户现在能出请求（`MiniMax-M3` 200），GLM 的 Anthropic 路由仍是 `429 1113`。MiniMax 的 `usage` 自带 `cache_creation_input_tokens` / `cache_read_input_tokens`，所以用**全新前缀**做了对照实验（每轮独立 nonce，绝不复用 §9.5 的前缀）：

| 轮 | 前缀 | 断点 | input | cache_creation | cache_read |
|---|---|---|---|---|---|
| A1 | 全新 A | `cache_control` | 3539 | **0** | 0 |
| A2 | A 第二次 | `cache_control` | 211 | 0 | 3328 |
| B1 | 全新 B | 无 | 3411 | 0 | 128（部分） |
| B2 | B 第二次 | **无** | 1 | 0 | **3538** |
| B3 | B 第三次 | `cache_control` | 1 | 0 | **3538** |

结论只有一句能同时解释五行：**MiniMax 的 Anthropic 路由是隐式前缀缓存，`cache_control` 是空操作**。

1. 全新前缀**带**断点首发（A1）的 `cache_creation_input_tokens` 是 0——如果它按 Anthropic 的显式语义计费，这里必须 > 0。
2. 全新前缀**不带**断点，第二次就整段命中（B2：`cache_read=3538/3539`）——缓存与断点无关。
3. 同一前缀加不加断点，读数完全一样（B2 vs B3）。所以断点既没有增量、也没有写成本。
4. MiniMax 那篇《Anthropic 主动缓存》文档给了 `cache_control` 示例，但真机行为与「显式」不符——**文档不能当能力证据，这一条只能靠实测**（正是 AGENTS 里「没有证据就是 unknown」要防的坑）。

**所以 MiniMax 也验不了 P0**，它和 DeepSeek / Agnes 同属隐式一类；给它（或 `glm`）加 `explicit-breakpoints` 证据都是错的。

**模型清单的真机事实**（同一 Anthropic 路由，单发各一次）：`MiniMax-M3` 200、`MiniMax-M3.1-Flash` 200；`MiniMax-M2.1` / `M2.5` / `M2.7` / `M2.7-highspeed` / `M2` 全部 `404 (2069) no longer available`。注意 `/v1/models` 仍把 M2.x 列出来，那个清单**不可用于判断 Anthropic 路由能出哪些模型**。`minimax-cn` 条目现有的 4 个 id 里只有 M3 仍可用。

**P0 的状态**：代码侧 8 条单测已覆盖，真机侧仍缺。本机能拿到的每一条 wire 都是隐式缓存（DeepSeek、Agnes、GLM 的 OpenAI 路由、MiniMax），要取「显式断点被上游接受」的读数，需要一个**真正按显式语义计费**的端点（Anthropic 直连，或同样支持 cache_control 写入计费的 Claude 兼容渠道）。

## 9.7 落地记录：minimax-cn 按隐式缓存接入（2026-11-08 09:05）

按 §9.6 的实测把 `minimax-cn` 归到隐式一类，改动四处：

1. `src/main/providers/aggregate/registry.ts`（`id: minimax-cn`）
   - `promptCache` 新增：`mode: implicit-prefix`、`readDiscount: 0.1`、`acceptsPromptCacheKey: false`，
     `evidence.docUrl = https://platform.minimax.cn/docs/api-reference/text-prompt-caching`、`asOf: 2026-11-08`。
   - 模型清单按真机裁剪为 `MiniMax-M3.1-Flash` + `MiniMax-M3`（M2.x 两条 wire 都回 404/2069）。
   - `notes` 写明「缓存是自动的、M2.x 在此路由已下线」，避免下一个人照 `/v1/models` 加回来。
2. `tests/aggregate/registry.test.ts`：目录模型总数 570 → 568，并在既有变更流水里记了原因
   （这条断言本来就是「条数 + 变更史」的守卫，不是纯数字）。
3. `docs/providers/minimax-cn.md`：新建，记录官方要点、五行对照实测、模型清单事实与**未取证项**（TTL、正式倍率、国际站条目）。
4. 全仓「89 条 / 570 模型」的现行口径同步为 568（AGENTS.md、两份 README、docs/features、docs/providers/README、docs/README、repo-description、CODE_WIKI 与两处源码注释）；带日期的历史记录（`docs/design/2026-11-04-…`、`modelMetadata.ts` 的 1.7.2 回顾、`autoRouting.test.ts` 的 2026-11-04 注释）**不改**，它们是当时读数。

生效面（代码层面）：

- `isCacheSensitive` 对它为真 ⇒ `cacheFirst` 会跳过 live-zone 压缩；
- `cacheEconomicsOf` 得 `{readDiscount: 0.1, writeMultiplier: 0}` ⇒ P3-A 的经济门要求省幅 > 90%；
- `autoRouting` 的缓存亲和把它算作「已知缓存供应商」，同一会话尽量不换账号（M3 与 M3.1-Flash 是不同的缓存域）。

P0 的状态不变：这仍然是隐式端点，**没有** `explicit-breakpoints` 证据；真机验收依旧等一个显式计费的端点。

## 9.8 部署后线上核对（2026-11-08 09:20）

**构建与门禁**：`npm run build` + `build:daemon` + 两个 `tsc -p` + 全量用例，**EXIT=0，1972 通过 / 0 失败**，daemon 产物 4605 KB（v1.7.9），两份 tsc 均 0 错误。

**部署**：WSL `/root/mpd/modelport-daemon.cjs` 已换为 4,715,830 字节（旧件备份 `modelport-daemon.cjs.bak-20261108-0915`，4,709,840 字节），属主 1001:1001；`grep -c 'MiniMax-M3.1-Flash'` = 2，包内 `minimax-cn` 记录确带 `promptCache.mode = implicit-prefix`。`systemctl is-active` = active，`ActiveEnterTimestamp=2026-11-08 08:59:51 CST`，`/health` 200，journal 无异常。

**代码侧运行时核对**（直接跑源码，不经猜测）：`minimax-cn` → `wire=anthropic-messages`、`models=MiniMax-M3.1-Flash,MiniMax-M3`、`mode=implicit-prefix`、`readDiscount=0.1`、`isCacheSensitive=true`、`cacheEconomicsOf={readDiscount:0.1,writeMultiplier:0}`、`explicitPathEligible=false`（即 `applyCacheBreakpoints` 不会碰它）。

**读数通路的线上实证**：同一时段真实流量里 `bailian_token_plan/deepseek-v4.1-flash` 的多条记录 `usage.source=upstream`、`cacheReadTokens` 分别为 68096/68676、160000/160465、67584/68293、159488/159764（≈99%），证明新 bundle 的 `prompt_tokens_details.cached_tokens` 归因仍然工作。

**新的真机事实：多账号轮换会毁掉隐式前缀复用。** 用 `agnes/agnes-3.0-flash` 发三轮同前缀（5,476 prompt，仅尾部不同）：三轮都 200，但 `cached_tokens` 三轮全缺；日志显示三轮落在**三个不同账号**（`…841 / …845 / …849`）。`agnes` 在能力表里是 `unknown`，不享受 `cacheAffinityMinutes`，于是被轮换打散。这条同时修正 §9.3 的取样口径：Agnes 第 2 轮那 8192/8443 的命中只在**恰好同账号**时成立，多账号下不可复现——读数通路照样能验，但必须先把样本钉在同一个账号上。反过来也说明 §9.7 把 `minimax-cn` 登记为已知缓存供应商是有实际收益的：它会拿到缓存亲和，不会像 Agnes 这样被轮换拆散。

**minimax-cn 的端点级验收：已完成（更正上一条的"未配置"）。** 我 09:0x 盘点时门店里确实还没有这条记录；用户在 **09:06:19**（`data.json` mtime）把它添加并填了 Key，于是本次直接验收。配置：1 个账号（`2cc7f9ff-…`）、`promptCaching.enabled=true`、`compression.enabled=true`、`cacheFirst=true`；夹具约 4,000 token，按真实多轮形状逐轮追加 assistant/user，轮间隔 2 秒：

| 轮 | 消息数 | prompt | `cached_tokens` | 延迟 |
|---|---|---|---|---|
| 1 | 1 | 3988 | 128 | 5118 ms |
| 2 | 3 | 4005 | **未上报（null）** | 2077 ms |
| 3 | 5 | 4022 | **3840（95.5%）** | 947 ms |
| 4 | 7 | 4039 | **3840（95.1%）** | 1002 ms |
| 5 | 9 | 4056 | **3840（94.7%）** | 1281 ms |

第 2 轮那个 `null` 是现成的"上游没报 ⇒ 显示 `-`、不当 0%"回归样本；第 3 轮起的 3840 是 30×128 的块对齐值，延迟同步骤降。

**另一条推翻直觉的真机事实：MiniMax 的隐式缓存按"完整消息"做键，不是同一消息内的任意 token 前缀。**

- 只改同一条 user message 末尾 3 个 token（`Answer A.` → `Answer B.`）：公共前缀约 3840 token，读数仍是 **0**。
- 同体重复：3840；换回 A：仍 3840；隔 10 秒：仍 3840 ⇒ 多条不同尾部的条目可以并存。
- 真实多轮形状（历史消息字节不变、只在末尾追加）：R2/R3 都 3840。

所以对这类端点，**任何改写历史消息内容的 live-zone 压缩都会让缓存从改写点起整段作废**（DeepSeek 是 token 前缀，压尾部还能吃到前半段）。P3-A 的 90.9% 门在 MiniMax 上要比 DeepSeek 更保守：省幅必须覆盖"整段失效"的风险，而不只是单请求的 `1 - c/(1+w)`。

**网关不改写请求体**：直连先写、网关同文读 3840/3989；网关先写、直连同文读 3986/3987，两个方向都整段命中——所以 §9.8 前面那次"经网关只有 128"是夹具改尾所致，不是网关缺陷。

**存量记录不用清理（更正上一版的"偏差"说法）**：该供应商的 `supportedModels` 仍是添加时的 9 个 id，其中 7 个 M2.x 在此路由 404。但模型管理面板里停用这些模型写的就是 `excludedModels`（`setModelEnabled → storeManager.setModelsServed`），它已被填上这 7 个名字，且 `modelServing.applyServed` 把它作为"在服务"的唯一权威——这 7 个既不在路由候选池，也不接受点名请求；线上 `/v1/models` 实测无任何 minimax 条目。`modelMappings.disabled` 是用户别名的账，与目录模型停用无关，两个都是 false 不代表"没停用"。所以这里没有待修项，只有新添加的条目会用裁剪后的 2 个模型。

## 9.9 为什么命中率停在 97%，而 DeepSeek 自家 harness 能到 99.7%（2026-11-08 10:45）

**先排除网关**。同一夹具（约 5k 前缀、逐轮追加）直连与经网关各跑 6 轮，逐轮 `uncached` token 为 1101/1103、962/964、1079/1081、940/942、1057/1059——每轮差 ≤2。网关不改写请求体，也不吃缓存。

**97% 是「每轮新增占总量」的算术结果，不是读数缺陷。** 今天 `bailian_token_plan/deepseek-v4.1-flash`：741 请求、77,213,244 prompt、75,043,584 cached（**97.19%**）⇒ 平均每个请求 2,949 个未命中 token、平均 prompt 104,200。逐轮比值本就等于 `1 − 新增/总长度`。

按请求拆近 300 行窗口（53 条 deepseek）：

| 分组 | 条数 | 命中率 |
|---|---|---|
| 全部已上报 | 51 | 中位 **98.8%**，19 条 ≥99%（均值 99.41%，最高 99.77%） |
| `turn<=1`（每段会话第一轮，必然全价） | 3 | 32.72% |
| `turn 2–3` / `4–10` / `11–30` | 8 / 17 / 18 | 97.54% / 97.71% / **99.02%** |
| `turn 31+` | 11 | 89.43% |

`turn 31+` 反过来最低，是被客户端自己的上下文重写拖垮的：一条 `p=156,867 / c=5,376`（**3.4%**）、一条 85.8%，前面几轮分别是 99.5%–99.7%。客户端是 `undici`（agent 侧），它裁剪/摘要后前缀整段作废，与网关无关。规模维度是同一件事：60–120k 前缀 97.83%，120k+ 93.82%（长上下文里被重写的概率更高）。

结论：**99.7% 需要「每轮新增 ≈ 前缀的 0.3%」，97% 对应「每轮新增 ≈ 2.8%」**。这个比值由客户端每轮追加多少决定；本网关自己的样本里 99.7%/99.8% 都有（`171,008/171,522`、`68,096/68,254`），天花板不是模型也不是网关。

**能把它抬上去的只有压缩，而压缩现在几乎不触发。** 今天落在已知缓存供应商上的 212 条请求里 `applied` 只有 **1** 条（bailian 的 `build_output` 1460→533）；跳过原因 `below_threshold` 101、`below_min_tokens` 67、`unsupported_type` 41、`no_live_zone` 2——211/212 连「要不要压」都没轮到。

**并且 P3-A 的门把经济学用反了（本条是待修项）。** `compression/policy.ts:67-73` 把供应商的缓存折扣套到 live zone 上，官方 DeepSeek 于是要求 **98%** 省幅（`1 - 0.02/(1+0)`）。但 `liveZone.ts:86-121` 选中的正是本轮才出现、**从未被缓存过**的最新 tool/user 消息——改写它不损失任何已缓存字节，而省下的 token 从下一轮起作为前缀被反复以缓存价读。正确门槛是 `MIN_SAVINGS_RATIO`（10%）。现在这道 98% 门等于在唯一安全的改写位置上把压缩关掉，两个目标（省 token、抬命中率）同时失效。

修法：live zone 不传 `cachePolicy`（或 policy 增加 zone 参数，live zone 走 10%）。第二道闸（`CONTENT_TYPE_MIN_BYTES` / `MIN_MESSAGE_TOKENS` / 未支持类型）吞掉另外 211 条，那是另一个量级的问题，需要单独定阈值。
