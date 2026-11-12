# PLAN：国内订阅套餐补齐 + 配额不足渠道标识

日期：2026-11-12　状态：已实施（2026-11-12，结果见 §6）

## 0. 结论摘要

1. 「国内主流 Agent Plan / Token Plan / Coding Plan」并不是全缺：目录已按订阅端点登记 11 条
   （清单见 §1.1）。**可核实的缺口只有 1 条**——阿里云百炼 Coding Plan（国内站，`sk-ws-` 凭证），
   仓内 `bailian_token_plan` 的 notes 已证明它存在，但 base URL 与模型清单没有取证。
2. 另外 5 家（腾讯云、百度智能云千帆、讯飞星火、京东云、美团 LongCat）是否提供**独立的订阅套餐
   API**未核实。按本仓「不猜 URL」的铁律，未取证前不登记，只进「不收录/待核」清单。
3. 「配额不足在渠道上标识」完全不依赖外部取证，可以仓内闭环：上游一旦回「额度/余额/欠费」类明确
   证据，就按 `(渠道, 账号, 模型)` 落一条带时刻的标识，列表出徽章、详情出原文，并在路由上跳过该候选
   直到过期或下一次成功。

## 1. 基线事实（均已核对当前源码）

- 聚合目录：`src/main/providers/aggregate/registry.ts`，92 条 / 580 模型（文件头注释同口径）。
- 订阅端点清单：`src/shared/aggregateCost.ts:62` `AGGREGATE_PLAN_ENTRIES`，11 条。
- 条款警告：`src/shared/aggregateTerms.ts:27`，3 条（`opencode_zen` / `qwencloud_coding` / `glm-cn`）。
- 额度旁表：`src/shared/aggregateQuota.ts`（脚本生成，不得手改），取证回执在 `docs/data/free-quota-research/`。
- 选号闸门：`src/main/proxy/quota/gate.ts:90` `quotaBlockReason`（`no-credit` 在前），`:113` `aggregateHeadroom`。
- 上游错误识别：`src/main/proxy/failover.ts:547` `CREDIT_EXHAUSTED_PATTERN`、`:566` `isRecoverableChannelFailure`、
  `:315` `isAccountArrearsError`。
- 每次尝试的日志行：`src/main/proxy/attemptTrace.ts`（providerId/accountId/model/status/errorMessage）。

### 1.1 已登记的国内/中文订阅套餐（11 条）

| entryId | 名称 | 端点 |
|---|---|---|
| `glm-cn` | 智谱 GLM Coding Plan（国内） | `open.bigmodel.cn/api/coding/paas/v4` |
| `zai` | Z.ai Coding Plan（国际） | `api.z.ai/api/coding/paas/v4` |
| `kimi_code` | Kimi Code | `api.kimi.com/coding/v1` |
| `qwencloud` | QwenCloud Token Plan（国际） | `token-plan.ap-southeast-1.maas.aliyuncs.com` |
| `qwencloud_coding` | QwenCloud Coding Plan（国际） | `coding-intl.dashscope.aliyuncs.com/v1` |
| `bailian_token_plan` | 阿里云百炼 Token Plan | `token-plan.cn-beijing.maas.aliyuncs.com` |
| `xiaomi-tokenplan` | 小米 MiMo Token Plan | `token-plan-sgp.xiaomimimo.com/v1` |
| `sensenova` | 商汤日日新 Token Plan | `token.sensenova.cn/v1` |
| `stepfun_step_plan` | 阶跃星辰 Step Plan | `api.stepfun.com/step_plan/v1` |
| `volcengine-ark` | 火山方舟 Coding Plan | `ark.cn-beijing.volces.com/api/coding/v3` |
| `volcengine_ark_agent_plan` | 火山方舟 Agent Plan | `ark.cn-beijing.volces.com/api/plan/v3` |

### 1.2 缺口与待核清单

| # | 候选 | 状态 | 处理 |
|---|---|---|---|
| 1 | 阿里云百炼 Coding Plan（国内，`sk-ws-`） | **确认存在、未登记**（`bailian_token_plan` notes 明写三套凭证隔离） | 取证 base URL 与模型 id 后登记 |
| 2 | 腾讯云 Coding Plan | 未核实是否有独立订阅 API | 取证通过才登记 |
| 3 | 百度智能云千帆 Coding Plan | 未核实 | 同上 |
| 4 | 讯飞星火 Coding Plan | 未核实 | 同上 |
| 5 | 京东云 JoyCode / 美团 LongCat | 偏 IDE/免费开放平台 | 不属于「订阅套餐」则不登记，写理由 |
| 6 | `minimax-cn`（`api.minimaxi.com/anthropic/v1`） | 已在目录，但**不在** `AGGREGATE_PLAN_ENTRIES` | 核实是否订阅端点；是则补进清单，影响「套餐内」分类 |

