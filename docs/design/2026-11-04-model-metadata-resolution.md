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

### 6.1 属性分组（2026-11-04 裁定）

九项属性按「路由是否真的据此判断」分成两组，判据来自 `proxy/autoRouting.ts`，不是按观感挑：

| 组 | 属性 | 为什么 |
| --- | --- | --- |
| 关键 `ROUTING_METADATA_ATTRIBUTES` | `vision` / `tools` / `reasoning` / `modalities` / `contextTokens` / `maxOutputTokens` | 前四项参与 `hardFilterFailure` 与 `supportsVision` 的候选筛选，`contextTokens` 是容量硬过滤与对外承诺的输入，`maxOutputTokens` 决定要不要裁剪请求 |
| 参考 `REFERENCE_METADATA_ATTRIBUTES` | `modelType` / `weight` / `free` | `modelType` 由 `modalities`/`vision` **派生**，算进完整度等于同一份证据数两遍；`weight`/`free` 是计费展示与「免费优先」排序的输入，缺了不影响一次请求能否成 |

**不适用 ≠ 未标注**（`isAttributeApplicable`）：`weight` 是渠道包的积分倍率，只有 `account`
provider 存在这个概念；`free` 对 `account`（`· 免费` 标签 / 上游 `isFree`）和 `aggregate`
（`docs/data` 成本票据）有出处，`custom`/`builtin` 没有任何生产者。这类行不进该属性的分母，
也不算缺口。

**关键 ≠ 自动补齐**：分组说的是「路由会不会因为这个属性不知道而判断错」，不是「批量一定要
把它填上」。`reasoning` 是关键属性，但标准库的值只允许逐字段手工采用（§9.3），所以它可能长期
留在缺口里——那是一个诚实的「上游没证据」，不是一个待办。

> 这一条是 1.7.2 那轮观感「补齐没效果」的根因：旧口径把「已完整标注」定义成九项全有来源，
> 于是聚合侧 570 行因为 `weight` 按构造补不上而永远挂在「仍有缺失」里——1000 行报 998 行缺失，
> 数字与两轮第三方标注、探测的实际进展无关。

### 6.2 覆盖率

```
coverage[attr] = { known, total, applicable, notApplicable, rate: known / applicable }
coverageGaps[attr] = applicable - known
```

分母是**适用**行数，界面与「待标注队列」同源（同一批 records、同一套适用性判据）。
`totals = { models, routingComplete, routingIncomplete, fullyAnnotated }`：
`routingComplete` 用 `isRoutingComplete`（六项关键属性全有来源）判定，
`fullyAnnotated` 保留「全部适用项都有来源」作为次要读数（聚合行没有 `weight` 这一项，是 8 而不是 9），
界面用它说明上限还有多远。
队列只留仍有**适用**缺口的行，每行带 `critical`：`false` 表示关键属性已齐、只剩参考项。

**对外暴露门槛**（不可协商，源自 AGENTS.md；判据是**误差方向**，不是来源标签）：

- `/v1/models` 的 `context_window` 只输出**不会朝危险方向错**的读数：`manual`、`upstream`
  中来自官方/供应商声明的值，以及 `probe`（实测下界——证得过这一档收得下，只会低报不会
  高报）；`catalog` / `family-rule` / 第三方推定值**一律不对外**，它们是单点类比或转述，
  既可能过期也可能高报；
- 标准库值属于 `catalog` 级，即便被用户采用也只是内部证据，**不外泄为事实**；要让它对外
  生效，正确动作是把它升级写成 `manual`，而不是放宽这一格；
- 没有合格读数时**省略键**，不输出 0 或推定价；
- 推定值进路由过滤/打分与界面（`effectiveContextLimit` 不分来源，选错一家代价只是次优）；
- **逐请求承诺**另走一个字段：`AutoRouteDecision.advertisedContextWindow` 过同一道闸门，
  写进响应头 `X-ModelPort-Context-Window`；与 `contextWindow`（未分来源，供日志与界面）
  并排存在，接线写反等于把猜值从新门放出去，由 `tests/proxy/probe-capability-layer.test.ts` 钉住；
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
| IPC | `providers:getModelMetadata`、`providers:probeModel`、`providers:cancelProbe`、`providers:getProbeJobs`、`providers:probeProgress`（单向事件）、`providers:getCatalogStatuses`、`providers:refreshCatalog`、`providers:getCatalogCandidates`、`providers:adoptCatalogField`、`providers:revokeCatalogAdoption`（刷新/探测/批量都只在用户显式触发时执行） |

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
- **可见进度与可取消**：探测在主进程登记为后台任务（`providers:getProbeJobs`），弹窗显示
  阶段（准备 / 第 N 档 / 等待响应）、已用秒数、已发请求数/上限，并提供「取消探测」。
  进度经 `providers:probeProgress` 单向推送；关闭/Esc 不等待长请求，重新打开会回显
  同一任务。取消只停止后续档位，已完成档位的结论照常保留。
