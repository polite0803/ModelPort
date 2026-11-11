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

## 7. 发布后复核：客户端身份（UA）与风控（2026-11-08，用户点出问题）

**问题**：「领取任务积分常规是有客户端信息的，UA 和风控处理了没有？」
**答案：没有处理到位。** 根因不是猜测，是两条读数：

1. 把 `fetchGrowthTasks` 打到本地回环服务器，实际出站头是 **`user-agent: node`** ——
   我没设 UA，而 Node 的 fetch 在调用方不设时就是发这一行。
2. 取证那三次 200 用的是**另一个脚本**，它显式设了 Chrome UA。⇒ **我验证过的请求
   和我发布的请求不是同一条。** 这条属于本仓库反复记过的「取数姿势造假绿」：
   门禁 2000/2000 全绿也照不出来，因为单测用的是自己写的 stub fetcher。

**现网实测（1 账号 × 5 组头，只读 `GET /v2/activity/growth/tasks`）**：

| 组合 | 结果 |
|---|---|
| `web` + 不发 UA（= `node`，即 1.7.11 发布时的形态） | HTTP 200 `code:0` 18 项 |
| `web` + 官方 CLI UA | HTTP 200 `code:0` 18 项 |
| `workbuddy` + 官方 CLI UA ← **修复后采用的形态** | HTTP 200 `code:0` 18 项 |
| `workbuddy` + 浏览器 UA | HTTP 200 `code:0` 18 项 |
| 上一行 + `Origin` + `Referer` | HTTP 200 `code:0` 18 项 |

**判据（要说清边界，不能写成「绕过风控」）**：该读端点当前**不按这些头设门槛**，
所以修复的理由不是「不改就失败」，而是**归因一致性与异常度**：仓里每一条 buddy 出站请求
都设 `product.userAgent`（`buddy-credits.ts:290`、`buddy-oauth.ts` 五处、`buddy-adapter.ts:1842`），
「腾讯后台『使用端』列按出站 UA 归因」是渠道族的既有不变量；同一账号上**唯独领积分这一条
是 `node`**，恰好是最容易被判成异常客户端的形状。

**修复**：`growthHeaders(credential, product)` 显式发 `User-Agent: product.userAgent`，
`X-Client-Platform` 从 `web` 改为 **`workbuddy`**（官方 bundle 里该头由
`sessionStorage['growth-center-platform']` 决定：桌面内嵌 `workbuddy` / 纯浏览器 `web` /
小程序 `miniprogram`；ModelPort 的凭据来自桌面那条授权链，故取内嵌形态）。
**不加** `Origin`/`Referer`：实测不需要，且 `product.endpoint` 与页面 origin 不同源，
硬造一个 referer 反而多一处不一致。

**修复后的出站读数（同一台回环服务器复测）**：GET 与 POST 都是
`user-agent: "WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/5.9.3"`、`x-client-platform: "workbuddy"`。
且这一组正是上表里在现网实测过的第 3 行 ⇒ **验证过的与发出去的是同一条**。

**仍未取证的一项**：`X-Device-Token`（图灵盾）。`buddy-credits.ts:15` 记的是**签到**端点
实测不需要；成长端点上面五组也都不带它且读得到，但**领取（POST）从没发过**，
所以「claim 需要不需要设备令牌」目前没有读数，只有「不需要 ≠ 已验证」这一句实话。
一旦真实点一次领到/失败，把结论回填这里。

**取证与验证脚本**（只读、凭据不出机器，落 `%TEMP%`）：`growth_probe.py`（host 归属）、
`growth_hdr_matrix.py`（上表五组头）、`growth_claim_probe.py`（**未执行**，等写授权）。

**补一条形状差异（同一档「未取证」）**：官方前端调 claim 是
`t.post(\`/activity/growth/tasks/${e}/claim\`)` —— **只给 URL，不带 body**（axios 传
`undefined` 即空体），而本实现发的是 `Content-Type: application/json` + `{}`
（沿用签到端点那条已实测可用的写法：`buddy-credits.ts` 的 `postJson` 发 `'{}'` 且
`daily-checkin` 实测 `code:0`）。两者对多数 JSON 端点等价，但**这不是实测结论**；
真实点一次若拿到非 0 且文案指向参数，先按「空 body」重试一次再动别的。

