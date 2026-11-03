# PLAN：聚合渠道的免费额度层（实测驱动版）

> 成文版本：v1.4.1 ｜ 最后核对：2026-11-03 ｜ 状态：历史记录

- 日期：2026-10-29
- 状态：已实现 + 外部端点探测（Q1–Q3 已裁定且落地；额度响应字段仍需有效 Key 验证，2026-11-03）
- 来源参考：https://github.com/tashfeenahmed/freellmapi （MIT，已克隆逐文件核对）
- 基线：main @ ac62cea
- **范围：只作用于 `type === 'aggregate'` 的聚合目录供应商。** builtin / custom / 10 个账号渠道全部不动。

## 1. 三条已核实的取数读数（决定"准确值"只能实测）

| 现成的料 | 实测覆盖率 | 结论 |
| --- | --- | --- |
| freellmapi 离线目录（`db/migrations/20260101_000000_legacy_baseline.ts`，含 `rpm/rpd/tpm/tpd/monthly_token_budget/context_window`） | 146 行带额度，与我们的 473 条模型按 `(entryId, modelId)` 精确交集 **36 行**；归一化（剥 `vendor/` 与 `:free`）后仍是 36 | 别人代录的意见，且 74% 对不上名 |
| 我们的转录源 `Ebony-Vinyl/dsh-our-free-model/src/providers/registry.json`（76 家 / 502 模型，名字 473/473 全匹配） | 带 `contextWindow` 的只有 **48 行**（我们命中的 473 条里 **46 行**有值）；`vision` / `reasoning` **全库 0 行为 true** | 名字对得上，但额度字段根本不存在 |
| 上游账号级额度接口 | freellmapi 全仓只注册了 **2 家**：OpenRouter `GET https://openrouter.ai/api/v1/key`（`data.limit` / `data.limit_remaining`）、SiliconFlow `GET https://api.siliconflow.com/v1/user/info`（余额，CNY 计） | 只有 2 家能直接问到"你这个 Key 还剩多少" |
| 正常响应里的额度头 | `services/provider-quota.ts` 的 `HEADER_SPECS` 覆盖 **11 家**，其中与我们目录重叠的是 **groq、cerebras、open_router**（其余 clod / blaze / router9 / septor / electronhub / radeon / modelscope 是冷门网关，我们目录没有）；另有通用回退 `x-ratelimit-limit-{requests,tokens}` | 覆盖面小，且必须实测才知道某家到底发不发 |

**所以取数的正确单位是"73 家供应商"，不是"473 条模型"**：免费池的限速几乎都按账号/供应商发布（RPM/RPD、日 token、月度 token 池），
模型级只是例外。逐家查官方文档拿真值，能实测的用实测校验，两家口径不一致就记两条并显示出处——**不猜、不凑满**。

## 2. 现有骨架（不重造）

| 已存在 | 位置 | 用来做什么 |
| --- | --- | --- |
| 带 Key 打上游的探测通路，**已经在跑** | `providers/aggregate/manager.ts:182-194 test()` → `:285-305 probe()`（`buildProbeHeaders :266-278`） | 额度实测就挂这条通道。现状：`test()` 只回 `{success, modelCount}`，**响应头被丢弃**，接出来即可 |
| 跨 `(provider, account, model)` 候选枚举 + 打分 | `proxy/autoRouter.ts:80-140`、`autoRouting.ts:335-381`，`RankCandidate` 已预留 `rpmUsed/rpmLimit/coolingUntil`，`ModelCapability` 已预留 `contextTokens` | 额度余量直接喂进现有 `headroom/quota` 两项 |
| 逐候选失败切换 | `forwarder.ts:307-353` + `isFailoverEligible:356-359`（只 429/5xx 换目标） | Q2 的跨家链复用它的循环 |
| 429 冷却 | `proxy/accountRuntime.ts:72-82`（内存态，该文件 `:4-5` 自陈重启清零） | 换成账本驱动的 resetAt |
| 流式原始 SSE 汇聚 | `routes/chat.ts:467-470`（`skipTransform`）与 `:495-498`（需转换）都写进同一个 `collectedContent`，收尾同一处 | usage 解析一个钩子覆盖 openai-chat 与 anthropic 两条线，不动适配器 |

