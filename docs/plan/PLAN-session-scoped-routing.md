# 方案：会话级路由与前缀契约（L1–L3）

> 成文版本：v1.8.38+（待定）｜ 成文日期：2026-11-20 ｜ 状态：**已实施（L1–L3 落代码，全量门禁 3246/3246，未提交）**
> 关联：[`PLAN-prompt-cache.md`](PLAN-prompt-cache.md)（缓存能力、断点、读数与仪表盘归那份，本方案不重复）
> 结论先行：网关四个指标（缓存命中 / token / 时延 / 稳定）一起掉的共同根源是**决策频率**——每轮都在重抽账号、重算裁剪点、整回合压着不交付。本方案不改机制数量，只把决策单位从「请求」改成「会话」。

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| 能同时拿到路由便利与直连水准吗？ | 能拿到「会话内」。跨会话的负载均衡仍然要付代价，靠分配器补。 |
| 同一会话还能换模型吗？ | **能，而且必须能。** 客户端点名、`routes:switch`、失败转移都是合法切换；变的是「不许静默切」，且切换计价可见。 |
| 不同账号的同一模型呢？ | 模型相同、缓存域不同（按 org/key 隔离）。默认粘住一个号，硬失败才换，换后预热一次。 |
| 三个杠杆 | L1 具名车道补账号亲和；L2 裁剪点单调、序列化跨轮稳定；L3 交付窗口收窄 + 预热/重发自适应。 |
| 绝不能破的 | 客户端点名必须被尊重；前缀逐字节稳定；降级撤销要分「换模型」与「换账号」两类。 |

---

## 1. 现状核对（2026-11-20 取码，先纠偏）

上一轮结论里「账号每请求重选」只对**具名模型车道**成立，这里按车道分开：