## 8. 领取路径的真实读数（2026-11-08 23:5x，用户在 WSL 网关 + 本地 1.7.11 壳上点了一次）

用户点击「领取任务积分」后的界面结果：**「领到 1 项（+100积分，+5能量），9 项此前已领，26 项还没做完」**。
⇒ §4.1 与 §7 里那三项「未取证」现在有答案了：

| 未取证项 | 结论 |
|---|---|
| claim 的响应形状 | **成功即 `code:0`**；本实现的分值取「清单声明值」（`reward_credit`/`reward_energy`）而不是读响应体 —— 界面显示的 `+100积分 +5能量` 与清单一致，**这条设计选择被真实读数验证为正确**（若当时去猜响应体字段名，就是 0）。 |
| claim 要不要 `X-Device-Token`（图灵盾） | **不要**。这次领取在**不带**设备令牌的情况下成功（头：Bearer + `X-Client-Platform: workbuddy` + `User-Agent: WorkBuddy/…CLI/…` + `Accept-Language`）。与签到端点 `buddy-credits.ts:15` 的结论同形。 |
| 请求体 `{}` vs 官方前端的不带 body | **`{}` 被接受**（领取成功）。§7 那条「先按空体重试」的预案不需要启用。 |
| 幂等码 | 仍然**没有读数**，而且大概率永远拿不到：本实现对 `claimed` 项**跳过不发请求**，所以重复点击是 0 次 POST。这条保持「非 0 一律失败带原文」即可，不必再猜码表。 |

**部署侧读数**（换包后）：`modelport.service` active + enabled；运行中的 bundle 头是
`X-Client-Platform: "workbuddy"`；`/health` 明文 8080 与 HTTPS 8443 均 200；
管理 RPC `channels:list` 返回 13 条渠道，`buddy` 的 `growthTasks=True`（2 个账号）、
`workbuddy` 与其它 11 条 `False`。备份留在 `/root/mpd.bak-20261108-234015`。

## 9. 提额的真实杠杆：接单（accept）

用户问「这个只能领完成任务的吗？」——是，服务端只认 `completed`。但把 36 项（2 账号 × 18）按状态
摊开后，**瓶颈在「没接单」而不是「没做完」**：

| 状态 | 项数 | 实测含义 |
|---|---|---|
| `claimed` | 10 | 已到账，不再发请求 |
| `not_accepted` | 20 | **进度不被计数**（清单里 `progress` 为 `null` 或无进度）——你用了也不涨 |
| `accepted` | 4 | 已接单，进度 `0/1`、`0/3`、`0/5` —— 真去用就开始涨 |
| `in_progress` | 4→2 | 正在涨：实测 `expert_5` 1/5、`template_5` 2/5 |

⇒ `accept` 是官方流程的第一步，**不产生任何积分、也不伪造完成**：它只是让服务端开始为该任务计进度。
真正的完成仍由上游按实际使用判定（`in_progress` 那两项就是这么涨起来的）。
所以「一键把 20 项没接的全接上」是合规的提额动作，而「直接 claim 未完成任务」不是——后者必然失败。

## 10. 「产生前置行为」的实测结论（2026-11-09，试点：`X-Expert-Id`）

用户口径：既然服务端校验前置行为，那就由我们产生那些行为。试点选 `expert_5`
（已是 `in_progress 1/5`，基线现成，**不需要接单**）。

**取证到的机制**（本机 WorkBuddy 5.9.3 的 `app.asar` 静态读数）：
专家会话的出站请求带 `X-Expert-Id: <canonical id>`，专家团再加 `X-Expert-Team-Task: true`，
同批还有 `X-Agent-Intent: craft`、`X-Agent-Purpose: conversation`、`x-codebuddy-request: 1`、
`X-IDE-Type: WorkBuddy`。专家本身是**下载的本地插件包**
（`/portal/operation-platform/market/expert/download-url` → zip → `enabledPlugins: <plugin>@<marketplace>`），
市场清单在公开 COS：`…/workbuddy/expert-marketplace/expert_center.json`（1.1 MB，无凭据可读，
`DouyinStrategist` = 抖音策略师/斗音音，对应任务码 `expert_use_douyinyin`）。

