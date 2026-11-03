# PLAN：auto 自动路由强化（v2）

- 日期：2026-10-29
- 状态：已拍板 D1/D2，按阶段 A → B → C → D 执行
- 基线：main @ ac62cea
- 范围：`auto` 虚拟模型的选择逻辑——能力元数据、契约过滤、成本、偏好、粘性、可观测
- 不在本批：语义分类（额外发一次模型调用）、按模型的失败记忆、跨对话摘要路由、`auto` 之外的具名模型路由

## 0. 现状核对（本轮实读，不是推测）

| 已存在的事实 | 位置 |
| --- | --- |
| `auto` 是保留字，请求名 trim + 小写后精确匹配 | `src/main/proxy/autoRouter.ts:23,50-52` |
| `/v1/models` 在开启时把 `auto` 置顶，`owned_by: auto-router` | `src/main/proxy/routes/models.ts:41-49` |
| 候选池 = 每个启用供应商的 `getEffectiveModels`，即用户勾选为 served 的模型 | `src/main/proxy/autoRouter.ts:88`、`src/main/store/store.ts:1720-1729` |
| 硬过滤：vision / tools / contextTokens 布尔判定，空池时只放宽 context 一次 | `src/main/proxy/autoRouting.ts:309-321,413-421` |
| 打分：配额余量、档位匹配、RPM 余量、在途并发、空闲、分散 | `src/main/proxy/autoRouting.ts:334-382` |
| 会话粘性：system + 首条 user 的哈希做键，命中后把候选 splice 到队首 | `src/main/proxy/autoRouting.ts:266-282`、`autoRouter.ts:148-162` |
| 失败切换：429/5xx/无状态码才换，stream 首包后不换 | `src/main/proxy/forwarder.ts:335-386` |
| 可观测：成功时回 `X-ModelPort-Route: <model> (<provider>)` | `src/main/proxy/routes/chat.ts:332` |
| 成本分档函数已经存在且口径明确（unknown 单独成档，绝不折进付费档） | `src/shared/channels.ts:166-175`、`tests/channels/cost-bucket.test.ts` |
| 渠道模型目录已经带 `supportsImage` / `weight` / `free`，但**路由层从未读取** | `src/shared/channels.ts:130-151`、`src/main/providers/accountChannels/modelCatalog.ts:76-110` |
| 聚合目录带每模型 `contextWindow`（46 行有值）、条目 `category` / `freeModelsHint` | `src/shared/aggregateQuota.ts:14-29`、`src/shared/aggregate.ts:32,50` |
| 内置供应商丢弃 `response_format` / `max_tokens` / `seed` 等；只有 `n > 1` 报 400 | `src/main/proxy/parameterPolicy.ts:8-18,27` |
| **内置供应商现在只剩 `opencode` 一个**，`MODEL_CAPABILITIES` 里的 deepseek/glm/kimi… 是已退役网页供应商的 id | `src/main/providers/builtin/index.ts`、`autoRouting.ts:98-150` |
| 聚合供应商的展示名是 `<entryId>/<modelId>`，按 `glm-5.3` 查 `MODEL_CAPABILITIES` 永远查不到 | `src/main/providers/aggregate/registry.ts:2973-2975` |
| 配置面只有 `enabled` / `maxAttempts` / `stickyMinutes` | `src/shared/types.ts:54-67`、`src/main/store/store.ts:72-85` |

三个真实缺口：

1. **能力来源与模型清单分裂。** 能力表手写在路由层（`autoRouting.ts:98-150`），只覆盖 8 家内置；渠道目录的 `supportsImage` 完全没有消费路径，聚合的 `contextWindow` 也没有。未登记模型落到默认值「tools: true、vision: false、context 64000」（`autoRouting.ts:75-80`）——视觉请求永远用不到渠道里的识图模型，而 tools 又可能被发给不支持的模型。
   更糟的是那张表**已经基本失效**：内置只剩 `opencode`，表里的 `deepseek` / `glm` / `kimi` 是已退役网页供应商的 id；聚合的展示名带 `<entryId>/` 前缀，按纯模型名查必然落空。真正还在起作用的只剩 `PROVIDER_DEFAULT_CAPABILITY` 按条目 id 兜底（`glm` / `kimi` / `minimax` 因 id 撞上聚合条目而意外拿到 `vision: true`）。
