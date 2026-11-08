# WorkBuddy（国内版）成长任务领取积分

> 成文版本：v1.7.10 ｜ 最后核对：2026-11-08 ｜ 状态：**阶段 A（只读取证）已完成，见 §4；实现范围按 2026-11-08 用户裁定收窄为「只做手动领取」⇒ 阶段 E 暂缓**

需求：在账号渠道 WorkBuddy（国内版，`buddy`）增加「完成任务领取积分」。现状只有每日签到
（`daily-checkin`），成长中心（`www.workbuddy.cn/profile/growth-center`）的任务型积分完全没有接。

---

## 1. 取证结论（本轮实测，非推断）

取证路径：本机安装的官方桌面端 → 官方用户中心网页自身的 JS bundle。

1. **桌面端不实现成长中心**。`C:\Users\polit\AppData\Local\Programs\WorkBuddy\resources\app.asar`
   （5.9.3）里 `growth-center` 只出现在三处，全部是 `window.open("/profile/growth-center?fromSource=…")`
   形式的跳转；该 bundle 内 `/v2/billing/meter/*` 只有三条：`get-enterprise-user-usage`、
   `daily-checkin`、`checkin-activity-status`。**所以任务接口不可能从桌面端 bundle 抄到。**
2. **真实契约来自网页 chunk**。`https://www.workbuddy.cn/profile/growth-center` 同源加载
   `assets.workbuddy.cn/web/usercenter/<commit-hash>/assets/`，任务逻辑在
   `growthSpace-CbMAHegV.js`，路由是懒加载的 `GrowthCenterPage` / `GrowthCenterTasksPage`
   （`AllTasksPage-CSGhrVsO.js`）/ `GrowthCenterRewardsPage`。
3. **端点与方法（逐字取自 bundle 源码）**：

   ```js
   GET  /v2/activity/growth/subscribe-task/status      // 刷新订阅类任务状态
   GET  /v2/activity/growth/tasks                     // 任务清单（先跑上面那条再取清单）
   POST /activity/growth/tasks/accept   body { task_codes: [...] }   // 接单
   POST /activity/growth/tasks/${code}/claim                          // 领取积分 ← 本需求
   GET  /v2/activity/growth/profile                   // 含 streak / redemption_status
   ```

   同族还有 `energy`、`badges`、`heatmap`、`streak`、`lottery/*`、`redeem`、`buddy/travel/*`，
   本需求只用上面四条。
4. **请求头与鉴权**（`config-BPHleWcY.js` 的 axios 实例）：无 `baseURL` ⇒ **同源
   `www.workbuddy.cn`**；`withCredentials: true`（浏览器走 cookie）；每条请求带
   `X-Client-Platform`（`web` / `workbuddy` / `miniprogram`）；URL 含 `/activity/growth` 时带
   `Accept-Language`（默认 `zh-CN`）；在嵌入式形态下带 `Authorization: Bearer <token>`，
   token 取自 `sessionStorage["growth-center-token"]`；401 时先续期再重放一次。
5. **任务状态机**（bundle 里的枚举，逐字）：
   `not_accepted → accepted → in_progress → completed → claimed`。
   任务项字段：`taskCode`、`title`、`desc`、`progress`、`total`、`acceptStatus`、`isLocked`、
   `unlockAt`、`rewardBuddy`。按钮 `dt-eid="growth_task_action"`，`kind` 为 `claim` 时才走领取。

### 1.1 与 Loomy 先例的关键差异（决定实现形态）

`vendor/channel-pack/src/loomy-onboarding.ts:4-9` 的前提是「**服务端不校验前置行为**，完成条件全在
客户端本地判定」，所以那里可以做成**纯 API 直领、一个 token 都不花**。

WorkBuddy 成长中心**不是**这个形态：服务端下发 `progress`/`total` 与五态 `acceptStatus`，
`claim` 只在 `completed` 时可点。⇒ **本功能只能领「已完成未领取」的任务，不能把未完成的任务变成积分**。
这既限制了收益（自动模式领不到没做过的任务），也意味着不存在「伪造完成」的实现路径。

