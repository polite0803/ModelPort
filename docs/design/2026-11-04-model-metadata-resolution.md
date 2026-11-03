# 模型元数据自动标注：分层解析链

> 适用版本：v1.7.x ｜ 最后核对：2026-11-04 ｜ 状态：已落地（第 0–5 步；第 3 步的阶梯探测见 §8，第 5 步的标准库层见 §9）

- 日期：2026-11-04
- 范围：模型类型、输入模态、`vision` / `tools` / `reasoning`、上下文窗口、输出上限、消耗权重与免费位的解析与呈现
- 不在本批：`/v1/models` 的广告口径（仍是「声明级才输出」）、账号通道倍率解析（`accountChannels/modelCatalog.ts` 原样保留）

## 1. 为什么需要「一条解析链」

这些属性今天分散在五处：供应商记录（`provider.modelCapabilities`）、聚合官方旁表
（`shared/aggregateQuota.ts`）、第三方旁表（`shared/aggregateCapabilities.ts`）、
静态表（`main/proxy/modelCapabilities.ts`）、手工标注（`userModelMarks`）。路由在
`autoRouting.ts::resolveCapabilityDetail` 里临时按顺序挑值，**界面与覆盖率没有任何统一入口**：

- 新同步回来的模型常常只有 `displayName` / `actualModelId`，其余字段全空；
- 「空字段」无法区分「上游明确说没有」和「谁都不知道」；
- 数值没有 `asOf`，探测结果无法过期；
- 用户看不出某个数是官方声明、按名字推的，还是实测的。

本设计新增一层**只读的元数据解析**，不替代路由的既有合并（`resolveCapabilityDetail`），
而是把同一批证据折成带来源/置信度/时间的 `ModelFact`，供界面、覆盖率与路由共用同一份
优先级表。

## 2. 来源链与优先级

从高到低（`shared/modelMetadata.ts::METADATA_SOURCE_PRIORITY`）：

| 优先级 | 来源 | 典型证据 | 置信度 |
| --- | --- | --- | --- |
| 1 | `manual` | `userModelMarks` | `declared` |
| 2 | `upstream` | 供应商同步的 `modelCapabilities`、聚合官方额度旁表、models.dev 旁表、渠道包 `context_window` | `declared` / `inferred`（第三方） |
| 3 | `catalog` | 标准模型库快照 + 用户逐字段采用（adoption ledger），见 §9 | `inferred` |
| 4 | `probe` | `~/.modelport/derived/model-probes.json`（手动探测，带 `asOf`） | `measured` |
| 5 | `family-rule` | `shared/modelFamilyRules.ts` 的家族规则表 | `inferred` |
| 6 | `cost-ledger` | `docs/data/**` 票据生成的 `aggregatePricing` / 官方免费清单 | `declared` |

规则：

- **同字段按上表取第一条有值的层**；缺席的层不参与，不写默认值。
- `source` 只有六个取值 + `unclassified`；细分出处写在 `evidence`（例如
  `models.dev@2026-10-31`）。这样「六层」不会因为旁表增多而膨胀成十层。
- 2026-11-04 的裁定把标准库层插在「上游声明」与「实测探测」之间：人工标记 > 上游声明 >
  标准库（含已采用的 adoption）> 实测探测 > 家族规则。标准库值置信度一律 `inferred`，
  采用是用户逐字段的显式动作，但**永远不能**盖住人工标记或上游声明。
- 实测探测因此排在家族规则**之前**（与第 3 步落地时的顺序不同）：实测值优先于按名字
  推的规则值。若将来要再调整，只改 `METADATA_SOURCE_PRIORITY` 一处，并同步 §6 的对外
  门槛判断。
- 权重/免费位只由 `cost-ledger` 或 `upstream`（渠道倍率）给出；**拿不到就是
  `unclassified`，绝不折算为 0**（`docs/data/**` 未公布即 `undocumented`）。
- 标准库的价格**不参与这一优先级链**：它没有对应的 `MetadataAttribute`，采用记录里的
  `price` 也不会被折成能力 hint（见 §9）。

## 3. 数据结构

```ts
interface KnownFact<T> {
  state: 'known'
  value: T
  source: 'manual' | 'upstream' | 'catalog' | 'probe' | 'family-rule' | 'cost-ledger'
  confidence: 'declared' | 'inferred' | 'measured'
  asOf?: string          // ISO-8601；只在上游/探测给出时存在
  evidence?: string      // 人类可读出处，不参与判定
}
interface UnclassifiedFact { state: 'unclassified' }
type Fact<T> = KnownFact<T> | UnclassifiedFact
```