2. **硬过滤不等于契约过滤。** 只有 vision/tools/context 三项。一个会静默丢掉 `response_format` 的内置供应商，在 auto 下同样会被选中，客户端拿到的是自由文本而不是它要解析的 JSON。
3. **成本与偏好不可表达。** 渠道倍率与聚合免费额度已经是现成数据，打分里没有成本项，"简单请求走免费、复杂请求才付钱"这个场景做不到；调用方也无法表达"这次要快"或"这次要省"。

## 1. 设计

### 1.1 能力三元组与三个来源

`vision` / `tools` 从布尔改为三态（`yes` / `no` / 未知），`contextTokens` 缺失即未知。**"未知"是一个真实状态，不折进任何一侧**（与 `costBucketOf` 把 unknown 单独成档同一个道理）。

来源优先级（高 → 低）：

| 来源 | 载体 | 覆盖 |
| --- | --- | --- |
| 模型标注 | `Provider.modelCapabilities[displayName]`（新字段），由内置配置与渠道同步写入 | 内置、账号渠道 |
| 供应商级默认 | 现有 `PROVIDER_DEFAULT_CAPABILITY`（`autoRouting.ts:86-95`），只描述**适配器**能力（能否上传图片） | 内置 |
| 聚合目录 | `AGGREGATE_QUOTA[provider.aggregateId]` 的每条 `perModel.contextWindow`；`category === 'free-tier'` 或 `freeModelsHint` 含该 id → free | 聚合 |
| 名字启发式 | 现有 `FAST_NAME_PATTERN` / `STRONG_NAME_PATTERN`（`autoRouting.ts:153-154`），只用于档位 | 全部 |
| 未知 | 无标注即未知，不猜 | custom / 长尾 |

判定规则：

- `needsVision` 且 `vision` 不是 `yes` → **排除**（图片被丢掉就是错答案；今天未知也等于排除，行为不回归）。
- `needsTools` 且 `tools === 'no'` → 排除；未知可通过（今天默认 true，不能收紧成排除）。
- 上下文：只有 `contextTokens` 有值才硬过滤；未知时沿用现有 64000 作为 `UNANNOTATED_CONTEXT_FLOOR`（维持现状，见 D2）。

### 1.2 契约过滤

给每个请求推导 `contractNeeds`：`vision`、`tools`、`multiChoice`（`n > 1`）、`structuredOutput`（`response_format.type` ∈ `json_object` / `json_schema`）。供应商能否满足的判定复用 `parameterPolicy` 的口径，不另造一张表。

统一规则：**有能力替代就换过去；没有替代就明示降级，只有图片不允许降级。**

- `multiChoice`：内置供应商本来就会 400（`parameterPolicy.ts:27`），auto 应优先选聚合/自定义候选；全都不能时返回既有的 400 `unsupported_parameter`，与具名路径同一形状。
- `structuredOutput`：内置供应商会丢弃它（`parameterPolicy.ts:10`），优先选聚合/自定义候选；全都不能时照常路由，但回 `X-ModelPort-Auto-Degraded: response_format` 并写进请求日志。
- 与 `docs/plan/PLAN-api-defects.md` 的 P5-1（已拍板：不支持的参数显式 400）不冲突：那张表落地后，`parameterPolicy` 多出"拒绝级别"，auto 直接消费级别，不再自己维护名单。

### 1.3 成本与偏好

成本输入直接用现成的 `costBucketOf(weight, free)`（`src/shared/channels.ts:168`），映射为 `free 1.0 / below-base 0.75 / base 0.5 / unknown 0.5 / above-base 0.25`。unknown 取中性值——既不奖也不罚，与"不知道不等于便宜"一致。