### 1.2 风险证据（必须先讲清，再谈自动模式）

渠道包上游 `Ebony-Vinyl/dsh-our-free-model`（MIT）已把 buddy 渠道**整体下架**，理由写在
`docs/verification/2026-10-25-excluded-workbuddy.md`（v2.6.0～v2.8.3 与 main 均已无 `buddy-*.ts`）：

> WorkBuddy's China build … and its international build … are not offered. The community plugin that
> serves them signs requests as WorkBuddy's own desktop client, which carries a risk this product does
> not want to put in front of users.

ModelPort 仍提供该渠道（`catalogue.ts:109-115`），这是既有产品决定，不在本 PLAN 重开。但**成长任务
是本仓库对该账号新增的一类认证写请求**，且本仓库已因此把每日自动签到改成默认关
（`vendor/channel-pack/src/auto-checkin.ts:12-17`，2026-11-05 裁定）。故本 PLAN 的自动模式
按同一口径设计：**默认关、只领不接单、不新增无人值守的 accept 流量**。

---

## 2. 待裁定项（请按编号点，点完即整批授权）

| # | 事项 | 推荐 | 依据 / 代价 / 被推翻改哪格 |
|---|---|---|---|
| Q1 | 是否授权阶段 A 的一次**带凭据只读**请求（`GET /v2/activity/growth/tasks`，1 次/账号） | **授权** | 阶段 B 的响应解析与「每任务分值」字段名只能从真实响应确定；不授权则阶段 B 只能按 bundle 变量名猜，解析错就是静默 0 分。代价：每个启用账号一次认证 GET。 |
| Q2 | 基址：`www.workbuddy.cn` 与产品配置里的 `CODEBUDDY.endpoint = copilot.tencent.com`（`product.ts:290`）不同，怎么落 | **已裁定：不加字段，直接用 `product.endpoint`** | 阶段 A 实测三个 host 返回**字节完全相同**的载荷（§4），新字段没有可观测收益，只多一处漂移点。代价：若日后上游只在 `workbuddy.cn` 服务该路径，需回来加字段——届时 §5 那句要重写。 |
| Q3 | 能力字段命名与落点 | **`growthTasks: boolean` 必填**，加在 `ChannelDefinition` + `ChannelView`（`src/shared/channels.ts:49`、`:117` 同侧） | 完全照 `dailyCheckin` 的既有先例：必填而非可选，否则新渠道可以不表态、界面照常渲染一个必然失败的按钮（该字段自己就是为用户报障 2026-11-02 opencode 立的规矩）。只有 `buddy` 为 `true`。 |
| Q4 | RPC 复用还是新建 | **复用 `onboarding.status` / `onboarding.claim`**，把 provider 白名单（`channel-pack-rpc.ts:2167`、`:2273`）扩到 buddy，响应体**追加可选 `items[]`** | 这对端点已经存在且语义正是「一次性任务领取」（`types.ts:683-725`），另起 `growth.*` 就是第二份同类通路，正是 AGENTS.md「不要为绕过开关另造通道」要避免的。loomy/raccoon 不产出 `items` ⇒ 行为逐字不变。 |
| Q5 | 自动模式做到哪一步 | **本轮不做（用户 2026-11-08 裁定「目前只做手动领取积分」）**；以下为恢复自动模式时的既定口径：只自动 `claim` 已 `completed` 的任务，不自动 `accept` | `accept` 是把账号状态从 `not_accepted` 改成 `in_progress`，无人值守下等于批量制造假进度且没有任何收益；`claim` 是领回服务端已认可的结果（§4 实测 `accept_status` 由服务端下发）。判据与 `isAutoCheckinExcluded`（`auto-checkin.ts:434-436`）同档：代价发生在调用期间，必须事前决定。 |
| Q6 | 自动模式的开关粒度 | **本轮不做**；恢复时按独立开关（新 `usage.autoGrowth`，默认关），不并入现有自动签到开关 | 现有开关的文案与记账语义都是「每日签到」；并进去会让用户以为打开的是同一件事，且成长任务的请求代价（写操作）与签到不同级。代价：多一个开关与一行界面文字。 |
| Q7 | 界面呈现 | **渠道卡内展开区**：按账号列 `title / progress/total / acceptStatus / 可领分值`，按钮「领取已完成任务」，结果行走单位感知文案 | 「结构上拿不到」可以，伪装成正常结果不行：未完成的任务必须显式标 `进行中/未接单`，否则用户会以为按钮点了没效果。 |

