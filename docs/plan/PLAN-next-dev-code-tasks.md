# PLAN：下一步开发计划代码修改任务（详细）

> 成文版本：v1.6.1 ｜ 最后核对：2026-11-03 ｜ 状态：历史记录

- 日期：2026-11-03
- 基线：工作树 @ 2026-11-03（三条活跃线：auto-routing-v2 / freellmapi-free-token / channel-auto-stability）
- 性质：把三条线的**剩余未闭环项**拆成可执行的代码修改任务，每条带落点、改法、验收判据、负控。
- 门禁：每批只跑定向测试；全批完成后跑一次 `npm run gate`（build + tsc×2 + node --test）。

---

## 0. 三条线当前状态（本轮实读，不是推测）

| 线 | 计划文档 | 已落地 | 剩余未闭环 |
|---|---|---|---|
| auto-routing-v2 | `docs/design/PLAN-auto-routing-v2.md` | 阶段 A/B/C 全部完成；粘性硬钉 `stickyHardPin` 已在代码落地（`autoRouter.ts:654`、`shared/types.ts:321`、`modelRoutes.ts:167/339`、`ModelRouteFields.tsx:277-278`）+ 判据（`routes-pool-and-sticky.test.ts:386-430` 三条正反） | ✅ 文档已同步（2026-11-03）：§6 C-1 行反映默认硬钉；§1.4 原文上方加了「已被 §7 推翻」的反向指针，线性阅读不会再停在旧裁定 |
| freellmapi-free-token | `PLAN-port-freellmapi-free-token.md` | A–E 五步 + §10 实时额度批全部完成（`aggregateQuota.ts`/`ledger.ts`/`aggregateCredit.ts` 等） | ✅ host 与端点已外部探测（均 401）；⚠️ 成功响应字段拼写仍需有效 Key 验证；文档已同步 |
| channel-auto-stability | `docs/audit/PLAN-channel-auto-stability.md` | R1–R6 五批修复 + 第六批 A1 收尾 + B-a（`/v1/api-definition/providers` 已实现） | 第五批「何时算限流结束」✅ 已闭环（`providerRetryAfterMs` 接线）；第六批相邻面 ✅ B-a 已实现并有定向判据 |

**结论（2026-11-03 收口后更新）**：三条线的代码缺口全部闭合——A 组四条接线已落地并配判据，
B-a 路由已实现，D-1/D-2 文档同步完成。剩余只有**外部条件**：C-3 要等有效 Key 的真实报文
（OpenRouter / SiliconFlow 的 401 探测只证明了 host 与端点存在，不能证明字段拼写）；
B 组真机面与 auto-routing 设置页手点属人工冒烟，不由本计划伪造读数。

---

## 1. 任务组 A：渠道包解禁时刻接线（channel-auto-stability 第五批未闭环）

### 现状（本轮实读）

渠道包（`vendor/channel-pack`）在 429 时已经算出上游真实解禁时刻并上报：

- `vendor/channel-pack/src/index.ts:1808`：`throw new LlmError('opencode: 该模型的所有通道当前都在限流中…', 'RATE_LIMIT', { status: 429, ...(waitMs === undefined ? {} : { providerRetryAfterMs: waitMs }) })`
- `resources/channel-pack/worker.mjs:54554`：`{ status: 429, ...retryAfterMs === void 0 ? {} : { providerRetryAfterMs: retryAfterMs } }`
- `resources/channel-pack/worker.mjs:54574-54577`：把 `failure.providerRetryAfterMs` 归一进 `info.retryAfterMs`

但宿主侧**丢弃了这个字段**：

- `src/main/channelPack/bridge.ts:281-295`：`case 'error'` 只读 `message.message` 与 `message.status`，`providerRetryAfterMs` 被丢弃
- `src/main/channelPack/bridge.ts:28-35`：`ChannelBridgeError` 只有 `status`，没有 `retryAfterMs`
- `src/main/proxy/accountRuntime.ts:303-331`：`recordFailure` 对 429 走自己的指数退避（`RATE_LIMIT_BASE_MS * 2**(failures-1)`，上限 `RATE_LIMIT_MAX_MS`），**不读**上游报的解禁时刻

后果（计划原文 §第五批已记录）：渠道包报的解禁时刻仍只往前推 60s，宿主在 `(账号,模型)` 档记到 10 分钟，但**派单前不读渠道包那句时刻** → 自维持循环（冷却到期→放一笔→又 429→再冷却）。

### 改法