一条模型的解析结果（`ModelMetadata`）按属性平铺：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `modelType` | `multimodal` / `text` / `unknown` | **派生**：已知 `modalities` 优先，其次 `vision`；两者都未知才 `unknown` |
| `vision` / `tools` / `reasoning` | `yes` / `no` | 三态里的 `unknown` 表达为 `unclassified` |
| `modalities` | `InputModality[]` | 缺失即未知（不是 `['text']`） |
| `contextTokens` | `number` | token 单位；非 token 口径的数字不写入 |
| `maxOutputTokens` | `number` | 同上 |
| `weight` | `number` | 消耗倍率；未知不是 0 |
| `free` | `boolean` | 只有明确为真/假才算已知 |

`unclassified` 是**一等状态**：解析层一定返回 `{state:'unclassified'}`，不会让字段散落成
`undefined`；界面据此渲染「待标注」而不是空白格。

## 4. 数据分库

| 数据 | 位置 | 是否可重建 | 同步/重建会不会擦除 |
| --- | --- | --- | --- |
| 手工标注 | `data.json::userModelMarks` | 否 | **不会**（与 `userModelOverrides` 分开，既有不变量） |
| 目录/别名 | `data.json::userModelOverrides` | 是 | 同步重建 |
| 上游声明 | `provider.modelCapabilities`（同步写入） | 是 | 每次同步重建 |
| 官方/第三方旁表 | `src/shared/aggregate*.ts` | 是（builder 脚本） | 重新生成 |
| 探测结果 | `~/.modelport/derived/model-probes.json` | 是 | 手动重探覆盖 |
| 标准库快照 | `~/.modelport/derived/model-catalog.json`（三个来源各一份） | 是 | 用户显式刷新覆盖单个来源 |
| 标准库采用 | `data.json::catalogAdoptions` | 否 | **不会**（快照刷新/删除不擦除；与 `userModelMarks` 分开） |
| 元数据解析 | 无持久化（每次现算） | — | — |

探测 sidecar 与标准库快照都是**衍生数据**，不进任何生成物；删除它们只会让对应层缺席。
生成物（`aggregateQuota` / `aggregatePricing` / `aggregateCapabilities`）仍然只由
`docs/data/**` 票据 + 脚本产出，禁止手改 —— 标准库数据**不并入** `aggregatePricing`。

## 5. 墓碑与 TTL

- 探测行带 `asOf`（写入时刻）。`MODEL_PROBE_TTL_DAYS = 30`，超过即 `expired`。
- `expired` 行**不参与解析**，界面显示「已过期」，可手动重探；不保留墓碑行，旧行被同键新行替换。
- 上游/官方旁表的 `asOf` 原样透传（`aggregateQuota` 已有 `asOf`）；没有时省略键，不编时间。
- 目录里消失的模型：解析只在**当前目录**内进行，旧探测行保留在 sidecar 里但不展示；
  同键模型重新出现时仍然可用（直到 TTL 过期）。

## 6. 覆盖率指标与对外暴露门槛

覆盖率按**属性**统计：

```
coverage[attr] = { known: 已知的行数, total: 当前目录总行数, rate: known / total }
```

`rate` 为 0–1 的比值，界面按百分比显示。分母只算启用供应商的目录（含停用但仍在目录里的行），
与「待标注队列」同源，避免两个页面各算一套。

**对外暴露门槛**（不可协商，源自 AGENTS.md）：

- `/v1/models` 的 `context_window` 只输出**声明级**事实（`upstream` 中来自官方/供应商声明的值，
  或 `manual`），`catalog` / `family-rule` / `probe` / 第三方推定值**一律不对外**；
- 标准库值属于 `catalog` 级，即便被用户采用也只是内部证据，**不外泄为事实**；
- 没有声明级事实时**省略键**，不输出 0 或推定价；
- 内部推定值只进入路由过滤/打分与界面，不进响应体；
- 上游没报 `usage` 就保持 `null`，探测读数不改写 `usage`。

## 7. 与现有模块的接入点