> 若 Q1 不授权：阶段 B 只能实现到「解析器按 bundle 变量名推断 + 单测夹具」，**不得**在门里
> 声称已接通，界面也不开按钮（宁可显示「未启用」）。

---

## 3. 阶段划分

### 阶段 A — 契约确认（需 Q1）
1. 对 `buddy` 的每个启用账号各发一次 `GET /v2/activity/growth/tasks`（`Authorization: Bearer`
   + `X-Client-Platform: web` + `Accept-Language: zh-CN`），host 分别试 `www.workbuddy.cn` 与
   `copilot.tencent.com` ⇒ 回答 Q2。
2. 落一份**脱敏**响应样本到 `docs/data/`（按仓库惯例，判据/字段来源要可复查），并确认
   分值字段（`credit`/`points`/`reward`）与 `unit`。
3. 只读，不发 `accept`、不发 `claim`。

**产出**：Q2 的实测结论 + 字段表，写回本文件 §4。

### 阶段 B — 渠道包实现
- 新建 `vendor/channel-pack/src/buddy-growth.ts`：`fetchGrowthTasks` / `claimGrowthTask`
  （串行、已完成跳过不发请求、失败不抛错而是 `ClaimOutcome` 同款分类，照 `loomy-onboarding.ts` 形状）。
  凭据过期走 `buddy-credits.ts:379-386` 的 `describeNonJsonResponse`（腾讯网关返回 HTML 错误页，
  用 `response.json()` 会得到无意义的 `Unexpected token '<'`）。
- `channel-pack-rpc.ts`：`onboarding.status` / `onboarding.claim` 各加 `CODEBUDDY.id` 分支，
  逐账号串行、单账号失败不中断整批（与 `collectClaimResults` 同一口径）。
- `types.ts`：`RpcOnboardingStatusResponse` / `RpcOnboardingClaimResponse` 追加可选 `items[]`。

### 阶段 C — ModelPort 接线
`src/shared/channels.ts`（`growthTasks`，两处必填）→ `accountChannels/catalogue.ts`（仅 `buddy`
为 `true`，其余 12 条逐个显式写 `false`）→ `accountChannels/manager.ts`（`growthStatus` /
`growthClaim`，走 `bridge.rpc('onboarding.…')`，与 `manager.ts:596` 同款信封处理）→ `ipc/channels.ts`
+ `ipc/handlers.ts` → `preload` → `src/shared/api.ts` / `api/headless.ts`（远程页与桌面同口径，
否则远程宿主拿不到——这是本仓库反复踩过的宿主差异）。

### 阶段 D — 界面
`src/renderer/src/pages/Channels.tsx`：展开区任务表 + 领取按钮 + `actionRequired` 单独成句；
两份 locale（`en-US.json` / `zh-CN.json`）；积分文案复用 `formatClaimGains`，不自拼。

### 阶段 E — 自动模式（Q5/Q6）
`auto-checkin.ts` 旁新增成长任务一档：独立文档字段 + 逐渠道记账（`providerDates` 同口径）、
默认关、`decidedBy: 'user'` 迁移判据照抄，跨 UTC+8 日界重新跑；界面加一行常驻状态文字。

### 阶段 F — 测试与门
- `tests/channels/`：`buddy-growth` 解析器（夹具按真实 serde 形状）、`onboarding.*` 白名单、
  能力表齐备性（按 `channel-claim-action.test.mjs` 的源码断言先例，断「两处必填声明」）。
- `tests/renderer/`：`growthTasks` 从目录到 `ChannelView` 的一行不许漏。
- 全部门禁只在收尾跑一次 `npm run gate`，且按项目记忆在**本地盘镜像**跑（UNC 共享盘上
  `.exe`/`.node` 会被拒），不在中途逐次全量。

