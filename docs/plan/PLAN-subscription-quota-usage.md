# 方案：订阅套餐用量的可见性与可执行（OpenCode / 百炼等）

> 成文版本：v1.8.37+ ｜ 最后核对：2026-11-20 ｜ 状态：**已实施（A/B/C 同批落地）**
> 结论先行：**在线问「套餐还剩多少」这两家都拿不到**（无公开接口，且 Coding Plan 条款禁止 API 调用）；能做的是把已有的**第五层证据**（用户声明窗口 + 本地账本）接到用户实际管 Key 的地方，并给已取证的套餐档位做预设。

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| 能显示百炼 Coding Plan 的 5 小时窗用量吗？ | **能**，但上限要用户声明（官方按请求次数计量，无 API 可查）。 |
| 能显示 OpenCode Go 套餐余量吗？ | **不能**。Zen 侧 15 个候选端点全 404；Go 是聚合条目，无任何可查数字。 |
| 今天零开发能做到什么？ | Providers 页 → 该条目「账号管理」→ 编辑账号 → 填声明额度。链路已存在且闸门真的执行。 |
| 那还要做什么？ | 把入口搬到用户管 Key 的地方（聚合详情），并给出套餐档位预设，免去逐个手填三个窗口。 |
| 绝不能破的？ | 钱不折 token；`undocumented` 不参与预判；查不到不等于 0；声明额度是上限不是换算率。 |

---

## 1. 现状：五层额度证据（2026-11-20 核对）

| 层 | 落点 | 口径 | 对聚合条目生效 |
|---|---|---|---|
| ① 官方静态帽 | `src/shared/aggregateQuota.ts`（builder 生成） | rpm/rpd/tpm/tpd/monthlyTokens | 是 |
| ② 本地账本 | `src/main/proxy/quota/ledger.ts:293` `record()` | 自数 requests/tokens，按 `(provider, account, model)` | 是 |
| ③ 在线余额 | `src/main/providers/aggregate/manager.ts:904` `queryCredits()` | 打 `quotaProbe`，单位 USD/CNY | 是（仅一家有声明） |
| ④ 上游亲口拒 | `shared/aggregateQuotaExhaustion.ts` + `aggregate/manager.ts:600` | 429/欠费措辞的现场记录 | 是 |
| ⑤ 用户声明 | `src/shared/declaredQuota.ts:26` | 5 小时/日/周/月 × token/请求 | 是（**跟账号走，不限 provider 类型**） |

第五层的关键事实：

- 闸门真的执行，不只是展示：`src/main/proxy/quota/gate.ts:225` 的 `declaredBlock` 是**任何** provider 类型的兜底（该文件 `:184-186` 的注释明写「用户声明是第五层，跟着账号走，任何类型都适用」）。
- 账本窗口可算：`ledger.ts:366` `declaredWindow()` —— `fiveHour`/`day` 扫分钟桶（分钟桶保留 24h+5min，够 5 小时），`week`/`month` 扫日桶/月桶（日桶留 40 天、月桶留当月+上月）。
- 路由页已展示：`gate.ts:368` `quotaSummaryOf()` → `autoRouter.ts:2486` → `Routes.tsx:812` 每模型显示「哪个窗口、还剩多少、什么时候复位、数哪来的」。

---

## 2. 为什么这两家拿不到在线用量（证据）

### 2.1 OpenCode —— 两条线都以「没有公开接口」收场

- 账号渠道 `opencode`（Zen）：`vendor/channel-pack/src/channel-pack-rpc.ts:3753-3767` 逐字记录实测结论 —— `balance` / `credits` / `usage` / `billing` / `quota` / `limits` / `subscription` / `workspace` 等 **15 个候选路径全部 404**（返回官网 HTML 而非 API JSON）。当前渠道页那个数是「当前可用通道数」，从本地 `modelRateLimits` 推的（`:3775-3813`），**零网络请求**、也不叫余额。
- 聚合条目 `opencode_go`（$5/月）：`src/shared/aggregateQuota.ts:389` 记 `undocumented`；`registry.ts:1233` 的条目没有任何 `quotaProbe`。

### 2.2 百炼 —— 三条计费通路都没有用量 API

| 条目 | 计量口径 | 可登记进 quota 吗 |
|---|---|---|
| `bailian`（按量） | 控制台按账号/档位展示 | 否，文档页无逐模型数字 |
| `bailian_coding_plan` | **请求次数**：Pro 5 小时 6000 / 周 45000 / 月 90000 | 否，五个字段只有 token 与 rpm/rpd 口径 |
| `bailian_token_plan` | Credits 抵扣 | 否，不折算 |

出处：`src/shared/aggregateQuota.ts:96`、`docs/data/free-quota-research/g12-cn-plans-2026-11-12.json:16,39`。

### 2.3 唯一的在线余额端点

全仓 `quotaProbe` 声明**只有一处**：`registry.ts:2790`（OpenRouter `/key`，USD）。SiliconFlow 的 `/user/info` 已于 2026-08-14 被官方下线（HTTP 410），声明已撤（`:1699` 注释、`quotaProbe.ts:132-135`）。解析层 `quotaProbe.ts` 目前只有 `openrouter-key` 与 `readSiliconFlowUserInfo` 两个 reader。