三个真实缺口：目录无额度字段（`src/shared/aggregate.ts:24-27`）、不统计 token
（`proxy/stream.ts:545-547` 与 `routes/chat.ts:565-568` 写死 `0`，统计只有请求数 `store/store.ts:1314-1380`）、
74 个跨家同名模型用不到（下条）。

## 3. 五步

**A 额度取数（本批主体工作量：73 家逐家查官方文档，产出有家、有出处、有录入日期的表）**
`AggregateEntry` 增可选 `quota`（provider 级帽 + 少数 model 级例外），每家三档之一，每档都留证据：
1. **`documented`**：官方 rate-limit / pricing / docs 页公布的上限，录入 `rpm/rpd/tpm/tpd/monthlyTokens/contextWindow`
   中**该家确实公布的那些**，其余留空；必带 `docUrl` + `asOf`（录入日期）。
2. **`learned`**：由 C 从用户正常流量带回的额度头（`x-ratelimit-*`）与 429 错误体（`limit: N` + 轴关键词）逐步得到，
   **只填空、只下调，从不上调**（沿用 freellmapi `ratelimit.ts:1526` 的条件）。本批不主动发探测请求，所以这一档是随使用慢慢长出来的。
3. **`undocumented`**：官方页面没有数字（冷门网关必然存在）。**留空，不填保守值也不填乐观值**，
   UI 出"官方未公布额度"那一句。这是"不知道"与"无限"唯一能被分开的地方。

数据落在新的 sidecar `src/shared/aggregateQuota.ts`（`entryId -> quota`），`registry.ts` 的转录数据不动，
出处与刷新日期集中一处可审；消费方仍是既有 `AggregateEntry` 读取链，不另造通道。

**B token 采集**（一个钩子）
非流式取 `result.body.usage`；流式解析 `collectedContent` 末尾带 usage 的 chunk。
上游没报 → `ceil(chars/4)` 估算，**只进账本与日志，绝不写回客户端响应体**（AGENTS.md「usage 绝不伪造」）。
顺带把两处写死的 `0` 改成"报了才带，没报 `null`"。

**C 账本 + 预检 + 只降不升的学习**
`proxy/quotaLedger.ts`，键 `(providerId, accountId, modelId)`；UTC 窗口（日窗滚动 24h + 账户级 UTC 午夜，同 `ratelimit.ts:33,38-39`；月键 `YYYY-MM`）；
落 `~/.modelport/quota-ledger.json`，防抖批量写、临时文件 `rename`，读不到按空账本起。
聚合每家实际只有一个 account（`manager.ts:221-236` 明文 "Keeps exactly one keyed account"、`:238-246` 免密账号），三维键在此退化为"每家一账号"。
预检接 `loadbalancer.getAvailableAccounts:92-126` 与 `autoRouter:92-113` 两处同一判据；无额度证据的**不剔除**。
429 文本反解 `limit: N` + 轴关键词（沿用 `ratelimit.ts:1526` 的条件：只填空、只下调，从不上调）。
全候选被额度挡下 → 既有 429 `rate_limit_error` + `Retry-After`（`errorMapping.ts:11-12,33-39`），只多一个诊断 code。

**D 「哪家有免费额度可用」标记**（你要的识别能力，UI 主产出；口径按 §4 已降级，不冒充实时查询）
每家一个证据驱动的状态，五态互斥、各占一句，绝不收敛成"可用/不可用"两态：

| 状态 | 判定依据（全部不需要我发请求） | 界面那句话 |
| --- | --- | --- |
| 标称有免费额度 | `category:'free-tier'` 10 家（bazaarlink / byteplus / cloudflare / gemini / kilo / kimchi / nvidia_nim / ollama_cloud / open_router / opencode_zen）或 `authKind:'none'` 4 家（kilo / ollama / lmstudio / llamacpp）或带 `freeModelsHint`，**且** A 里有 `documented` 免费帽 | 一句"免费池，文档上限 N，来源 <docUrl>（<asOf>）" |
| 本应用已打满 | 账本 C 里该 `(provider, model)` 的日/月窗口 ≥ 上限 | 一句"本应用已用到文档上限，UTC 00:00 复位"，附已用量 |
| 需要 Key | `authKind:'apiKey'` 且未存 Key（`hasStoredKey` `manager.ts:215-217`） | 一句"未配 Key，无法计量"，**不显示任何额度数字** |
| 官方未公布 | A 的 `undocumented` | 一句"官方未公布额度，只能撞 429 后逐步测得"，留空数字 |
| 未录入 | 该 entry 在 A 的表里根本没有行（73 家做完后应为 0，这条留给将来新增家） | 一句"额度尚未录入" + 出处为空 |