`prefer` 四档，同时决定目标档位与成本权重：

| prefer | 目标档位 | 成本权重 | 说明 |
| --- | --- | --- | --- |
| `balanced`（默认） | 按请求复杂度 | 0.10 | 现状行为的加强版，成本只用于同分时偏向免费 |
| `fast` | 固定 fast | 0.10 | 时延优先 |
| `strong` | 固定 strong | 0.05 | 能力优先 |
| `cheap` | balanced | 0.45 | 省钱优先；免费候选额外加分 |

生效方式：配置里的 `prefer` 是默认值，请求头 `X-Auto-Prefer` 可按次覆盖（非法值忽略并记日志）。

### 1.4 粘性改为加分，不再硬钉

现在命中粘性就把候选 splice 到队首（`autoRouter.ts:148-162`），即使它当前分数远低于别的候选。改成把粘性作为打分输入：完全命中 +0.12，同供应商同模型不同账号 +0.06。首选冷却或配额耗尽时自然让位，而不是被硬钉在一个不可用的目标上。

### 1.5 可观测

- 保留 `X-ModelPort-Route`（已存在）。
- 新增 `X-ModelPort-Auto-Prefer`（本请求生效的偏好）、`X-ModelPort-Auto-Attempts`（实际尝试数）、`X-ModelPort-Auto-Reason`（胜负因子的机器码：`capability` / `tier` / `cost` / `sticky` / `only`）、`X-ModelPort-Auto-Degraded`（仅在降级时出现）。
- `RequestLogEntry` 增加可选 `auto?: { prefer, attempts, candidates: string[], reason? }`；`candidates` 是排名后的展示名，最多 5 条。

## 2. 已拍板（2026-10-29）

| 编号 | 拍板值 | 落地位置 |
| --- | --- | --- |
| D1 | 单一 `auto` + `X-Auto-Prefer` 请求头；不新增虚拟模型名 | B-3 |
| D2 | 未标注上下文的模型沿用 64000 硬上限（`UNANNOTATED_CONTEXT_FLOOR`） | A-4 |

### 原待拍板项（存档）

| 编号 | 问题 | 选项 | 推荐 | 代价 |
| --- | --- | --- | --- | --- |
| D1 | 偏好怎么暴露给调用方 | (a) 单一 `auto` + `X-Auto-Prefer` 请求头；(b) 多个虚拟模型名 `auto-fast` / `auto-cheap` / `auto-strong` | **(a)** | 不发自定义头的客户端只能用配置里的默认偏好；(b) 能覆盖所有客户端，但永久占用命名空间、让 `/v1/models` 变长，且每个新偏好都要加一个保留字 |
| D2 | 未标注上下文的模型怎么参与长请求 | (a) 沿用 64000 硬上限；(b) 收紧到 32000；(c) 不设上限、只扣分 | **(a)** | (a) 维持现状但可能把 60k 请求发给实际上限 32k 的未标注模型；(b) 更保守但会让长请求更容易 503；(c) 最宽松，存在上游静默截断的风险 |

## 3. 实施阶段

全局约束（沿用本仓既有口径）：

1. 每阶段只跑该阶段的定向测试；全量门禁只在阶段 D 跑一次。
2. 每条行为改动配一个能红的负控：把被测分支改回旧行为，该条测试必须红；不写恒真断言。
3. 不靠"默认关闭"交付：新能力在默认配置下必须可用。
4. 能力不靠新旁路：`auto` 的候选池仍然是 `getEffectiveModels`，用户关掉的模型永远不参与。