---

## 3. 今天零开发就能用（必须先说清）

聚合 Key 就是普通的 `Account` 记录（`aggregate/manager.ts:663` 走 `AccountManager.create`），而声明额度编辑器挂在账号弹窗上（`AddAccountDialog.tsx:255` → `:345` 的 `DeclaredQuotaEditor`），写入口是 `accounts.add` / `accounts.update`（主进程 `store/accounts.ts:110` 归一、`store/store.ts:1480-1490` 按「留空=不修改」合并凭据）。

而 `Providers.tsx:174` 的 `filteredProviders` **不排除** `type === 'aggregate'`，`ProviderCard.tsx:159,227` 对聚合记录同样渲染「账号管理」。因此：

1. 供应商页 → 找到百炼 Coding Plan → 账号管理 → 编辑那条 Key；
2. 填「每 5 小时 / 请求数 / 6000」与「每周 / 请求数 / 45000」；
3. 路由页立刻显示该模型的 5 小时窗与周窗余量，闸门也立刻按它挡发车。

> ⚠️ 修正前一轮的判断：我曾说「聚合条目的 Key 没有声明额度编辑器」。准确说法是**聚合详情页的 KeysCard 没有**，但 Providers 页的账号管理有。两页管的是同一批 Account 记录。

**这条通路有三个已知粗糙面**（本 PLAN 要收的正是它们）：

- **入口错位**：用户在聚合详情页管 Key（`AggregateDetail.tsx:676` `KeysCard`），那里既没有声明额度、也没有已用量；要去另一个页面才能填。
- **看不到回显**：`AggregateKeyInfo`（`src/shared/aggregate.ts:207`）没有 `declaredQuota` 字段，`listKeys()`（`manager.ts:1111`）也不带，所以聚合详情即使想显示也拿不到。
- **逐个手填**：三个窗口要填三次，且数字在文档里，容易填错档位。

---

## 4. 阶段

### 阶段 A：把第五层接到聚合详情（核心）

目标：在 `KeysCard` 每个 Key 行就地显示「已声明窗口 + 已用/上限 + 复位时刻」，并就地编辑。

落点：

1. `src/shared/aggregate.ts:207` `AggregateKeyInfo` 增 `declaredQuota?: DeclaredQuotaLimit[]`（引用 shared 类型，不改语义）。
2. `src/main/providers/aggregate/manager.ts:1111` `listKeys()` 透出 `account.declaredQuota`（已经过主进程归一，无需二次处理）。
3. `src/renderer/src/components/aggregate/AggregateDetail.tsx:676` `KeysCard`：每行挂 `<DeclaredQuotaRows>`（复用只读行，与账号列表同源），并加一个铅笔按钮打开声明额度编辑器。
4. 编辑器复用：把 `AddAccountDialog.tsx:345` 的 `DeclaredQuotaEditor` 提到 `components/providers/DeclaredQuotaEditor.tsx` 并导出（纯搬迁，不改逻辑），两处共用 —— 避免出现第二份窗口/单位白名单。
5. 写回：新增 IPC `aggregate:setKeyQuota`（`main/ipc/channels.ts` + `handlers.ts` + `shared/api.ts` + `preload` 具名登记），实现落到 `aggregateProviderManager.setKeyQuota(accountId, declaredQuota)`，内部只调 `AccountManager.update`（不新增凭据路径），成功后返回 `detail()`。

不做：不在聚合详情展示「聚合级汇总的声明额度」—— 声明是账号级上限，折叠成一个条目级数字会让「一把打满一把空着」变成一个假平均（与 `summarizeQuotaRows` 已有的分组纪律一致）。

### 阶段 B：用户自定义模板库（不硬编码任何套餐数字）

> 拍板（2026-11-20）：**不把套餐数字写进代码**。套餐档位随订阅变化、各家口径不同，硬编码等于把「某一刻的官方页」固化成产品的权威值。改为：**模板由用户自己建、自己改、自己命名**，代码只提供存储与填入。

- 类型：`src/shared/declaredQuota.ts` 增 `DeclaredQuotaTemplate = { id, name, limits: DeclaredQuotaLimit[] }`，配 `normalizeDeclaredQuotaTemplates()`（逐条过 `normalizeDeclaredQuota`、按 name 去重、条数上限、空 limits 丢弃）。
- 存储：`AppConfig.declaredQuotaTemplates?: DeclaredQuotaTemplate[]`（`shared/types.ts` 与 `main/store/types.ts` 两处声明点同加，`DEFAULT_CONFIG` 预置 `[]`，`normalizeConfig` 调归一）。随 `data.json` 加密备份一起走，零额外迁移。
- UI：`DeclaredQuotaEditor` 顶部一行「模板」：
  - 下拉选中即把该模板的 limits 填入当前表单（可继续改，改的是这份 key 的声明，不动模板）；
  - 「存为当前为模板」：以当前表单的 limits 建一条，名字由用户输入（取账号名或档位名，如「百炼 Coding Pro」）；
  - 「删除模板」：删的是模板，不碰已落盘的账号声明。