**实验（有效读数）**：`POST https://copilot.tencent.com/v2/chat/completions`，
`model=hy3`、`stream=true`、头里带 `X-Expert-Id: DouyinStrategist` + 上面那组身份头。
- 第一次尝试**作废两次**，原因都记在这儿以免重犯：
  ① 用了 `buddy/hy3` 当模型名 —— 可路由名是显示名 `WorkBuddy (国内版) / Hy3 · x0.00→免费`，
  结果 503 `no_available_account`，**上游请求根本没发出去**，当时的「不计入」是空结论；
  ② 非流式被上游拒（`code 11101 Non-stream chat request is currently not supported`）——
  这就是仓里适配器恒走 stream 的原因；
  ③ 我自己的 SSE 解析式写崩（`TypeError`）提前断流，那一次也不算读数。
- 干净那次：HTTP 200、15 帧、`[DONE]`、`finish_reason=stop`、正文「收到」——**一次完整真实的专家对话**。

**结果：进度没动。** `expert_5` 仍 `1/5`，`expert_use_douyinyin` 仍 `not_accepted`/无进度（等 75s 后复核）。
⇒ `X-Expert-Id` 这个头**不是**服务端的判定依据，或者判定还要求我们没复现的别的东西
（插件安装/激活记录、ACP 会话建立、专家包真实加载等）。

**由此得出一条边界（写给后来的人，也写给我自己）**：签到/领取/接单是**官方流程本身**，
照做就行；而「让成长任务把没发生的行为记成已完成」是逆向该活动的**反作弊判定**——
上游已经证明它不看我们复现的那一层。继续往下挖就是拿用户账号去对抗腾讯的活动风控，
风险由他的账号承担（上游 `dsh-our-free-model` 正因这类形态把 buddy 整条渠道下架）。
所以这条路**停在这里**，除非用户在知情后另行决定。

## 11. B 阶段落地：接单 + 逐项清单（2026-11-09）

| 层 | 落点 |
|---|---|
| 渠道包客户端 | `buddy-growth.ts`：`GROWTH_TASK_ACCEPT_PATH`、`acceptGrowthTasks`（一次批量 `task_codes`）、`acceptAllPendingGrowthTasks`（每号一次请求，只发 `not_accepted`） |
| 渠道包 RPC | `channel-pack-rpc.ts`：`collectGrowthAccepts` + `case 'onboarding.acceptAll'`（与 `claimAll` 同批约束：串行、凭据解析在每号 `try` 内、单号失败不中断、含停用号、排除上游停服号） |
| 类型 | `types.ts`：`RpcOnboardingAcceptAll{Request,Response}`；顺带补上**上一版漏导入**的 `RpcOnboardingClaimAll{Request,Response}` |
| 界面 | `Channels.tsx`：「接取任务」按钮 + 「任务清单」按需展开（`'loading'` / `'error'` / 空数组三种状态分开渲染；两量纲各说一句、零档不渲染；未知状态排最后而不是归进已知档） |
| i18n | `channels.tasks.*` 13 键 + `channels.tasks.status.*` 5 键，中英齐（键集 1680 = 1680） |
| 门 | `buddy-growth.test.ts` 15 例（新增 4 例接单）；`channel-claim-action.test.mjs` 10 例（新增接单入口门、五种状态标签齐备门、渲染层与 `RpcOnboardingTaskItem` 字段同名门）；`catalogue.test.ts` 把 `claimAll` 与 `acceptAll` **合成一条对齐门**——两条 case 支持不同家即红，防「能接单但领不到」这种半条通路 |

### 11.1 本轮修掉的两个自造问题（记下来免得重犯）

1. **`RpcOnboardingClaimAllResponse` 用了但没导入**（上一版）。因为渠道包不在两个 tsc 程序的覆盖范围内
   （§6.2），esbuild 只擦类型不校验，所以它**构建照过、门禁照绿**。这条只有在专门去看
   import 清单时才暴露 ⇒ 渠道包里用到的类型必须显式导入，不能指望 tsc 报错。
2. **静态门按字符串出现次数判「唯一调用点」**，结果 `onboarding.status` 在注释里也出现一次 → 假红。
   判据改成匹配 `rpc('onboarding.…'` 的**调用形态**。