---

## 4. 实测记录（阶段 A，2026-11-08 22:3x，WSL 网关 `/root/.modelport` 池内 `buddy` 账号 #1）

取证姿势：脚本落 `C:\Users\polit\AppData\Local\Temp\`，在 WSL 内**自己读凭据文件**，
只对外打印状态码与脱敏结构（`token|cookie|user_id|nick|email|phone` 一律换成长度）。
本轮共 3 笔请求，全部 `GET /v2/activity/growth/tasks`，1 个账号 × 3 个 host。

| 项 | 结论 | 取证时间 |
|---|---|---|
| 生效 host | **三个 host 同载荷**：`www.workbuddy.cn`、`www.codebuddy.cn`、`copilot.tencent.com` 各返回 HTTP 200、`code:0`、**字节数完全相同（12213）**。⇒ **沿用 `CODEBUDDY.endpoint`，不新增 `userCenterEndpoint`**（Q2 按此收口，§5 的备选作废） | 2026-11-08 |
| Bearer 是否被接受 | **是，且不需要 cookie、不需要 `X-Domain`/`X-Product`/`X-Product-Code`**。只带 `Authorization: Bearer <access_token>` + `X-Client-Platform: web` + `Accept-Language: zh-CN` 即 200。凭据是 Keycloak RS255 JWT（`iss=https://www.codebuddy.cn/auth/realms/copilot`，`allowed-origins:["*"]`、`aud:account`）⇒ 跨 host 可用是设计使然，不是巧合 | 2026-11-08 |
| 分值字段名与单位 | **两个独立量纲**：`reward_credit`（积分，样本恒 100）与 `reward_energy`（能量，样本恒 5），另有 `reward_buddy`（布尔，限定款盲盒）。⇒ **展示不得相加成一个数**，接 `credits.ts` 的单位分域先例（`normalizeCreditUnit` 只分 token/credit，能量是**第三个域**，必须新立一档而不是塞进 credit） | 2026-11-08 |
| `completed` 判定是否服务端可信 | **可信**。响应是 `data.tasks[]`，每项带 `accept_status`（实测出现 `claimed` / `completed` / `not_accepted`）与 `progress:{current,target}`；`not_accepted` 项的 `progress` 是 **null**。所以「能不能领」由服务端说了算，客户端不做本地判定 | 2026-11-08 |

任务项实测字段（全量，非挑选）：`task_code`、`title`、`description`、`task_desc`、`task_type`
（样本 `single`）、`jump_url`（`workbuddy://playbook` 这类自定义 scheme）、`valid_start`、`valid_end`
（样本均 null）、`reward_credit`、`reward_energy`、`reward_buddy`、`template_id_fixed`、`badge_name`、
`accept_status`、`progress`、`is_pinned`、`is_new`、`icon_url`、`tag`、`locked`、`has_reward`、
`claimed_button_text`、`claimed_button_style`、`reward_popup_button_text`。
样本账号共 **18 条任务**。

**信封与签到同构**：`{code, msg, data, requestId}`，`code:0` 为成功 —— 判定继续以响应体 `code`
为准、不能只看 HTTP 状态（`buddy-credits.ts:19-20` 已记过这条）。`requestId` 可落进请求日志取证。

### 4.1 仍未取证的一项（需要写授权）

**`claim` 的响应体形状与幂等码**。bundle 只给出 `POST /activity/growth/tasks/${code}/claim`
的调用形态，没给出成功响应里字段叫什么、也没给出「已领过」返回哪个 `code`。
`buddy-credits.ts` 的 `10001` 是**签到端点**实测出来的，**不能拿来当成长任务的幂等码用**。

⇒ 阶段 B 的实现按这个边界写：**把「拿不准的返回」如实归到 `failed` 并带上原始 `code`/`msg`**，
不猜成 `claimed`、不猜成 `already-claimed`。等你授权发一次真实 claim（或等界面第一次点出读数），
把真实码表回填这里，再把分类收窄。这是 §1.1 那条「宁可显示未领到，也不伪装成正常结果」的延续。