三套计数域不得并排当可比：本应用账本数（token，含 B 的估算标记）、文档上限（外部口径）、
账号渠道的 credit 权重（不在本批）——各标各自来源，月度余量与日余量分列不合并。

**E 裸模型名跨家链**（Q2 已批）
现状：显示名带前缀 `glm/glm-5.2`，`isModelRoutable`（`store/modelServing.ts:76-83`）只认在服务的目录名，
裸名 `glm-5.2` 匹配不上任何一家 → `routes/chat.ts:181-193` 直接 503 `no_available_account`。
改成：裸名在所有"目录末段等于该名且正在服务"的聚合条目里按额度余量排序，429 后换下一家。
实测重叠规模：**74 个模型名出现在 ≥2 家**——`glm-5.2` 14 家、`deepseek-v4-pro` 13 家、`deepseek-v4-flash` 13 家、
`kimi-k2.6` 12 家、`kimi-k2.5` 11 家。今天这 74 个名字全部处在"有备选但用不到"状态。
约束：`preferredAccountId` 仍为硬约束；被 `excludedModels` 停用的条目因不在 `servedNames` 里，天然不参与。

## 4. 已裁定（2026-10-29）

| 项 | 裁定 | 对本方案的约束 |
| --- | --- | --- |
| 取数通道 | **只查官方文档，我不主动发任何探测请求** | A 的全部数值必须来自官方文档并带 `docUrl` + `asOf`；`AggregateEntry.quotaProbe` 里 `kind:'endpoint'` 那一档**本批不做**（要发请求）。`measured` 仍会出现，但只能由**用户自己正常业务流量顺带带回**的额度头与 429 错误体产生（C 的只降不升），不是我去打上游 |
| 首批范围 | **全部 73 家一次做完** | 无"未探测/未录入"的中间态可依赖，D 的界面必须把"文档也没公布"这一态渲染清楚，不能用空白或 0 代替（见 §3-D） |

连带降级（必须写明，否则 UI 会骗人）：**D 的"有免费额度"不是实时问上游问出来的**，
而是"官方文档标称免费池 + 本应用账本里该账号已用量 vs 文档上限"。所以第一版的状态名是
`标称有免费额度` / `本应用已打满日上限` / `需要 Key` / `官方未公布` / `未录入`，
其中"今日剩余"永远标注"按本应用计量"。真·实时余量要等 OpenRouter `/api/v1/key`、SiliconFlow `/v1/user/info`
这类账号级额度接口被授权后才有，那是独立一批。

## 5. 拍板记录

| 编号 | 问题 | 裁定（2026-10-29） |
| --- | --- | --- |
| Q1 | 额度取数通道 | **只查官方文档，我不主动发探测请求**；`learned` 只能由用户自己流量的额度头/429 体顺带产生。首批 **73 家一次做完**。连带效果：D 的"有免费额度"降级为"标称 + 本应用计量"，见 §4 |
| Q2 | 裸模型名跨家额度感知链 | **做**（E）。`preferredAccountId` 保持硬约束，`excludedModels` 停用行天然不参与 |
| Q3 | 官方文档也没公布额度的家 | 进 `undocumented`，**留空数字**，UI 出"官方未公布额度，只能撞 429 后逐步测得"；不填保守值也不填乐观值 |

## 6. 明确移出本批