### 阶段 A：能力元数据与契约过滤（正确性）

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
| --- | --- | --- | --- | --- |
| A-1 | 能力只能从路由层手写表读到；`Provider` 没有任何能力字段（`src/main/store/types.ts:178-224`） | `src/shared/types.ts` 新增 `ModelCapabilityHint = { tier?, vision?, tools?, contextTokens?, weight?, free? }`；`Provider` 与 `BuiltinProviderConfig`（`store/types.ts:108`）各加可选 `modelCapabilities?: Record<string, ModelCapabilityHint>`；`initializeDefaultProviders` 的强制覆盖列表加入该字段 | 单测：保存一个带标注的内置记录，重启初始化后标注仍在且来自代码；负控：覆盖列表去掉该字段 → 标注不生效 | 旧记录该字段缺失即未知，无需迁移 |
| A-2 | 手写表 `MODEL_CAPABILITIES`（`autoRouting.ts:98-150`）的 id 指向已退役的内置供应商；聚合展示名带 `<entryId>/` 前缀，按纯模型名查必然落空（`registry.ts:2973-2975`） | 整表搬到新文件 `src/main/proxy/modelCapabilities.ts` 作为静态参考数据；查询时先拆出 `/` 之后的模型段再查（聚合与账号渠道都适用），未命中再退回整名；补 `opencode` 的 9 个模型标注（全部 free，`nemotron-3.5-super-vl-free` 标 vision yes，其余未知）；`PROVIDER_DEFAULT_CAPABILITY` 保留并注明其真实含义是"按供应商记录的兜底默认" | 单测：`resolveCapability('glm', 'glm/glm-5.3', {})` 命中 glm 的模型行；`opencode` 的 VL 模型 vision 为 yes；负控：不拆前缀时该用例红 | 纯搬家 + 查询修正；`glm`/`kimi`/`minimax` 的条目级 vision 默认保持不变（见风险节） |
| A-3 | 渠道目录的 `supportsImage` / `weight` / `free` 没有消费路径 | `manager.ts:460-500` 的同步循环把 `ChannelModelInfo` 转成标注，`applyChannel`（`manager.ts:553`）写入 `record.modelCapabilities`；`supportsImage === undefined` 不写 vision（保持未知） | 扩展渠道同步测试：给定一份 fixture 目录，断言写入的 record 含 vision/weight/free 且未知项不出现；负控：删掉映射后红 | 记录变大（每模型几十字节） |
| A-4 | `satisfiesCapability` 是布尔判定（`autoRouting.ts:309-318`） | 改三态：vision 必须 `yes` 才可接图片；tools `no` 排除、未知可通过但扣分（`toolsUnverified`）；上下文有值才硬过滤，未知用 `UNANNOTATED_CONTEXT_FLOOR` | 单测三条：已知 no 永不被选；vision 未知在图片请求下不被选；带 `contextTokens: 32000` 的模型不接 40k 请求。负控：把 vision 判据改回"非 no 即可"即红 | 打分权重需重新调平 |
| A-5 | 契约过滤零实现；`response_format` 被静默丢弃（`parameterPolicy.ts:8-18`） | 新增 `contractNeeds(request)`；`autoRouter.select` 先按 `multiChoice` / `structuredOutput` 过滤，全都不能满足时：`multiChoice` 返回既有 400，`structuredOutput` 照常路由并标注降级 | 集成测试：只有内置供应商时 `n=2` → 400；`response_format: json_schema` + 同时存在聚合供应商 → 选中聚合；只有内置时 → 路由成功且带 `X-ModelPort-Auto-Degraded`。负控：去掉过滤即红 | 依赖 `parameterPolicy` 的现有级别；P5-1 落地后自动跟随 |