- 与既有 `docs/data/free-quota-research/*.json` 的关系：那些回执仍然是**取证证据**，但不再被读成产品常量；用户想照抄就去文档抄一次，抄进自己的模板库。这样平台侧数字改了口径，产品不需要跟着发版。

### 阶段 B′（随 B 一起做）：套餐档位的一键模板来自用户，不来自代码

预设**不预置任何条目**。首次使用时模板库为空、只显示「新建模板」；用户建过一次之后跨账号复用。理由同上：代码里出现 `6000/45000/90000` 就是把第三方文档的某一版变成产品承诺，而这份数字既可能改口径、也可能只对某个档位成立。

### 阶段 C：时区偏差的交代（小改，但要显式）

账本桶键用 UTC（`ledger.ts:62-72` 的 `toISOString`），声明额度的周/月边界也用 UTC（`declaredQuota.ts:116-133`）；而百炼官方是**周一 00:00（UTC+08:00）**、月按订阅日，腾讯/讯飞同族。

后果：`week` 窗最多多算 8 小时前的量，`month` 窗起点可能不是订阅日。**不改变「是否打满」的方向性**（只会更保守），但复位时刻会偏。

处置（已拍板 C1）：在 `DeclaredQuotaRows` 与路由页的复位文案上，对周/月加一句「按 UTC 自然边界」的口径说明；不引入时区字段、不改账本。理由：加时区字段要动 `DeclaredQuotaLimit` 形状、备份兼容、以及 5 小时滚动窗不受影响，成本远大于 8 小时的复位偏差。

### 不做（明确边界）

- **不打上游查套餐余量**：OpenCode Zen 无端点；百炼等 Coding Plan 条款逐字禁止 API 调用（`src/shared/aggregateTerms.ts:53-67`），把套餐 Key 用于代理本身已在灰区，再加一轮探活会放大暴露面。
- **不折算 Credits**：Token Plan / 积分制一律只显示 `officialNote` 原文。
- **不启用 `cline.quota`**：它是现成的真·订阅窗口读数（`vendor/channel-pack/src/cline-quota.ts:58`，`five_hour` / `weekly` / `monthly` + `percentUsed` + `resetsAt`），但装配层硬编码只给 Cline（`channel-pack-rpc.ts:1503`），且 ModelPort 控制台零消费 —— 它只服务 DSH 宿主徽标。要给 Cline 用是另一件事，不在本 PLAN。

---

## 5. 验收

1. `npm run gate` 四项全绿（经 SSH）。
2. 新增测试：
   - `tests/renderer/aggregate-key-quota-surface.test.mjs`：`KeysCard` 真的挂了 `<DeclaredQuotaRows>`、铅笔入口调的是 `aggregate.setKeyQuota`；两份 locale 都有用到的键。
   - `tests/shared/declared-quota-templates.test.ts`：模板归一（按 name 去重、与 `DECLARED_QUOTA_MAX_WINDOWS` 同源的上限、空 limits 丢弃）；**并断言源码里没有任何套餐数字常量**（负样本自证：`shared/` 与 `src/main/` 下除注释外不出现 `6000` / `45000` / `90000` 这类档位数字作为 `DeclaredQuotaTemplate` 初值）。
   - `tests/aggregate/set-key-quota.test.ts`：`setKeyQuota` 只经 `AccountManager.update`；空数组落成 `undefined`（不落空键）；非聚合账号被拒。
3. 手工验收：给百炼 Coding Plan 的一条 Key 新建模板「百炼 Pro」（6000/45000/90000）→ 该模板出现在下拉里 → 另一条 Key 选这个模板即填入 → 聚合详情就地显示「5 小时 0/6000」等三行 → 发几条请求后数字增长 → 路由页该模型出现同一行读数，且周/月行带「按 UTC 自然边界」的口径说明。
4. 回归：无声明、无模板时行为完全不变（不渲染、不挡、不写键）；模板库为空时编辑器只显示「新建模板」。

---

## 6. 已拍板（2026-11-20）

| # | 项 | 裁定 |
|---|---|---|
| 1 | 预设数字怎么存 | **不硬编码**：官方数字随套餐变化，必须给 UI 留设定空间 ⇒ 做成**用户自定义模板库**（`AppConfig.declaredQuotaTemplates`），代码零权威数字 |
| 2 | 周/月窗 UTC 偏差 | **C1：标注口径，不加时区字段** |
| 3 | 阶段顺序 | **一次做完**：A → B → C 同批落地 |

---

## 7. 关联

- 设计依据：`docs/AGENTS-full.md` §Architecture A、§The Fifth Quota Layer
- 取证回执：`docs/data/free-quota-research/g12-cn-plans-2026-11-12.json`、`g2.json`
- 既有相关计划：`docs/plan/PLAN-aggregate-cn-plans-and-quota-marking.md`（订阅端点登记与配额标识，本文是它的用量侧续篇）