## 5. 退役面（本功能落地后不该留下的东西）

无新增重复通路。若 Q2 最终判定 `copilot.tencent.com` 也服务该路径，则 `userCenterEndpoint`
字段不引入，改在 `buddy-growth.ts` 直接用 `product.endpoint` —— 届时本文件 §3 阶段 B 的那句
要一并改掉，不留第二份说明。（阶段 A 已判定三 host 同载荷，该字段**未引入**，此句作废。）

---

## 6. 实现记录（2026-11-08，只做手动领取）

| 层 | 落点 |
|---|---|
| 渠道包客户端 | `vendor/channel-pack/src/buddy-growth.ts`（新增）：`fetchGrowthTasks` / `claimGrowthTask` / `claimAllGrowthTasks` / `growthTaskItem` / `sumGrowthRewards` / `formatGrowthGains` |
| 渠道包 RPC | `vendor/channel-pack/src/channel-pack-rpc.ts`：新增 provider 级 `case 'onboarding.claimAll'` + 模块级 `collectGrowthClaims`；`onboarding.status` 白名单补 `CODEBUDDY.id` 并产出 `items` / `totals` |
| 类型 | `vendor/channel-pack/src/types.ts`：`RpcOnboardingTaskItem` / `RpcOnboardingRewardTotals` / `RpcOnboardingClaimAll{Request,Response}`；状态与领取响应各加**可选** `items` / `totals` / `gained` / `failed` |
| 能力位 | `src/shared/channels.ts`：`growthTasks: boolean` 必填（`ChannelDefinition` + `ChannelView` 两条）；`accountChannels/catalogue.ts` 13 家逐个表态，只有 `buddy` 为 `true`；`manager.ts` 的 `growthTasks: channel.growthTasks` |
| 界面 | `src/renderer/src/pages/Channels.tsx`：`claimTasks()` + `channel.growthTasks` 条件渲染的第二个按钮；两份 locale 各 13 个键（含 `listSeparator`，分隔符不硬编码中文逗号） |
| 门 | `tests/channels/buddy-growth.test.ts`（10 例）、`tests/channels/catalogue.test.ts` 新增 growthTasks↔claimAll 对齐、`tests/renderer/channel-claim-action.test.mjs` 新增 4 例同构静态门 |
| 文档 | `docs/AGENTS-full.md`（RPC 方法清单 + 两能力独立与两量纲）、`docs/features/providers-accounts.md`（不变量一条） |

### 6.1 两处 PLAN 原话被现网推翻（按口径写清，不留过时描述）

1. **阶段 C 原写「新增 IPC 通道 + preload」**——不存在也不需要。宿主早就有一条通用透传
   （`manager.ts::rpc()` 直接转 `bridge.rpc(method, payload)`，`IpcChannels.CHANNELS_RPC` 不判方法名），
   界面 `channels.rpc('onboarding.claimAll', …)` 就到位。加新通道等于给同一件事开第二个入口。
2. **阶段 B 原本打算把 buddy 也加进 `onboarding.claim`（单号）**——已撤。卡片要的是「点一次把
   整池领一遍」，单号与整池两份领取实现是漂移的起点；`onboarding.claim` 保持 loomy/raccoon 两家，
   buddy 只走 `onboarding.claimAll`。

### 6.2 一条与本次改动无关、但影响「绿」的含义的发现

`npm run gate` 的两个 tsc 程序**都不覆盖 `vendor/channel-pack`**：pack 源码是
`worker.ts` 经虚模块 `virtual:channel-pack` 由构建期插件注入的，TS 看不到实现。
实测读数：`tsc -p tsconfig.node.json --listFiles` 共 630 个文件，`buddy-growth` / `channel-pack-rpc`
命中 **0**。⇒ 渠道包侧「tsc 0 error」是**空洞的绿**，它的真门只有两条：
`scripts/build-channel-pack.mjs`（esbuild 打包，能抓语法与解析错）+ 直接 import 源码的测试。
本次两条都跑了（bundle 里 `activity/growth` 与 `onboarding.claimAll` 均在）。