- **显式超时**：单请求 `30s`（`PROBE_REQUEST_TIMEOUT_MS`），整体 `5min`
  （`PROBE_TOTAL_TIMEOUT_MS`）。超时一律按 `inconclusive` 收敛，不无限等待；401/403、
  429、5xx、网络不可达与超时在弹窗里分别显示「鉴权失败 / 被限流 / 上游错误 / 网络不可达 /
  上游超时」，并给出重试入口。
- **全部补齐（全自动批量）**：标注页只有一个「全部补齐」按钮，没有逐模型复选框、没有
  分批确认。点击即开始；范围由主进程自动选取所有「未标注或部分标注」的模型，已声明字段
  （人工标记、上游声明）不进入候选。面板里只有一个「同时执行探测」开关（默认关闭）；开启
  时开始前一次性展示合计预估（探测请求条数与 token），确认后全程不再询问，关闭时零确认。
  采用口径：`exact` 与 `alias` 自动采用并在结果里标记来源（alias 标「别名匹配」），
  `family` 只记为候选、不自动采用；价格永不自动采用；采用仍逐字段可撤销，人工标记永不
  被覆盖。跨模型并发 1，内部批大小 10 只作为节奏控制、对用户不可见；遇 429/限流对当前批
  指数退避（2s 起、上限 30s），单模型失败记失败并继续下一个。
- **编排在主进程**：批量任务是主进程持有的后台 job（`modelCatalogBatchRunner`），渲染层
  只通过 `providers:getCatalogBatchJobs` 回读快照、通过 `providers:catalogBatchProgress`
  单向订阅进度；关闭面板、切换页面、重新打开看到的是同一个进行中的任务。应用退出
  （`before-quit`）先干净 abort，暂停等待者被唤醒，不留半写状态。同一时刻只允许一个
  active job（running / paused）：并发点击「全部补齐」会被主进程拒绝并指回现有任务，
  避免两个任务共享同一条全局串行探测队列。进度事件统一给出
  `processed/total/percent`、当前模型、已用/预计剩余、成功/跳过/失败计数；
  `measuredFields` 按**字段**计数（context / output 各算一项），`adoptedFields` 同样按字段；
  `skippedDisabled` 表示计划阶段被过滤的模型数。
- **范围过滤（与路由口径一致）**：只有「已启用（在 `getEffectiveModels` 里）且被至少一条
  **可路由**路由引用」的模型进入批量计划。路由引用沿用候选池既有判定：`resolvePoolRoute`
  成功、不在 `excludeModels`、且若 `pinModels` 非空则必须在其中；不另造一套匹配规则。
  被过滤的模型在预演与汇总里显示「已停用 / 未被路由引用，跳过 N 个」，数字差异可见。
  单模型「探测」按钮不受此过滤影响（用户显式针对某个模型仍可执行）。
- **单模型三态**：`done`（全部成功或声明级跳过）/ `partial`（有成功也有失败）/
  `failed`（全失败）。`partial` 保留 `error` 与 `errorKind`，进入失败清单并参与退避——
  「context 成功、output 被 429/5xx/超时」不会被折叠成 done。采用失败的字段同样进失败
  清单并在失败原因里带上字段与原因，不静默计成 skipped。
- **失败与退避**：跨模型并发 1，内部批大小 10 只作为节奏控制、对用户不可见；遇
  429/限流对当前批指数退避（`2s × 2^n`，上限 30s），非限流结果重置 streak；单模型失败
  记失败并继续下一个。
- **断点与幂等**：adoption 去重键统一为 `catalogAdoptionKey(providerId, displayName, field)`
  （`shared/modelCatalog.ts` 一处实现），预演与执行、断点续跑都用它，不按 catalogId 判断。
  取消/异常后再次点击「全部补齐」，按当前报表队列继续；已采用字段在计划阶段就被扣除，
  已 `measured` 的探测事实不再进入计划，因此不会重复写 adoption、也不会重复发探测请求。
  **真实限制**：失败清单与「仅重试失败项」依赖主进程内存记录（最多 20 条 job）；应用重启
  后只能「重新执行全部补齐」，由 adoption/实测事实推导断点，不能按上次失败项精确重试。
  预演同样读取 adoption ledger，保证「预演字段数」与实际执行会跳过的字段一致。


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
  失败结果带 `errorKind`（`network` / `timeout` / `http` / `parse` / `empty`）与耗时：
  HTTP 非 2xx 附带响应体前 200 字符，网络失败带 `cause.code`，超时说明 60s 上限。
  界面按来源展示失败原因；单个来源失败不影响其它来源，也不会清空整份快照。