### 阶段 B：成本与偏好

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
| --- | --- | --- | --- | --- |
| B-1 | 打分无成本项（`autoRouting.ts:334-382`） | `RankCandidate` 增加 `costBucket`；`cost` 因子按 1.3 的映射参与打分；权重读 `prefer` | 单测：同分下 free 胜 base；unknown 与 base 同分；above-base 在 `cheap` 下被 free 明显压过。负控：去掉成本项即红 | 免费候选可能变多，配额消耗更快 |
| B-2 | 配置只有三个字段（`src/shared/types.ts:54-67`） | 增加 `prefer: 'balanced' \| 'fast' \| 'strong' \| 'cheap'`，默认 `balanced`；`normalizeAutoRoutingConfig`（`store.ts:72-85`）校验枚举，非法值回落默认 | 单测：写非法值后读回 `balanced`；负控：去掉校验 → 非法值原样读出 | 旧配置文件缺该字段即默认值 |
| B-3 | 请求侧没有偏好入口 | `chat.ts:190` 一带（与 `x-web-search` 同处）解析 `X-Auto-Prefer`，合法值覆盖配置 | 集成测试：同一候选池下 `X-Auto-Prefer: cheap` 与默认选出不同候选；非法值忽略。负控：忽略该头即红 | 无 |
| B-4 | 设置页只有开关/次数/粘性（`LoadBalanceConfig.tsx:265-316`） | 增加偏好选择；把该文件本地常量 `DEFAULT_AUTO_ROUTING`（`LoadBalanceConfig.tsx:16`）改为 import 共享的 `DEFAULT_AUTO_ROUTING_CONFIG`，消除两处默认值漂移 | 源码测试：渲染层不再定义自己的默认值；`tsc -p tsconfig.json` 0 错误 | 纯 UI |

### 阶段 C：粘性与可观测

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
| --- | --- | --- | --- | --- |
| C-1 | 粘性结果 splice 到队首（`autoRouter.ts:148-162`） | 改为打分输入：完全命中 +0.12、同供应商同模型 +0.06；`rankCandidates` 增加 `sticky` 参数，保持纯函数 | 单测：粘性候选在池内时排第一；从池中消失（冷却/配额）时不影响其它候选顺序；分数差距过大时让位。负控：恢复 splice 即红 | 极端情况下同一对话会换模型 |
| C-2 | 只有 `X-ModelPort-Route`，无理由、无尝试数 | 按 1.5 新增三个响应头；`RequestLogEntry`（`src/shared/types.ts:248`）加 `auto` 字段并在成功/失败两处写入（`chat.ts:416`、`:482`） | 集成测试：成功响应带三个头且值合法；失败响应同样带；请求日志行含 `auto.candidates`。负控：删掉写入即红 | 日志每行 +几十字节 |
| C-3 | 503 只带一句 `No available model for auto routing`（`chat.ts:260-270`） | 加 `details: { missing: ['vision' \| 'tools' \| 'context'], rejected: Record<string, number> }` | 单测：只开纯文本模型时请求图片 → 503 且 `missing` 含 `vision`；负控：去掉 details 即红 | 无 |

### 阶段 D：文档与门禁

| 编号 | 内容 | 验收 |
| --- | --- | --- |
| D-1 | `AGENTS.md` 新增 "Auto Routing" 小节：能力三元组与来源、契约过滤规则、`prefer` 语义、成本分档、粘性、四个响应头、"未知即未知" | 小节与代码逐条对得上（含行号） |
| D-2 | 全量门禁一次跑完 | `npm run build`；`npx tsc --noEmit -p tsconfig.json`；`npx tsc --noEmit -p tsconfig.node.json`；`node --test "tests/**/*.test.ts" "tests/**/*.test.mjs" "tests/**/*.test.js"` 除既有 2 条 skills 环境失败外全绿 |

## 4. 验收总表

| 场景 | 期望 |
| --- | --- |
| 图片请求，池中有已知识图模型 | 选中识图模型（今天只会选内置那几家） |
| 图片请求，池中只有未知模型 | 不选（维持严格） |
| 长请求 100k，池中有标注 128k 的模型 | 只选标注 128k 的 |
| `n=2`，池中含聚合供应商 | 选中聚合供应商 |
| `n=2`，只有内置供应商 | 400 `unsupported_parameter` |
| `json_schema`，只有内置供应商 | 路由成功 + `X-ModelPort-Auto-Degraded` |
| `X-Auto-Prefer: cheap`，池中含免费模型 | 免费模型排第一 |
| 同分候选，一免费一付费 | 免费优先（balanced 默认即生效） |
| 首选账号 429 | 换到同模型的另一个账号，而非换模型 |
| 同一对话第二轮 | 与第一轮同一模型（粘性），除非其不可用 |