| 模块 | 接入方式 |
| --- | --- |
| `main/providers/modelMetadataService.ts`（新增） | 汇总目录、手工标注、旁表、家族规则、探测 sidecar，产出 `ModelMetadataReport` |
| `shared/modelMetadata.ts`（新增） | 唯一优先级表、`mergeModelMetadata`、覆盖率与队列纯函数 |
| `shared/modelFamilyRules.ts`（新增） | 家族规则表（每条带 `evidence`），被解析服务与 `autoRouting` 消费 |
| `shared/modelProbe.ts`（新增） | 探测行类型、TTL、`fresh` / `expired` 判定 |
| `main/providers/modelProbeStore.ts`（新增） | sidecar 读写（原子写）、手动探测入口 |
| `shared/modelCatalog.ts`（新增，§9） | 快照/条目校验、三档匹配、adoption ledger 与价格隔离 |
| `main/providers/modelCatalogStore.ts`（新增） | 标准库快照 sidecar 读写（原子写、损坏降级为空） |
| `main/providers/modelCatalogParsers.ts`（新增） | models.dev / LiteLLM / OpenRouter 的本地解析器 |
| `main/providers/modelCatalogService.ts`（新增） | 显式刷新、候选查询、逐字段采用/撤销 |
| `main/proxy/modelCapabilities.ts` | 静态表保留；`autoRouting.ts` 在其后叠加家族规则 |
| `main/proxy/autoRouting.ts` | `ModelCapability` 增加 `maxOutputTokens` 与来源；推定值进入硬过滤/打分 |
| `renderer/components/models/ModelMetadataPanel.tsx` | 覆盖率看板 + 标准库快照卡片 + 待标注队列 + 候选/采用对话框 |
| `renderer/pages/Models.tsx` | 「标注覆盖」页签入口 |
| IPC | `providers:getModelMetadata`、`providers:probeModel`、`providers:getCatalogStatuses`、`providers:refreshCatalog`、`providers:getCatalogCandidates`、`providers:adoptCatalogField`、`providers:revokeCatalogAdoption`（刷新/探测都只在用户显式触发时执行） |

不修改 `docs/README.md` 索引（另一任务在整理索引）；索引需要补的条目见交付说明。

## 8. 第 3 步的边界（诚实记录）

- 已落地：sidecar 结构、TTL/过期、手动「探测」入口、把探测结果写成 `asOf` 行。
- 探测覆盖：可达性 + 工具调用接受性 + 图片输入接受性（三条极小请求，`max_tokens` 很小）。
- 上下文窗口：按 `4k / 8k / 16k / 32k / 64k / 96k / 128k / 200k` 阶梯向上试，首个明确
  超限档的前一档为下界、失败档为上界（如「≥64K, <128K」）。有家族规则/声明推定值时
  只试相邻三档，界面确认框显示「请求条数上限 + 输入/输出 token 预估」，用户确认后才发。
- 输出上限：按 `1k / 2k / 4k / 8k / 16k / 32k` 阶梯发 `max_tokens`（`max_completion_tokens`
  先经 `normalizeOutputCap` 折叠），用 `finish_reason=length` 与 `usage.completion_tokens`
  判定真实截断点；成功但内容提前停止记为 `suspect`，不升级为结论。
- 429 / 401 / 403 / 5xx / 网络错误 / 超时一律记 `inconclusive`，**不写任何上限**；本地准入
  或额度闸门命中记 `deferred`（暂缓），不抢占真实流量、不触发冷却。
- 已有声明级来源的模型默认跳过，界面明示「已声明，无需探测」；`force` 才重测，且重测
  只新增 `measured` 证据，人工标注仍最高优先级。
- 探测请求走 `probe: true`：跳过派发账本、AIMD/Bandit/冷却与上下文裁剪；请求日志行带
  `kind: 'probe'`，不计入请求统计。全局串行队列保证同一模型串行、跨模型并发上限 1。

## 9. 标准库层（第 5 步）

手动标注页从「只能手填」扩展为「可按字段从第三方标准台账补全」。核心口径是**快照式、
默认不采用、采用可撤销**；标准库始终是 `catalog` 级内部证据，不是本项目官方数据。

### 9.1 快照结构

三个可选来源（`shared/modelCatalog.ts::CATALOG_SOURCES`）：

| 来源 | 抓取地址 | 许可/归属 |
| --- | --- | --- |
| models.dev（主） | `https://models.dev/api.json` | MIT（models.dev 仓库），models.dev contributors |
| LiteLLM（次级） | `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json` | MIT（BerriAI/LiteLLM 仓库），BerriAI / LiteLLM |
| OpenRouter（次级） | `https://openrouter.ai/api/v1/models` | OpenRouter API 使用条款（数据按原样提供） |

落盘位置 `~/.modelport/derived/model-catalog.json`（衍生数据，可删除重建）：

```ts
interface CatalogSnapshot {
  source: 'models.dev' | 'litellm' | 'openrouter'
  sourceUrl: string
  fetchedAt: string       // ISO-8601
  contentHash: string     // 原始响应体的 sha256
  license: string
  attribution: string
  entries: CatalogEntry[] // 只保留至少有一个可用字段的条目
}
interface CatalogStore {
  version: 1
  snapshots: Partial<Record<CatalogSourceId, CatalogSnapshot>>
}
```

- **打开页面不联网**：`getCatalogStatuses()` 只读磁盘元数据（来源、URL、时间、指纹、
  许可、归属、条目数）；唯一的网络路径是用户点击的 `refreshCatalog(source)`。