- **LiteLLM 抓取口径**：原始文件约 3.2 MB、4,500+ 条；`raw.githubusercontent` 会 301/302
  到 CDN，因此抓取改为 `redirect: 'manual'` 逐跳跟随（最多 5 跳），每一跳都重新校验
  协议与地址；整体抓取超时 60s（慢链路余量）。
  解析只取 `mode` 为 `chat` / `vision` 的条目（缺失 `mode` 的老条目按对话模型保留）；
  键里的 provider 前缀只用于归属展示。`max_input_tokens` / `max_output_tokens`
  （老字段 `max_tokens`）按字段直取，不做「上下文减输出」之类的二次推断。
- **写入是原子的**：唯一临时文件 + `rename`，且只覆盖被刷新的来源，其他来源保持原样。
- **外部数据一律校验**：字段类型、正整数、上下文 ≤ 100,000,000、输出上限沿用
  **1,000,000** 上界、价格 0–10,000,000 USD/1M；模态只接受已知集合。元数据字段缺一即
  视为快照损坏，整份降级为空台账（界面显示「尚未抓取」而不是报错）。
- 三个解析器（`modelCatalogParsers.ts`）把各自 shape 折成同一条目；价格在解析时一次性
  换算成 **USD / 1M tokens**（LiteLLM/OpenRouter 的 per-token 值 × 1e6），之后不再换算。
  换算显式固定：先按 `max / 1e6` 反推上限避免先乘后溢出，再乘 1e6 并保留 6 位小数；
  超上限的字段丢弃而不是截断成 10,000,000。
- **`reasoning`（2026-11-04 追加）**：三个来源分开定口径，都经 `capabilityFlag` 收口。
  models.dev 的顶层 `reasoning` 是 schema 里的显式布尔，`true` 与 `false` 都是**声明**，
  两个方向都收（与同源的 `attachment` / `tool_call` 一致）；OpenRouter 的
  `supported_parameters` 是「这条端点实测可用的参数清单」而不是完整能力表，只列出
  `reasoning` 才写 `yes`，**缺席不折成 `no`**；LiteLLM 台账没有这个键，一律不写。
  这条与聚合旁表 `shared/aggregateCapabilities.ts` 的「只采 `true`」不是同一口径：那张表
  是社区填表、`false` 更可能是「没填」，而 catalog 层的 `vision`/`tools` 早已按「显式布尔
  两向都收」处理，`reasoning` 跟随后者。加上这一项之前，`reasoning` 在标准库层根本没有
  生产者，覆盖率里它是一个永远补不上的洞。采用范围与 `vision`/`tools` 不同：只允许逐字段
  手工采用，不进批量自动采用（理由见 §9.3）。

### 9.2 端点回退与内置兜底

- **端点顺序**：主端点 → jsDelivr CDN → 用户在设置里配置的镜像
  （`catalogMirrorUrl`，仅 https，默认空）。不在代码默认值里硬编码任何第三方镜像站。
  逐个尝试、成功即停；每次刷新返回 `attempts[]`
  （`url / label / status / errorKind / error / elapsedMs / bytes`），全部失败时一并展示，
  用户能区分「全都不可达」还是「某个端点挂了」。
- **先实测再定顺序**：2026-11-04 在本机逐一请求（见下表）；主端点与 jsDelivr 均返回
  与主文件完全一致的 3,281,413 字节，因此备用顺序固定为
  `raw.githubusercontent → cdn.jsdelivr`，用户镜像排最后。

  | 端点 | 状态 | 耗时 | 字节 |
  | --- | --- | --- | --- |
  | `raw.githubusercontent.com`（主） | HTTP 200 | 553ms | 3,281,413 |
  | `cdn.jsdelivr.net`（备） | HTTP 200 | 443ms | 3,281,413 |
  | `fastly.jsdelivr.net`（诊断） | HTTP 200 | 470ms | 3,281,413 |
  | `gcore.jsdelivr.net`（诊断，缓存偏旧） | HTTP 200 | 952ms | 3,190,018 |
  | `api.github.com`（诊断） | HTTP 200 | 564ms | 6,400 |