10 个账号渠道（credit 权重与 `disabled/dead` 自带机制，与 token 额度不同口径，并表必造假可比）；
builtin / custom 供应商；Thompson 采样 bandit；`/v1/responses`、图像/语音/视频、fusion、prompt compression、MCP；
freellmapi 的目录云 `api.freellmapi.co`（核实：他们免费装也拿月度快照，`catalog-sync.ts:28-31`，`:1065` 无 Key 照发请求；
钉死的是**公钥**，只防 CDN/中间人注入模型；路由路径 grep `license|premium` 零命中，运行时不碰云。
不接不影响可用，且它的数正是上表那 36/146，达不到你要的准确值）。

## 7. 合规

MIT：任何转录数据在文件头注明来源仓库与 URL，保留版权与许可声明。
ToS：freellmapi README 的逐家复核表里 Cohere 明确 ❌ Avoid、NVIDIA / Gemini / Z.ai ⚠️，这些标注随目录进 `notes` 并在聚合页显示。
不做任何自动注册 / 绕过指纹闸门的逻辑（与 `docs/plan/PLAN-retire-web-providers-aggregate.md` 既有裁定一致）。

## 8. 验证口径

每阶段只跑定向测试；全量门禁在 A–E 全部落地后跑一次
（`npm run build` + 两个 `tsc --noEmit` + `node --test`）。负控逐条对应：
A 断"`source:'unmeasurable'` 的行不得参与预检"（把缺省改 `documented` 必须红）；
B 断"上游无 usage 时响应体里不出现估算值"；
C 断"UTC 午夜边界""崩溃后账本可读""已有 50 时学到 80 不得覆盖、学到 20 必须覆盖"；
D 断五种状态各出各自那句（i18n 三态按 key 断言，插值 `count` 可断到）；
E 断"裸名命中 ≥2 家时第一条 429 后由第二家成功应答，且请求日志两行 provider 不同"，
并把 `isModelRoutable` 的钉死还原作负控（该用例必须红）。

## 9. 实施状态（2026-10-29 收口）

| 阶段 | 状态 | 落点 |
| --- | --- | --- |
| A 额度取数 | 完成 | `scripts/build-aggregate-quota.mjs` → `src/shared/aggregateQuota.ts`；取证回执 `docs/data/free-quota-research/*.json`（g1–g6 + g7-retry，撤回项带 `withdrawn`）。**72 家：15 家有数字、57 家 undocumented** |
| B token 采集 | 完成 | `proxy/quota/usage.ts`；`routes/chat.ts` 三个成功出口计量；两处伪造的 `usage:{0,0,0}` 改为 `null`，并把"禁止伪造 usage"源码门从只抓 `1` 收紧到任意数字 |
| C 账本 + 预检 + 学习 | 完成 | `proxy/quota/ledger.ts`（滚动分钟/24h + UTC 月，防抖 rename 落盘）、`observations.ts`（额度头 + 429 体，只降不升）、`limits.ts`（条目帽/逐模型帽/实测帽合并）、`gate.ts`（autoRouter 与 loadbalancer 共用一份判据）、`chat.ts` 两出口喂学习 |
| D 五态标记 | 完成 | `shared/aggregateQuotaView.ts`（五态 + 免费池分离 + 窗口 + `officialNote` 原单位）、`pages/Aggregate.tsx`（额度列）、`aggregate/manager.ts` 经既有 `aggregate:list` 回 `quotaUsage`（未新增 IPC）；死字段 `quotaUsed/quotaTotal` 已删 |
| E 裸名跨家链 | 完成 | `shared/aggregateRouting.ts`（解析 + 排序）、`loadbalancer.selectChainCandidates`、`forwarder.forwardFirstReachable`（与 auto 共用唯一循环）、`X-ModelPort-Aggregate-Chain` 响应头 |

**与计划的两处偏离（都写在代码注释里）**：
1. 目录从 73 家 / 473 模型变成 **72 家 / 465 模型**——7 个上游已退役模型删除、`mistral_codestral` 整条撤下（2026-10-29 用户裁定"上游已不给用的就删除"）。
2. D 的五态里"已打满"用的是**本应用滚动 24 小时 / UTC 自然月**，不是"UTC 00:00 复位"；面板按窗口逐条标注，不承诺厂商的复位时刻。