## 2. 阶段 P1：目录补齐（依赖外部取证）

- **P1-1 取证**：只读供应商官方套餐介绍页与接入文档；逐条记录 `docUrl`、`asOf`、原文引用。
  不做匿名探测以外的任何请求；探测被拒就记为「无法核实」。
- **P1-2 登记**（仅限取证通过的条目）：
  - `registry.ts` 新条目（`category: 'apikey'`、专属 `authUrl`/`envVar`、`notes` 写清计费通路隔离）；
  - `shared/aggregateCost.ts` `AGGREGATE_PLAN_ENTRIES` 增一行（带理由）；
  - `docs/data/free-quota-research/g12-cn-plans-2026-11-12.json` 写回执，再跑
    `scripts/build-aggregate-quota.mjs` 生成 `aggregateQuota.ts`；
  - 若条款限制与 GLM/千问同级，追加 `aggregateTerms.ts` 逐字警告。
- **P1-3 不收录清单**：每家一行理由（无独立套餐 API / 只有 IDE 订阅 / 页面读不到），写进本 PLAN 附注。
- **P1-4（可选）**：类别筛选增加「订阅套餐」一档，判据用现成的 `isPlanEntry()`，不改 `AggregateCategory` 枚举。

## 3. 阶段 P2：配额不足标识（纯仓内，可独立交付）

### 3.1 判据（新文件 `src/shared/aggregateQuotaExhaustion.ts`）

三个原因值，分开是因为用户动作不同：`quota-exhausted`（等复位/升档）、`balance-insufficient`（充值）、
`arrears`（处理账务）。识别**只认上游明确措辞**：

- 402 → 命中；
- 复用 `CREDIT_EXHAUSTED_PATTERN`（credits/balance 不足、`can only afford 0`）；
- `billing daily count exceeded`、`欠费`、`arrearage`、`overdue payment`；
- 中文：`额度|配额|积分|套餐` 与 `不足|用尽|耗尽|用完|已用完` 同现；
- **排除**：本地 AIMD 拒绝（`localAdmissionRejected`）、`client_abort`、限流/频率超限（`rate limit`、`频率超限`、
  `限流`）、没有任何文案的裸 429。宁可漏标，不把限流标成没额度。
- 报文只存截断摘要（≤240 字符），不存 Key。

### 3.2 落库

- `data.json` 新增 `aggregateQuotaExhaustions: Record<entryId, AggregateQuotaExhaustionRecord[]>`；
  记录字段：`accountId/accountName/modelId/asOf/reason/status/message/until?`。
- 读时丢弃已过期记录；同一 `(accountId, modelId)` 覆盖写；每条目上限 50 条。
- 过期时刻：上游给了 `Retry-After`/解禁时刻就用它，否则 `QUOTA_EXHAUSTION_TTL_MS = 30 分钟`。

### 3.3 记录与清除

- 记录点：`src/main/proxy/routes/chat.ts` 拿最终 `attemptTrace` 后逐条判（三条分支共用同一处），
  只处理 `provider.type === 'aggregate'` 的家。
- 清除：同一 `(渠道, 账号, 模型)` 一旦成功即清；详情页给一个「清除标识」按钮（新增一个 IPC）。

### 3.4 展示

- `AggregateListResult` 增 `quotaExhaustions: Record<entryId, summary>`（条数 + 最近一条）。
- 左栏条目名旁出红色徽章「配额不足」；详情额度卡下一行：账号 / 模型 / 原因 / 时刻 / 上游原文。
- 与既有五态徽章**并列不合并**：五态是「本应用账本对官方帽」，这里是「上游亲口说的」，混成一个数就是伪造。

### 3.5 路由

- `QuotaBlockReason` 增 `'quota-exhausted'`；`quotaBlockReason` 在 `no-credit` 之后判，命中即跳过
  **该 `(账号, 模型)`** 候选（不是整家），与既有窗口打满同一层语义。
- 过期自动放行；成功即清，所以充值/复位后第一笔一旦成功，标识立刻消失。

### 3.6 i18n 与测试