- **内置快照**：`scripts/build-builtin-catalog.mjs` 从可达端点抓取，按
  `mode in (chat, vision)` 裁剪（丢弃 embedding / audio / image / TTS 等不参与对话补全的
  条目），写出 `resources/catalog/litellm.json`，含
  `sourceUrl / fetchedAt / contentHash / license / attribution` 与裁剪计数。
  原始约 3.28 MB / 4,526 键 → 3,239 条 / 约 0.94 MB。`npm run build:builtin-catalog`
  可在发布流程或 CI 执行；抓取失败只打印醒目告警、退出码 0，不中断构建，旧文件保持不动。
- **发布流程接入**：`.github/workflows/release.yml` 在 `npm run build` **之前**执行
  `npm run build:builtin-catalog`（`continue-on-error: true`），保证安装包携带当次抓取的
  快照。失败策略：抓取失败但旧快照存在 → 日志记录「沿用旧快照」并继续；快照缺失 →
  `::warning::` 明示「发布包将不含内置快照，离线场景无法补全」；`fetchedAt` 超过 90 天 →
  `::warning::` 陈旧告警。普通 `npm run build` **不**依赖网络，本地断网构建不受影响。
- **运行时读取**：打包后读 `process.resourcesPath/catalog/litellm.json`
  （electron-builder `extraResources`），开发态回落 `resources/catalog/`。该文件仅首次
  查询快照/候选时惰性加载并缓存，不参与启动路径。
- **回退规则**：用户快照优先；某来源从未成功刷新过时使用内置快照，元数据带
  `builtin: true`，界面标注「内置快照（YYYY-MM-DD）」。用户显式刷新失败**不清空任何数据**：
  内置快照与上一份用户快照都保留，提示里说明当前实际使用的是哪一份。
- **镜像校验**：地址写进 `config` 前经 `sanitizeCatalogMirrorUrl`（仅 https；空 = 不使用）；
  界面明示可达性与可信度由用户自行承担。
- **SSRF 结论**（镜像地址是用户输入、重定向目标不受控）：所有端点与每一跳重定向只接受
  https；拒绝环节/链路本地/私网地址（`127.0.0.1`、`169.254.169.254`、`10/8`、
  `172.16–31`、`192.168/16`，IPv6 的 `::1` / `fc00::/7` / `fe80::/10`），并检查 DNS
  实际解析结果而非只看字面量；响应体硬上限 8 MB（流式累计，超限即取消）。

### 9.3 匹配策略（三档 + 置信度）

| 档位 | 规则 | 例子 |
| --- | --- | --- |
| `exact` | 原文 `actualModelId` 或 `displayName` 与条目 `id` 完全相同 | `gpt-4o` |
| `alias` | `normalizeCatalogAlias`：去 provider 前缀（最后一个 `/` 之前）、去 `-YYYY-MM-DD` / `-YYYYMMDD` 日期后缀、去 `-latest`、大小写归一、非字母数字折成 `-` | `openai/gpt-4o-2024-08-06` → `gpt-4o` |
| `family` | `catalogFamilyKey`：别名键的第一段且长度 ≥ 3 | `claude-3-opus` → 家族 `claude` |

- 三档按上表顺序合并、同一 `entry` 只保留最高档；结果按 exact → alias → family 排序，
  最多返回 5 条。
- **默认不自动采用**：界面列出候选与置信度徽标，用户必须逐字段点击「采用」；刷新快照
  或打开页面本身不会改变任何模型的可路由能力。唯一的批量入口是用户点击「全部补齐」后
  由主进程自动执行：`exact`/`alias` 自动采用（alias 在结果中标注来源），`family` 只作
  候选，价格与 `reasoning` 不参与自动采用（`CATALOG_BATCH_AUTO_FIELDS`）；采用仍按字段写入 ledger。
- **`reasoning` 只允许逐字段手工采用**：它是 `hardFilterFailure` 的判据之一（请求要求思考时，
  `reasoning: 'no'` 的候选被排除），而第三方台账对它的 `false` 常常只是「按默认回答」。批量写入
  等于让一份社区表格获得把模型从请求里筛掉的权力；误判的代价是用户看不见那个模型，不是一次
  次优路由。想要这个效果就得在候选对话框里逐字段点「采用」——显式动作，随时可撤销。
- 候选查询一次建索引（`buildCatalogIndex`），不为每条模型重扫全量快照。

### 9.4 Adoption ledger（按字段采用、可撤销）

存放于 `data.json::catalogAdoptions`（用户决策，**不写 `userModelMarks`**，与手工标注
语义分开，同步/快照刷新都不会擦除）：

```ts
interface CatalogAdoption {
  providerId: string
  displayName: string
  catalogId: string          // `${source}:${provider ?? ''}:${id}`
  field: 'contextTokens' | 'maxOutputTokens' | 'price' | 'modalities' | 'vision' | 'tools' | 'reasoning'
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

### 9.5 许可、归属与口径

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