**未做**：实机联调（本仓 `tests/api/` 只有纯函数与源码门，没有 HTTP 测试台）。已留一轮核对清单：
裸名请求的 `X-ModelPort-Aggregate-Chain` 应为链头条目；把链头 429 后请求日志应出现两行且 provider 不同。

**全量门禁**：`npm run build` 0、`tsc -p tsconfig.node.json` 0、`tsc -p tsconfig.json` 0、
`node --test "tests/**/*.test.{ts,mjs,js}"` **386/386 通过**。

## 10. 实时额度批（2026-11-03，§4 那条「等授权的另一批」已落地）

用户拍板：**聚合页手动点一次**（不做周期轮询、不做开页自动查）+ **问回来的余量要参与选号排序**。

- **目录声明**：`AggregateEntry.quotaProbe = { path, reader, docUrl, asOf }`（`src/shared/aggregate.ts`），两家条目各一条：`open_router` → `/key` / `openrouter-key`，`siliconflow` → `/user/info` / `siliconflow-user-info`。没进 `aggregateQuota.ts`，因为那份是 `scripts/build-aggregate-quota.mjs` 从取证回执生成的产物、明令不得手改，把一个 URL 掺进数值生成器会让两边都对不上账。
- **基址跟着用户配的那一个走**：抓取用 provider 记录里的 `apiEndpoint` 拼相对路径，聊天流量去哪个 host、额度查询就去哪个 host；转录来的 `.com` 因此不会在两处不一致。鉴权复用 `buildProbeHeaders`（与聊天同一个 header/prefix），Key 不过 IPC、不进日志（`tests/aggregate/credit-query-fetch.test.ts` 把 stdout/stderr 都接走做断言）。
- **单位隔离（本批最关键的一条）**：美元额度、人民币余额、本应用的 token 账本是三个互不可比的计数域，所以实时余量**只当闸门、不当数字**——`shared/aggregateCredit.ts::creditSnapshotExhausted` 是唯一判据（整行成立、明确不是 `unlimited`、问到了一个数、`<= 0`、`asOf` 在 `CREDIT_SNAPSHOT_TTL_MS = 15min` 内），命中时 `aggregateHeadroom` 返回既有的 `-1`、`quotaBlockReason` 返回新增的 `'no-credit'`。`QuotaBlockReason` 因此拆成 `QuotaWindowBlockReason | 'no-credit'`，`METRIC_FOR_REASON` / `REASON_ORDER` 只对窗口那一半有定义——把美元折进 token 比例在类型层就写不出来。
- **TTL 为什么是 15 分钟**：这一行是人手点出来的，用户不再点就没有新数据；让一个人工读数长期影响路由等于让路由表停在他上次好奇的那一刻。超期仍照实展示并标过期，只是不参与排序。回退成本是一个常量。
- **多把 Key**：单次上限 `CREDIT_QUERY_KEY_CAP = 10`，逐把各问一次、界面按 Key 分行；超出部分显式写「其余 N 把未查询」，不静默截断。`limit: null`（OpenRouter 无上限）→ `unlimited`，既不当 0 也不当「还有很多」，且永不参与排序。
- **五态未动**：`aggregateQuotaView.ts` 的五个状态一个字没改，实时余量是旁边独立一行（`tests/renderer/aggregate-credit-wiring.test.mjs` 断言它不喂 `quotaViewOf`）。
- **判据**：`tests/aggregate/credit-readers.test.ts`（解析层，含「解析器不 import 传输/store/fs」）、`tests/aggregate/credit-query-fetch.test.ts`（本地替身，绝不打真实域）、`tests/proxy/quota-credit-gate.test.ts`（TTL 两侧 + 无快照时与改动前逐值相同 + 落盘形状）、`tests/renderer/aggregate-credit-wiring.test.mjs`（四环接线 + 双语同键）。负控：把 TTL 改成 365 天 → 2 条红（已还原复绿 21/21）。
- **本轮做不了、必须真机点一次才知道的一件事**：两个响应形状来自 §1 第 3 行的转录记录，本轮没有任何真机报文。字段拼写（余额是不是就叫 `balance`）与 `api.siliconflow.com` 这个 host 通不通，都要在界面上点一次才知道；对不上时解析器报 `unexpected-shape` 并显示在界面上，不会伪装成一个数。