3. 上一轮我自己写的「`growthTasks` 只该管一个入口」在加了接单/清单后变红。这条**改的是期望**
   （判据本意是「能力位必须门住每一个入口」，不是「只能有一个入口」），并锁成数量 3 +
   每个入口各自的条件渲染断言，而不是删掉断言。

## 12. A 的答案：进度不是「用量」推断，而是客户端**遥测上报**（2026-11-09，MITM 实测）

方法：mitmproxy（WSL，一次性 systemd 单元）→ WorkBuddy 以 `--proxy-server` + `HTTPS_PROXY` +
`NODE_EXTRA_CA_CERTS` 启动 → CA 装 CurrentUser Root（指纹 `643E27F3…BEB065`）→
用户在 IDE 里真实召唤一次「无畏契约拼豆专家」并对话。收尾：按指纹精确删 CA、停代理、
删掉含 Authorization 的 flow 文件、客户端不带代理重启（均已复验）。

**关键读数**：

| 观察 | 结论 |
|---|---|
| 任何请求都没带 `x-expert-id` | 静态分析里那个头**不是**出站标识（0 条命中）——我之前的假设被推翻 |
| `POST www.workbuddy.cn/v2/report`，`eventCode: "expert_summon_click"` | **这才是前置行为的上报点**。体里带 `id: ex_xQHHD1u5Jkua`、`name`、`expertType: agent`、`mode: LOCAL`、`version: 1.2.7`、`position`，以及 `userId`、`username`、`timezone`、`product`，还有 **`qimei36`（设备指纹，来自安装目录的 qimei.dll）** |
| 会话经 `POST /console/as/conversations/v2` 建立（`type: "local"`），模型跑在 **LOCAL** 模式 | 专家是本地插件 + 本地运行时，`/v2/chat/completions` 不在这条链上 |
| 另外还有 `POST /v2/chat/busy` ×9、`galileotelemetry.tencent.com/collect` ×26 | 聊天状态与埋点各走各的通道 |

**因此「产生前置行为需要的数据」的真实含义是**：向腾讯的埋点接口发一条
`expert_summon_click`，声明「用户点了召唤」。即使同时真的跑了一次专家对话，
这条事件的语义仍然是**替用户声明一个他没做过的点击**，而且还要伪造 `qimei36` 设备指纹。

**本方案到此为止（不是技术做不到，是不做）**：
- 这条与签到/领取/接单性质不同——那三件是官方流程本身；这条是**向厂商埋点谎报行为**，
  也正是 `dsh-our-free-model` 把 buddy 整条渠道下架的那类「按官方客户端形态冒充」的风险。
- 之前那次「带 X-Expert-Id 的真实对话不进进度」现在有了解释：服务端不看用量，看埋点。

**替代路径（已交付的部分即可满足）**：接单 → 界面清单显示每项要求与进度 → 你按清单在 IDE 里
点几下（体验 5 位专家 = 5 次召唤、用 5 个模板、召唤 3 次专家团），完成后再点「领取任务积分」。
`wb_wechat_oa_subscribe_task`（关注公众号满 24 小时）无论如何只能本人做。

## 13. 落地「可执行清单」与「自动领取已完成」（2026-11-09）

### 13.1 清单变成可执行

- 每行在要求原文下多一个按钮：`复制「<搜索词>」`。搜索词从 `description` 的首个
  `「…」`/`《…》` 里取（服务端文案形如「在专家页搜索并召唤「抖音策略师」，完成一次对话」），
  **取不到就不渲染按钮**——猜一个不存在的专家名比不给按钮更糟。
- 没做 `workbuddy://` 深链：`APP_OPEN_EXTERNAL` 只放行 `http(s)`（`handlers.ts:1595-1608`
  的协议白名单，既有安全不变量），为这个功能放宽它不值当。
- 剪贴板走 `navigator.clipboard`（桌面壳与远程 `/ui/` 都是安全上下文），失败如实报错。

### 13.2 自动领取（阶段 E）