| 编号 | 任务 | 落点 | 改法 | 验收 | 负控 |
|---|---|---|---|---|---|
| A-1 | `ChannelBridgeError` 携带 `retryAfterMs` | `src/main/channelPack/bridge.ts:28-35` | 类加可选字段 `retryAfterMs?: number`；构造函数第三参接收 | ✅ 已落地（bridge.ts 已改） | 单测：带 `providerRetryAfterMs` 的错误能取到该值；不带时字段为 `undefined` | 删掉字段即红 |
| A-2 | bridge `case 'error'` 读取并透传 `providerRetryAfterMs` | `src/main/channelPack/bridge.ts:281-295` | 从 `message.providerRetryAfterMs`（number 且有限）取值，传入 `ChannelBridgeError` 第三参 | ✅ 已落地（bridge.ts 已改） | 单测：worker 上报 `{status:429, providerRetryAfterMs: 60000}` → bridge 抛出的 error 带 `retryAfterMs === 60000` | 把读取改回只读 status → 红 |
| A-3 | 宿主把 `retryAfterMs` 喂进 accountRuntime 冷却 | `src/main/proxy/forwarder.ts`（渠道分支）+ `src/main/proxy/accountRuntime.ts:303-331` | `recordFailure` 增可选尾参 `retryAfterMs?: number`；给了 429 且给了 model 时，`coolingUntil` 取「自己指数退避」与「`now + retryAfterMs`」里**更晚**的那个（与既有 `coolingUntil` 取更晚的语义一致，`accountRuntime.ts:499-515`） | ✅ 已落地（accountRuntime.ts + forwarder.ts 已改） | 单测：`recordFailure(id, 429, now, model, 120000)` → 冷却到期 ≥ `now + 120000`；不给 retryAfterMs 时行为与改动前逐值相同 | 把「取更晚」改回「只用退避」→ 红 |
| A-4 | forwarder 渠道分支把 bridge error 的 `retryAfterMs` 传下去 | `src/main/proxy/forwarder.ts`（`ChannelBridgeError` 消费处） | 捕获 `ChannelBridgeError` 时，若 `error.retryAfterMs !== undefined` 则随 `recordFailure` 传入 | ✅ 已落地（forwarder.ts 已改） | 单测：渠道 429 带 `providerRetryAfterMs` → accountRuntime 该模型档冷却用上游时刻 | 不传 → 红 |
| A-5 | 判据 + 文档 | `tests/proxy/accountRuntime.test.ts`、`docs/audit/PLAN-channel-auto-stability.md` | 补 A-1~A-4 用例；计划文档第五批「未闭环」那条改标「已闭环」 | ✅ 测试已补；docs/audit/PLAN-channel-auto-stability.md 第五批已标已闭环；PLAN-next-dev-code-tasks.md A 组表格已标落地 | 全量门禁绿；文档状态与代码一致 | — |

**不做**：不改渠道包内部退避逻辑（`vendor/channel-pack` 只 vendor，改它要重打包）；不把 `retryAfterMs` 折进 token 额度（那是 freellmapi 线的口径，本线只管冷却时刻）。

---

## 2. 任务组 B：`/v1/api-definition/providers`（channel-auto-stability 第六批相邻面，B-a 已完成）

### 现状（本轮实读）

- 计划原文 §第六批「未做的相邻面」：`/v1/api-definition/providers` 仍没有 anthropic 分派；Claude Desktop 若走能力发现而非 `/v1/models`，那里是下一个同源缺口。
- 本轮 grep：`src/main/proxy/routes/` 与 `server.ts` **不存在** `api-definition` 或 `definition` 路由。即该路由当前**根本不存在**（不是「存在但无分派」，而是整条缺失）。

### 裁定与实现（2026-11-03，用户拍板 B-a）

**选 B-a：按网关自定义形状实现。** 落点：
- `src/main/proxy/routes/apiDefinition.ts`：实现 `GET /v1/api-definition/providers`；清单同源取 `enabledModelRoutes` + `resolvePoolRoute` 成功集合，`context_window` 复用 `autoRouter.advertisedContextFloors()`；每个响应带 `X-Request-Id`。
- `src/main/proxy/routes/index.ts`：注册并导出路由。
- `src/main/proxy/server.ts`：根路由 endpoints 清单补齐该 endpoint。
- `tests/routes/api-definition.test.ts`：覆盖空表、启用/禁用路由、上下文下界、`anthropic-version` 不改变形状、未广告子路径 404。

**边界**：这是 ModelPort 网关自定义发现形状，不是 Claude Desktop / Anthropic 契约；不提供单查 detail，不做 `anthropic-version` 分派。