**外部探测补充（2026-11-03，C 组自行查询）**：两个 host 均可达，端点均存在，未携带有效 Key 时都返回标准 JSON 401。OpenRouter `GET /key` 返回 `{"error":{"message":"No cookie auth credentials found","code":401}}`；SiliconFlow `GET /user/info` 返回 `{"code":30014,"data":null,"message":"Token is invalid."}`。这只能证明“host 可达、路由存在、鉴权 fail-closed”，**不能**证明成功响应里的字段拼写；`openrouter-key` / `siliconflow-user-info` 读取器暂不改，`unexpected-shape` 兜底仍然有效。

**真机冒烟结果（2026-11-03 18:10，用户界面实点）**：
- **OpenRouter：正常出数**。`openrouter-key` 读取器期望的 `data.limit` / `data.limit_remaining` 形状由此得到真机证实，无代码改动。
- **SiliconFlow：HTTP 401**（`code 30014 / Token is invalid.`）。判定：① 端点与请求形态都是对的——假 Key 直测 `.com` 与 `.cn` 两个 host 均返回同款 JSON 401，说明上游正常解析了 `Authorization: Bearer`；② 401 发生在 `readCreditAt` 的 HTTP 状态分支，早于解析层，所以这**不是**「`balance` 字段名猜错」，读取器不需要也不应该改（成功形状至今无真机报文，`unexpected-shape` 兜底继续生效）。用户侧动作：核对重填该条目 Key（Key 入库不做事前校验，401 是第一现场）。
- **本次暴露并修复的真实缺陷**：`readCreditAt`（`manager.ts:824-826`）把上游原话吞了——detail 只留 `HTTP 401`，界面只能说「上游拒绝了这次查询」，用户分不清 Key 无效还是端点异常；而同文件 `testModel`（`:708`）早已用 `errorMessageOf` 保留原话。修复 = 失败分支拼上 `errorMessageOf(response.data)` 并先过 `redactSecrets`（401 正文可能反射请求 Key）。判据：`credit-query-fetch.test.ts` 原 401 条断言改钉 `HTTP 401 - nope`，新增「401 正文反射 Key 时 detail 已脱敏且 vendor 句子存活」一条（用 SiliconFlow 真实报文形状）。解析层零改动。

**第二轮探测（2026-11-03 晚，用户换 Key 后重测）：HTTP 410 — 端点已被官方下线**：
- `GET /user/info` 返回 `410 This endpoint is deprecated and is no longer available.`——410 与 401 性质完全不同：401 是「这把 Key 无效」（换 Key 能解决），410 是「这个端点本身不存在了」（**任何 Key 都不会成功**）。
- 官方更新公告（https://docs.siliconflow.cn/cn/release-notes/overview）原文：「由于系统更新迭代，/user/info 接口已无法适配平台用户账户体系，该 API 将正式停止服务……若您仍在使用 /user/info 接口，请尽快移除相关调用」；第三方佐证（ApiMonitor / DSH 余额查询插件 / MeteorNOX 组件）一致记录该接口 **2026-08-14 起停止服务**，替代接口「截至发版仍未见」，这些组件均已改用「无余额接口 + 探活验证 Key」策略。
- 处置（同轮落地）：registry 撤下 `siliconflow` 的 `quotaProbe` 声明（保留声明等于假装能查），`queryCredits` 走既有 `no_probe` 路径、界面显示「该条目没有声明额度端点」；`credit-readers.test.ts` 声明断言改钉 `declared === ['open_router']` 并断言 siliconflow 无 `quotaProbe`（注明官方 2026-08-14 下线与公告出处）；`readSiliconFlowUserInfo` reader 保留不删（纯函数、零调用方，官方替代端点上线时字段名要按真机报文重写整个 reader，现在删只制造无意义 diff），仅在注释里写明去向。`aggregateQuota.ts` 的 siliconflow 段是模型限速票据（quota 全 null），与本功能无关，不动。
- 判据出处：本轮所有结论以用户实点报错 + 官方公告 + 第三方 CHANGELOG 为准，`credit-readers.test.ts:212` 起是回归钉。