- **刷新失败保留旧快照**：HTTP 非 2xx、超时、JSON 损坏、解析为空都返回 `success:false`，
  写盘只发生在成功解析之后；`catalogSnapshotStatuses` 仍返回磁盘上的上一份数据。
- **写入是原子的**：唯一临时文件 + `rename`，且只覆盖被刷新的来源，其他来源保持原样。
- **外部数据一律校验**：字段类型、正整数、上下文 ≤ 100,000,000、输出上限沿用
  **1,000,000** 上界、价格 0–10,000,000 USD/1M；模态只接受已知集合。元数据字段缺一即
  视为快照损坏，整份降级为空台账（界面显示「尚未抓取」而不是报错）。
- 三个解析器（`modelCatalogParsers.ts`）把各自 shape 折成同一条目；价格在解析时一次性
  换算成 **USD / 1M tokens**（LiteLLM/OpenRouter 的 per-token 值 × 1e6），之后不再换算。

### 9.2 匹配策略（三档 + 置信度）

| 档位 | 规则 | 例子 |
| --- | --- | --- |
| `exact` | 原文 `actualModelId` 或 `displayName` 与条目 `id` 完全相同 | `gpt-4o` |
| `alias` | `normalizeCatalogAlias`：去 provider 前缀（最后一个 `/` 之前）、去 `-YYYY-MM-DD` / `-YYYYMMDD` 日期后缀、去 `-latest`、大小写归一、非字母数字折成 `-` | `openai/gpt-4o-2024-08-06` → `gpt-4o` |
| `family` | `catalogFamilyKey`：别名键的第一段且长度 ≥ 3 | `claude-3-opus` → 家族 `claude` |

- 三档按上表顺序合并、同一 `entry` 只保留最高档；结果按 exact → alias → family 排序，
  最多返回 5 条。
- **默认不自动采用**：界面列出候选与置信度徽标，用户必须逐字段点击「采用」；刷新快照
  或打开页面本身不会改变任何模型的可路由能力。
- 候选查询一次建索引（`buildCatalogIndex`），不为每条模型重扫全量快照。

### 9.3 Adoption ledger（按字段采用、可撤销）

存放于 `data.json::catalogAdoptions`（用户决策，**不写 `userModelMarks`**，与手工标注
语义分开，同步/快照刷新都不会擦除）：

```ts
interface CatalogAdoption {
  providerId: string
  displayName: string
  catalogId: string          // `${source}:${provider ?? ''}:${id}`
  field: 'contextTokens' | 'maxOutputTokens' | 'price' | 'modalities' | 'vision' | 'tools'
  value: unknown             // 写入前经 sanitizeCatalogAdoptionValue
  source: CatalogSourceId
  evidenceId: string         // `${快照 contentHash}:${条目 id}`，可追溯用的是哪份数据
  adoptedAt: string
}
```

- 同 `(providerId, displayName, field)` 只有一条，重复采用覆盖旧值（不可变写入）。
- 撤销单个字段或整模型全部字段，立即回退到自动解析结果；界面在对话框里展示当前已采用
  字段并提供「撤销」与「全部撤销」。
- 采用值进入解析链的方式：`catalogAdoptionHint` 把 ledger 折成 `ModelCapabilityHint`，
  `modelMetadataService.catalogLayer` 再折成 `source:'catalog'`、`confidence:'inferred'`
  的一层。**价格被显式排除在 hint 之外**，因此 price-only adoption 不产生任何层。
- 路由侧同样只消费 ledger（`autoRouter::capabilityHintsFor` → `catalogHint`）；快照里
  未被采用的候选值不会进入路由打分或过滤。

### 9.4 许可、归属与口径

- 快照卡片与候选对话框都展示来源、`sourceUrl`、`fetchedAt`、`contentHash`、`license`
  与 `attribution`；界面文案写明「第三方数据，仅作参考」。
- 标准库数据**不并入** `aggregatePricing` / `aggregateQuota` 等生成式 sidecar，也不手改
  生成物；它只存在于自己的 sidecar 与 adoption ledger。
- 价格只展示，不参与路由、额度或权重判定：USD、CNY 与本应用 token 账本是三个不可互换的
  计数域，禁止把价格折成 token 权重（`catalogAdoptionHint` 的空 `price` 分支即该口径的
  代码落点）。
- `/v1/models` 仍只广告声明级来源；`catalog` 值属于内部 `catalog` 级，不外泄为事实，
  `usage` 依旧可为 `null`。
- 本次不新增自动网络请求：探测与真实流量隔离的既有约定不变，标准库只有用户显式刷新才
  联网。