---

## 3. 任务组 C：实时额度真机验证（freellmapi §10）

### 现状（计划原文 §10 已记录）

两个响应形状来自转录记录，本轮没有任何真机报文。字段拼写（余额是否叫 `balance`）与 `api.siliconflow.com` host 可达性，都要在界面上点一次才知道；对不上时解析器报 `unexpected-shape` 并显示，不会伪装成一个数。

### 改法（验证驱动，非纯代码）

| 编号 | 任务 | 落点 | 改法 | 验收 |
|---|---|---|---|---|
| C-1 | 外部探测 OpenRouter `GET /key` | 无有效 Key 的 HTTP 探测 | 记录 host 可达性与 401 响应 | ✅ host 可达、端点存在、返回 JSON 401；成功形状未证明 |
| C-2 | 外部探测 SiliconFlow `GET /user/info` | 同上 | 记录 host 可达性与 401 响应 | ✅ `api.siliconflow.com` 可达、端点存在、返回 JSON 401；成功形状未证明 |
| C-3 | 若形状不符，修读取器 | `src/shared/aggregateCredit.ts`（`openrouter-key` / `siliconflow-user-info` 读取器） | 按真机实际字段改解析；保留 `unexpected-shape` 兜底 | `tests/aggregate/credit-readers.test.ts` 用真机报文形状更新 |
| C-4 | 文档状态同步 | `PLAN-port-freellmapi-free-token.md` | 状态从「待拍板 Q1–Q3」改为「已实现 + 真机验证」；Q1–Q3 已裁定且落地 | 文档与代码一致 |

**不做**：不做周期轮询、不做开页自动查（§10 已拍板：手动点一次）。

---

## 4. 任务组 D：文档状态同步（auto-routing-v2 + freellmapi）

| 编号 | 任务 | 落点 | 改法 | 验收 |
|---|---|---|---|---|
| D-1 | auto-routing-v2 §6 C-1 行同步 | `docs/design/PLAN-auto-routing-v2.md:186` + §1.4 | ✅ 已完成（2026-11-03）：§6 C-1 行已写「路由级默认硬钉（`stickyHardPin` 缺省即开）」；本轮另在 §1.4 原文上方补「已被 §7 推翻」反向指针——只改 §6 不够，线性阅读 §1.4 的人仍会停在「不再硬钉」的旧裁定 | 与 §7、代码、判据三方一致 |
| D-2 | freellmapi 文档状态 | `PLAN-port-freellmapi-free-token.md` | ✅ 已完成：状态行已是「已实现 + 外部端点探测（Q1–Q3 已裁定且落地；额度响应字段仍需有效 Key 验证，2026-11-03）」，与 C-1/C-2 探测读数一致 | 见 C-4 |

---

## 5. 执行顺序与依赖

1. **A 组（代码，最高优先级）**：A-1 → A-2 → A-3 → A-4 → A-5。A-1/A-2 是 A-3/A-4 的前提。
2. **C 组（验证）**：C-1/C-2 真机点一次 → 若不符走 C-3 → C-4。可与 A 组并行（C 不依赖 A）。
3. **B 组**：✅ 已按用户拍板实现 B-a；定向测试通过。
4. **C 组**：✅ 已自行完成无 Key 外部探测；有效 Key 的成功响应字段验证留给后续。
5. **D 组（文档，最后）**：D-1/D-2 已同步 A/B/C 状态。

## 6. 门禁

- A 组每条任务配定向测试；A 组完成后跑一次 `npm run gate`。
- C 组若触发 C-3（改读取器），跑 `tests/aggregate/credit-readers.test.ts` + `credit-query-fetch.test.ts`。
- 全批（A+C+D）完成后跑一次全量 `npm run gate`（build + tsc×2 + node --test）。

## 7. 边界与风险

- **A 组不改渠道包内部退避**：渠道包是 vendor，改它要重打包 `resources/channel-pack/worker.mjs`；本批只在宿主侧接 `providerRetryAfterMs`。
- **A 组 `retryAfterMs` 只影响冷却时刻，不影响额度计量**：额度计量走 freellmapi 线的 `quota/ledger.ts`，两线口径隔离。
- **B 组形状是网关自定义**：不宣称 Claude Desktop / Anthropic 兼容；未广告名沿用通用 404。
- **C 组 401 不是成功形状**：无 Key 探测只能证明 host 与端点存在；字段拼写必须等有效 Key 返回后再决定是否触发 C-3。