| 车道 | 模型粘性 | 账号粘性 | 前缀稳定 |
|---|---|---|---|
| auto 路由 | 有：`stickyHardPin` 缺省开，硬钉（[autoRouter.ts:1567](../../src/main/proxy/autoRouter.ts#L1567)） | 有：sticky hint 携带 provider/account，另有 `cacheAffinity`（[autoRouter.ts:1515-1543](../../src/main/proxy/autoRouter.ts#L1515)） | 无：裁剪点每轮重算 |
| **具名模型** | 名字固定，无「粘性」概念 | **无**：仅 `!autoDecision` 才走 `selectAccount`，`preferredAccountId` 只来自静态 `modelMapper.getPreferredAccount`（[chat.ts:910-919](../../src/main/proxy/routes/chat.ts#L910)） | 无 |
| responses | 同 chat | 同 chat | 无，且整回合压着不交付 |

其余已确认的落点：

- 会话键：`clientSessionKey({ body, headers })`（[chat.ts:823](../../src/main/proxy/routes/chat.ts#L823)），来源 `client-session | content-hash`（[autoRouter.ts:265](../../src/main/proxy/autoRouter.ts#L265)）。
- 降级撤销：`revokeSticky` 同时清 sticky 与 cacheAffinity（[autoRouter.ts:2617](../../src/main/proxy/autoRouter.ts#L2617)），注释写明质量退化是「correctness signal, not a cache trade-off」——**这条是既有取舍，本方案不改它，只改具名车道与裁剪层。**
- 裁剪：每请求新建 service、无会话状态（[forwarder.ts:548-563](../../src/main/proxy/forwarder.ts#L548)）；保尾丢头 `slice(-N)`（[contextManagementService.ts:717](../../src/main/proxy/services/contextManagementService.ts#L717)）。
- 交付：`holding` 直到首个 tool-call delta 或流结束（[responses.ts:384](../../src/main/proxy/routes/responses.ts#L384)）。
- 已稳定的改写（不需要动）：图片转述按 sha256 复用（[visionRelay.ts:47](../../src/main/proxy/visionRelay.ts#L47)）；工具名改名与 namespace 展开都是确定性映射。

---

## 2. 不变量

1. **客户端点名必须被尊重。** 换模型、换账号永远是合法请求；本方案只改变「默认走谁」与「切换是否可见」，绝不阻止切换。
2. **前缀契约。** 同一会话第 N+1 轮序列化必须以前 N 轮为前缀。允许断裂的只有四种显式原因：客户端改写历史、超预算推进裁剪点、硬失败换腿、客户端点名换模型。每种都要能写进 trace。
3. **撤销分类。** 「模型质量退化」只换模型，「账号故障」只换账号。一次撤销不得同时改变两者——否则缓存断在没人要求的地方。
4. **缓存域是物理事实。** 换模型、换账号、跨供应商换家，都必然全冷一次；本方案不试图消除这次断裂，只保证它只发生一次而不是每轮发生。
5. **不写文本。** 沿用 AGENTS.md 铁律，不新增任何写进请求的自造文本。
6. **失败开放。** 新判据缺数据、异常、未知能力时退回现有行为。

---

## 3. 阶段

### L1 — 具名车道的会话级账号亲和

**目标**：具名模型在多账号池里也能像直连一样连续命中同一账号的缓存。

**落点**

- [chat.ts:910-919](../../src/main/proxy/routes/chat.ts#L910)：`!autoDecision` 分支在调 `selectAccount` 前查会话亲和表，得到 `preferredAccountId` 后复用现有参数位（[loadbalancer.ts:78](../../src/main/proxy/loadbalancer.ts#L78) 签名不改）。
- 新内存表 `(conversationKey, model) → accountId`，容量与 TTL 对齐 autoRouter sticky；可选落盘，格式与 `cacheAffinity` 一致（[autoRouter.ts:2217](../../src/main/proxy/autoRouter.ts#L2217)）。
- 取值顺序：**用户静态点名**（`modelMapper.getPreferredAccount`）> 会话亲和 > `loadBalanceStrategy`。
- 失效白名单：配额窗耗尽、欠费/未订阅、静默通道判死、401/403 账号失效。**裸 429 与延迟退出粘性不换号**（它们不改变缓存域，换了纯亏）。
- 换号时：写一条 `routeSwitch` trace（`reason` + `from` / `to`），并在 L3 开启时对新账号预热一次。

**判据**

1. 同一 `conversationKey` 连续 5 轮（间隔 < 亲和 TTL）落到同一 `accountId`。
2. 注入硬失败后，1 轮内换号，且该会话之后不再回摆。
3. 裸 429 场景下账号不变（用现有失败注入夹具）。

**代价**：会话级负载不均，单账号可能变热。缓解靠「新会话按剩余额度分配」，老会话不动。这是一笔明确的交换，不接受就不该做 L1。

**回退**：亲和表开关默认开、可关；关了等价于现在的行为。

---

### L2 — 前缀契约：裁剪点单调 + 序列化稳定

**目标**：长会话不再每轮从裁剪点起重新冷启动。

**落点**

- [forwarder.ts:548-563](../../src/main/proxy/forwarder.ts#L548)：`createContextManagementService` 增加 `sessionKey` 入参；service 内部持有 `(sessionKey, model) → cutIndex`。
- 规则：
  1. 首次需要裁剪时按现有算法算 `cutIndex` 并记住。
  2. 之后每轮先验：记住的 cut 是否仍满足预算。满足 ⇒ **原样使用，不重算**。
  3. 不满足 ⇒ 前移，并**一次多让出一份余量**（`TRIM_CUT_HEADROOM_RATIO = 5%`），
     写 `cacheBreak: trim-advance`，并预热一次。
  4. 会话 TTL 到期丢弃。

- **实施时发现并修正的缺口**：「装不下就前移一格」在固定预算下等于每轮断一次——
  历史每轮增长一点，裁剪点就跟着挪一点，与改动前的逐轮重算没有任何区别。必须
  一次多让出 5%，后续几轮的增长都落在余量里，断裂才从「每轮」摊成「每 K 轮」。
  代价是窗口少用约 5%（模型看到的历史略少）。这是本阶段真正的机制，不是可选项。
- 稳定性断言：`repairToolCallAdjacency`、工具名改名、namespace 展开对同一输入必须逐字节幂等。已有实现是确定性的，这里只补测试钉住。

**判据**

1. 新测试：构造 6 轮递增历史，断言第 N+1 轮发出的序列化以第 N 轮为前缀；裁剪推进那一轮除外，且该轮必须带 `trim-advance` 标记。
2. 同一输入连续处理两次，序列化结果逐字节相同。
3. 真机：同一会话 5 轮的 cache read 曲线不再出现「每轮归零」。

**代价**：裁剪点冻结期间窗口余量变小，极端长会话可能比现在更早拒绝。回退：余量低于 5% 时允许提前推进（仍只推进一次），阈值见 §5。

---

### L3 — 交付窗口收窄与开关自适应

**目标**：把 responses 线的「整回合 hold」压到「头 1–2k 字」，同时不把复读交给客户端。

**落点**

- [responses.ts:384](../../src/main/proxy/routes/responses.ts#L384)：`holding` 改为多信号放行：
  - 已有 tool-call delta ⇒ 放行（现状）。
  - 字符数 ≥ 6000 且去重率过闸 ⇒ 放行（现状）。
  - **新增**：1200–6000 字之间，连续两个窗口的行级去重率不上升 ⇒ 放行。
  - **新增**：45 s 兜底，无任何判据也放行（宁可晚交付，也不无限压）。
- 预热自适应（[promptCache.ts:129](../../src/shared/promptCache.ts#L129)）：仅当「上一轮距今 < 5 分钟」且「本会话轮数 ≥ 2」时发预热请求；压完即结束的会话不再净亏。
- 重发自适应：重发前用 `streamRepetition` 同一判据复核已生成部分，减少误重发（误重发的代价是双份 token 与双份时延）。

**判据**

1. 纯正文回合的 TTFT 中位数下降（改前后各取 50 次同夹具）。
2. 现有退化测试全集仍绿：复读交付率 0，`[DONE]` 唯一，残片剥离不变。
3. 预热请求数在「单轮会话」里为 0。

**代价**：判据越早越可能误杀健康正文；45 s 兜底意味着极端长文仍会晚交付。两者都进配置，可关。

---

## 4. 明确不做

- **不做「禁止换模型」**：客户端点名与失败转移是契约，不能拿缓存当理由拒绝。
- **不做跨账号/跨供应商缓存迁移**：上游按 org/key 隔离，物理不可行，不设计假通路。
- **不改 `revokeSticky` 的现有语义**：质量退化仍撤销模型锚点（[autoRouter.ts:2617](../../src/main/proxy/autoRouter.ts#L2617)）；本方案只在账号侧新增独立记忆，避免一次退化解两把锁。
- **不改 `loadBalanceStrategy` 算法**：只在其前面加一层会话记忆。
- ~~**本次不覆盖 `/v1/completions` 的具名车道**~~：用户点明该车道仍在使用
  （2026-11-20），已补上：`completions.ts` 与 chat 同一条规则（用户静态点名 > 会话亲和 > 策略），
  会话键也共用 `clientSessionKey` + `conversationKeyFor`。
- **不重复 PLAN-prompt-cache 的断点与仪表盘工作**。

---

## 4.5 实施记录（2026-11-20）

| 阶段 | 落点 |
|---|---|
| L1 | `shared/types.ts`（`AppConfig.sessionAffinity`，缺省开）、`store.ts` 归一、`proxy/accountAffinity.ts`（新）、`loadbalancer.ts::selectAccount` 第 5 参、`autoRouter.ts` 两个方法（能力闸 + TTL 收口）、`chat.ts` 与 `completions.ts` 读写、`LoadBalanceConfig` 总开关 + 两份语言包 |
| L2 | `services/contextManagementService.ts`（`cutHint` / `cut` / 5% 余量 / `TRIM_CUT_HEADROOM_RATIO` / `cutFingerprintOf`）、`proxy/trimCutLedger.ts`（新）、`ProxyContext.sessionKey`、`forwarder.ts` 读回写 |
| L3 | `shared/streamRepetition.ts`（`earlyReleaseMinChars` / `holdTimeoutMs` / 归一）、`routes/responses.ts`（两窗早放行 + 45 s 兜底 + 守卫关闭不押）、`cacheMissLedger.ts::snapshot`（轮数与时刻）、`cacheWarm.ts`（`not_continuation`）、`chat.ts` 透传、设置页两项 + 两份语言包 |
| 测试 | `tests/proxy/session-account-affinity.test.ts`、`tests/proxy/trim-cut-continuity.test.ts`、`tests/shared/stream-repetition.test.ts`（新期望 + 归一用例） |

### 4.6 只读归因再切分（2026-11-20，用户批准）

起因：现网读数显示 OpenCode Go 80.8%、百炼 `deepseek-v4.1-flash` 73.4%，但同一个
OpenCode Go 的 `hy4-flash-free` 是 94.2%、同一个模型的 `buddy` 是 99.1%。四类成因
无法回答「81% 里有多少是该付的」。因此把分类拆细，**不改任何处置**：

| 计数 | 判据 | 含义 |
|---|---|---|
| `coldFirst` | cold 且本会话无上轮读数 | 真·首轮，无法避免 |
| `coldResumed` | cold 但会话有上轮读数（>50% 未命中） | 锚点丢了，异常 |
| `breakAppend` | break 且 `未命中 ≤ 本轮新增 + max(1k, 10%)` | 新增内容本来就没缓存，结构上限 |
| `breakDiverged` | break 且未命中明显大于新增 | 已有前缀被改写，要查 |
| `afterRestart` | 首轮 + 进程启动 10 分钟内 | **疑似**账本被重启清掉，不是新会话 |

落点：`proxy/cacheMissLedger.ts`（判定）、`shared/tokenAccounting.ts`（类型、归一、
日桶累加）、`store.ts::recordTokenUsage`、`chat.ts` 透传、`shared/providerUsage.ts`
（窗口求和）、`ModelCacheCard` 的第二行与中英文案。测试见 `tests/proxy/cache-miss-ledger.test.ts`。

**token 权重（同日追加）**：条数回答「多少轮」，token 回答「损失多大」——两者会给出
相反结论（一轮冷启可能丢 30 万 token，四十轮断链新增只丢 2 万）。所以在四类与每个
再切分上各记一份 `cacheMissTokens` / `cacheMissTokenDetail`，口径 `未命中 = prompt − cacheRead`
（只算上报了缓存字段的上游请求）。面板上：四类圆点旁显示该类未命中 token 合计，括号里的
百分比以四类未命中 token 总和为分母。`afterRestart` 是**子集标记**：同一笔未命中在它和
`coldFirst` 各记一次，但四类合计里只算一次——这是刻意保留的双计，面板上读作「其中」。

**续轮间隔分档（`cacheMissIdleGap` / `cacheMissIdleGapTokens`）**：把 `coldResumed` 按
「距上一轮」的间隔切 <5m / 5–30m / >30m。这是区分两种成因的唯一客观依据：间隔超过上游
缓存寿命 ⇒ 过期是事实，不用修；间隔很短却整段没命中 ⇒ 上游提前清缓存或换了后端，应当
找供应商。受账本读数保留窗（6 小时）约束：更久的会话按新会话记（首轮），`over30m`
实际覆盖 30 分钟到 6 小时。2026-11-20 11.5 分钟窗口的实测：断链 95.6% 是「新增」，
`breakDiverged` 仅占 2.1% 未命中 token；损失大头是 `coldResumed`（百炼 56%、OpenCode 94%）。`

---

## 5. 待拍板

| # | 事项 | 建议 | 代价 |
|---|---|---|---|
| 1 | 账号亲和默认开还是关 | 默认开，提供总开关 | 默认开即接受会话级负载不均 |
| 2 | 裁剪点冻结的余量阈值 | 5% | 更小 ⇒ catch 更少、拒绝更多；更大 ⇒ 断裂更频繁 |
| 3 | 45 s 兜底是否接受 | 接受 | 极端长文晚交付 |
| 4 | 亲和表是否落盘 | 先内存，观察一轮再定 | 不落盘则进程重启后首轮全冷 |

---

## 6. 验收

- `npm run gate` 四项全绿（build + build:daemon + 两个 `tsc --noEmit` + 全量测试），经 SSH 执行。
- 新增测试：L1 亲和 3 例（稳定 / 硬失败换号 / 裸 429 不换）、L2 前缀契约 3 例（跨轮前缀、幂等、推进标记）、L3 放行 3 例（两窗稳定、45 s 兜底、单轮不预热）。
- 真机读数（同一会话 5 轮）：cache read 曲线、TTFT、total tokens、所选 `accountId` 序列。三项都比改前取到的基线对比，缺读数不算完成。