## 5. 边界与风险

- **不做语义分类。** 复杂度仍是本地规则分；加一次模型调用会把延迟指标和费用都变坏，收益无法先证明。
- **`auto` 的候选池不扩大。** 用户关掉的模型仍然不参与；这条是既有行为，本计划任何阶段都不得放宽。
- **未知不等于不支持，也不等于支持。** 三态是为了让"不知道"可见，不是给自己一个随便选的借口：有已知可用候选时，未知永远排在后面。
- **成本数据只对渠道和聚合存在。** 内置与自定义没有倍率，成本档为 unknown（中性），`cheap` 偏好对它们没有偏向——这是数据边界，不是实现缺陷。
- **聚合条目级的 vision 默认值没有单独取证。** `glm` / `kimi` / `minimax` 今天的 `vision: true` 继承自已退役的网页适配器（它们当时能上传图片），对聚合线路来说属于未复核的假设。本批保持原值以免造成视觉路由回归，并在代码里注明出处；要收紧就按 `docs/data/free-quota-research/` 的方式逐家取一次证，单列一批。
- **风险点**：A-4 的三态会改变既有打分排序，`tests/proxy/autoRouting.test.ts` 现有 19 条里与顺序相关的用例需要按新权重重新核对（改期望，不是删用例）。

## 6. 实施状态（2026-10-29）

阶段 A、B、C 已落地，文档（D-1）已写入 `AGENTS.md` 的 "Auto Routing" 小节；D-2 门禁见最后一节。

| 阶段 | 状态 | 落地位置 |
| --- | --- | --- |
| A-1 | 完成 | `src/shared/types.ts` 的 `ModelCapabilityHint`；`Provider.modelCapabilities`；`providerSync.ts` 随内置同步覆盖 |
| A-2 | 完成（改法调整，见下） | 静态表落在 `src/main/proxy/modelCapabilities.ts`，按展示名与 `/` 后模型段两次查询 |
| A-3 | 完成 | `modelCatalog.capabilityHintOf()` + 渠道同步写入 `modelCapabilities` |
| A-4 | 完成 | `autoRouting.resolveCapability` 三态合并、`satisfiesCapability` 新规则、`UNANNOTATED_CONTEXT_FLOOR` |
| A-5 | 完成 | `contractNeeds` / `providerMeetsContract` / `applyContractFilter`；chat 路由的 400 与降级头 |
| B-1..B-4 | 完成 | `costBucket` 进打分、`AutoPreference` 配置与归一化、`X-Auto-Prefer`、设置页选择器 + 共享默认值 |
| C-1..C-3 | 完成 | 粘性改加分、三个响应头、`details.missing`、`RequestLogEntry.auto` |

三处与计划原文不同，均已在实现时写明理由：

1. **A-2 没有搬进 `builtin/<id>.ts`。** 核实后发现内置供应商只剩 `opencode` 一个，原表的 id 指向已退役的网页供应商，搬进配置无处可放。改为独立静态表，并修正了"聚合展示名带前缀导致查不到"的问题——这才是那张表此前失效的真实原因。
2. **C-2 的 `reason` 只保留 `only` / `sticky` / `score`。** 原计划的 `capability` / `tier` / `cost` 需要拆解每个因子的贡献才能如实给出；只算冠军不够，算亚军分解又是一套没有消费方的新机制。当前三个值都能从代码直接判定，不会出现"标着 cost 其实是档位"的假归因。
3. **成本进入打分的方式改成加减项** `weight × (costScore − 0.5)`，而不是重新分配既有权重。这样未知成本恰好贡献 0，既有策略的权重量级不变，排序变化可以只用成本项解释。

新增的判据（计划里没写、实现时补的）：