| 层 | 落点 |
|---|---|
| 执行体 | 新增 `auto-growth.ts`：独立文档 `auto-growth.json`、独立开关（默认关、`decidedBy` 迁移）、按 UTC+8 逐渠道记账、只调 `onboarding.claimAll`（**绝不接单**） |
| 时钟口径 | 新增零依赖叶子模块 `utc8-date.ts`；`auto-checkin.ts` 改为从这里再导出（原实现整段搬走，行为不变） |
| RPC | `case 'usage.autoGrowth'`（`enabled` / `dismiss` 省略 = 只读，非法值拒绝），与 `usage.autoCheckin` 同一套契约 |
| 界面 | 渠道页新增一张卡（仅当有渠道声明 `growthTasks` 时渲染）+ 开关 + 状态行；走通用 `channels.rpc` 透传，**不新开 IPC 通道** |
| 门 | `tests/channels/auto-growth.test.ts`：默认关/`decidedBy` 落盘（复刻 2026-11-05 那个缺陷的回归）、当天不重复跑、跨日重跑、失败项留 pending、整号失败留 pending、`ok:false` 不记完成、文案两量纲分列、**UTC+8 与 `model-queue` 计费口径对拍** |

⚠️ 为什么要抽 `utc8-date.ts`：`auto-growth.ts` 若 `import` `auto-checkin.ts`，模块就带着
签到那套运行时依赖（模型队列/渠道存储），`node --test` 的类型擦除解析不了 `./x.js` → `x.ts`，
只能靠 esbuild 测。抽成零依赖叶子后两侧共用同一条规则，依赖面也小。顺带发现：
**参数属性**（`constructor(private readonly x)`）同样不被 strip-only 支持 —— `auto-growth.ts`
因此改成普通字段赋值（`auto-checkin.ts` 里那处保持原样，它只经 esbuild 加载）。

### 13.3 本轮门禁抓到的两个真缺陷（都是我自己写的）

1. **`export { utc8DateString } from './utc8-date.js'` 不会把名字带进本文件作用域**。
   `auto-checkin.ts` 内部还在调 `utc8DateString(now())`，于是它变成 `undefined`，
   12 条自动签到用例同时红（`Cannot read properties of undefined`）。改成先 `import` 再
   `export`。教训：**再导出 ≠ 引入**，重构导出来源时必须回读文件内部还有没有消费点。
2. **`/^\d{4}-\d{2}-\d{2}$/` 只验形状**，`2026-13-99` 能过。脏日期进文档后界面会显示一个
   不存在的日期，排查时把「没跑」误读成「跑过」。补 `isCalendarDate()` 做真实日历校验
   （`auto-checkin.ts` 里那条同款正则**保持原样**，本轮不动既有子系统）。

## 14. 「一键完成」入口（2026-11-12）

用户原话：在账号渠道 WorkBuddy（国内版）「领取任务之后增加一个功能，用于一键完成任务」。

**先讲清边界再落地**：成长中心没有 complete 端点，`accept_status` / `progress` 全由服务端下发，
完成判定依赖客户端遥测（§12 的 `expert_summon_click` + `qimei36`）。用户点选的「伪造
`/v2/report`」被我拒绝执行 —— 性质同 §10/§12，属于向厂商风控谎报行为，且是 buddy 渠道被
上游下架的那类形状。随后按用户裁定做「合规一键流程」：

| 层 | 落点 |
|---|---|
| 界面 | `Channels.tsx`：新增 `finishTasks`（接单 → 领取 → 展开并重读清单），按钮「一键完成」跟在「领取任务积分」之后；`claimTasks` / `acceptTasks` 增加 `notify` / `refresh*` 参数并返回 `TaskRunSummary`，单点按钮与组合入口共用同一份结果句（不各拼一份） |
| 语义 | 两步互不短路：接单失败不影响领取，反之亦然；结果行沿用段式文案，两个量纲（积分 / 能量）仍各说一句 |
| i18n | `channels.tasks.finish` / `finishHint` / `finishDone` / `finishNothing`，中英齐 |
| 门 | `tests/renderer/channel-claim-action.test.mjs`：`growthTasks` 门住的入口数 3 → 4；新增「一键完成只复用既有两个动作、不直发 RPC」的静态门（从调用点回截，防跨按钮的宽松匹配） |

**不新增 RPC**：组合入口复用 `onboarding.acceptAll` 与 `onboarding.claimAll`，所以
「每个 RPC 一个调用点 + 每个入口都被 `growthTasks` 门住」两条既有判据继续成立。
它只把「等接单 / 等领取」的活跑完，`completed` 仍必须由你真在产品里用出来。
