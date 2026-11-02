# PLAN：从 magpie 借鉴能力（目录数据 / 导入 / 路由 / wire）

- 日期：2026-10-29
- 状态：**已收尾**。Phase 1.2（models.dev 兜底）、Phase 3.1（smart/pace）、Phase 4（出向 responses）已落地并通过验证；Phase 1.1 核查后**撤回**；Phase 2.1 / 2.2 / 3.2 判定为不做（理由见各节）
- 基线：main @ ac62cea（工作区存在大量未提交改动，本计划不触碰、不整理）
- 参考实现：[yetone/magpie](https://github.com/yetone/magpie)（MIT，Go + 菜单栏，**代码无法直接复用**，只能移植设计与数据）
- 范围：供应商目录数据、models.dev 目录源、外部 Key 导入、每账号代理、路由组与 smart/pace 选号、openai-responses wire
- **不在范围（用户明确搁置）**：隐私脱敏 masking、网关中间件插件（param-override / model-map / system-prompt / word-guard / think-tags）、成本与账单视图、局域网共享与每客户端限额、搜索密钥池、备份与远程同步、agent 配置接管

## 0. 现状核对（本轮实读）

| 事实 | 位置 |
| --- | --- |
| 目录现有 72 条 / 465 模型，测试把这两个数字钉死 | `tests/aggregate/registry.test.ts:13,16` |
| 旧版注释仍写 "76 entries / 502 models"，与断言不一致（上游转录基数） | `src/main/providers/aggregate/registry.ts:5` |
| 只允许两种 wire，且测试枚举了 anthropic 走的恰好三家 | `src/shared/aggregate.ts:11`、`tests/aggregate/registry.test.ts:51-61` |
| 目录条目的用户名是 `<entryId>/<modelId>` | `registry.ts:2973` |
| 无模型清单的条目允许由用户自填，`save()` 已支持 | `aggregate/manager.ts:138-143` |
| `modelsUrl` 存在才会打开 `supportsModelFetch`；探测逻辑在 `probe()` | `aggregate/manager.ts:187,350-417` |
| reader 是纯函数、可注入，`auto` 会依次尝试 | `providers/modelListReaders.ts:61,71` |
| 选号只有三种：round-robin / fill-first / failover | `proxy/loadbalancer.ts:65,82-90` |
| 裸名跨家链已按额度余量排序 | `loadbalancer.ts:97-111`、`shared/aggregateRouting.ts` |
| 账本能给出滚动分钟/24h/UTC 月的用量，但**没有"何时重置"** | `proxy/quota/ledger.ts:182,203` |
| 上限判定返回"哪个窗口满"，不是一个布尔 | `proxy/quota/limits.ts:119` |
| 内置供应商硬编码剥离 9 个采样参数 | `proxy/parameterPolicy.ts:8-18` |

四个真实缺口：

1. **目录缺 5 家仍在服务的端点**：StepFun、ModelScope、Huawei Cloud MaaS、Nous Portal、Volcengine Ark（国内版；现有 `byteplus` 只是国际站）。这些在 magpie 的 preset 里都有，且都是标准 OpenAI 兼容端点。
2. **模型清单只能靠人抄**。magpie 用 models.dev 聚合，新模型在下次刷新就出现；本项目 `registry.ts` 的模型行是手抄 + 人工核验，维护成本随家数线性上升。
3. **选号无法表达"别浪费还剩的额度"**。magpie 的 `smart`（剩余配额里选最快重置的）与 `pace`（按"每小时剩余最多"平摊到重置）就建立在"重置时刻"这一维上，而账本现在刻意不记它。
4. **没有 responses 入向**。magpie 网关同时说 Chat / Responses / Anthropic / Gemini；本项目 `AggregateWire` 只有两种，`fleetrelay_t1` 正是因为 responses-only 而被排除。

## 1. Phase 1：目录数据与 models.dev

### 1.1 新增 5 家端点条目 —— **核查后撤回，不执行**

原计划从 magpie 的 preset 清单补 StepFun / ModelScope / Huawei Cloud MaaS / Nous Portal / Volcengine Ark 国内版。核查结果否掉了这个前提：

| 结论 | 依据 |
| --- | --- |
| `volcengine-ark` / `byteplus` **已在目录里** | `registry.ts:1842`、`2238` |
| 其余四家**没有任何可实证的端点与模型 id** | StepFun 官方文档路径 404；ModelScope 文档页为 JS 渲染无静态正文；Huawei MaaS 只有第三方博客给出 `maas-api.cn-south-1.myhuaweicloud.com/v1`，且模型清单是 DeepSeek-R1 / Qwen2.5 这一代；Nous Portal 只找到第三方集成页 |
| 这四家**不在 models.dev 目录里** | 对整份 `api.json` 检索 `stepfun` / `modelscope` / `huawei` / `nous` 均为 absent |
| **空模型清单的条目在本仓库是危险的** | `store/modelServing.ts:77` 的 `isModelRoutable` 在 `hasCatalogue === false` 时返回 `true`，即"没有目录"被当成**通配供应商**。写 `models: []` 不是"待发现"，而是让这家吞掉所有模型名 |

因此本阶段**不新增条目**。原计划的 `models: []` + 交给 discovery 的退路，被 `isModelRoutable` 的通配语义否决 —— 这条退路只在既有 `lmstudio` / `ollama`（`category: 'local'`，用户自己知道那是本机）上成立，不能推广到公网供应商。

要重新开这一项，前置条件是把 `isModelRoutable` 的"空目录 = 通配"改成显式标记（例如 `wildcard: true` 只给本地供应商），那是独立的一次改动，不在本轮。

### 1.2 models.dev 作为目录补充源 —— **已落地**

实现与原计划的偏差（更小的改动面，语义不变）：

| 原计划 | 实际 | 理由 |
| --- | --- | --- |
| 扩 `ModelsFetchReader` 枚举 + 在 `modelListReaders.ts` 加 reader | 新建 `src/shared/modelsDev.ts` 独立模块 | 现有两个 reader 的契约是"一个上游端点的响应体"；models.dev 是**全局目录**（按 provider 键控），塞进同一枚举会让 `readModelList` 的调用方误以为它也能读上游 |
| 接进 aggregate discovery | 接成 `syncModels()` 的**兜底源** | 上游答了就用上游；只有探测失败才读 models.dev |
| — | `planSyncModelIds()` 纯函数 | 三态判定（`null` / `[]` / `[...]`）必须可单测，否则"上游答 0 个模型"会被误当成"读不到" |

- 文件：`src/shared/modelsDev.ts`（新）、`src/main/providers/aggregate/manager.ts`、`src/shared/aggregate.ts`（`AggregateOperationResult.modelSource`）、`AggregateDetail.tsx`（同步结果文案）、`tests/shared/models-dev.test.ts`（新，9 例）
- 规则（全部有测试）：
  - 只取 `id` / `name`，缺 `name` 回落 `id`；
  - 按 `type` 过滤非聊天模型（embedding / reranking / transcription / image / video / speech）；
  - 形状不认识返回 `null`，空结果返回 `[]`，两者**不可混用**；
  - **不读** `cost` / `limit` / `tool_call` —— 那些属于 `aggregateQuota.ts` 与 `modelCapabilities.ts`，抄一份就是第二个真相。
- 验收：`node --test tests/shared/models-dev.test.ts`（9 通过）

## 2. Phase 2：外部 Key 导入 + 每账号代理 —— **判定不做**

### 2.1 导入候选扫描 —— 不做，前提在真实机器上不成立

在开发机上实读了三个来源（只看键名，不打印值）：

| 文件 | 实际内容 | 能否提供可用 Key |
| --- | --- | --- |
| `~/.claude.json` | `installMethod`、`cachedGrowthBookFeatures`、`userID`、`machineID`、`pluginUsage` 等安装/遥测状态 | **否**，没有凭据字段 |
| `~/.codex/auth.json` | `auth_mode`、`OPENAI_API_KEY`（值为 null，走订阅登录） | **否** |
| `~/.cc-switch` | 目录不存在 | **否** |

即使是别的机器上更完整的 `.claude.json`，它承载的是**订阅登录态**（OAuth token），不是
aggregate 需要的 `apiKey`。要支持那种凭据，得新建一个 channel-pack 渠道并接登录流程 ——
那是"做一个渠道"的工程量，不是"加一个导入按钮"。

结论：收益为 0 时不做。若未来要做，前置是"存在一类可直接转成 `apiKey` 的来源"，且需重新核实。

### 2.2 每账号代理 —— 用户决定不做

留着的前提是"同一家必须走代理、另一家不能走代理"并存；只有一两家需要代理时，全局代理已覆盖。

## 3. Phase 3：路由组与 smart/pace

### 3.1 smart / pace 两种选号模式 —— **已落地**

- 文件：`src/shared/quotaPacing.ts`（新，纯逻辑）、`src/main/proxy/loadbalancer.ts`（接入）、`src/shared/types.ts` + `src/main/store/types.ts`（扩枚举）、`src/main/proxy/autoRouting.ts`（auto 打分口径）、`LoadBalanceConfig.tsx` + 两份 locale（UI）、两个新测试
- 重置时刻**全部由既有桶推导**，账本格式未变：
  - 分钟/日窗 = 对齐到整窗的下一个边界（`nextRollingBoundary`）；
  - 月窗 = UTC 次月 1 日（`nextUtcMonthStart`）。
- 语义（`tests/shared/quota-pacing.test.ts`，9 例）：
  - `smart`：选**最早解封**的候选；已打满的排在所有还有余量的候选之后，即便它解封更早；
  - `pace`：按 `剩余量 / 距解封小时数` 取最大；全部打满时返回 `undefined`，不硬选一个注定 429 的账号；
  - 两者在**无上限 / 账本读取失败**时不参与，`selectAccount` 回落 `fill-first`。
- auto 的打分口径也认这两个值：打分阶段拿不到重置时刻，因此只提高 `headroom` / `quota` 的权重，真正的重置判定留给 `loadbalancer` —— 不在打分里假装能做它做不到的事。
- **散点一致性**：策略枚举在仓库里有 5 处独立字面量（两个 union、auto 口径、UI 下拉、UI 两张映射表）+ 2 份 i18n，漏一处只在运行期表现为"选不到 / 显示 undefined"。`tests/shared/load-balance-strategies.test.ts` 把这些全部钉住。
- 验收：`node --test tests/shared/quota-pacing.test.ts tests/shared/load-balance-strategies.test.ts`（22 通过）

### 3.2 具名路由组 —— 暂缓

`auto` 的候选池来自 `getEffectiveModels`，用户通过勾选 served 已经能裁剪池子；再叠一层具名组，
**额外收益只有"多个池子并存"**。而它要动 store 结构、`/v1/models` 和 UI 新页，属于高成本中低收益。

若要做，前置是先出现"一个 `auto` 池装不下、必须并存多个策略不同的池"的真实用例。

## 4. Phase 4：openai-responses wire —— **出向已落地**

实现与原计划的差异：

| 原计划 | 实际 | 理由 |
| --- | --- | --- |
| 新建 `adapters/responses.ts` 独立适配器 | 翻译层 `src/shared/responsesWire.ts` + forwarder 内一个分支 | 翻译是纯数据变换，放 shared 可脱离网络单测；适配器壳只会多一层 |
| 声称"解锁 `fleetrelay_t1`" | 未改动该条目 | 该条目当初是**因 responses-only 被排除**，仅实现出向不足以让它真正可用（还需要对它的端点与模型做实证），本轮不为它背书 |
| 一并做入向 `/v1/responses` | **不做** | 入向需要反向编解码，且没有已知客户端在向本代理发 Responses；出向先解决"供应商只会 responses"这一半 |

落地内容：

- `AggregateWire` 增加 `'openai-responses'`，`aggregateChatPath()` 对应 `/responses`。
- `forwarder.forwardResponsesWire()` 在**默认分支之前**接管，因为三处不同：
  1. 不做 prompt 工具注入（responses 自带原生 tools，叠加会双重提示）；
  2. 请求体由 `chatToResponsesRequest()` 重建，而非按白名单搬运；
  3. 响应流**逐事件**翻译，不是攒齐后重编 —— 首字节时间等于上游第一个增量。
- 四条硬规则，各有测试：`usage` 缺失即 `null` 不补 0；`[DONE]` 恰好一个（上游不发 `completed`
  时也要补，否则客户端挂住）；`response.failed` 走 `{"error": …}` 帧而非正文；
  `refusal` / `function_call` 不混进 `message.content`。
- 验收：`node --test tests/shared/responses-wire.test.ts`（8 通过）

## 5. 提交与验收纪律

每个 Task 一次提交，提交前必跑：

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
node --test "tests/**/*.test.ts" "tests/**/*.test.mjs"
```

`tests/skills/` 两个用例在 Windows 上本来就失败（AGENTS.md 已记录），不作为阻断项。
本轮环境另有一个更大的限制：**沙箱禁止子进程捕获 stdio**，任何用 esbuild 打包 vendor 源码
（`tests/channels/*`）或起 CLI dry-run 的用例都会 `spawn EPERM`。全量 529 项里 27 项因此失败，
逐条确认均为 `spawn EPERM`，与代码无关；本轮的验证以两个 `tsc` + 相关子集为准。

## 6. 风险

| 风险 | 处置 |
| --- | --- |
| 新增条目的模型 id 无法实证 | 只给 `modelsUrl`，清单交给 discovery；宁缺勿造 |
| smart/pace 依赖重置时刻推算 | 全部由既有桶推导，不写盘；推不出来就回落，不改变可用性 |
| responses 入向语义面大 | 先出向后入向；不支持的字段显式 400，不做"看起来成功"的翻译 |
| 工作区已有大量未提交改动 | 本计划只改上述文件，提交时逐文件 add，不用 `git add -A` |