- `explainMissing()`：候选池非空却排不出结果时，503 的 `details.missing` 说明缺 vision / tools / context，而不是一句"没有可用模型"。
- `RequestLogEntry.auto`：`{ prefer, reason, attempts, candidates, degraded? }`，成功与失败日志都写。
- 粘性与成本的新用例覆盖在 `tests/proxy/autoRouting.test.ts`（33 条）；配置归一化拆到 `src/main/store/autoRoutingConfig.ts`，由 `tests/store/auto-routing-config.test.ts` 覆盖。

### D-2 门禁读数（2026-10-29）

| 门 | 命令 | 读数 |
| --- | --- | --- |
| 构建 | `npm run build` | exit 0（含 `check:source-artifacts` 与 channel-pack 打包） |
| 渲染层类型 | `npx tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| 主进程类型 | `npx tsc --noEmit -p tsconfig.node.json` | exit 0，0 错误 |
| 全量测试 | `node --test "tests/**/*.test.ts" "tests/**/*.test.mjs" "tests/**/*.test.js"` | 421 条全过、0 失败 |

未覆盖项：设置页的选择器只经过了类型检查与源码测试（`tests/renderer/auto-routing-settings.test.mjs`），没有在运行中的 Electron 里手点；本轮没有改动布局结构，只在一个既有区块前插入了一个下拉框。

## 7. 2026-11-03 复核与粘性裁定（推翻 §1.4 / C-1 的「不再硬钉队首」）

本轮对账 §6 的自述，用现码与实跑读数逐条核过：A-1…A-5、B-1…B-4、C-2、C-3 与 E 的裸名跨家链都成立（定向 108 条 + `autoRouting-manual.test.ts` 18 条，0 失败）。**只有 C-1 的「不再硬钉队首」已经不成立**，且计划文档一直没跟着改。

事实链：`dd7adf4`「Codex 会话粘性改为路由层硬优先」在 `autoRouter.select` 里加了 `promoteSticky`，把上一轮成功的模型提到队首。因此今天两层同时生效——打分里的 `stickyBonus`（+0.12 / 同供应商不同账号 +0.06）还在，但**首位归属由 `promoteSticky` 决定**，加分只剩「该模型在每账号去重里争到唯一槽」这一层边际作用。判据也随之分裂：`tests/proxy/autoRouting.test.ts` 那条 "never hard-pins it" 只测 `rankCandidates` 纯函数层，管不到 select 层，所以这次回归没有任何用例会红；真正钉住硬优先的是 `tests/routes/routes-pool-and-sticky.test.ts` 的「路由层粘性是硬优先」。

**裁定（2026-11-03）：路由级开关，默认硬钉。** `ModelRoute.stickyHardPin?: boolean`，缺省键（含老 `data.json`）按 `!== false` 解释为开——写成 `=== true` 会让全部老装机静默失去硬钉，与 [[project-modelport-codex-agent-routing]] 记的那次故障正对着。关掉它 = 本计划 §1.4 的纯加分语义，那一层此前没有独立判据，本批要补上「关掉后免费/档位差能压过粘性」的正反两条，否则 0.12/0.06 是否还有作用无法证伪。

- **依据**：agent 会话换模型比慢一点更伤（上下文理解、工具协议、缓存全部重来），且 §7 上面那条实测是 21 次请求跳 7 个模型。
- **代价**：默认档下粘性候选即使分数远低于别家也会被选中；同一段会话第一轮选中谁，整段都跟着它的延迟走——这与 2026-11-03「速度 vs 省钱 → 省钱」那条拍板是同一个对价，不是回归。
- **被推翻时的改法**：把默认值翻成纯加分即可（`promoteSticky` 的调用条件与 `stickyHardPin` 的缺省解释在同一处），退役面只有 `routes-pool-and-sticky.test.ts` 那两条硬优先用例。
- **不做**：不为「关掉硬钉」另造第二条打分通路，加分项沿用既有的 `stickyBonus`。