- `en-US.json` / `zh-CN.json` 各加 `aggregate.quotaExhaustion.*` 与三个原因文案。
- `tests/proxy/aggregate-quota-exhaustion.test.ts`：判据正负样本（含「正常文案里出现 quota」的反例）、
  TTL/until 过期、成功清除、按 (账号,模型) 精确命中、条目级折叠。

## 4. 验收

唯一标准：SSH 下 `npm run gate`（build + build:daemon + 两套 tsc + 全量测试）。

## 5. 拍板记录

- **D1 = 授权取证**：已读各厂商官方套餐/接入文档（未做任何匿名探测）。
- **D2 = 选项 A**：标识 + 该 `(账号, 模型)` 硬跳过直到过期。

## 6. 实施结果（2026-11-12）

### 6.1 新增条目（9 条，base URL 逐字取自厂商文档）

回执：`docs/data/free-quota-research/g12-cn-plans-2026-11-12.json`；旁表由
`scripts/build-aggregate-quota.mjs` 生成（98 家 / 16 有官方数字 / 82 未公布）。

| entryId | 端点 | 模型基线 |
|---|---|---|
| `bailian_coding_plan` | `coding.dashscope.aliyuncs.com/v1` | 6 |
| `tencent_coding_plan` | `api.lkeap.cloud.tencent.com/coding/v3` | 1（`tc-code-latest`） |
| `tencent_token_plan` | `api.lkeap.cloud.tencent.com/plan/v3` | 0（id 只在控制台公布） |
| `qianfan_coding_plan` | `qianfan.baidubce.com/v2/coding` | 3 |
| `qianfan_token_plan` | `qianfan.baidubce.com/v2/tokenplan/personal` | 8 |
| `xfyun_astron_coding_plan` | `maas-coding-api.cn-huabei-1.xf-yun.com/v2` | 1（`astron-code-latest`） |
| `xfyun_astron_token_plan` | `maas-token-api.cn-huabei-1.xf-yun.com/v2` | 16 |
| `jd_coding_plan` | `modelservice.jdcloud.com/coding/openai/v1` | 7 |
| `jd_token_plan` | `modelservice.jdcloud.com/tokenPlan/openai/v1` | 1（`maas-token-latest`） |

空/单模型基线是刻意的：不发明 slug，因为「unknown」比一个错模型 id 更接近事实。
另：`aggregateCost.ts` 的 `AGGREGATE_PLAN_ENTRIES` 增 9 条；`aggregateTerms.ts` 增 5 条逐字警告
（百炼 / 腾讯 Coding / 千帆 Coding / 千帆 Token / 京东 Coding）；列表页类别筛选新增「订阅套餐」一档
（`isPlanEntry()` 判定，不动 `AggregateCategory` 枚举）。

### 6.2 不收录清单（P1-3）

| 候选 | 理由 |
|---|---|
| 美团 LongCat | 按量计费 + token 资源包，不是「套餐类」订阅端点 |
| 京东 JoyCode | 只有 IDE 产品，无独立订阅 API |
| `minimax-cn` | `api.minimaxi.com/anthropic/v1` 是否订阅端点仍未核实，暂不并入套餐清单 |
| 讯飞 / 腾讯 Token Plan 条款警告 | 页面只有转述、没有可逐字引用的整句，**有意不列**（缺一条比编一句好） |

### 6.3 P2 落地

| 层 | 落点 |
|---|---|
| 判据 | `src/shared/aggregateQuotaExhaustion.ts`（三个原因、限流 veto、TTL 派生、折 50 条） |
| 落库 | `store.ts` `aggregateQuotaExhaustions` + 五个方法；`store/types.ts` 默认值 |
| 记录/清除 | `proxy/quota/exhaustionMarks.ts`，在 `routes/chat.ts` 三分支汇合点调用一次 |
| 闸门 | `QuotaBlockReason` 增 `'quota-exhausted'`；`quotaBlockReason` 在 `no-credit` 之后判 |
| 展示 | 列表红色徽章 + 详情逐 `(账号, 模型)` 行（原因/时刻/解禁/HTTP/上游原文）+「清除标识」按钮 |
| IPC | `aggregate:clearQuotaExhaustions` → `aggregateProviderManager.clearQuotaExhaustions` |
| i18n | `aggregate.manage.exhaustion.*`（en-US / zh-CN） |
| 测试 | `tests/proxy/aggregate-quota-exhaustion.test.ts`（13 例，判据正负 / 过期 / 清除 / 闸门精确命中 / 折叠 / 非聚合忽略） |

与既有四层的关系写进 `AGENTS.md`（Quota / routing）：静态帽、本应用账本、上游余额、本层**并列不合并**。