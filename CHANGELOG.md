# Changelog

本文件记录 ModelPort（早期名为 Chat2API / Chat2API Manager）对用户可见的变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

条目按"为什么改、影响什么"描述；每条末尾括号里的短哈希指向产生该变更的提交，可在 `git show <哈希>` 中核对。
版本边界与溯源说明见文末。

## [1.8.11] - 2026-11-13

版本边界：tag `v1.8.11`（相对 1.8.10）。主题是**路由出错时要么说清楚、要么快速失败**：软钉指向池外模型时
不再悄悄换一个模型把这一轮跑完；「没订阅 / 没钱 / 额度窗已尽」这类今天不会好的拒绝不再每 15 秒重撞一次；
请求日志里的 `reason` 终于说得出这一轮为什么用了这个模型。另含四件操作面：路由能力下限 `minTier`、控制台
「长期固定」、托盘固定默认 10 分钟并标注影响面、候选池预演 15 秒短缓存。

### Fixed（修复）

- **钉住的模型不在池里，旧行为是照常换一个模型跑完这一轮**：软钉点名的模型被池策略筛掉或被手动移除后，
  客户端以为还在跟钉住的模型对话，其实每一轮都在换实现（现网实测连续三次 504）。现在选路当场把软钉退役
  （`pinStale.action: 'retired'`），本轮零候选、503 `pin_stale` 并点名那个模型，下一次请求走这条路由的
  普通顺序；持久的 `preferredModel` 不删配置，报 `action: 'ignored'` 并照常服务。`/v1/completions` 补齐了
  同一条拒绝分支 —— 此前两条入口对同一个池给出不同答案。(`2258b3f`)
- **终止性拒绝被当成普通 429**：402、「需要订阅」、免费额度 / 日限耗尽这类拒绝，15 秒冷却后下一笔请求又
  撞同一家，一轮里可以付七八次同样的拒绝。现在分类器把这三类折成 6 小时（付款 / 订阅）与 1 小时（额度窗），
  与指数退避、上游 `Retry-After` 取更晚者；同时退出「耗尽链恢复轮」—— 重走一遍只会把同一句拒绝再付一次。
  裸 429、`rate limit`、`for your subscription tier` 都不命中，仍是原来的分钟级退避。(`2258b3f`)
- **日志里的 `reason` 恒等于 `only`**：`reason`（`pin` / `only` / `cache-affinity` / `sticky` / `score`）
  原来在 `single` 作用域裁剪**之后**计算，剪完只剩一个模型，每一行都写成 `only`，等于没有归因。现在在
  裁剪前算，并新增 `previousHint`（上一次服务的模型）与 `pinStale`，面板能直接回答「这一轮为什么换 / 没换」。
  (`2258b3f`)
- **「已固定」其实早已失效**：软钉指向的模型离开池子后，托盘与控制台仍显示「已固定：X」，实际每轮都在用
  别的模型。托盘子菜单、顶栏路由项、控制台列表与详情现在分三态：已固定 / 已不在池内·不生效 / 固定已失效。
  (`2258b3f`)

### Added（新增）

- **路由能力下限 `minTier`**：可选 `fast` / `balanced` / `strong`，是「不低于」的下限语义，与 `strong-tier` /
  `balanced-tier` 的**等值**池策略是两件事。在名称钉之后、池策略与手动加回之前生效，所以 include 也捞不回
  下限以下的模型；筛空时报 `missing: ['min_tier']`，预览状态 `below-tier`，写入侧拒绝未知值。(`2258b3f`)
- **控制台「长期固定」**：`routes:switch` 新增 `persist` 档，把这一次选择写进路由的 `preferredModel`
  （重启后仍在，直到「恢复自动排序」），并撤掉内存软钉，避免 30 分钟倒计时盖住「一直」。先写配置再撤钉：
  写失败时那颗钉子还在，界面显示的就是用户刚点的结果。(`2258b3f`)
- **托盘固定默认 10 分钟并标注影响面**：托盘发起的固定从 30 分钟改成 10 分钟，菜单里加一行「影响这条路由
  的全部客户端」—— 固定是路由级的，不是一个客户端的选择。(`2258b3f`)
- **候选池预演短缓存**：`preview()` 结果缓存 15 秒 / 64 条（键 = 路由名 + 解引用后的池 + 样本形状），进出
  都 `structuredClone`；实测一次开菜单的全池扫描 p50 4.7 秒 / p90 10.2 秒。编辑器保存标注后用 `fresh: true`
  跳过读缓存，否则会看到「标了视觉可用、预览还说不可用」。(`2258b3f`)
- **映射面板拒绝与路由同名的别名**：请求解析先认路由名，同名的映射行永远不会生效。新建时直接拒绝，存量
  撞名的行在表里标出警告；停用的路由同样挡住别名（请求得到的是 `route_disabled`，不是映射指向的模型）。
  (`2258b3f`)

## [1.8.10] - 2026-11-13

版本边界：tag `v1.8.10`（相对 1.8.9）。主题是**裁剪不再把「这一轮让我做什么」裁掉**：网关自己的上下文
裁剪把首条 `user`（Codex 注入的 `AGENTS.md`）当成任务、丢掉了真正的指令，模型回一句「规则已加载，你想
让我做什么？」便收尾，客户端读到的是「又停了」。另含两条诊断面：空池的 429/503 现在也写请求日志行；
控制台新增「路由与模型」页，列出全部可切换模型并可搜索、固定。

### Fixed（修复）

- **「不执行」的真因是网关裁剪丢了当轮指令**：`codex-deepseek` 点名单模型后仍复现，现网三笔
  200 + `finish=stop` 的正文都是「AGENTS.md 已加载……你想让我做什么」，对应同一时刻的三次裁剪
  （36→19、144→45、214→45）。裁剪只在 `channelIds` 点名的渠道（`trae`）上运行，窗口按**条数**算
  （40 条 ≈ 20 次工具调用，一次调用是 assistant + tool 结果两条），一轮中段的请求窗口里只剩工具流量；
  `keepToolGroupAndTask` 补回的是**首条** user —— 那是 Codex 注入的规则书，不是任务。现在窗口本身不含
  user 时，同时补回**窗口之前最新的一条 user**（`lastUserBefore`），`tokenLimit` 的预留量也把它算进去。
  代价是被裁的轮次多带 1–2 条消息；仍然是删除式裁剪，网关不写一个字。(`760c188`)
- **空池的 429/503 不写请求日志行**：`no_available_model` 与 `model_temporarily_unavailable` 两条拒绝
  都在 `addRequestLog` 之前返回，面板上只剩客户端转述的那句话，「为什么没有候选」无处可查（1.8.9 补的是
  成因文案，行本身仍然缺失）。现在两条都写一条错误行（`requestId`、`errorType`/`errorCode`、
  `responseBody`），并附带同一份 `auto` 块（`route` / `chainLength: 0` / `skipped` / `modelScope`）；
  503 的 `details.skipped` 与响应头共用同一份「前 8 条」清单。(`a734500`)

### Added（新增）

- **控制台「路由与模型」页**：托盘子菜单只放得下 8 个模型，其余折成「另有 N 个模型在控制台」——那句话
  此前点不动。现在托盘那一项跳到 `/routes?route=<name>`，页面读 `routes:menu` 的同一份快照，列出该路由
  **全部可切换模型**（上限 2000），支持按模型名／供应商名／展示名三字段搜索，行内直接「固定／换下一个／
  恢复自动排序」；固定走 `routes:switch`（内存软钉，30 分钟）与 `routes:unpin`，不改路由配置。
  (`54a16c3`)

## [1.8.9] - 2026-11-13

版本边界：tag `v1.8.9`（相对 1.8.8）。主题是**架构 A：一轮只服务一个模型**——跨模型换家只在回合
之间发生，配软钉快速切换与托盘菜单；另含**渠道包把「本步没做完」伪装成「输出 token 上限」**的
投影修正。设计来源：`docs/AGENTS-full.md` §Architecture A。发布前现网报出
`503 No available model for route 'codex-deepseek'`，追下去是三条「空池」缺陷（全池冷却、
瞬时空池、当日上限不复位），一并在本版修掉。

### Fixed（修复）

- **「No available model for route '…'」其实是一轮候选全在冷却**：`rankCandidates` 把
  `coolingUntil > now` 的候选无条件剔掉，而 `single` 作用域只留队首模型的账号 —— 那几个账号
  刚被上游拒过时，候选池就成了空数组，上层只能报 503 `no_available_model`（读起来是「这条
  路由没有模型，去查供应商」）。现网读数：Codex 三条连续失败的 503 都没有 `details.missing`，
  同一时刻六次新会话打到六个不同模型、每次都在第一家失败一次就整轮结束。现在全池冷却时只留
  **最早恢复的那一组**参与换家，最多付一次必败的上游往返，换回一个真实的上游 429/402 与它的
  `Retry-After`。(`b9dd78e`)
- **瞬时空池报 429 可重试，而不是 503「这条路由没有模型」**：候选被额度窗口打满、上游亲口拒过
  额度、账号当日上限挡掉时池子会空，但成因是**会自己复位**的状态。`AutoRouteDecision` 新增
  `transientUnavailable`（cause / skipped / retryAfterSeconds；解禁时刻取自额度耗尽标记的
  `until`，没有就退回 60 秒），chat 与 completions 两条入口把它投影成 429
  `model_temporarily_unavailable` + `Retry-After`，`details` 写明成因与条数。配置筛空
  （`pool_strategy` / `manual_filter`）与能力不符仍然 503 —— 那两类才是「去改点东西」。
  (`b9dd78e`)
- **账号「当日上限」其实从没复位过**：`todayUsed` 只增不减 —— `resetDailyUsage()` 的注释写着
  「应由午夜调用」，而全仓没有任何调用方，于是 `dailyLimit` 是**终身上限**：哪一天打满，这个
  账号从此不再进候选池。在单模型作用域下，这是「这条路由没有模型」的另一条成因。现在计数带
  本地日期键（`todayUsedDay`），读的时候日期对不上就是 0（`shared/dailyUsage.ts`），递增时把
  键写上，管控台的「今日用量」同源显示；缺日期键的老数据读作 0（沿用旧值正是那条永久屏蔽
  本身）；无调用方的 `resetDailyUsage()` 删除。(`b9dd78e`)
- **「模型本步不完整」被报成「输出 token 上限」**：渠道包把七种与输出上限无关的合成情形（工具
  参数 JSON 残缺、必填参数收到空值、缺名的调用被丢弃、上游没宣告就断流、工具从未宣告、正文被
  停止串掐断、思考循环）一律折成 `{kind:'max-tokens'}`，客户端读到
  `incomplete/max_output_tokens` 并按「输出太长」收场。DSH 有 harness 会重跑该步，ModelPort 只
  投影一次，折叠在这条链上不成立。现在这些情形带成因标签，投影成 502 `incomplete_step` 错误帧；
  真实 `length` 保持原样。它同时是**模型级**退化：撤粘性锚点、上模型熔断票，但不降账号并发
  （账号答了，是模型没把活干完）。(`81898bd`)

### Changed（变更）

- **一轮只服务一个模型（架构 A）**：`ModelRoute.modelScope` 三档，缺省 `single` —— 一轮之内
  只有该模型的账号之间换家，换模型只发生在回合之间（上下文理解、工具协议与前缀缓存都不跨模型
  存活，中转一次客户端读到的就是「莫名崩掉」）。`family` 保留同名家族跨供应商，`pool` 保留
  上一版的跨模型池。裁剪在软钉与熔断重排**之后**执行，用户点名或退化过的模型因此能换掉这一轮
  的队首；`single` 档墙钟 40 秒，池档仍是 90 秒。(`81898bd`)
- **回合之间换模型的唯一通路是模型熔断**：`(路由, 模型)` 5 分钟、内存态，只由「模型自己没把活
  干完」的五类上票（重复、空转、宣布即停、换家来的只说话、合成未完成步骤）；截断与慢首字只撤
  粘性锚点，不给模型定罪。熔断把模型降级排尾而不是删除，全池熔断时自动失效，成功一次即清票。
  延迟门（首字慢于池内 p75 时不把粘性模型提前、收尾同源撤锚点）也按**作用域**算：单模型档是
  该模型的账号，钉住时是被钉模型的账号，不再拿全池分布判一个不参赛的模型。(`81898bd`)
- **软钉 > 持久偏好 > 粘性**：`routes:switch` 写内存软钉（路由或会话级，30 分钟），
  `ModelRoute.preferredModel` 是持久形态（界面读作「一直」，没有倒计时）。钉住的模型不被熔断
  否决——用户意图高于自动票；池里没有这个模型时按原排序服务，但 `pinMiss` 进日志与
  `X-ModelPort-Pin` 响应头，不静默回退。(`81898bd`)

### Added（新增）

- **托盘「模型」子菜单**：列出每条启用路由及其模型（标出当前、被钉、熔断中），点击即切换，另带
  「换下一个」与「恢复自动排序」。shell 不持有管理密钥，菜单经页面 RPC 读取与回填
  （`shell:route-menu-request` / `shell:route-menu` / `shell:route-command`，两个方向都校验
  发送者）；tooltip 直接显示「路由 · 当前模型」。(`81898bd`)
- **路由表单新增「一轮内的模型范围」**：三档选项取自共享常量 `MODEL_SCOPES`，落盘只认这三个
  字面量、缺键读作 `single`。没有这一格，`pool` 档只能手改 data.json。(`81898bd`)
- **清空日志确认文案改为「只删除请求日志行。使用统计与 token 台账不受影响，此操作不可撤销。」**：
  上一版改了行为没跟上文案（那条 locale 改动当时随并行会话留在工作树里），本版一并发布。
  (`81898bd`)

### 未取读数

- 托盘菜单（子项、标记、tooltip、右键刷新）只有源码级钉点（`tests/shell/tray-model-menu.test.ts`），
  没有在实机托盘里点过：headless 起不来 Electron 托盘，这一格要装机后补一次目视。
- 未对真实上游做「钉住某模型 → 下一轮生效」的端到端请求，选路层由回归测试覆盖。
- 未在真机上观察 Codex 收到 429 之后的退避与重试形态：本版只钉住响应形状（状态码、`Retry-After`、
  code），客户端的处置在它自己那侧；部署后第一次遇到瞬时空池即可核对。

## [1.8.8] - 2026-11-13

版本边界：tag `v1.8.8`（相对 1.8.7）。主题是**日志与使用统计的边界**：一次「清空日志」把几周
的使用统计一起抹掉；日志面板的错误条数一旦攒到保留下限就再也不变化。恢复现网被删的统计又牵出
两条：重建日的延迟是半截量除以抬高后的成功数，以及缓存命中卡的自定义日期框画在了隔壁那张卡里。
取证记录、恢复口径与已知失真量写在 `docs/audit/2026-11-13-clear-logs-statistics-loss.md`。

### Fixed（修复）

- **「清空日志」把使用数据一起删了**：`storeManager.clearRequestLogs()` 在清完日志行之后，还
  把整块 `statistics` 写回默认值——累计请求数、按天统计、按模型/按渠道/按账号的使用量全部归零，
  而 `tokenUsage`（按日用量桶）不受影响，所以仪表盘是「token 图还在、请求数没了」这种形状。
  文档早就写明日志清空是独立操作、不连带清统计，但全仓没有任何判据调用过这个方法（唯一一处只
  拿它清场），于是文档与代码漂移无门可拦。现在这句写入已删除，并补 `tests/store/clear-logs-keeps-usage.test.ts`
  钉住：清空后统计与用量桶原样、落盘一致、应用日志那条路同样不碰统计。(`038823a`)
- **「错误一直保持 100 条，不会变化」**：错误行的保留下限（请求日志 100 条、应用日志 500 条）
  此前**没有时限**，每次裁剪都把「最新的 100 条错误」重新保下来，于是错误行永不出局——列表攒到
  100 条就不再变化，几周前的失败一直压在今天要查的那几条前面。现在下限只覆盖 `logRetentionDays`
  （缺省 7 天）以内的错误行，窗口跟着设置页那个已有的「日志保留天数」走，四个写配置的入口都
  经同一处下发。(`038823a`)
- **日志面板的计数取自统计账本，不再是数保留窗里的行**：请求日志只留最近 200 行外加错误保底，
  数行会把「今日请求」压成保留上限——现网实测当天 886 次请求只数出 200，「今日错误」到过保底
  值之后也永远停在那个条数上。四张卡片现在读 `statistics.dailyStats`，与仪表盘同一口径；探测行
  两边都不计（请求行靠 `kind: 'probe'`，账本靠转发器的 `!isProbe`）。(`038823a`)
- **重建日的延迟不再是「半截量除以抬高后的成功数」**：11-11 / 11-12 的总数与成功数按用量桶重建后，
  `totalLatency` 仍只有已记段，直接相除把 11-12 的平均延迟读成 116ms（完好的相邻日是 1.2–7.3s）——
  比「未记录」更假。带 `tokenLedger` 标记的天现在两处都不参与延迟：趋势图上断线
  （`dailyTrendPoints`），窗口聚合的分子分母同时跳过（`windowDayTotals`）；窗口里只剩这类天时读
  `null`。请求数与成败照常计入。(0996308)
- **缓存命中卡的自定义日期框回它自己的卡片**：这张卡与供应商统计共用同一个窗口，但它只渲染预设
  行、不渲染日期输入，于是点这张卡的「自定义」之后日期框只出现在隔壁「供应商统计」里——看着像
  隔壁的控件，改的却是这张卡的区间。现在两张卡各自渲染预设行 + 自己的起止输入，接线由
  `tests/renderer/provider-stats-window.test.mjs` 的负控钉住（撤掉输入即红）。(0996308)
### Added（新增）

- **重建日行的来源标记**：`DailyStatistics` 新增可选 `totalRequestsSource`。清空事故里丢失的那段
  统计按按日用量桶重建时，总数与成功数都带上这个标记，`success + failed == total` 的构造仍然成立
  （`tests/store/rebuilt-day-provenance.test.ts`），重启后也能读出「这一行不是逐笔数出来的」。
  已知失真量：11-11 约 590 条失败被计成成功，11-12 的未记段全部按成功计；这两天按渠道的成败与
  延迟被撤成「未记录」而不是留下半截量。(`038823a`)

### 未取读数

- 清空确认对话框的文案（改成「只删日志行，使用统计与 token 台账不受影响」）落在同一份 locale
  文件里，那里还有并行会话未提交的路由改动，因此没随本版提交，随下一版走。
- 本版未在 macOS / Windows 实机点过「清空日志」；判据是 store 层的进程内真 store + 真落盘验证。

## [1.8.7] - 2026-11-12

版本边界：tag `v1.8.7`（相对 1.8.6）。主题是**`auto` 从「泳道」改为「池」**——上一版把换家钉在
队首模型上，客户端第一发硬故障后当场中断；本版让排序只决定先试谁，失败就换下一家（含下一个
模型）。另含首字延迟从罚分升为门、中途换实现的客户端可见标记、思考回灌跨线路统一，以及渠道包
两处「报错说错了事实」的修正。本批改动由并行会话在同一工作树完成，hunk 交错，合为单个提交
`5445416`。

### Fixed（修复）

- **客户端一上来就中断：`auto` 被钉在队首模型，第一发硬故障就等于整条路由作废**：上一版的
  「泳道」把候选链收口在队首模型的账号之间，只有「这一家供不了这个模型」的硬故障（且路由显式
  打开跨模型）才允许越界。现网读数正是栅栏的形状：`chainLength` 37–116，`attempts` 只有 1–2
  —— OpenCode 的 404、modelscope 的 `limit_burst_rate` 429、workbuddy 的风控 400 各自结束了
  整条链，而池里几十个候选一次都没被试。现在 `auto` 是一个池：排序（同名账号相邻、首模型家族
  其次）只决定顺序，任何状态码策略允许的失败都换下一家，直到有候选答上来或墙钟 90 秒 /
  `maxAttempts`（账号故障类）收口。`ModelRoute.crossModelFailover`、`AutoRouteDecision.lane`、
  `anchorLaneToCandidates` 与 `auto.lane` 日志字段一并退役。部署后运行中的包已无这三个符号，
  新请求行不再带 `auto.lane`。(`5445416`)
- **一家拒收请求体就把整池打死**：池语义下裸 400（既不是能力不符，也不是账号故障，例如某家不认
  `temperature`）现在换下一家且不罚账号；接连两家都拒收则收口在第二次——那更可能是请求本身写坏
  了，继续换只是把同一次拒绝重演。客户端自己按了取消仍然是终止（它落成 400 +
  `request.signal.aborted`）。(`5445416`)
- **「走路由比直连慢一个数量级」（用户报障）**：首字延迟此前只是封顶 0.2 的罚分，硬粘性无条件
  把它提到队首，慢模型因此永远不让位。现在延迟是**门**：以池内 `ewmaFirstTokenMs` 的 p75 为门槛
  （读数不足 4 个不判），慢于门槛的候选不再被硬粘性提前；同一门槛在流收尾时判「这一轮慢到该撤
  锚点」（第六类退化），两条判据同源于选路阶段算好的 `latencyGateMs`。用池内分位而不是绝对毫秒
  数：现网实测直连 p50 1.9s、走路由 p50 15.3s，任何定值都会在一边永远不触发。(`5445416`)
- **上游按默认值截断，锚点不撤，下一轮又送回同一家**：客户端没给 `max_tokens` 而
  `finish_reason=length` 时，Codex 把这一轮读成 `response.incomplete (max_output_tokens)` 并就地
  结束任务；锚点不撤就每轮读到同一句 Incomplete。现在这条（第五类退化）与空转、宣布即停止同口径
  撤锚点；客户端自己点了上限仍算显式截断，不撤不罚。(`5445416`)
- **思考回灌在账号渠道与聚合线路之间断掉**：渠道包跑在独立 worker 线程里，和主线程各持一份
  `tool_call.id` → 思考的缓存，客户端在同一会话里换线时上一轮的思考找不到，整段对话下一轮 400。
  观测与补回统一到主线程：观测在 chat / completions 路由（下行 SSE 的唯一出口），补回在转发器
  （通用分支组装请求体前、账号渠道派发前），两条线路共用同一张 id 表。(`5445416`)
- **Responses 的并行工具调用被拆成多条 assistant，严格上游整轮拒收**：`input` 是一次一个
  `function_call` item，逐条落成独立 assistant 会产出「调用 A / 调用 B / 结果 A / 结果 B」。
  MiniMax 实测 `invalid params, tool call result does not follow tool call (2013)`，整轮会话报废
  且其余候选一次都没试。现在同批调用并进同一条 assistant，之间出现的思考项挂回该轮而不是另起一条；
  结果一到，这批就收口，之后的调用不会挤进来。(`5445416`)
- **WorkBuddy 账号池全部冷却时报「no usable credential，请重新登录」**：池化安装根本没有
  `WORKBUDDY_ACCESS_TOKEN` 这一项，冷却时的回落把「冷却中」说成了「没登录」。现在如实报可恢复的
  冷却（文案带宿主识别用的「账号池中的账号当前均不可用」），交给换家与恢复轮；池里一个账号都没有
  时才走单凭据路径。(`5445416`)
- **风控文案与事实不符**：单账号池被 11140 拦截时，提示却写「已逐个换号重试」，用户按「换号」去
  排查，真正该做的是加账号。现在按三种范围分别说明：池里换过号（换/加账号）、没有第二个可换的号
  （加账号）、流内错误帧（本条不重发）。(`5445416`)

### Added（新增）

- **`X-ModelPort-Switch` 响应头**：本轮服务者与这条会话上一轮锚点不同时给出
  `provider/model -> provider/model`，日志同一判断落在 `auto.switchedFrom`。「模型名没变、行为
  变了」是客户端最难自查的一类故障，这一格把它变成可检索的事实；首轮或同锚点复用不出现。(`5445416`)
- **换家与延迟的诊断字段**：请求行新增 `auto.latencyGateMs`（本轮池内 p75 门槛）与
  `auto.stickyGated`（硬粘性因门槛被跳过），与 `auto.failures[].kind` 并列，用来回答「为什么这
  一轮换了模型 / 为什么没粘回上一家」。(`5445416`)
- **判据本体可单测**：`autoRouting.ts::poolLatencyGateMs` 与
  `streamOutcomePolicy.ts::isSlowTurnAfterStream` 抽成纯函数，选路与收尾两个消费点读同一格，
  不在路由文件里各算一遍。(`5445416`)

### Changed（变更）

- **退役配置面**：`ModelRoute.crossModelFailover` 连同路由编辑页的开关、归一化落键、两份语言的
  文案一并删除；盘上残留的旧键在归一化时丢弃，管理 API 不会再报一个没人读的开关。
  `RequestLogEntry.auto.lane` 删除，旧日志行不受影响。(`5445416`)
- **`auto` 与裸名链的 400 口径分开**：池语义的裸 400 换家（两次封顶，不罚账号），裸模型名的跨家
  链仍按原状态码策略把 400 当终局——点名的那个名字就在这几家之间，400 说明请求本身有问题。(`5445416`)

### Tests（判据）

- `tests/routes/proxy-routes-catalog-404.test.ts`：重写为池语义并补负控——全池试满才收口 503、
  5xx 按 `maxAttempts` 收口、403 换家、裸 400 换家与「第二次就收口」；`auto.lane` 必须不再出现。
  (`5445416`)
- `tests/routes/sticky-latency-gate.test.ts`（新增）与 `tests/proxy/sticky-revoke-policy.test.ts`：
  p75 门只跳过「会变慢」的那一次提前、读数不足不判、慢于门槛的完成流撤锚点、`client_gone` 不判。
  (`5445416`)
- `tests/routes/context-overflow-failover.test.ts`：窄口径负控改写——无关的 400 不算窗口不够
  （不写 `contextFit`、不记能力不符），只按池语义换下一家。(`5445416`)
- `tests/renderer/auto-routing-settings.test.mjs`：由正向接线改为**退役反向门**——控件、归一化、
  路由读取、两个 locale 的文案四处必须同时消失，换家循环里也不许再出现模型栅栏。(`5445416`)
- `tests/shared/responses-inbound.test.ts` / `tests/proxy/reasoning-echo.test.ts` /
  `tests/channels/workbuddy-port.test.ts`：并行调用并成一条 assistant 与 2013 形状、跨线路共用
  一份思考缓存、冷却误报与三档风控文案。(`5445416`)

## [1.8.6] - 2026-11-12

版本边界：tag `v1.8.6`（相对 1.8.5）。主题是**Codex 接 `codex` 路由的两类假象**——渠道上游的
404 被折成 502 吃掉换家上限、一整发什么都没交付的流被记成成功；另含启动时误删用户凭据的退役名
判据、候选耗尽的 503 收口补齐、工具调用配对修复、余额门控降级、OpenCode 会话亲和头与模型管理页
的同步/标注能力。本批改动由并行会话在同一工作树完成，hunk 交错，合为单个提交 `6bbde15`。

### Fixed（修复）

- **渠道上游的 404 被折成 502，换家上限被注定失败的候选吃满**：cline 的 `:batch` 变体在 chat
  端点逐发 404 `model not supported`。建流阶段的失败只能以 HTTP 200 的 SSE 错误帧浮现，而那一发
  帧里没写状态码，宿主嗅探分支又只按文案判 400/502 —— 于是「这一家供不了这个模型」被记成账号
  故障，三条 `:batch` 撞满路由的 `maxAttempts: 3`，1152 个候选的链在第 7 家收手，客户端读到
  `503 no_available_model（last: cline: model not supported）`。现在错误帧带上上游真实状态码，
  宿主两个嗅探分支同口径读它（此前只有姊妹分支读），404 换家且不罚账号、不进冷却。现网证据
  `chatcmpl-mwcbjari-izjtek`：同渠道同模型，流式记 502、非流式记 404，全仓 110 笔渠道包失败
  无一例外折成 502。(`6bbde15`)
- **只承诺不执行：一整发零交付的流被记成成功**：Codex 工具结果回填后的那一轮由
  `openrouter/free` 服务，200 + `[DONE]` + 176 KB 出站，但正文与工具调用都是空（客户端 usage 里
  1108 个 output token 全是思考），回合以 `last_agent_message: null` 结束，界面停在上一句「先确认
  当前 shell 位置」上。去重率判据对这一发结构性失明——思考走 `reasoning_details` 对象数组，零行
  只得到 `notJudged: too_short`，看着像健康——所以它既算胜又留着粘性锚点，下一轮继续派给同一台
  空转机。现在补第三类退化读数 `streamTrace.emptyTurn`：只在客户端带了工具、流正常收尾、且正文与
  `tool_calls` 皆空时判，命中即按 degraded 进 AIMD/Bandit 并撤锚点。现网证据
  `chatcmpl-mwcghqtq-td1xm6`。(`6bbde15`)
- **更新后 DeepSeek 的 Key 丢了**：`deepseek`/`glm`/`kimi`/`minimax`/`zai` 五个名字既是 1.5 网页
  集成的退役名、又是随包聚合目录的现役条目 id（`minimax` 还兼账号渠道 id），而凭据按同
  `providerId` 落同一张 `accounts` 表，于是每次网关启动（自更新必带一次重启）都把用户配好的 Key
  与每模型开关当孤儿删掉。判据改为「在名单里 **且** 随包代码无任何现役定义」。(`6bbde15`)
- **候选耗尽被透传成 429，Codex 读成「你已达到使用上限」并终止**：收口判据从「只收 404」扩为
  「试过多家且失败在候选侧（404/401/403/429/5xx、渠道包池空文案）」一律收成 503 + `Retry-After`
  ——缺省 60 秒取自余额门控的缓存 TTL，上游给了解禁时刻就用它（秒数与 HTTP 日期都读）；400/422
  永不收口，第一家就失败仍原样透传。`/v1/completions` 补上此前只有 chat 路由才有的这套收口。
  现网证据 11-11 那笔：链在第 3 家收手、末笔池空门控被透传成 429，而当时池里 75 个候选大多活着。
  (`6bbde15`)
- **Codex 的 agent 回合被严格上游整段拒收**：同一份历史在 `buddy/deepseek-v4-pro`、
  `buddy/kimi-k3.1-pro` 中 502「tool calls and tool results do not match」，换到宽松候选才 200，
  代价是整轮粘在弱模型上、用户读到无故停下。渠道 Worker 出站前把「调用↔结果」配平：无结果的调用、
  孤儿结果、重复声明、重复回填各删多余一条，**只删不造**，调用清空后连键撤掉。(`6bbde15`)
- **`opencode_go` 每轮白撞一次 400**（上游要求 `x-opencode-session`）：对解析后主机名为
  `opencode.ai` 及其子域的上游补发四个同值亲和头，取值优先客户端自己的会话标识
  （`prompt_cache_key` → `user` → `metadata.user_id`），否则账号级纯哈希派生，无跨请求缓存。
  补头不产生订阅资格——403 仍是账号事实，界面照实说。(`6bbde15`)
- **余额为 0 的账号被直接剔除，把候选池踢空**：0 分不清「烧光」与「本计划根本不发积分」，剔除会
  抛出「账号池中的账号当前均不可用」。改为**降级排最后**——只有池里再无「有余额/未知」账号时才取
  手动顺序第一个并 warn；「这个计划发放过积分吗」的判据收进 `credits.ts::planGrantsCredits` 成唯一
  权威并接到 TRAE 与 Gemini（Gemini 两个配额窗口都没下发时按未知放行，不再当 0 拦号）。
  cline/raccoon/lobsterai/minimax 只有汇总数字、拿不出发放量，不套用该判据。(`6bbde15`)

### Added（新增）

- **模型管理页「同步模型」按钮**（IPC `providers:syncModels`）：作用域随供应商筛选，缺省同步所有
  已启用的可同步供应商；账号渠道整包只 `resync` 一轮、聚合逐条目 `syncModels`、内置走
  `modelsFetch`，逐家回报增删并提示；自定义供应商明确回 `unsupported`，不假装同步成功。(`6bbde15`)
- **每模型「消耗倍率」与「免费」标注**：标注对话框两栏越界当场拒绝；列表按
  `manual > 渠道目录` 合并并提示「来自手工标注、同步不覆盖」；聚合行显示成本分类，别名/自定义显示
  「不适用」而非「未标注」；消耗筛选与路由侧同口径。(`6bbde15`)
- **请求行携带空转读数** `streamTrace.emptyTurn`（`contentChars` / `toolCallDeltas` /
  `toolsOffered` / `empty`），与 `streamTrace.repetition` 并列、同源于一份累计 SSE 文本，只读不
  写；非流式仍明确不判。(`6bbde15`)

### Changed（变更）

- **目录变体标签解析修正**：`名 · x0.03 SG` 这类带同名变体的标签现在能拆出倍率且名字原样保留；
  此前解析失败会让去重吞掉模型。(`6bbde15`)
- **日志的失败分类与实际换家分支对齐**：缺会话亲和头那类 400、以及普通 404，在
  `attempts[].outcome` 与 `auto.failures[].kind` 两处统一记 `capability`（此前同一笔尝试两处结论
  相反）。(`6bbde15`)

### Tests（判据）

- `tests/channels/openai-gateway-error-frame-status.test.ts`：建流阶段的错误帧带上游状态码
  （顶层与 `failure.status` 两种形状都取）、读不到时仍按 502 兜底不发明数字、一条流只有一个
  `[DONE]`。(`6bbde15`)
- `tests/routes/account-channel-stream-error-status.test.ts`：三条 `:batch` 的 404 不吃掉
  `maxAttempts`、第四家正常服务；单发一笔 `:batch` 得 404 且账号不进冷却。(`6bbde15`)
- `tests/routes/empty-turn-stream-trace.test.ts`：带工具、零正文、零工具调用的完成流在请求行留下
  `emptyTurn`，并真的进这一家的 `degradedRate`；交付了工具调用的那一发不判空转。(`6bbde15`)
- `tests/shared/stream-repetition.test.ts` / `tests/proxy/sticky-revoke-policy.test.ts`：
  `reasoning_details` 数组形状下去重率失明而空转判据命中、有正文或有工具调用都不算空转、没带工具
  不判、`[DONE]`/PING/坏帧不贡献计数；撤锚点只在 `done` 上生效，`client_gone`/`timeout` 各按既有
  口径。(`6bbde15`)
- `tests/store/retired-name-collision.test.ts`：撞名判活、`mimo`/`qwen`/`qwen-ai` 照删、Key 值逐
  字节存活、每模型开关分治、退役名单不许悄悄变、二次启动幂等。(`6bbde15`)
- `tests/channels/tool-call-validation.test.ts`：四类配对缺陷各自删对、不改写入参、明细只带坐标且
  12 条截断、怪异输入不抛错。(`6bbde15`)
- `tests/proxy/failover.test.ts` / `tests/proxy/attempt-trace.test.ts`：收口矩阵（5xx/401/403/429
  命中、400/422/200/无状态码不收口）、上游 `Retry-After` 覆盖默认值、`parseRetryAfterSeconds` 七种
  输入、亲和头 400 记 capability 而普通 400 仍 fatal。(`6bbde15`)
- `tests/ipc/model-sync-console.test.ts` / `tests/renderer/model-weight-annotation.test.mjs`：同步
  通道/类型镜像/三分支/按钮与中英插值一致、整包只 resync 一轮；标注表单判据、合并顺序、筛选同口径、
  变体倍率。(`6bbde15`)
- `tests/channels/account-pool-balance-demote.test.ts` / `credit-balance-plan-gate.test.ts`：未知
  账号优先于 0 余额账号、全 0 才降级并 warn、健康路径只读 TTL 缓存不多探；发放判据算术、免费档放行、
  Gemini 无配额窗口不等于 0。(`6bbde15`)
- `tests/proxy/opencode-affinity.test.ts`：域判定的假阳性、四头同值且只发四个、禁用身份头、可重复
  派生、字段优先级、两个 `buildHeaders` 调用点必须传 `request`。(`6bbde15`)
- 两处吃源码文本的接线断言按新实现更新（`tests/renderer/repetition-guard-wiring.test.mjs` 的变异
  锚点），变异仍会红——牙齿没被摘掉。(`6bbde15`)

### 未取读数

- **只在 WSL 宿主上跑过门禁**：`npm run gate` 全绿（2249 个测试、0 失败、两套 tsc 零错误），没有在
  Windows / macOS 安装包上各起一次验证。
- **空转判据只覆盖 `/v1/chat/completions` 一条道**：`/v1/completions` 与 `/v1/responses` 今天根本不
  产 `streamTrace`（去重率读数也不在那两条道上），所以同一发零交付在另两条道上仍会被记成成功。
- **客户端可见的错误帧多了一个非 OpenAI 标准的 `status` 键**（`error.status`，此前该帧只有
  `message`/`type`/`code`）；未逐个客户端验过容忍度。
- **一个行为变化未取实测**：流式渠道失败里真 400 的那几笔（现网 3 笔 `INVALID_REQUEST`）现在按既有
  裁定「400 终止」，不再伪装成 502 去换家。
- **现网 WSL 网关仍是 1.8.5 的产物**：上面两条 Codex 相关的修复要部署并重启后才生效。

---

## [1.8.5] - 2026-11-11

版本边界：tag `v1.8.5`（相对 1.8.4）。主题是**每个渠道一个「走系统代理」开关**；另含码道 token
配额的计量口径、日志页列表撑满窗口、以及 1.8.4 只有读取端的宿主机代理补上探测脚本。

### Added（新增）

- **渠道卡片「走系统代理」开关**：每张渠道卡一个开关，打开（缺省）时该渠道沿用应用已经探到的
  系统代理链（环境代理 → 宿主机代理文件 → Windows 系统代理），关闭则**真直连**。关闭的判断放在
  插件出口之前，所以界面写「直连」就是直连——出口 IP 不会因为插件出口而变。开关只记录**用户显式
  关掉**的渠道（缺省读作开），升级不会静默改掉正在工作的出网路径；保存后下一次渠道请求即生效，
  不用重启 Worker。登录、续期、余额查询与推理全部按渠道身份走同一个出口；配置写入经整批校验，
  坏值连同原因拒掉，不会留下「界面关了、实际还在走代理」。(`e1f0b69`)
- **宿主机代理探测脚本** `scripts/wsl-host-proxy.mjs`：经 WSL interop 读 Windows 代理端口，
  对候选地址做真实的 CONNECT 隧道探测，把可用地址写进 `host-proxy.json`；探测失败保留上一次
  可用地址（只有 `--off` 写 null），代理客户端重新打开后网关自己接上，两个方向都不需要重启服务。
  1.8.4 的「宿主机代理只有读取端」由此补齐。(`db495d8`)

### Changed（变更）

- **码道 token 计量与积分分桶**：同渠道下积分版账号与老 token 版账号是两种计量口径
  （`usageTotalPackageCredit` 与 `usageTokenChatMessages`，上游每项自带 `show`），元数据里的
  `CreditBalance` 现在带 `unit`；渠道总额只累计积分，token 账号的读数在明细行各自带单位显示，
  两种口径同时出现时卡片显式说明「不折算、不相加」。归并逻辑移到 `shared/channels.ts` 的纯函数
  `summarizeChannelCredits`，桌面与远程页面用同一份实现。(`e1f0b69`)
- **日志页列表撑满窗口**：虚拟列表此前按「条数 × 行高、封顶 600px」定高，窗口再高下方也留白；
  现在量容器实际高度并用 `ResizeObserver` 跟随，页面骨架改成可选的整高 flex 列。(`3696700`)

### Fixed（修复）

- **码道老 token 版账号的额度被整条丢掉**：原实现先判账户类型，token 计费账户一律回
  「Token 计费账户，无积分余额」，明明拿到了 token 配额却按错口径丢弃。现在先按读数判：有积分报
  积分、没有积分但有 token 配额报 token，主数字只放一个口径，另一口径以说明行给出。
  (`e1f0b69`)

### Tests（判据）

- `tests/channels/channel-system-proxy.test.ts`：缺省读作走代理、读侧归一/写侧整批校验、关闭后
  环境代理与插件出口都不碰、打开/缺省走代理、未绑定 `fetch` 不受任何渠道例外影响、失败文案的
  路由段说清「该渠道已关闭系统代理」。(`e1f0b69`)
- `tests/channels/codearts-token-quota.test.ts` / `credits-unit-fold.test.ts`：token 项按上游
  `show` 读、配额位占值 `1` 不产生负剩余、两种口径分桶不相加、渠道级说明只在混用时出现。
  (`e1f0b69`)
- `tests/channels/host-proxy.test.ts`：坏文件/缺文件按「没有代理」而非报错、存活探测丢掉过期
  地址、`NO_PROXY` 对文件也生效、失败文案点名「宿主机代理」。(`db495d8`)
- 两处钉旧调用形状的源码断言按新实现更新（`tests/channels/catalogue.test.ts` 的
  `apply(ctx, { systemProxy })`、`minimax-refresh-selfheal.test.ts` 的按渠道出口）。(`e1f0b69`)

### 未取读数

- **只在 WSL 宿主上跑过门禁**：`npm run gate` 全绿（2191 个测试、0 失败、两套 tsc 零错误），
  没有在 Windows / macOS 安装包上各起一次验证。
- **开关没有实机点过**：本机无图形环境，界面只经类型检查、构建与测试覆盖；「关掉开关后某渠道
  真的换成本机直连出口」没有在真实客户端上对比过出口 IP。
- **探测脚本本轮未重跑**：`scripts/wsl-host-proxy.mjs` 的读取端契约有测试，脚本自身的探测与
  写盘依赖真实宿主机代理，未在发布前复跑。

## [1.8.4] - 2026-11-11

版本边界：tag `v1.8.4`（相对 1.8.3）。三块面向界面的变化：**模型管理页每个模型都能单独测试**、
**聚合条目的「同步模型」变成真同步**（删作废、加新增）、**页面不再限制 1280px 宽度**；另含一批
渠道账号续期/身份/出网修复。

### Added（新增）

- **模型管理页逐模型「测试」**：每行一个按钮，点一次发一条最小真实请求（`ping` +
  `max_tokens:1`），成功显示延迟、失败显示原因（无可用账号 / 渠道运行时未启动 / 缺 Key /
  上游状态码等，不再是一句笼统的「失败」）。聚合条目复用详情页那条带 Key 轮换的探测；渠道与
  自定义供应商走生产转发路径，端点、鉴权、报文形状与真实流量一致。请求带 `probe: true`：
  不进派发账本、不更新 AIMD/Bandit、不写冷却、不计入成功率，一次手动测试不改变路由判断。
  别名行没有固定供应商时按钮禁用并说明原因。(`61e7976`)

### Changed（变更）

- **模型状态列「可用」改为「启用」**（英文 Available → Enabled）。三种状态仍是各自的语义：
  启用 / 不可用（已启用但该供应商没有活跃账号）/ 未启用（被停用）。(`61e7976`)
- **页面宽度自适应**：内容容器此前固定 `max-w-[1280px]`，宽窗口两侧留白；现在只保留内边距，
  所有页面用满窗口宽度。窄屏行为不变。(`61e7976`)
- **聚合条目「同步模型」改为真同步**：上游自己答了 `/models` 时，按上游清单双向对账——它不再
  报告的模型从目录里删掉，新报告的直接加进来（现有顺序保留）；探测失败退到 models.dev 目录时
  仍只增不减（第三方目录缺一行不能证明上游下架），同步提示会写明本次是否删除。不删到空；
  存活模型的每模型参数原样保留，被删模型的参数随清单裁剪，其停用标记一并清掉（将来重新上架
  不会一进来就是停用态）；账号与 Key 不受影响。同步结果提示新增与移除的数量。
  (`61e7976`)

### Fixed（修复）

- **MiniMax 账号静默过期 5 天**：批量续期原先按账号池里的 `refreshable` 布尔过滤，而这个值一旦
  被某次失败写成 `false`，定时器就每 30 分钟静默跳过、一行日志都没有——邮箱里还躺着可用的
  `refresh_token`，面板只能显示「余额查询失败」。现在判据读凭据本身（看得见 `refresh_token`
  就尝试），池值与凭据不符时只记日志；续期被拒时先确认磁盘上的凭据是否已被并发请求更新
  （refresh_token 会轮换，服务端拒的可能是旧的那一份），避免一次交错把好账号永久标死。
  (`bbdac25`)
- **MiniMax 余额查不到时只说「查询失败」**：余额请求改走渠道自己的出网出口，并区分凭据失效 /
  网络 / 响应形状三种失败原因，卡片显示原因而不是笼统一句；「查不到」与「余额为 0」仍然分开。
  (`bbdac25`)
- **CodeArts 重复登录判不出来、账号名认不出**：凭据里的 `access_key_id` 是临时 STS 凭据
  （小时级过期，每次登录换发），拿它做判重永远判不出。改为从 `refresh_token` 的
  `user_profile` 解出稳定的 `account_id` 与华为云账号名；登录时固化，存量凭据在启动时先补身份
  再跑通用判重（重复账号只停用、不删除，凭据不可重建）。(`bbdac25`)
- **WSL/NAT 下渠道访问不了宿主代理**：WSL 与 Windows 不共享 loopback，宿主 Clash 只监听
  `127.0.0.1` 时渠道全部出网失败。渠道出网新增「宿主机代理」一级：读数据目录下的
  `host-proxy.json` 并对代理端口做存活探测；文件缺失、值为空、探测失败一律退回直连，不会把
  「宿主代理没开」变成全渠道故障。(`bbdac25`)
- **一次故障把并发打到 1 后起不来**：每模型 AIMD 的并发下限从 1 提到 2、乘性降速的最小间隔从
  5s 提到 30s。2026-11-11 codearts 实测 23s 内四连 502 就把 4→2→1 打穿，此后一条卡首字的慢流
  占死唯一名额，恢复条件要数分钟才够得到。另外本地准入拒绝现在每 (账号, 模型) 10s 补一条状态
  快照 warn（inFlight / 首字 EWMA / 限流率），排障不必再从请求行时间差反推。(`bbdac25`)

### Tests（判据）

- `tests/channels/minimax-refresh-selfheal.test.ts`：池布尔为 false 但凭据可续期时照常续期、
  并发重放不标死账号、凭据确实缺失才写 false。(`bbdac25`)
- `tests/channels/codearts-identity.test.ts`：从 refresh_token 解出稳定身份、旧票据凭据/损坏
  载荷一律回退不抛错。(`bbdac25`)
- `tests/channels/minimax-credit-errors.test.ts`：401 映射为凭据失效、网络与形状错误各自成档。
  (`bbdac25`)
- `tests/store/model-serving-r1.test.ts`：真同步删掉上游不再报的模型、加入新报的、保留用户停用
  的存活模型、被删模型的停用标记被清掉、models.dev 兜底不删。(`61e7976`)
- `tests/aggregate/multi-key.test.ts`：`removeMissing` 的对账顺序与空清单语义。(`61e7976`)

### 未取读数

- **只在 WSL 宿主上跑过门禁**：`npm run gate` 全绿（2166 个测试、0 失败、两套 tsc 零错误），
  没有在 Windows / macOS 安装包上各起一次验证。
- **宿主机代理只有读取端**：`host-proxy.json` 的写入脚本（`scripts/wsl-host-proxy.mjs`）不在
  仓库里，当前部署需要外部脚本或手写这个文件；文件不存在时按「没有宿主代理」走直连。
- **模型测试按钮与页面宽度没有实机点过**：本机是无图形环境，只经类型检查、构建与测试覆盖。

## [1.8.3] - 2026-11-11

版本边界：tag `v1.8.3`（相对 1.8.2）。两块内容：**打包安装的主进程错误日志终于进得了应用日志**，
以及**渠道登录不再把一个账号记成两条**；另删除一条从来不会生效的「对话记录清理」开关，仓库也不再
跟踪构建产物。`1.8.0`–`1.8.2` 此前未在本文件成文，按提交标题回填在文末。

### Fixed（修复）

- **安装版主进程的错误只落在没人看的流上**：`src/main` 有 233 处 `console.*`（其中
  `error`/`warn` 136 处），打包后的 Electron 主进程没有终端，这些输出在生产里直接丢失——线上故障
  只剩「已迁移到应用日志」的那部分路径可查。现在 `bootstrap.ts` 装一次桥
  （`src/main/logging/consoleBridge.ts`）：原 console 照常打印（systemd 下的 daemon、
  `npm run dev` 都不变），再脱敏 + 截断后写进应用日志。所有宿主共用同一装配点，新增调用点自动
  覆盖。(`9ecc3c4`)
- **日志持久化失败会自己喂自己**：`AppLogManager` 原本用 `console.error` 报告「写盘失败」，桥接后
  这条错误会变成新日志条目、再次触发持久化、再失败。改为直写 `process.stderr`，终端宿主仍可见。
  (`9ecc3c4`)
- **备份收集失败只剩错误码**：`storage-not-ready` / `write-failed` 的原始原因此前只进 console，
  现在随同一条桥写进应用日志；返回码契约没动。(`9ecc3c4`)
- **重复登录会多出一条账号**：同一上游账号登录两次得到两条独立条目，各自参与选号、各自耗额度，
  界面上像两个账号。`account.create` 现在按服务端下发的稳定标识判重（不用每次登录都会换发的
  `access_token`），移除刚建的占位条目，并把 `duplicate` / `existingAccountId` 回给界面——提示
  改成「该账号已存在，未重复添加」。存量重复账号启动时只停用、不删除（凭据不可重建）。
  (`de306e9`)
- **CodeArts 积分制账号走 benefit 通道必失败**：不带 benefit 包的账号返回 HTTP 200 + SSE 内嵌
  错误，旧实现只在一个特定错误码上去头重试，其余走「直接抛出」，于是既没重试又被报成 502，网关
  按可切换故障把同一目标再投一次。现在「本次确实带了 `maas_type: benefit` 且流内错误未被额度/
  排队分支接住」本身就是判据：去掉该头重试一次；不带该头时同一错误是 404 终态（这个账号供不上
  该模型），不再重投。(`de306e9`)

### Changed（变更）

- **「对话记录清理」开关删除**：它配置的会话表从来没有人写入（`addSession()` 零调用，
  `initialize()` 也没人调），开关改与不改没有区别，却让人以为行为变了。连同 `sessionManager.ts`、
  `sessions` 键、10 条 `session:*` IPC 通道、渲染层面板与两份 locale 一起移除；`config.sessionConfig`
  按退休键在读取时剥离，管理 API 不会再报告一个没人读的开关。(`c967add`)
- **仓库不再跟踪构建产物**：根 `modelport-daemon.cjs`（4.7 MB）与 `renderer/`（51 个文件）是从
  提交 `423ece3` 混进来的产物，早已与源码漂移且没有任何门比对。`bin/modelport` 改为运行
  `out/daemon/`，缺失时提示先 `npm run build:daemon`。(`31fe546`)
- **请求主干的类型收口**：`buildRequestBody` → `Record<string, unknown>`、`extractHeaders(unknown)`
  窄化、`ForwardResult.body?: unknown`、`ApiWire.invoke<T>`。不改行为，只让字段名写错在类型检查
  阶段暴露。(`c967add`)

### Tests（判据）

- `tests/logging/console-bridge.test.ts`：双写（原 console 拿到原文、sink 拿到脱敏副本）、
  `api_key=` 脱敏、sink 自己打印时不回灌、重复 install 幂等、无 sink 时静默降级。(`9ecc3c4`)
- `tests/channels/account-dedupe-wiring.test.ts`：`account.create` 的每个登录分支都接了去重
  （MiniMax 除外——它没有稳定身份值）、判据表里不得出现 `access_token`、存量去重只停用不删除。
  (`de306e9`)
- `tests/channels/codearts-benefit-route.test.ts`：带 benefit 头的流内错误去掉该头重试一次、
  抛出文本带上游 `error_code`、不带该头时同一错误 404 终态、额度耗尽分支优先。(`de306e9`)

### 未取读数

- **只在本机 WSL 宿主上跑过门禁**：`npm run gate` 全绿（2141 个测试、0 失败），但没有在
  Windows / macOS 安装包上各起一次验证桥接后的日志落盘。
- **benefit 判据只来自一份现网抓包**：`APIG.0604` + `The API does not exist ...` 这一种帧。上游
  换错误码时判据仍按「带了头且没被额度分支接住」成立，但没有第二种调用栈可验证。

### 补记：1.8.0–1.8.2（按提交标题回填，未逐条复核）

- **1.8.0**：新增 CodeArts、Comate 两个账号渠道与三家聚合供应商（PPIO、华为 ModelArts Studio、
  Infini-AI）；路由池显示渠道成本权重；模型标注与批量采纳的结果保持可见。
- **1.8.1**：Comate 把 agent 工具桥接成客户端工具。
- **1.8.2**：模型行显示解析后的元数据摘要；Comate 输出结构化 finish reason；发布链路补 Windows
  arm64 产物。

## [1.7.16] - 2026-11-10

版本边界：tag `v1.7.16`（相对 1.7.15）。一块内容：**控制台窗口里的「新窗口链接」不再一律甩给系统
浏览器**——指向网关自身路由的链接在窗口内跳转，只有跨源链接才交给浏览器。另含一条发布链路修复：
`package-lock.json` 里 55 条 `resolved` 指向 npmmirror，把 CI 的 `npm ci` 卡在 502/504。

### Fixed（修复）

- **点内部链接会从应用里跳出去**：`shell/main.ts` 的 `setWindowOpenHandler` 把任何 http(s) 的
  `window.open` / `target=_blank` 都交给 `shell.openExternal`，而页面是 HashRouter SPA、内部跳转本来
  就写成新窗口链接，"打开渠道""打开日志"一点就跑到浏览器。新增 `decideWindowOpen()`
  （`src/shell/openTarget.ts`）：同源且落在 `/ui` 路由 → 发 `shell:navigate` 原地跳转；证书/网关失败页
  （`data:`）上指向 UI 的链接 → 在窗口内重新加载；跨源 → 仍然交给系统浏览器；`file:` / `smb:` /
  `ms-msdt:` 之类直接忽略。(`5e02eea`)
- **发布流水线卡在 `npm ci`**：`package-lock.json` 里 55 条 `resolved` 是本地用镜像安装时写进去的
  （`registry.npmmirror.com`），CI 直连该镜像对 `mime-db` / `mime-types` 持续返回 502/504，`gate` 之后
  的 `prepare` 与四个打包 job 全部 skipped。统一改成 `registry.npmjs.org`，integrity 一字未动。(`f0a13b7`)

### Tests（判据）

- `tests/shell/open-target.test.ts`：同源的 hash 路由与路径写法归一到同一条路由、跨源（含同主机不同
  端口）仍外开、同源但非 UI 路径（`/health`）不装进窗口、`data:` 失败页的重试链接在窗口内加载、
  非 http(s) 协议忽略。(`5e02eea`)

### 未取读数

- **1.7.15 的安装包不含这条修复**：`v1.7.15` 的 tag 冻结在 `f0a13b7`，本条只覆盖 `5e02eea` 之后的构建；
  装了 1.7.15 的机器要重装 1.7.16 才有新行为。
- **只在 WSL 形态的 `/ui` 页面上验证**：判定依赖「页面地址是 `<origin>/ui/`」，桌面端直连本地网关
  时走同一条路径，但没在便携包/远端主机两种入口上各点一遍。

## [1.7.15] - 2026-11-10

版本边界：tag `v1.7.15`（相对 1.7.14）。两块内容：**Dashboard 顶部统计卡片可以按指定日期/区间查看**；
上下文裁剪改为**按渠道点名**，缺省不裁，止住有前缀缓存渠道的命中率回归。配置形态新增一个可选字段
（`contextManagement.channelIds`），升级后裁剪默认关闭，需要裁剪的渠道要显式填进去。

### Added（新增）

- **统计卡片能回答「那几天怎么样」**：总请求数、成功率、平均响应时间、Token 用量共用同一个时间段
  ——今天 / 近 7 天 / 近 30 天 / 全部 / 自定义（两个 `<input type="date">`，起止倒置时给出提示而不是
  悄悄互换）。聚合放在 `src/shared/statsWindow.ts` 的纯函数里，切换窗口只对已取回的日桶做本地重算，
  不重新发 IPC；卡片与 Provider 状态卡共用一份 `StatsWindowPicker`，不再各写一套区间控件。
- 趋势条比较**上一个等长区间**（今天对昨天、近 7 天对前 7 天、自定义对等长的前一段），不再固定拿
  「昨日」当基准；`all` 没有前一段，按「无对比」呈现。(`e95dbd2`)

### Changed（变更）

- **「没有记录」仍然是「—」**：窗口内没有任何已存储的日桶时，请求数、成功率、延迟返回 `null` 并渲染
  `—`/`-`，不写成 0；真正跑过但全部失败的窗口才显示 0% 成功率，延迟仍是无测量。活跃账户数描述的是
  「现在」，不随时间窗变化，因此它没有趋势。(`e95dbd2`)
- `scripts/deploy-wsl-daemon.sh`：从 `systemctl cat` 反解安装目录的 WSL 网关替换脚本（停服 → 覆盖
  `modelport-daemon.cjs` / `resources` / `renderer` → 启动 → 轮询 `/health`）。默认**不**备份；
  `MODELPORT_BACKUP=1` 才先复制整目录并在失败时回滚。`bin/modelport` 与它一并补上可执行位。

### Fixed（修复）

- **裁剪把有缓存渠道的命中率打到 59%**：`forwarder.ts` 里裁剪的门只有
  `contextManagement.enabled`，而 slidingWindow 每轮把切点后移、历史前缀逐轮变异，DeepSeek 系的隐式
  前缀缓存因此全灭——bailian / loomy / raccoon 实测命中率从 97–98% 掉到 59–60%，TRAE 这类本就没有
  缓存的渠道反而不受影响。现在 `ContextManagementConfig` 增 `channelIds?: string[]`，只有被点名的
  渠道会走裁剪；缺省或空表示**谁都不裁**，`enabled: true` 也不再全局生效。判据收敛在
  `trimAppliesToProvider()`，控制台面板同步加作用域输入框。(`e95dbd2`)

### Tests（判据）

- `tests/shared/stats-window.test.ts`：日键跨月步进、闭区间长度与倒置、上期等长（`all` 无上期）、
  空窗口返回 `null`、实测 0% 与「未测量」的区别、Token 合计不携带半份 per-provider/per-model 拆分。
- `tests/proxy/context-trim-scope.test.ts`：缺省/空名单不裁、点名才裁、名单外的渠道不裁。(`e95dbd2`)

### 未取读数

- **统计窗口没有在 macOS / Windows 壳的实机上逐预设点过**：判据是纯函数单测与桌面端 dev 构建的人工查看；
  自定义区间的 `input[type=date]` 在 Chromium 各平台的弹层差异未单独核对。
- **本地安装以手动部署为准**：WSL 侧的 `/root/mpd` 由 `scripts/deploy-wsl-daemon.sh` 替换（需要 root，
  脚本自带停服 → 覆盖 → 启动 → `/health` 探活）；桌面侧装本次 Release 的安装包。程序内更新走
  `electron-updater` → GitHub Releases，本机若开着系统代理却没有代理进程监听，会以
  `net::ERR_CONNECTION_REFUSED` 失败——这是网络环境问题，不是包本身的问题。

## [1.7.14] - 2026-11-09

版本边界：tag `v1.7.14`（相对 1.7.13）。一块内容：**网关管理从独立窗口搬进控制台**，成为
`/gateways` 页面；admin 通道的调用方校验按文档来源分开。非破坏性升级，地址簿、已保存口令与
通道数据形态不变。

### Added（新增）

- 控制台的 `gateways` bridge surface 与 `shell:navigate`：页面自己重读快照、自己派发动作，
  不再需要宿主另外开一块窗口。(`4fa5e97`)

### Changed（变更）

- **网关管理是控制台里的一页**：`pages/Gateways.tsx` 与其它页面共用外壳，侧边栏底部新增入口
  （只在控制台里注入 `window.modelportShell.gateways` 时出现，浏览器打开同一页面时不显示）；
  托盘与 `Ctrl+Shift+G` 先用 `shell:navigate` 把当前窗口带到 `/gateways`。只有主窗口当前不是
  控制台页面时（例如网关打不开的失败页）才退回原来的 `data:` 列表窗口——那是这种时候唯一
  还能工作的界面。(`4fa5e97`)
- **admin 通道按文档来源分别校验**：`data:` 列表窗口按身份信任（origin 由构造决定为 `null`）；
  控制台页面是网关托管的远端文档，每个 `shell:gateway-*` 通道都必须与更新动作一样用
  `activeGatewayForSender(event)` 证明自己是**当前网关**的页面，否则拒绝。(`4fa5e97`)

### Tests（判据）

- `tests/shell/gateway-manage.test.ts` 改为逐条点名 admin 通道并核对其校验，另覆盖页面到
  bridge 方法的分流、侧边栏入口的注入条件、部署指南不把导航留在控制台文档里。(`4fa5e97`)

### 未取读数

- **没有在真实 WSL / 远程网关上重放整套动作**（连接、安装、升级、卸载）。这次只换了宿主文档
  与调用方校验，通道实现本身未改；判据是单测与 1.7.13 已实测的通道行为。

## [1.7.13] - 2026-11-09

版本边界：tag `v1.7.13`（相对 1.7.12）。两块内容：HTTPS 证书信任改到**控制台本机**执行、
面板按主机拆开；账号渠道的 TRAE 身份与签到设备号回归、渠道包错误码结构化、流式结束帧顺序修正。
非破坏性升级；`data.json`、地址簿、已保存口令与既有渠道凭据的字段形态不变，只有 TRAE 账号的
`X-Ide-Version-Code` 与签到设备号被重新取值。

### Fixed（修复）

- **「已信任」旁边是仍在拒绝握手的浏览器**：shell 形态下 `tls:install-trust` 跑在监听器所在的
  主机上（WSL 是没有信任命令的 Linux 守护进程，远程是别人的电脑），而面板把那份 `trusted` 画成
  了客户端这台机器的读数。现在信任原语（指纹、探测、安装、移除）抽到
  `src/shared/certificateTrust.ts`，OS 命令经 `TrustRuntime` 注入，网关与控制台共用一份实现；
  控制台自己取 PEM（先 `GET /v1/management/tls/ca`，取不到回落到握手被拒时捕获的那张），落进本机
  `userData/tls` 后才改本机当前用户的根证书库。三个 bridge 方法一律无参数，页面交不进 PEM 也
  指不了路径。面板拆成「网关主机信任」（只读）与「本机」两块，各给自己的 `NODE_EXTRA_CA_CERTS`
  路径；纯浏览器页面不再显示会改别人电脑的按钮。(`81f5257`)
- **https 首连失败是死路**：`certificate-error` 只捕获不放行，连接失败页现在直接给出「安装到本机
  信任并重试」，并按精确 URL 放行这份 `data:` 文档。非自签名证书拒绝装进根库（要信任的是签发它的
  CA），并如实报告而不是跑一次命令。(`81f5257`)
- **TRAE 所有模型一律 4001 `param is invalid`**：`X-Ide-Version-Code` 接的是 `product.json` 的
  `traeVersionCode`（过期常量 `20250325`），而上游按**日期式客户端下限**卡这个头。改为取
  `date` 的构建日期（`YYYYMMDD`，本机 `2026-11-03`）：2026-11-09 实测同账号同请求，只换该头
  `20260805` 被拒、`20260810`/`20261103` 全部通过。这与具体模型无关——报障时是
  `deepseek-v4.1-flash`，换任何模型都 4001。(`c3869bc`)
- **TRAE 自动签到每 30 分钟空转一整天**：9074 的文案「签到人数过多」是误导，它由设备号决定：
  自生成的 32 位 hex 每次都回 9074，换成官方客户端 `storage.json` 里
  `iCubeAuthInfo://icube-dc:<16 位>` 登记的号后立即 `code:0`。9074 与 9095（本机名额已被另一个
  账号用掉）改为终态「需修正设备号」，不再保留 pending 反复重打上游；真正的「人数过多」（非 9074）
  仍按瞬时失败继续补领。(`c3869bc`)
- **渠道包的额度/限流对客户端只是中文散文**：包自己的机读码（`QUOTA_EXCEEDED` / `RATE_LIMIT` /
  `AUTH` / `MISSING_CREDENTIAL`）原本在 `worker.ts` 就被丢掉，只剩 `message`。现在 `code` 与
  `providerRetryAfterMs` 一路带到转发器与路由层：包自己兜的 502 按 429 + `insufficient_quota` /
  `rate_limit_exceeded` 交出，上游真给了 4xx 的保留原状态码与语义，客户端能据此判断「换一条」还是
  「等解禁」。(`c3869bc`)
- **严格客户端把整轮判成 `content_after_finish`**：只回 `reasoning_content` 的上游需要一帧
  content 回填，否则只读 content 的客户端看到空响应；而这一帧原来排在结束帧**之后**（Qoder 的
  `StreamAdapter` 等实测整轮报废）。回填改到结束帧之前，且结束帧发出后一律不再补。(`c3869bc`)

### Added（新增）

- TRAE 账号的「设备号」入口：Channels 页可直接填入官方客户端的 16 位设备号，经
  `channel-pack-rpc` 落进渠道凭据；en-US / zh-CN 补齐 `channels.device.*` 文案。(`c3869bc`)

### Tests（判据）

- `tests/proxy/certificate-trust.test.ts`（指纹形状、非自签名拒绝、Windows 按 SHA-1 精确移除）、
  `tests/renderer/https-machine-trust-panel.test.mjs`（两层面板与两条 `NODE_EXTRA_CA_CERTS`）、
  `tests/build/shell-entries.test.ts`（shell 入口与 preload 产物）。(`81f5257`)
- `tests/channels/trae-device.test.ts`（设备号发现与校验）、`tests/channels/client-identity.test.ts`
  （TRAE 版本码取构建日期）、`tests/channels/auto-checkin-failure-text.test.ts`（设备号终态与
  可操作文案）、`tests/proxy/stream-finish-frame.test.ts`（回填帧在结束帧之前）、
  `tests/proxy/error-fidelity.test.ts`（渠道包机读码映射）。(`c3869bc`)

### 未取读数

- **没有在真实 WSL / 远程部署上重放「安装到本机信任并重试」**。判据是单测与
  `TlsStatus.handshakeRejections` 的取证路径；`certificate-error` 的捕获分支在 Linux 上无法端到端
  验证（那里没有信任命令，面板按 `supported:false` 呈现）。
- **TRAE 4001 与设备号的结论来自逐一换头/换号的实测**（2026-11-09，同一账号同一 token），没有
  覆盖面更广的客户端版本矩阵：上游下限会随时间前移，`TRAE_FALLBACK_VERSION_CODE` 需要跟着现役
  客户端的构建日期更新。
- 门禁读数 2063/2063 绿（`npm run build` 0、`build:daemon` 0、`tsc` ×2 各 0 error）；补齐本机
  `@esbuild/linux-x64` 后才跑得动，缺这个原生包时报的是 193 个环境假红。

## [1.7.12] - 2026-11-09

版本边界：tag `v1.7.12`（相对 1.7.11）。管理面限流按逻辑调用分桶、模型映射表回归用户数据、
渠道页并发与批量积分、Qoder 免费档余额判据。用户别名、地址簿与已保存口令不受影响；升级后
首次读配置时会摘掉同步写进去的机器接线行与「owner 已不存在」的僵尸钉定，用户自己的别名与
点名保留。

### Fixed（修复）

- **远程 UI 把自己打成 429，之后整块管理面一起死**：限流原来按 IP 一个桶、按 HTTP 请求计数。
  Channels 页一次刷新会带 list + 每渠道 credits + autoCheckin + identity 十几个调用，叠加
  5s 状态轮询后 240/分钟被自己的流量打满；被拒之后配置写入、SSE 事件流、备份导入一起失败
  （2026-11-09 日志里 1542 条 429、持续 11 分钟）。桶键改为 `(IP, 逻辑调用)`：RPC 用
  `<channel, args 摘要>`，其余路径用 `方法 + 路径`；同一 IP 仍保留 1200/分钟的全局上限，
  分桶不等于放宽总量。UI 侧按同一键记住窗口释放时间，同键的后续刷新一起等。(`43d5ff0`)
- **映射表被同步整表重写，用户的别名会被下一轮同步抹掉**：聚合与账号渠道的同步都把
  「每模型一行」的接线写进全局 `config.modelMappings` 并整表覆盖。现在接线只写供应商记录
  自己的 `modelMappings` 账本，归属由 `modelServing::derivePreferredProvider` 从
  `<providerId>/<modelId>` 前缀与账本反推；全局表在读侧摘掉三类行：退役名、owner 已不存在的
  僵尸钉定、与账本等价的机器接线行。读不到供应商表（早期启动）时不做批量删除。(`23cecfc`)
- **映射面板教用户写通配键，而运行时只按精确名查表**：`gpt-*` 这类条目从来命中不了任何请求。
  新建时直接拒绝并说明原因；存量通配条目仍然列出（删不删由用户决定），但标红提示它到不了。
  (`23cecfc`)
- **Channels 页首屏 1.7–5.9s**：13 家 `account.list` 原本串行（单次 0.1–0.5s）。现在并发问
  worker，返回顺序仍按目录顺序。(`1743f0d`)
- **一次刷新要发十几笔管理面请求**：新增 `channels:creditsAll`，宿主内并发问完所有已连接
  渠道，对管理面只占一次预算；单家失败是结果里的 `error` 字段，不会让整页失败。(`1743f0d`)
- **并发刷新把目录扫描跑成多份**：结果只在整轮结束才写缓存，并发调用各跑一轮就是多路全量
  扫描。目录扫描加 `SingleFlight`，失效用代次保证旧轮次不回写缓存、也不清理新轮次。(`1743f0d`)
- **Qoder 免费/标准档被余额门控读成「余额为 0」**：该计划的 `userQuota` 是
  `{total:0, used:0, remaining:0}`——本来就不发积分，却和「发放过又烧光」同形。新增
  `qoderPlanGrantsCredits`（任一包 `total>0` 或 `used>0`）：从未发放返回「未知」放行，
  发放过而剩余 0 仍按确凿的 0 拦截。(`1743f0d`)
- **客户端中途断开时请求日志缺收尾**：流在 `client_gone` 关闭时补写 `finishReason` /
  `streamTrace` / `streamTruncated`，日志里能看出上游发到哪儿、有没有给过结束帧；不触发计分，
  保持「既不记成功也不记失败」的口径。(`36c45bd`)
- **`/v1/management/rpc` 的慢请求与 4xx 认不出是哪一次调用**：路由把 `channel` 挂到
  `ctx.state`，访问日志写出 `rpc=<channel>`；限流在路由前拒绝时也写。(`43d5ff0`)

### Removed（退役）

- `ModelMapper` 的 `mapModel` / `getActualModel` / `addMapping` / `removeMapping` /
  `getAllMappings` / `getProvidersForModel` 与私有通配匹配、`ConfigManager.setModelMappings` /
  `resolveActualModel`、两侧同步里的 `writeMappings`：五条读路径各有一套「别名怎么解析」，
  是两套写法长期并存的根源。(`23cecfc`)

### Tests（判据）

- `tests/channels/single-flight.test.ts`（4 例）：并发共享同一轮、结束后重开、失效后旧轮次
  不回写且不清理新轮、失败不粘住。
- `tests/store/model-mapping-table.test.ts`（5 例）：机器接线行被摘；用户别名（改名、点名、
  同名钉定）三种形态都保留；owner 已删的钉定被摘；无供应商表时只做退役检查；
  `derivePreferredProvider` 接住机器行原来的归属。
- `tests/channels/qoder-credit-balance-free-plan.test.ts`（3 例）：免费档不被读成 0、
  发放后烧光仍读成 0、门控两态各自放行/拦截。
- `tests/proxy/management-rate-limit.test.ts`、`tests/renderer/headless-rpc-resilience.test.mjs`：
  分桶键与全局上限、UI 同键等待。
- `tests/proxy/client-abort.test.ts`：改为直接调用生产判据 `readStreamOutcome`
  （原手写副本的正则把引号留在值里，`sawFinish` 也与生产语义相反）。(`36c45bd`)

### 未取读数

- **没有对着远程 UI 重放那次 429 风暴**。判据是日志取证（1542 条 429 / 11 分钟、Channels 页
  扇出）与单测；门禁 2034/2034 绿，但「页面刷新不再自己触发限流」的端到端读数要等下一次
  真实使用。
- **发布前的门禁在本地镜像（`C:\mp-build`）跑，不在共享盘**：共享盘拒绝执行 `esbuild` 与
  原生模块，在那里读到的红是环境假红。

## [1.7.11] - 2026-11-08

版本边界：tag `v1.7.11`（相对 1.7.10）。账号渠道 WorkBuddy（国内版）新增「完成任务领取积分」
的一键领取。非破坏性升级；数据、地址簿与已保存口令不受影响。

### Added（新增）

- **WorkBuddy（国内版）卡片上多一个「领取任务积分」按钮**，就在「领取积分」旁边，点一次把
  该渠道账号池里所有账号**已完成但没领**的成长任务奖励领回。此前只有每日签到一条通路，
  成长中心（网页「Buddy 加油站」那套任务）的积分在控制台里领不到。(`9338053`)
- **能不能领由服务端说，不由客户端猜**。成长任务的状态机是
  `not_accepted / accepted / in_progress / completed / claimed`，本实现只对 `completed` 发领取请求，
  **不替用户接单**（接单只把状态推到 `in_progress`，不做对应行为永远到不了 `completed`，
  发出去就是必然失败的请求）。端点、请求头与字段来自对官方用户中心网页 bundle 的取证 +
  真实凭据实测：三个 host（`www.workbuddy.cn` / `www.codebuddy.cn` / `copilot.tencent.com`）
  返回字节相同的载荷，故沿用既有 `endpoint`，没有新增配置项。
- **积分与能量分开报，不相加**。成长任务每项同时下发 `reward_credit`（积分）与
  `reward_energy`（能量），是两个计数域；结果文案里各说一句、域内求和，界面不会出现
  `+105` 这种既无法与官方界面核对、也还原不出来源的数字。
- **能力位 `growthTasks` 与 `dailyCheckin` 同为必填布尔**。判据同一条先例（v1.5.0 因
  OpenCode 报障而立）：可选字段会被新渠道按「不写 = 有」填进去，界面照常渲染按钮，
  点下去只拿到泛化文案。目前只有 WorkBuddy（国内版）为 `true`，其余 12 家在渠道包
  `onboarding.claimAll` 里拿到的是**可读拒绝**（国际版另有专门一句「没有成长任务接口」）。

### Tests（判据）

- `tests/channels/buddy-growth.test.ts`（10 例）：清单解析（含 `progress` 为 `null` 时**省略字段**
  而不是补 0——补零会把「还没开始」渲染成「0/0 已完成」）、「读不到」返回 `null` 而非空数组、
  请求头正好是官方网页那组且**不发**归属头、只对 `completed` 发 POST、非 0 一律带服务端原文、
  网关 HTML 错误页报「重新登录」而不是 JSON 解析错、`task_code` 转义、两量纲文案与合计。
- `tests/channels/catalogue.test.ts` 新增一条对齐门：目录的 `growthTasks` 必须与渠道包
  `onboarding.claimAll` 实际支持的那家一致，**名单不写死**——渠道包补上或撤掉某家，目录没跟着
  改就直接红。`tests/renderer/channel-claim-action.test.mjs` 补四条同构静态门（条件渲染、
  主进程那一行映射、两处必填声明、两个按钮不共用文案键）。

### 未取读数

- **真实领取那一次写请求没有发过**。取证阶段只做了只读（清单/状态），`claim` 落在用户账号上
  且不可撤，需用户自行点一次或单独授权。因此「领到账」目前只有源码、bundle 与单测证据；
  门禁全绿（2000/2000），但不等于上游读数。
- **领取响应体的字段名与幂等码未取证**。签到端点的 `10001` 不能拿来当成长任务的「已领过」，
  所以非 0 一律按失败上报并原样带上服务端文案——宁可用户看到那句原文，也不替它翻译成成功。
  拿到真实读数后这一档可以收窄。

## [1.7.10] - 2026-11-08

版本边界：tag `v1.7.10`（相对 1.7.9）。会话收尾报错与聚合 DeepSeek 思考回传两处网关侧
缺陷的修复，外加压缩判决的按日取证与 MiniMax 目录校正。非破坏性升级；数据、地址簿与
已保存口令不受影响。

### Fixed（修复）

- **会话结束后客户端报「系统发生异常 请重试」**：`StreamHandler` 里 1.0 时代的
  `[function_calls]` 文本缓冲仍在运行。回答里只要出现形似标记的文本（例如 markdown 链接
  `[stream.ts](…)`），它就把正文扣在缓冲区里，并且连后面的 `finish_reason` 结束帧一起
  压住；客户端读到「流结束了却没有结束原因」，按断流处理（Qoder 报 `code=500`）。该缓冲
  整段删除：正文与工具调用原样透传，结束帧无条件转发。只被它引用的
  `src/main/proxy/utils/toolParser/`（约 1170 行）一并退役。(`ccc48a1`)
- **聚合 DeepSeek 线 thinking 模式 400**：上游返回 `The reasoning_content in the thinking
  mode must be passed back to the API.`。客户端不会回传带 `tool_calls` 轮的思考，而聚合
  线路此前又没有渠道包那套回灌。现在按 `tool_call.id` 缓存我们下发过的思考并在下一轮
  补回（缓存跨响应共享、累积按响应隔离，按行切分不破坏多字节字符）；`auto` 路由把这条
  400 当作可切换失败，直接点名的模型仍返回上游原文。(`ccc48a1`)
- **供应商内容审核 400 的处置口径**：百炼 `data_inspection_failed`（图片涉敏）原样透传，
  不改写 `code`、不换家重试（下一家收到的是同一张图）；视觉能力路由仍只在 `auto` 候选池
  里按 `needsVision` 过滤。新增门钉死透传口径。(`ccc48a1`)

### Added（新增）

- 压缩判决按日计数：每个请求记下每个候选的 `tokensBefore` / `tokensAfter` 与放行结果，
  按 1% / 2% / 5% / 8% / 10% / 25% 分桶（2% 与 8% 分别是 DeepSeek 与 Anthropic 的缓存
  折扣线）。请求日志只留一两天，按日计数才能在日志滚掉之后回答「压缩多久能赢过缓存」。
  (`ccc48a1`)
- 分模型缓存表新增覆盖度说明：窗口跨过本次升级时，早于该功能的日期没有模型拆分，表下
  定量给出「覆盖 N / M 条请求」，不再让明细合计悄悄小于旁边的当日总量。(`ccc48a1`)

### Changed（变更）

- MiniMax（CN）聚合条目：只保留在用的 `MiniMax-M3.1-Flash` 与 `MiniMax-M3`（M2.x 在该
  路由返回 404/2069），补记自动前缀缓存（约 0.1× 读价，官方未给统一倍率）与取证页
  `docs/providers/minimax-cn.md`；聚合目录随之为 89 条 / 568 模型。(`ccc48a1`)

### Tests（判据）

- 新增门：结束帧必达（含 markdown 链接与 `[function_calls]` 字面量、原生 tool_calls 流）、
  reasoning 回灌（端点判定／跨块观测／并发隔离／有界淘汰／非流式）、审核 400 原样透传、
  压缩判决分桶与溢出、分模型覆盖度；全量 `npm run gate`：**1985 通过 / 0 失败，exit 0**
  （2026-11-08）。

### 未取读数

- 三类 400 是否真的消失，需要把本版部署到实际网关后跑真实流量验证；本版只完成代码、
  门禁与文档，没有改动任何已部署实例。

## [1.7.9] - 2026-11-08

版本边界：tag `v1.7.9`（相对 1.7.8）。提示缓存（prompt cache）的读数、命中强化与
DeepSeek 专项。非破坏性升级；数据、地址簿与已保存口令不受影响。

### Added（新增）

- 仪表盘新增「缓存命中（按模型）」：按 `供应商 · 模型` 展示请求数、上游覆盖率、上游输入、
  缓存读与命中率，可切今天／7 天／30 天／全部。没有上游缓存读数的模型显示 `-`，不显示
  0%；顶部仍保留当日全局读数。(`36d5359`)
- 请求日志与按日 token 计数新增逐请求、按模型的缓存读；`cacheReadReported` 区分「上游
  明确报 0」与「完全没报」，分模型命中率只在有分母时显示。(`36d5359`)
- DeepSeek 缓存优先：`compression.cacheFirst` 默认开启，对文档化前缀缓存的供应商跳过
  live-zone 压缩；`autoRouting.cacheAffinityMinutes` 默认 60 分钟，同一会话优先落在同一
  账号与模型。压缩净收益门改为 `1 - c/(1+w)`，未知供应商仍沿用 10%。(`36d5359`)
- Anthropic 显式缓存断点：在工具表末尾、system 末尾、上一轮末尾注入 `cache_control`
  （最多 4 个，只加元数据、不改文本，幂等）。设置页新增开关与 5 分钟／1 小时档；
  DeepSeek 等自动前缀缓存的供应商不受这个开关影响。(`36d5359`)

### Tests（判据）

- 新增门：前缀逐字节稳定（含变异负控）、Anthropic 断点位置与幂等、按模型缓存聚合与
  200 键溢出、缓存优先策略与净收益门；全量 `npm run gate`：**1965 通过 / 0 失败，exit 0**（2026-11-08）。

### 未取读数

- DeepSeek 三组命中率（现状／缓存优先／+亲和）、Anthropic 三轮 `cache_read_input_tokens > 0`、
  7 天压缩净收益分布：需要真实 key 流量，本版未伪造读数。Anthropic 官方文档页在本机被区域
  网关拦截，能力表数值标注为待真机复核（`docs/providers/anthropic.md`）。

## [1.7.8] - 2026-11-08

版本边界：tag `v1.7.8`（相对 1.7.7）。补上 1.7.7 里网关管理入口的可发现性——侧边栏也能进。
非破坏性升级。

### Added（新增）

- 控制台窗口侧边栏底部新增「网关管理」：只在控制台窗口渲染（`window.modelportShell` 由控制台 preload 注入），点击打开同一个网关管理面板窗口；同一页面用浏览器打开（远程网关）或运行在旧版壳里时不显示该条目——那里没有可打开窗口的宿主。托盘、`Ctrl+Shift+G`、菜单栏「视图 → 网关管理…」保持原样。(`337f619`)

### Tests（判据）

- 新增门：侧边栏入口必须挂在桥接上（`openGatewayManager` 为可选方法）、通道在 main 注册、两语言文案在位；全量 `npm run gate`：**1943 通过 / 0 失败**（2026-11-08）。

## [1.7.7] - 2026-11-08

版本边界：tag `v1.7.7`（相对 1.7.6）。本版补齐控制台的多网关管理——面板、WSL 网关的
装后生命周期、远程部署指南——并修掉托盘里两个网关对话框点开即关。非破坏性升级，
数据、地址簿与已保存口令不受影响。

### Added（新增）

- 网关管理面板：托盘或 `Ctrl+Shift+G` 打开一个独立窗口，列出地址簿里的全部网关——形态徽标、运行状态灯、版本与地址，按形态给动作（连接／编辑／删除；本机再加启动／停止／修复，WSL 加安装）。切换只是对 `activeId` 的一次写入，当前网关不给「连接」，点一下不会把页面重载掉；动作文案随快照下发，用户文本一律 `textContent` 写入。(`92e654d`)
- WSL 网关的装后生命周期：已安装的行不再恒显「安装」，按探测到的服务态给 启动／停止／重启／升级／卸载。服务态用一条 `sh -lc` 脚本单次探测（`systemctl cat` + `is-active`），与 HTTP 探测并行且 HTTP 应答优先；卸载先从单元文件解析真实安装目录（手动部署的目录可能不在 `/opt/modelport`），确认框写明**保留 `~/.modelport`**，地址簿条目与管理口令不动。(`20444fb`)
- 逐行升级：托盘与面板行共用 `checkForUpdatesForEntry(entry)`——任何一行都能触发检查与执行；本地行点明「与控制台是同一个安装包」，WSL 行「可一并升级」，未托管的 WSL 行保持「只升级控制台」，远程行不给升级（升级控制台不是管理那台网关）。(`20444fb`)
- 远程网关的「部署指南」：拉 Release feed 列出 x64／arm64 的 daemon tarball 与 `.sha256` 下载链接，给出下载→校验→解包→写 systemd 单元→`enable --now`→`--init-host` 的可复制命令；feed 不可达时降级为 Release 页面链接。控制台没有远程主机的凭据，部署步骤交给操作者，不做遥控。(`20444fb`)
- 渠道模型目录的来源在界面披露：渠道包随目录上报「上游现取／官方客户端缓存／静态兜底」，非上游时渠道行显示徽标、模型面板顶部给整句说明、刷新提示附一行——这份清单能用，但不是现取的，不能画得像正常刷新结果。(`4b07897` `e6c3d3d`)

### Fixed（修复）

- 托盘「添加网关」「编辑当前网关」点开即关：对话框页的取消按钮写成 `onclick = send('cancel')`，赋值拿到返回值的同时调用已经在页面加载时发出，`settle(null)` 立即执行。取消改为函数引用（页面抽成 `gatewayPromptPage.ts`），托盘在窗口隐藏时先 `show()`（模态子窗的父窗不可见时对话框点不动）。(`3c13864`)
- TRAE 刷新模型清单为空：官方客户端改走 RPC 拉目录后，batch 端点只回空组与自定义模型；网关改读官方客户端本机缓存（按账号 UID，只读），合并规则与上游解析共用一个函数，缓存连同来源一起存（30 秒后提醒不会消失）。(`4b07897`)
- MiniMax 签到「积分领取没有完整生效」：令牌过期时上游回 HTTP 401 且响应没有 `base_resp`，旧解析把「HTTP 失败」当成业务成功，最终报「签到响应缺少有效的 claim_result」，自动签到便拿着同一枚死令牌每 30 分钟空转。现在先判 HTTP 状态；凭据失效记成终态「需重新登录」，当天不再重试；`claim_result` 真的缺失时把实际字段名列出来。(`4b07897`)
- 自动签到失败不再合成一句「N 个失败」：分「需重新登录」（终态）／「人数过多」（瞬时，保留 pending 自动重试）／其余；逐渠道文案的闸门改用 `providerDates`，否则任何渠道待重试都会让提醒在下一轮被「今日已处理」覆盖。(`4b07897`)
- WSL 上 WorkBuddy／Qoder／Trae 客户端版本恒显示「落后」：WSL 宿主现在经 `/mnt/c/Users/*/AppData/Local/Programs` 读 Windows 侧安装；WorkBuddy 官方源始终按 win32 身份请求（linux 身份被上游 400）；Qoder 国际版清单优先 `download.qoder.com`（静态站当前不可达）。(`4b07897`)

### Tests（判据）

- 全量 `npm run gate`：**1942 通过 / 0 失败，exit 0**（2026-11-08）。
- 新增门：`shell/gateway-list-plan`（动作矩阵覆盖各形态各服务态）、`shell/wsl-install-plan`（服务态解析、启停重启脚本、注入拒绝）、`shell/deploy-guide`（资产链接／校验命令／转义／降级）、`shell/gateway-manage`（通道注册、卸载确认与数据保留、具名桥接、页面分发）。
- 渠道侧新增：`trae-model-cache`（缓存归一与合并规则）、`minimax-credit-errors`（401 归因）、`auto-checkin-failure-text`（终态与瞬时分档）、`model-source-ui`（来源披露入口与两语言文案）。

### 未取读数

- WSL 启停／重启／卸载只在脚本层断言过（正反向、等 active 的循环），尚未在一台真实发行版上执行整条动作链。

## [1.7.6] - 2026-11-07

版本边界：tag `v1.7.6`（相对 1.7.5）。本版是**破坏性**的发布形态变更：安装包从此是
控制台 + 网关安装器，原「主应用」不再单独发布。

### Added（新增）

- 控制台三形态：本地（同一个二进制以无窗口角色 `--gateway` 起独立网关进程，保住系统密钥库封装的 `store.key`）、WSL（网关装在 WSL 里）、远程（只连接）。窗口一律加载网关自己的 `/ui/`，三种「网关不存在」各自的画面与动作不同。空地址簿首启自动落一条本地网关，安装即等于「取代主应用」。(`2586da8`)
- 网关按需安装：本地形态首启执行 `--init-local`（建数据目录、生成管理口令、起监听），口令经 0600 一次性文件交给控制台密封后删除，用户无需粘贴；WSL 形态在网关不存在时全自动安装——读发行版与架构（`wsl.exe` 是 UTF-16LE）、Node 缺失或过低时装 nodejs.org 官方构建并按 `SHASUMS256.txt` 校验、daemon 包缺 `.sha256` 直接拒绝、写 system 作用域 systemd 单元、执行 `--init-host` 取口令、等 `/health` 应答；任一步失败自动回滚且**不动 `~/.modelport`**。(`2586da8`)
- 渠道页的自动领取签到积分现在显示逐渠道结果，以及「今天还有 N 个渠道未完成，稍后自动重试」；有待重试渠道时用 30s 慢轮询，而不是 5s 空转。(`061f57f`)

### Changed（变更）

- 发布收敛为单产品：删除 `electron-builder.shell.yml` 与 `build:shell`，`package.json` 的 `build` 段成为唯一配置；移除 `publish` 段，**不再产出 `latest.yml`**。CI 三平台各打一条安装包，daemon tarball 单独构建上传，其余资产逐一生成同名 `.sha256` 后 `gh release upload`。在线升级资产名改为 `ModelPort-<ver>-<arch>-setup.exe`。(`2586da8`)
- 安装控制台更新前先停本地网关子进程：两者是同一个 exe，留着它会锁住二进制；安装器随后重新拉起控制台，由它启动新版本网关。macOS / Linux 不再尝试静默安装，明确提示从 Release 页面下载。(`2586da8`)
- 地址簿以形态（`local` / `wsl` / `remote`）取代「允许在线升级此 WSL 网关」开关；旧 `gateways.json` 按 `manageWsl === true ? 'wsl' : 'remote'` 迁移。(`2586da8`)
- 自动签到改为**逐渠道**记账：每个渠道按 UTC+8 记自己的完成状态，失败或声明 `retryLater` 的留在待办，由 30 分钟的重试定时器（`DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS`）只重跑这些渠道；已完成的当天不再发请求，跨日后第一轮重跑全部。(`061f57f`)
- 开发通路改走生产同款传输：控制台窗口加载 Vite 页面，`/v1` 由 dev server 代理到本地网关（HTTP + SSE），不再依赖桌面 preload 的 IPC。(`2586da8`)

### Fixed（修复）

- Qoder 每日额度在 10:00（UTC+8）刷新前被记成「今天已处理」，导致当天新额度整天漏领：刷新前那一轮现在保留为待重试，10:00 之后自动补领。(`061f57f`)
- 自动签到「一个渠道成功就把当天记完成」：失败渠道当天不再重试，也不再有逐渠道结果；现在按渠道记账并按 30 分钟补领，全部完成后的重试轮是零上游请求。(`061f57f`)
- 本地网关的三种失败不再长得一样：未安装（可一键装）/ 已安装未运行（可启动，附退出后的日志）/ 在跑但 `/health` 不应答（列出进程与端口）。端口被占用时网关不会自行换端口。 (`2586da8`)

### 发布（Breaking）

- **主应用发布形态取消**：`ModelPort-<ver>-<arch>-setup.exe` 仍是唯一 Windows 安装包，但它装下来的是控制台；`ModelPort-Shell-*` 资产不再发布。appId 仍为 `com.modelport.manager`，老用户覆盖升级即可，`data.json`、`store.key` 与凭据不受影响。
- macOS / Linux 也出控制台（本地 + 远程形态；WSL 项只在 Windows 出现）；WSL / 无头 Linux 继续用 `modelport-daemon-<ver>-<arch>.tar.gz`。

### Tests（判据）

- 全量 `npm run gate`：**1892 通过 / 0 失败，exit 0**（build + build:daemon + 两个 `tsc` + 全量）。
- 新增门：`gateway-entry`（三产物与动态加载、网关角色无窗口/无托盘/保留密钥库）、`gateway/local-init`（首启计划与握手形态、状态文件拒绝坏数据）、`shell/local-gateway-plan`（未安装/未停止/不应答三态与 argv）、`shell/wsl-install-plan`（UTF-16LE、Node 供给、unit 与脚本同源、init 后才重启、回滚不动数据）。
- 实跑读数：隔离 profile 起 daemon，`/health 200`、`/ 200`、`/ui/ 200`、RPC 无口令 `401` / 带口令 `200`。

### 未取读数

- 本地形态的真机运行（`--gateway` 会读写这台机器的真实 `~/.modelport`，未在作者正在使用的数据上执行）。
- WSL 首装的真机失败路径（无 systemd、无 sudo、端口占用）。
- macOS dmg 的 Gatekeeper 行为与 NSIS 覆盖安装时子进程是否停干净。

## [1.7.5] - 2026-11-06

版本边界：tag `v1.7.5`（相对 1.7.4）。

### Added（新增）

- Windows Shell 在线升级：托盘「检查更新（Shell + WSL 网关）…」和设置 → 关于的「在线升级（Shell + 网关）」卡片可以同时升级 Shell 与标记为 WSL 托管的 daemon。Shell 读 GitHub Release API，下载 `ModelPort-Shell-<ver>-x64-setup.exe` 与 `modelport-daemon-<ver>-<arch>.tar.gz`，每个资产必须带同名 `.sha256` 才允许安装；daemon 安装前备份到 `<install>.bak-<时间戳>`，失败自动回滚，升级前还会比对「本机 WSL daemon 版本」与「网关 URL 报的版本」。(`0703641`)
- 壳安装包在静默安装后自启动：`/S` 会跳过 NSIS 完成页的运行勾选框，`build/installer.nsh` 的 `customInstall` 在静默安装结束时拉起新 Shell，升级后不会留下无窗口/无托盘的进程。(`0703641`)
- 地址簿新增每个网关的「允许 Shell 在线升级此 WSL 网关」开关（`manageWsl`，默认关闭）与 `wslDistro`；远程网关只升级 Shell，daemon 仍在宿主机手动升级。(`0703641`)

### Fixed（修复）

- 管理面自限流：8 小时窗口里 71 条 429（09:01 一分钟 50 条）都来自远程 UI 自己的刷新风暴。限额从 60/分钟提到 240/分钟，客户端对相同 `channel+args` 做在途合并并对 429 按 `retryAfterMs` 退避一次；Channels 的 `changed` 事件 1.5s 去抖、积分 fan-out 10s 节流、自动签到/登录轮询 2.5s→5s，ProxyStatus 5s→15s。(`0703641`)
- 首块后停摆不撤粘性：`qodercn/dmodel` 在 09:13/09:15/09:19 三笔都是 `reason:"sticky"`、`totalMs` 132s/182s/156s，超时只记了账号失败却没撤锚点。现在 `timeout` 与上游 `error` 也撤粘性，`client_gone` 保持不撤。(`0703641`)
- 上游目录缺失模型冷却：ModelScope/BazaarLink 的静态目录会把已下架模型一直当候选（8 小时里 ModelScope 11 次 400、BazaarLink 10 次 402）。命中窄口径目录缺失文案后，对 `(provider, model)` 记 6 小时冷却；只影响选路，不记账号故障，不影响 `/v1/models` 广告。(`0703641`)
- 日志 redaction 误伤：`missing_api_key: API key is required` 被键值对规则改成 `"[REDACTED]" key is required`（15 条 401 全是这个形状）。规则加词边界后不再命中 `missing_api_key` 内部的 `api_key`；正常 `api_key=...`/`x-api-key: ...` 不受影响。拒绝行同时补 `userAgent`，下次能直接指认未带 Key 的客户端。(`0703641`)
- 日志降噪：keychain 不可用的 stdout 警告只报一次；`desktop-only` 403 降为 info 且不写访问日志。(`0703641`)

### 发布

- CI 在 shell 与 daemon 步骤生成并上传同名 `.sha256`；`latest.yml` 仍然只有主应用一份，Shell/daemon 走 GitHub Release API + `.sha256`，不产生第二份更新描述文件。(`0703641`)
- 本版是首个带 Shell/daemon `.sha256` 资产的 Release；1.7.5 之前的 Release 没有校验文件，在线升级会拒绝安装并提示缺少校验。(`0703641`)

### Tests（判据）

- 全量 gate：**1852 通过 / 0 失败**，两个 `tsc` program 零报错；新增 Shell 更新计划/接线、About 合并升级、目录缺失冷却、粘性撤锚、redaction/UA 等测试。(`0703641`)
- 线上验证：壳桥接真实返回 `shell 1.7.4 / gateway 1.7.4 / managed:true`；用本地 1.7.5 假 Release 跑通完整升级（`daemonUpdated:true, shellUpdated:true`，daemon/Shell 均变为 1.7.5），随后恢复到 1.7.4；静默安装器自启动实测 `BEFORE=0 → AFTER=4`。(`0703641`)

## [1.7.3] - 2026-11-04

版本边界：tag `v1.7.3`。

本版每一项都由运行实例的证据驱动，不是预防性加固；证据数字写在各条里，可对着 `docs/audit/DEFECT_ANALYSIS_REPORT.md` 复核。

### Added（新增）

- 管理 API 速率限制：只作用于 `/v1/management` 前缀，按客户端 IP 计固定窗口，默认 60 次 / 60 秒，挂在鉴权之前（所以计数键只能是 IP）。理由不是「本地可信」，而是本机任意进程都能直连回环端口 —— 一段 `while true` 的脚本就能把含 `PUT /config` 的管理面打到主进程忙不过来，而这台机器上同时还在跑用户真正的推理流量。(`a966a57`)
- 账号渠道的服务清单预检：请求进入路由前先问渠道包「这一家愿意服务这个模型吗」，本地必败的名字不再打上游。带成功 30s / 失败 5s 的 TTL 与过期宽限期 —— 预检在选路热路径上，而一次 `bridge.models()` 的 RPC 上限是 120s，在请求路径上等目录读取等于把「一次本地必败」换成「一笔可能卡两分钟的请求」；所以过期只触发后台刷新，宽限期内旧清单照用，超过宽限期按未知处理（不剔除）。渠道包整组缺席记 `null` = 未知并放行，一次目录故障不许把整池打死。(`a966a57`)
- 未申报工具名诊断：客户端报 `Model generated invalid tool call: finish` 时，网关侧每笔都是 200、`endReason=done`、`sawDone=true` —— 是上游模型自己造了一个不在 `tools` 里的名字、客户端按自己的工具表拒收，而请求日志不记工具名，事后判不了这个案子。现在把「请求声明集」与「响应里真实出现的名字」的不一致记进日志。**纯观测**：不校验、不丢弃、不改写任何响应字节。(`a966a57`)
- 被网关拒绝的请求也进请求日志：这类请求没到供应商、没有路由记录，同一块面板上「客户端一直报错」与「这里没有流量」原本读不出因果关系；现在每笔拒绝带方法、路径、状态码、错误码与被点名的模型。(`a966a57`)

### Changed（变更）

- 主进程调试输出默认静默：打包后的主进程没有终端，`console.log` 只落进平台 stdout 捕获，Windows 上任何能读进程输出的程序都能看到账号名与映射到的模型名一类运行期情报。只在 `MODELPORT_DEBUG=1` 或 `NODE_ENV=development` 时输出。判据用 `=== 'development'` 而不是 `!== 'production'`：打包产物里 `NODE_ENV` 根本没设置，反向判断会让生产环境恰好落在开启分支上。(`a966a57`)
- 配置脱敏收进一个递归工具，管理 API 的 `/config` 响应不再自己写一份规则：敏感键在管理面响应、诊断包与应用日志三条出口上按同一套规则变 `***`。(`a966a57`)
- 探测新增两道纯判定 —— 模态闸门与确定性失败的终局结论。当天的读数里 100 条错误请求行有 73 条是 `kind:'probe'`，且按 provider 100% 全失败：SiliconFlow 32/32（上游原话 `Model does not exist`）、ModelScope 30/30（403 邮箱未验证）、讯飞星火 8/8（500 `AppIdNoAuthError`，而该 provider 当时 `enabled:false`）、阿里云百炼 2/2（400 产品未开通）。规划层此前每轮都重探这些条目，因为它只看「这个字段还没测出来」。终局结论只回答「当前能不能服务」，**永不**折成上下文窗口或输出上限，也永不进路由候选筛选与对外广告；缺席即未知、未知放行，判据只认已声明字段与 `declared` 置信度。(`a966a57`)
- 供应商状态巡检加进程内 5 分钟 TTL：Dashboard 每 60s 全量巡检 23 个 provider，等于每分钟 23 次整份 940KB 加密 store 的序列化 + 加密 + 原子重命名落盘，外加约 10 次真上游 `GET /models`；一天因此写下 3829 行 `Update provider` 日志，并有 1130 条 `slowRequest`（>1500ms）告警与这 23 连发全量写盘同时段集中。健康是分钟级够用的指标，不是实时量 —— 状态真的翻转时，请求路径上的 failover 会立刻体现。(`a966a57`)
- 标注页的覆盖口径重定义为「关键属性完整 / 待补」：分母只算适用行（聚合与自定义行的倍率不适用，不计入缺口），第三方旁表一类参考项单列为「参考」，不再把「只剩参考项没填」的模型说成不能路由。(`a966a57`)

### Tests（判据）

- 新增 108 条测试（门禁总数 1575 → 1683，本机全量 **1683 通过 / 0 失败**，两个 `tsc` program 零报错）：管理面限流、未挂载路径的 404、配置脱敏、探测模态闸门与终局处置、账号渠道服务前预检（含命名模型那一支）、provider 状态巡检缓存、未申报工具名审计。`koa-ratelimit` 作为新增运行时依赖同时进 rollup 的 exclude 名单与 `tests/build/main-bundle-deps.test.ts` 守卫 —— 外部化它会让安装包启动即 `ERR_MODULE_NOT_FOUND`，与 1.4.5 那次外部化 `electron-store` 是同一个坑。

### 文档

- 缺陷分析报告从仓库根目录归入 `docs/audit/` 并接入文档索引；10 份状态为现行的文档适用版本对齐到 `package.json` 的当前版本，消掉原先 8 份写 1.7.1、2 份写 1.7.2 的漂移。

## [1.7.2] - 2026-11-04

版本边界：tag `v1.7.2`。

### Added（新增）

- 模型元数据分层解析链（v1.7.1 首发，本版延续）：模型类型、输入模态、`vision` / `tools` / `reasoning`、上下文窗口、输出上限、消耗权重与免费位由一条带来源、置信度与 `asOf` 的解析链给出，优先级为**人工标记 > 上游声明 > 标准库 > 实测探测 > 家族规则 > 成本台账**；同字段取第一条有值的层，缺席不写默认值，权重与免费位拿不到就是 `unclassified`，绝不折算为 0。(`dd8bc97`)
- 标准模型库补全：models.dev / LiteLLM / OpenRouter 快照台账之外，抓取新增端点回退（主站失败依次尝试 jsDelivr 与用户配置的镜像，镜像只接受 https）与随包内置的 LiteLLM 快照 `resources/catalog/litellm.json`，全新安装、离线或三个端点都不通时仍有一份可用的候选台账；采用仍按字段写入 adoption ledger、可单字段或整模型撤销，标准库的许可与价格只作展示，不进入路由打分或计费。(`ed61a55`)
- 「全部补齐」重做为真正的后台批量任务：任务由主进程持有，同一时间只跑一份；界面只订阅进度，关掉再打开仍是同一份快照。支持暂停 / 继续 / 取消、失败项单独重试、断点续跑，自动跳过已停用或没有被任何路由引用的模型；探测是显式一次性开关，确认总量后不再逐模型弹窗。阶段、已处理数、成功 / 跳过 / 失败、已采用字段与探测用量都可见。
- 探测能力（v1.7.1 首发，本版延续）：上下文按 `4k→200k`、输出上限按 `1k→32k` 阶梯向上试，给出「≥64K, <128K」式区间结论；429 / 401 / 403 / 5xx / 网络错误 / 超时一律 `inconclusive` 且不写上限，本地准入与额度闸门记 `deferred`；探测流量与真实流量隔离，不记账、不计统计、不触发冷却。(`dd8bc97`、`713dc51`)
- 实测探测读数参与选路：探测层插在「标准库采用」与「家族规则」之间，带窗口的长请求会在本地淘汰装不下的候选，而不是发出去吃一次上游 context 类 400 再换家；过期行与非 `measured` 行不进入这一层。每轮响应新增 `X-ModelPort-Context-Window`，中途换到更小窗口的模型时客户端可据此调整压缩时机。(`f16f5aa`)
- 完整备份与迁移：设置 → 数据安全新增整份导出 / 导入，覆盖供应商、账号与解密后的凭据、配置与路由、模型标注、标准库采用台账、渠道登录态，可选统计、Token 账本与日志；支持明文与口令封装（scrypt + AES-256-GCM），导入前给出文件自带的计数预览，支持覆盖与合并两种语义。覆盖模式落库前先留 `data.pre-restore.<时间戳>.json`。导入必须重启后生效。

### Changed（变更）

- 对外广告的判据从「按来源标签放行」改为「按误差方向放行」：人工标记、上游声明与 `probe` 的实测下界可以承诺给客户端；家族规则、标准库快照与第三方旁表只进路由内部与界面。要对外承诺某个标准库值，通路是把它改写成人工标记。`AutoRouteDecision` 因此并排 `contextWindow`（日志与界面）与 `advertisedContextWindow`（响应头），两者不许互换。(`f16f5aa`)
- LiteLLM 抓取口径收窄并补诊断：`mode` 只保留 `chat` / `vision`（缺 `mode` 的旧条目按对话模型保留），输入 / 输出上限按字段直取、不做二次推断；重定向改为手动逐跳跟随（不把凭证带去跨域目标），失败结果按每次尝试记录 `attempts`，界面能显示每一跳失败在哪。
- 标准库镜像地址在配置写入侧清洗：只接受 https，非法或非字符串一律丢弃，管理 API 不会报告一个没人读的值。

### Fixed（修复）

- 批量补全的部分成功不再被当成整体失败：成功 / 跳过 / 失败三态分别累计并汇总，单个模型失败不中断整轮。
- 标准库采用台账的归属键补上供应商与显示名：同名模型跨供应商时不会再串台，撤销只影响对应的那条采用。
- 探测相关的网关自撰文本纳入 `GATEWAY-TEXT` 登记与两向对账测试，避免新文案绕过受控集合。
- 探测任务裁剪改按 `startedAt` 排序并优先删已结束任务；所有任务都在跑时按上限收敛最旧记录，但只移除可查询性、不中断真实请求。进度广播对每个窗口单独 `try/catch`，单个窗口销毁不再打断推送。
- 跨平台测试稳定性：调度器测试改用注入的假时钟，换行断言先规范化 CRLF 再匹配，Windows 检出不再因时序与换行失败。(`7da99be`)

### Tests（判据）

- 新增标准库解析、端点回退、adoption 归属、批量补全三态与断点续跑的测试；`tests/backup/` 覆盖备份格式解析、口令封装 / 解封与落库前清洗三条纯逻辑路径。备份的 UI 流程（原生选文件、覆盖 / 合并确认、重启）没有自动化测试，只有主进程编译与手工核对覆盖。

### 适用范围与已知限制

- 备份文件含**明文**账号凭据；不带口令导出的文件应视为敏感数据。`store.key`、会话、额度账本与 `derived/` 快照不进入备份，导入后需要重新登录渠道或等待快照重建。
- 合并模式本地优先，统计、日志与渠道登录态不落库（统计相加会把同一批请求记两遍，渠道包是整份替换语义）；需要完整状态时用覆盖模式。
- 备份线目前只有纯逻辑测试，端到端导入流程未纳入 CI。

## [1.7.1] - 2026-11-04

版本边界：tag `v1.7.1`（重发；首个 1.7.1 的 tag 指向 `70eb487`，那一批 17 个产物已作废）。

### Added（新增）

- 模型元数据自动标注：模型类型、输入模态、`vision` / `tools` / `reasoning`、上下文窗口、输出上限、消耗权重与免费位不再只靠人工逐条填，改由一条带来源、置信度与 `asOf` 的解析链给出，优先级为**人工标记 > 上游声明 > 标准库 > 实测探测 > 家族规则 > 成本台账**。同字段取第一条有值的层，缺席的层不参与、不写默认值；权重与免费位拿不到就是 `unclassified`，绝不折算为 0。模型页新增「标注」标签页，逐属性显示取值与出处。(`dd8bc97`)
- 手动探测：对单个模型发可达性、工具调用接受性、图片输入接受性三条极小请求；上下文窗口按 `4k→200k`、输出上限按 `1k→32k` 阶梯向上试，取首个明确超限档的前一档为下界、失败档为上界（如「≥64K, <128K」）。发请求前界面确认框给出「请求条数上限 + 输入/输出 token 预估」，用户确认后才发；命中家族规则或声明推定值时只试相邻三档。429 / 401 / 403 / 5xx / 网络错误 / 超时一律记 `inconclusive` 且**不写任何上限**，本地准入或额度闸门命中记 `deferred`，不抢占真实流量、不触发冷却。已有声明级来源的模型默认跳过并明示「已声明，无需探测」，`force` 才重测且只新增 `measured` 证据。(`dd8bc97`)
- 探测流量与真实流量完全隔离：探测请求带 `probe: true`，跳过派发账本、AIMD/Bandit/冷却与上下文裁剪；请求日志行标 `kind: 'probe'`，不计入请求统计。全局串行队列保证同一模型串行、跨模型并发上限 1。(`dd8bc97`)
- 探测有可见进度、可取消、有超时上界：探测登记为主进程的后台任务，弹窗显示阶段（准备 / 第 N 档 / 等待响应）、已用秒数与已发请求数/上限，并提供「取消探测」——取消只停止后续档位，已完成档位的结论照常保留；关掉弹窗再打开会回显同一个任务（`providers:getProbeJobs` 回读进行中与最近完成，进度经 `providers:probeProgress` 单向推送）。超时显式分两段：单请求 30s、整体 5min，超时一律按 `inconclusive` 收敛而不无限等待；401/403、429、5xx、网络不可达与超时在界面上分别成句（鉴权失败 / 被限流 / 上游错误 / 网络不可达 / 上游超时）并各自给重试入口，不再是一句笼统的失败。(`713dc51`)
- 一键补全：待标注队列新增统一入口。预演**只读本地标准库候选、不联网**，先列出模型数、预计采用字段数、探测请求条数与 token 合计，逐模型可勾选——`exact` 默认勾选、`alias` 提示确认、`family` 默认不勾选。执行跨模型串行（并发 1）、可暂停可取消，逐模型显示待处理 / 匹配中 / 探测中 / 已完成 / 跳过 / 失败，单个模型失败不中断整体，结束后汇总成功/跳过/失败。采用仍是逐字段写入 adoption ledger、可撤销；已声明字段（含人工标记）不进入候选采用列表。(`713dc51`)
- 标准模型库：新增 models.dev（主）、LiteLLM、OpenRouter 三个可选来源的快照台账，落盘 `~/.modelport/derived/model-catalog.json`，属可删除重建的衍生数据。打开页面不联网——唯一的网络路径是用户点击的「刷新」；刷新失败（非 2xx、超时、JSON 损坏、解析为空）保留磁盘上的上一份快照；写入用唯一临时文件 + rename 且只覆盖被刷新的来源。外部数据逐字段校验（正整数、上下文 ≤1 亿、输出上限 ≤100 万、价格 0–1000 万 USD/1M、模态只接受已知集合），元数据字段缺一即整份降级为空台账，界面显示「尚未抓取」而不是报错。失败结果带 `errorKind`（`network` / `timeout` / `http` / `parse` / `empty`）与耗时：HTTP 非 2xx 附响应体前 200 字符，网络失败带 `cause.code`，超时写明 60s 上限；界面按来源分别显示原因，单个来源失败既不影响其它来源也不清空整份快照。(`ed61a55`、`713dc51`)
- 按字段采用、可撤销：采用记录写在 `data.json::catalogAdoptions`，与手工标注 `userModelMarks` 语义分开，同步与快照刷新都不会擦除；同 `(供应商, 模型, 字段)` 只留一条，重复采用覆盖旧值。可撤销单字段或整模型全部字段，撤销后立即回退到自动解析结果。auto 路由的候选过滤与打分只消费已采用的条目，快照里未被采用的候选不参与；标准库的价格与第三方许可只作展示，永远不进入路由打分，也不参与计费。(`ed61a55`)
- 渠道包模型清单同步除 `context_window` 外也读取 `max_output_tokens`（同样只认上游明说的数，缺失保持未知）；路由池编辑器补上输出上限的人工标记入口，留空即「未标注」，非数字 / 0 / 小数 / 超上界都被拒绝并给出原因。(`dd8bc97`)
- 仓库治理面补齐：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、PR 模板、Dependabot、`CODEOWNERS`、`.editorconfig`、`.nvmrc`；`package.json` 补 `repository` / `bugs` / `keywords`；CI 与发布工作流统一从 `.nvmrc` 读取 Node 24，消掉本地最低版本与门禁版本的漂移。(`05b944d`)
- 文档：`docs/` 按 `design/`（方案）/ `plan/`（计划）/ `audit/`（审计）重组，每份文档补「适用版本 / 最后核对 / 状态」元信息块，索引按「覆盖 `docs/` 下每一份文档、没有孤立文件」重新核对；README 中英双版、代码概览与文档索引统一；新增 `docs/features/` 四篇按功能点成篇的功能手册（桌面界面与更新、HTTPS 与证书信任、日志与诊断、渠道与账号），写行为、必守不变量、配置默认值与代码落点。(`9a82a8c`、`b454fa9`)

### Changed（变更）

- 推定值不出现在对外响应：新增的 `catalog` / `probe` / `family-rule` 三层只进路由过滤打分与界面，`/v1/models` 的 `context_window` 仍只输出声明级事实（供应商官方声明或人工标记），没有时省略键——沿用既有对外门槛，本次把它写进设计文档并让新增层遵守。(`dd8bc97`、`ed61a55`)
- LiteLLM 台账的取数口径收窄：只保留 `mode` 为 `chat` / `vision` 的条目（`embedding` / `rerank` / `image_generation` 这些不是对话模型，混进来只会稀释候选；缺 `mode` 的老条目按对话模型保留），输入/输出上限按字段直取，不做「上下文减输出」之类的二次推断；原始文件约 3.2MB、4,500+ 条，抓取显式跟随重定向并带产品 User-Agent，整体超时放宽到 60s 给慢链路留余量。价格换算固定为「先按上限反推（`max / 1e6`）避免先乘后溢出，再乘 1e6 并保留 6 位小数」，超上限的字段丢弃而不是截断成上限值。(`713dc51`)

### Fixed（修复）

- 调度器与代理测试的两类不稳定：调度器测试此前用真实 `setTimeout` 赌并发时序，换行相关断言又只匹配 `\n`，在 Windows 的 CRLF 检出下必挂。给 `Scheduler` 注入最小时间源接口（生产默认仍是系统时钟，调度语义不变），测试改用假时钟做精确断言；proxy 测试先把源码换行规范化再匹配。(`7da99be`)

### 本版为 v1.7.1 的重发

首个 1.7.1 于 2026-11-04 发布后，`main` 上又落了一批元数据线的收口（探测进度与取消、超时收敛、一键补全、标准库失败分类与 LiteLLM 取数口径），按用户指令以**同一版本号**重发。`package.json` 的 `version` 未变，因此**已装上首个 1.7.1 的机器不会收到更新提示**，需要手动下载本版产物；旧 tag 的 17 个产物已随重发作废。

## [1.7.0] - 2026-11-04

版本边界：tag `v1.7.0`（`326f734`）。

### Added（新增）

- 供应商模型清单定时刷新：账号渠道、聚合目录、内置三类来源收进统一调度器，按天/周/月周期在内存中预热，设置页可选周期；同时修掉 Node `setInterval` 的 2^31-1 毫秒上限问题——1/3/6 月档位此前会退化成每毫秒打上游。(`78c3f13`)
- 路由"份额轮转"：auto 候选链改为整池展开，按 30 分钟滚动窗口内每个（供应商, 模型）的派发次数排序，手动添加的模型不再在第一轮就被同账号的高分模型挤掉；新增 `ModelRoute.fairnessLead`（默认 2、上限 20）可调份额领先档；请求日志新增 `chainLength`/`skipped`，日志里的 10 个候选名不再被误读成"池子就这么大"。(`7d9cd47`)

### Changed（变更）

- 换家循环不再把候选链裁到 `maxAttempts + 3` 家，整条排序结果交给换家：可恢复失败由墙钟预算收口，账号故障由账号上限收口；单次请求最多记录的失败尝试数 8→20。(`7d9cd47`)
- 补齐 BazaarLink 402（credits）的说明文案，并把某渠道"所有通道对该模型均受限"从普通 502 中摘出，避免一家渠道受限就吃掉整个账号故障预算。(`7d9cd47`)
- 客户端识别补充 DSH UA 的 `deepseek-harness` 标识。(`7d9cd47`)

### Fixed（修复）

- 注销定时任务后不再续订 `setTimeout` 链（此前注销后仍会再跑一轮）。(`7d9cd47`)

## [1.6.1] - 2026-11-03

版本边界：tag `v1.6.1`（`42c1697`）。

### Fixed（修复）

- 主进程"选号卡顿"：加密 `electron-store` 每次 `get` 都要整份读盘 + PBKDF2 + AES 解密，选号闸门按候选逐条查询，一次请求约 750 次整库解密并卡住主线程；改为一次选号复用余额快照与账号表，并新增成本门测试。(`3a19a71`)
- 上游目录不认模型（ModelScope / BazaarLink 的文案）时按能力类 400 换下一家，不记账号失败；probe 的错误帧同样保持 400。(`3a19a71`)
- SiliconFlow 官方 `/user/info` 已下线（HTTP 410），撤下其额度探测声明。(`3a19a71`)

## [1.6.0] - 2026-11-03

版本边界：tag `v1.6.0`（`5fe993e`）。

### Removed（移除）

- 网关不再向模型注入任何提示词（裁定：本网关不注入任何提示词）。退役四条通路：托管工具提示词、尾随 user 守卫、输出风格转向、上下文摘要，连同 UI、配置键与测试一并删除；不支持工具的模型改由能力路由（`needsTools`）处理；退役配置键在 `normalizeConfig` 中剥离，管理 API 不再报告没人读取的开关。(`f6b7f1b`)

### Added（新增）

- 协议正确但内容退化的流成为第二类 degraded：对拼接后的 `content`/`reasoning` 增量做尾部 128 行去重比，命中即撤销粘性锚点；读数只以聚合形式落到 `streamTrace.repetition`，非流式响应不参与判定。(`f6b7f1b`)
- 新增日志/搜索压缩器与 CCR 存储接线，压缩节省可被真实计量。(`f6b7f1b`)
- 新增 `GET /v1/api-definition/providers`：以网关自定义形状列出可用路由名与保守的 `context_window` 下界，口径与 `/v1/models` 同源。(`f6b7f1b`)
- Bandit 成功率改 Beta 后验采样（Thompson sampling）：强候选大概率得高分，弱候选保留探索概率；连续退化、尝试连败与显著慢仍走确定性罚项，避免随机性稀释事故证据。(`de41a61`)
- 聚合目录新增国内主站与套餐端点：百炼按量 / Token Plan、火山方舟按量 / Agent Plan、阶跃星辰 / Step Plan、讯飞星火、零一万物、百川、硅基流动中国站共 10 条；套餐与按量严格分条，避免 Key 混用走错计费域，四类订阅端点标为 included。(`e3fe5c1`)

### Changed（变更）

- 客户端显式选择推理档位（`reasoning_effort`）的请求按能力对待：候选明确不接受该参数时，400 改判为"换一家"，不再整单失败。(`7b2c82c`)

### Fixed（修复）

- 聚合额度查询失败改为保留上游原话并先脱敏，界面能区分"Key 无效"与"端点异常"；401 正文反射的 Key 不会随 IPC 到界面。(`194419c`)
- 补 en/zh 叶子键一致性门并清理孤儿文案，避免新增文案只落一种语言。(`5fe993e`)

## [1.5.5] - 2026-11-03

版本边界：tag `v1.5.5`（`dfde837`）。

### Added（新增）

- 粘性改为路由级开关 `ModelRoute.stickyHardPin`（缺省即开，`!== false` 判据，老 `data.json` 不需迁移）；关掉后只剩 `+0.12`/`+0.06` 的分数加成，预设播种继承该格，避免用户关掉的硬钉被下次播种悄悄打开。(`9c1115d`)
- 聚合实时额度接通：聚合详情页点一次问一次（无轮询、开页不自动发）。实时余量只当闸门不当数字——美元额度、人民币余额与本应用 token 是三个不可比的计数域；命中条件严格（整行成立、非 unlimited、问到数、`<=0`、`asOf` 在 15 分钟内），命中只把 `aggregateHeadroom` 折成既有的 `-1`，`QuotaWindowBlockReason` 增加 `no-credit`。(`9c1115d`)
- `GET /v1/models/:model` 按 `anthropic-version` 返回 anthropic 形状，且与清单行同源，避免"列表承认、单查否认"。(`9c1115d`)
- 粘性键升级为客户端会话标识（`prompt_cache_key` → `user` → `metadata.user_id` → `session_id` 头），优先于内容指纹：agent 客户端自行压缩历史后不再把会话换到别家；来源写入日志 `auto.sessionKeySource`，标识值本身不入日志。(`69a0686`)

### Fixed（修复）

- Codex 的 `apply_patch`（自由文本工具）两端按 `custom` 形状处理：入向补必填字符串 `input` 契约，出向回 `custom_tool_call` + 原文，历史里的 `custom_tool_call`/`custom_tool_call_output` 也读回；修掉"总说完成、文件没变"的静默失败。(`213ddb5`)
- HTTPS 的系统信任库不等于"客户端能连"：补齐 `NODE_EXTRA_CA_CERTS` 通路、`GET /v1/management/tls/ca`（只回 PEM，不带私钥）与 `/v1/management/tls/status`（握手被拒计数），Node 系客户端（Codex CLI、WorkBuddy 等）不再静默连不上。(`fda4d81`)

## [1.5.4] - 2026-11-03

版本边界：tag `v1.5.4`（`3ee88f6`）。

### Added（新增）

- 上下文窗口读数：只让已公布窗口参与 `/v1/models` 下界，一家都没公布就省略 `context_window`；"没公布上限"也不再作为淘汰候选的依据，避免长上下文请求被整池误杀成 503。(`ef51ee0`)
- 每轮读数：`shared/requestContextFit.ts` 估算入量、窗口与 fits/overflow，写进请求日志并在详情页分三档显示；估算值绝不进 `usage`。(`ef51ee0`)
- "装不下就换家"：`isContextOverflowError` 认 OpenAI、Anthropic 与中文的超限文案，接进能力不匹配的四个调用点，换下一家且不给账号记冷却；无关 400 仍然终止。(`ef51ee0`)
- 池策略预览透出 `conflicts`：哪条策略、新纳入多少、各自不满足前面的哪几条，便于解释"怎么又落到免费弱模型"。(`76c440a`)

### Fixed（修复）

- 池策略"或"的提示只报跨类作废：成本/档位/渠道类的 `or` 作废能力筛选时才提示；同类并集是 low-cost、vision-first 等预设的本意，不再狼来了。(`64b3630`)

## [1.5.3] - 2026-11-03

版本边界：tag `v1.5.3`（`d18cd7e`）。

### Added（新增）

- 质量感知降权与按模型 AIMD 并发：`finish_reason=length` 且客户端未请求 `max_tokens` 记为 degraded，连续两次即时降权；每（账号, 模型）默认并发 4，拥塞 ×0.7（5s 冷却），5 次干净成功 +1（30s 静默期）；本地准入拒绝返回可重试 429 `local_concurrency_limit` 且不惩罚账号；短窗口 EWMA 首包延迟与 429/超时/degraded 率进入候选打分。(`bf25f02`)

### Changed（变更）

- Codex 会话粘性改为路由层硬优先：同一会话上一轮成功的模型排到候选队首，避免 agent 每轮换模型导致上下文与工具协议漂移；模型停服/冷却时自然让位。(`dd7adf4`)
- 账号渠道默认工具能力改为 yes。(`33e3aa2`)

### Fixed（修复）

- 工具定义清洗：清掉 Codex 空名 `tool_search` 占位与缺 `parameters` 的定义，修 Raccoon 502 与 Agnes 400；WorkBuddy 11140 的 HTTP 400 按账号风控换号并冷却；OpenCode 匿名槽全部限流时报 429 而不是伪装成"重新登录"；Qoder 池内账号全不可用时不回退默认凭据；Bandit 将失败尝试计入候选健康分。(`63a1543`)
- 余额门控渠道统一在池耗尽时抛出：全部限流保持 429，池内有账号但全不可用直接 403 并说明余额/停用/凭据原因；只有池内完全没有账号条目时才允许历史单凭据回退。(`b46fd4c`)
- 校正 Codex `exec_command` 的 shell/workdir，Windows 客户端一律改用 `pwsh`。(`5f9880d`, `d18cd7e`)

## [1.5.2] - 2026-11-02

版本边界：tag `v1.5.2`（`fff1380`）。

### Changed（变更）

- 对齐 new-api 的错误/换家/协议语义：保留上游 `status`/`type`/`code`/`param`，403 不再改写 401；流内错误帧收尾并支持 200 首帧探测；客户端错误不再误伤账号；流式增加心跳与静默看门狗；Anthropic/Responses 补齐 thinking、工具结果附件、cache usage 与 reasoning。(`0e0cc6b`)
- 请求日志补尝试链、流生命周期、错误栈、诊断包与单请求 trace；崩溃与 worker 日志落盘；代理设置页等持久化配置加载后再渲染，修掉"重启后被默认 127.0.0.1 / HTTPS 关闭覆盖"的问题。(`0e0cc6b`)

### Fixed（修复）

- Anthropic 连续 user 轮按官方语义合并：Claude Desktop 3P 先发"上下文 + 问题"再发环境说明，原样转 chat 会被多数上游只读最后一条，导致每轮都答"你想做什么"。(`8adc746`)
- OVH 拒收 `prompt_cache_key`，该聚合条目用 `dropParams` 剥离。(`fff1380`)

## [1.5.1] - 2026-11-02

版本边界：tag `v1.5.1`（`cf3f94a`）。

### Added（新增）

- 路由可被 Anthropic 客户端按档位发现：`routeTiers` 发 `anthropic_family_tier`，`routeDisplayNames` 控制清单行显示名；非法档位宁可不发，避免客户端整行丢弃。(`16914c5`)
- 新增只允许一跳的池引用 `basedOnRoute`：一条路由可整体借用另一条的选择行为（池策略、钉名、手动增删、打分档、尝试数、粘性），但名字与日志仍是自己的；写入侧拒绝自引用、未知目标与二级引用，引用断掉时返回 404 `route_reference_broken` 并点名，不静默回落全目录。(`16914c5`)

### Changed（变更）

- Anthropic 配置卡片只保留一张名字表，每行直接给"在 Claude 里点不点得到"；补客户端名改为随保存自动完成；档位表补三列表头；"全 0"时明确说"无事可做"而不是报失败。(`b81f89b`, `1aa6a24`, `ffe0966`, `dacc29d`)

### Fixed（修复）

- 聚合条目返回空错误体（Unknown error）的 400 继续换家且不计账号故障；自动路由试过多家仍 404 时返回 503 `no_available_model`，避免 Claude 误判模型被删；Anthropic 兜底只解析 routable 路由；客户端断开产生的 ECONNRESET/EPIPE 记 debug；滑动窗口裁掉全部非 system 消息时保留最新一条。(`cf3f94a`)
- 流式 4xx 交出上游原文，不再把"序列化失败"当原因；Anthropic 入向不再透传客户端的 `device_id`/`session_id`（OVH 会以 extra arguments 整笔拒绝）。(`03ac9f0`)

## [1.5.0] - 2026-11-02

版本边界：tag `v1.5.0`（`dd6d273`）。

### Added（新增）

- HTTPS 监听（默认 8443，与 HTTP 共用同一套 Koa 中间件与路由）：首次启用自动生成本机证书（SAN localhost/127.0.0.1/::1，397 天，到期前 7 天重签，落 `~/.modelport/tls/`），也支持成对填写自有 PEM；设置页提供开关、端口、证书状态与"安装到系统信任"（Windows certutil、macOS `security`、Linux 给命令），只在用户点击时改动信任库。(`571e673`)
- 证书可加入远程地址（`httpsSanHosts`，IP 走 SAN type 7、域名走 type 2）；重签判据从"快过期"改为"是否覆盖当前名单"，名单不变时指纹稳定，不会每次启动作废已装好的信任；新增"从系统信任移除"。(`dd6d273`)
- 渠道按上游能力决定签到按钮：`ChannelDefinition.dailyCheckin` 必填，判据是渠道包 `credits.claimAll` 有无该家分支，没有接道的渠道不再点出 `unsupported provider`。(`dd6d273`)

### Changed（变更）

- 凭据加封 `v1:` 前缀；解不开的密文按"凭据不可用"返回并留错误日志，不再把一串 base64 当明文发给上游；编辑账号不再把已存凭据下发渲染层；Anthropic 路由播种带 `skipNames`，用户删掉的名字不复活；全新安装且无 Key 时生成一把。(`571e673`)
- 新增依赖 `selfsigned`，并按 `electron-store` 同一理由打进主进程 bundle（安装包内没有 `node_modules`）。(`571e673`)

### Fixed（修复）

- Windows 撤销信任不能直接用 `certutil -delstore`：实测序列号不匹配时仍返回 0 并删掉库中第 0 条；改用按 SHA-1 精确过滤的 PowerShell 删除。(`dd6d273`)

## [1.4.11] - 2026-11-02

版本边界：tag `v1.4.11`（`201a3bd`）。

### Added（新增）

- 新增 `/v1/responses` 入向：翻成 chat 请求回环到本进程，`usage` 缺失保持 `null`，`response.completed/incomplete/failed` 三选一，`previous_response_id`/`background`/`item_reference` 显式 400。(`74ec217`)
- Anthropic 模型发现改为生成 pinned 路由而非别名；`/v1/models` 只剩路由后，Claude Desktop 仍能按真实模型名选中。(`74ec217`)

### Security（安全）

- 渲染进程开启 sandbox；导航只认建窗时登记的应用自身文档（原 `file://` 前缀判据允许磁盘上任意 HTML 带着本应用 preload 被加载）；IPC 经 `trustedSender` 校验 senderFrame；`openExternal` 只认 http(s)；拒绝 attach webview。(`74ec217`)
- CORS 撤掉"没配 Key 就回 `*`"（出厂默认无 Key 时任何网页都能读走完整响应），`/stats` 不再免鉴权；管理 API 密钥改常量时间比较；自定义厂商头共用禁头清单；导出件脱敏自定义头里的凭据（Key 常被写进 `x-api-key`）。(`74ec217`)
- localStorage 与配置导出只保留界面偏好，含 `apiKeys`/`managementApiSecret` 的 config 不再落浏览器存储；请求/应用日志改为"先脱敏、再截断"，补 Bearer、裸 `sk-`、URL 查询串三类。(`74ec217`)
- dev server 默认只绑 127.0.0.1（`MODELPORT_DEV_HOST` 显式放开）；不再替 root 自动加 `--no-sandbox`；同时在途请求封顶 100。(`74ec217`)

### Changed（变更）

- `/v1/models` 与单查只广告启用中的路由；别名停用位落到 `ModelMapping.disabled`，所有读路径收口到 `modelServing.isMappingActive`；路由卡片显示候选数并对空池给警示。(`74ec217`)
- 发布流程：`release.yml` 先跑 gate（build + 两个 tsc + 全量测试）再 publish，Node 统一 24。(`74ec217`)

### Fixed（修复）

- 限流退避改按（账号, 模型）记档：同一渠道别的模型成功一次，不再抹掉本模型的 429 冷却与连击计数（此前解禁时间每分钟只后移约 60 秒，反复付整段 system 的 prefill 去撞墙）；每账号限流档上限 64，并先摘到期/最久未碰的。(`9bbb0e7`)

## [1.4.10] - 2026-11-01

版本边界：tag `v1.4.10`（`025fa8a`）。

### Added（新增）

- Gemini 线路可诊断：`lane_retired`、出口地区、产品线三类确定性 4xx 从"一律归 SERVER"中摘出并直接给可读原因；客户身份头里的 antigravity 版本与 changelist 改为从自动更新站现取；模型目录改为按当前凭据的 `fetchAvailableModels`，静态一行退为兜底。(`70ec39b`)

### Removed（移除）

- OpenCode 本机运行时退役：删除 `src/main/opencode/*`、`builtin/opencode.ts`、`proxy/adapters/opencode.ts`、`oauth/adapters/opencode.ts` 及 7 个测试，`modelListSource` 去掉 runtime 分支（分发前提"npm 上有可用 2.x 客户端"不成立，留着的分支永远走不到）。(`70ec39b`)

### Fixed（修复）

- 等待全部改为有界：`planRequestDeadlines` 由请求超时算出非流式截止、流式首事件、块间停摆与渠道排队预算，换家循环把剩余墙钟折算成单次截止；修掉实测"一笔 525 秒才报当日额度用尽、两笔 214/245 秒才报凭据不可用"。(`f607710`)
- 旧别名留下的裸模型 id 补回渠道前缀（此前 8 笔 100% 400）；凭据/匿名槽这类要人处理的故障不再重试，改走 5 分钟起的冷却档且渠道池一变即解除，错误带 `channel_relogin_required` 但状态仍 502，避免指挥客户端轮换它自己的 Key。(`f607710`)
- 强制 `tool_choice` 撞到不支持的候选归入"换一家就能成"；上游上报的 `usage` 不再被 `transformChunk` 当空帧丢掉（这条同时修掉所有客户端流式 `usage` 恒为 null）。(`f607710`)
- Anthropic 入站五处缺口：清单按 `anthropic-version` 分派、回环主动要 usage、补 `X-Request-Id` 不变量、点名模型落到 auto 时用响应头声明、把工具引擎裁决出的 `transformed.tools` 接进出站体。(`f607710`)
- 两类只在高频真实流量里出现的失败单独归类：渠道包发请求前的 `QUOTA_EXCEEDED`（定时限流，换一家就能成）不再计入账号故障上限；上游安全策略拦截按账号生效，不再"第一个候选就 return"，客户端 `code` 的风控判据排在 401/403 之前。(`a32f957`)
- `/v1/completions` 空 prompt 本地返回 400，不再投影成网关的空 messages 报错；历史 `tool_calls.arguments` 非法 JSON 先修再发；末条工具结果的出站序列补一条极简 user（修 VS Code agent 第 2 轮装死）；末条 tool 兜底挂到 `doForward`，造的这句不再被当成用户本轮输入。(`20aab4d`, `025fa8a`, `fb720f9`, `cb49a5c`)
- "这一家不认这个模型"类 404 改为换下一家。(`a3e3406`)

## [1.4.9] - 2026-11-01

版本边界：tag `v1.4.9`（`9f6a7c6`）。

### Added（新增）

- 仪表盘按供应商显示请求数、成功率、平均延迟、token 与美元费用；拿不到就显示 `-`，绝不折算成 0；成功率只除以"已覆盖请求"，旧构建起始的整天保持"未覆盖"。(`d06dbbe`)
- 逐请求费用：仅在上游上报用量且端点有定价时计价，free/included 记 0 且算已定价，unknown 不写数字；日桶新增 `byProvider` 分表。(`d06dbbe`)
- 最新活动显示从 UA 解析出的客户端标识。(`964fe53`)

### Removed（移除）

- 移除没有消费方的 `SecuritySettings` 开关（`credentialEncryption` / `logDesensitization`），管理面不再展示不生效的选项。(`d06dbbe`)

### Fixed（修复）

- lobsterai 积分查询区分"上游确实说 0 分"与"字段缺失/未登录"，查询前对临期/失效凭据先续期；逐账号 `enabled` 一路带到界面，停用账号读数显示但不计入渠道总额；API Key 页掩码示例与真实长度一致。(`d06dbbe`)

## [1.4.8] - 2026-10-31

版本边界：tag `v1.4.8`（`e331342`）。

### Added（新增）

- 上下文压缩默认开启，仪表盘"压缩节省"随之生效；显式关过的用户保持关闭（归一仅认 `enabled === true`），升级安装继承新的出厂默认。(`4c26f92`)
- 活跃账户卡片可点击并与今日 token 同排；活动列表补充实际模型与账号。(`02eb832`)

### Fixed（修复）

- raccoon 频率超限改判 429 走短冷却换号；补全 `outputSteering` 等缺失文案的 i18n。(`1da4b3d`)

## [1.4.7] - 2026-10-31

版本边界：tag `v1.4.7`（`c0eafa4`）。

### Added（新增）

- auto 路由升级为可增删改的普通路由，策略按路由生效：`AppConfig.routes` 每条自带 strategy / prefer / maxAttempts / stickyMinutes / poolStrategies，粘性键变为 `${route.name}|${conversationKey}`；旧 `config.autoRouting` 在首次启动迁移为唯一一条 `auto` 路由（以 `routes` 键是否存在为判据，幂等）；删掉 `auto` 后 `/v1/models` 不再广告它；改配置不需要重启代理。(`f77cda7`)
- `/v1/models` 为每条启用路由合成条目，`context_window` 取该路由候选池的下界，空池省略该键。(`f77cda7`)
- 手工能力标注独立成 `modelMarks` 表，模型同步不会抹掉用户纠正；聚合能力旁车与生成脚本；`outputCap` 别名折叠；客户端画像 `clientProfile`。(`f77cda7`)

### Fixed（修复）

- 历史缺 `reasoning_content` 的 400 参与换家（渠道能力不匹配），不再整单失败。(`c0eafa4`)
- store 归一 overrides 记录，写入口不再因缺键抛 TypeError。(`663a357`)

## [1.4.6] - 2026-10-30

版本边界：tag `v1.4.6`（`b0c4788`）。

### Fixed（修复）

- 修复 1.4.5 引入的"打包安装后存储不可用"：`electron-store` 被移出 externalize 列表，而 asar 不含 `node_modules`，`await import` 抛 `ERR_MODULE_NOT_FOUND`，且该 import 在 `initialize()` 的 try 之外，初始化错误保持 null，所有依赖存储的 IPC 都报 "Storage not initialized"；重新打进 bundle，把 import 移进 try，模块加载失败时跳过损坏恢复，并用 `tests/build/main-bundle-deps.test.ts` 守住这条。(`d4839e9`)

## [1.4.5] - 2026-10-30

版本边界：tag `v1.4.5`（`cda3f58`）。

### Changed（变更）

- 完成品牌更名 Chat2API → ModelPort（**BREAKING**）：响应头改 `X-ModelPort-*`，opencode agents 改名；启动时在 store/runtime/缓存初始化之前迁移两处持久化根（`<appData>/chat2api → <appData>/modelport` 同卷重命名以保住 `store.key` 解密，`~/.chat2api → ~/.modelport`），目标已存在则跳过、失败只告警不半迁移；`localStorage` 键一次性迁移到 `modelport-settings`。(`85286a3`)
- vite 配置路径改为从 cwd 解析（支持映射盘），`electron-store` 保持 external（1.4.6 撤回该决定）。(`f7bd2ee`)

### Fixed（修复）

- 渠道装不下工具清单时换下一个 auto 候选：工具数超过上游上限（如 128）属渠道能力不匹配，换家且不记冷却/账号失败；`forwarder` 等首个流事件再判定成功，客户端断开即中止上游。(`74b1ca9`)

## [1.4.4] - 2026-10-30

版本边界：tag `v1.4.4`（`8566ea1`）。

### Added（新增）

- 余额门控选号：8 个渠道选号前探测账户额度（fail-open，60s/5s TTL，in-flight 去重，`DSH_ACCOUNT_BALANCE_GATE` 可关）；确认余额为 0 的账号被跳过，避免池首的"烧干账号"吃掉所有请求；loomy/buddy 保持自己的选号器。minimax 补 402 处理：标记该模型到 UTC+8 日边界并轮转到下一账号。(`9de5790`)

### Changed（变更）

- 新增跨平台 CI gate workflow 与 Node 运行版本自检，`npm run gate` 成为唯一验收口径。(`62ee5d1`, `0307fec`)

### Fixed（修复）

- 渠道额度只统计启用账号，开关账号会改变用户看到的渠道总额；渠道页与模型页不再每次 revalidate 都闪回 loading。(`8566ea1`)
- 非拉丁供应商名导致自动路由 500：`X-Chat2API-Route` 原样拼中文名（如 "TRAE (字节)"）触发 `ERR_INVALID_CHAR`，改走 `routeHeaderValue`，非 ASCII 按 UTF-8 百分号编码；`Aggregate-Chain` 同口径。(`d9078ea`)

## [1.4.3] - 2026-10-30

版本边界：tag `v1.4.3`（`98ef5df`）。

### Fixed（修复）

- OpenCode 运行时把非法工具上报当成原生工具活动展示的问题。(`ee1ffe5`)

## [1.4.2] - 2026-10-30

版本边界：tag `v1.4.2`（`2e2ae10`）。

### Added（新增）

- auto 路由 v2：按供应商的重试预算（账号渠道一次短重试）、路由错误策略与拒绝日志、`/v1/models` 上下文窗口服务、能力表、聚合参数丢弃、上下文压缩管线、账号渠道目录同步（成本分桶、停用/死模型处理）。(`9d07417`)
- 免费额度账本与成本分级：`docs/data` 下的额度凭证生成 `aggregateQuota`/`aggregatePricing` 旁车，账本与限额器逐请求计量，`smart`/`pace` 按派生重置时间路由，`aggregateCost` 对每个模型回答 free/included/priced/unknown。(`ddc566a`)
- WorkBuddy 登录渠道族（按 v2.5.1 upstream 快照适配，出处见 `docs/upstream`）；Qoder 会话复用、plan-gate 112、切片队列等待、usage 缓存约定、MiniMax 增量 tool-call 名；宿主侧 reasoning replay 与工具调用预校验。(`55a6540`)
- 开机自启；日志广播 IPC 与请求日志趋势保留策略。(`a805cf4`)
- 聚合页额度/费用徽标与筛选、代理设置压缩面板、仪表盘 token 用量卡与趋势图修复、账号数、供应商认证标签，全部新文案支持 en/zh。(`018306b`)

### Fixed（修复）

- 仪表盘趋势改用日滚存，不再受被截断的请求日志影响。(`2e2ae10`)

## [1.4.1] - 2026-10-29

版本边界：tag `v1.4.1`（`ac62cea`）。

### Added（新增）

- 聚合渠道目录：API Key / 免费额度 / 本机三类条目，支持 openai-chat 与 anthropic-messages 两种线路。(`ac62cea`)
- 十个登录账号渠道（vendored channel pack），账号渠道提供在线模型目录、额度权重、免费模型徽标、逐模型开关与死模型恢复。(`ac62cea`)
- OpenCode 作为运行时内置供应商：本地 runtime bridge、延迟流（响应头先于 30–60 秒的一轮结束发出）、免费池额度错误转 429、死亡进程下次请求替换；provider 状态不启动 runtime，`opencode://local` 豁免 http(s) 规则。(`5075873`)
- 解码层强制 OpenCode 工具契约：`tool_choice: required`、强制函数、`parallel_tool_calls: false` 由 JSON envelope（`anyOf` + `minItems`/`maxItems`）约束；非文本内容开流前 400；`usage` 映射上游计数、缺失保持 `null`。(`3e96b9b`)

### Changed（变更）

- 应用更名为 ModelPort（包名、产品名、界面）；Electron profile 固定，已有安装保留加密 store key 与凭据可读。(`ac62cea`)
- 代理 API 契约加固：fail-closed 鉴权（有 Key 时 `/v1/*` 恒需 Bearer 或 `X-API-Key` 且常量时间比较，无 Key 只绑 loopback）；流式/非流式统一 OpenAI 形错误帧，每流恰好一个 `[DONE]`，`usage` 只用上游真实值，响应带 `X-Request-Id`；内置供应商静默丢弃不支持的采样参数，仅 `n > 1` 返回 400；在线模型清单同步存 `userModelOverrides` 并并入 `/v1/models`。(`e48c3e5`)

### Removed（移除）

- 移除提示词注入管线、Perplexity 供应商、服务端 session 表与旧 logs/session 界面。(`e48c3e5`)
- 退役 8 家基于网页会话（Web UI）接入的供应商，启动时清理其供应商、账户与模型映射（DeepSeek / GLM / Kimi / Mimo / MiniMax / Qwen / Qwen AI / Z.ai）。(`ac62cea`；名单另见 CODE_WIKI §13)

### Fixed（修复）

- 修正供应商默认值与 Z.ai 认证头；Z.ai 验证码受限在文档标注。(`d71d304`, `59f03ab`)

## [1.4.0] - 2026-05-27

版本边界：无 tag；以 `package.json` 升至 1.4.0 的提交 `c81dfe1`（"prepare v1.4.0 release"）为准。

### Added（新增）

- 重设计托管工具调用流程。(`04e7ad2`, `9854357`)
- 独立应用日志存储（与请求日志分离）。(`99d7663`)
- 应用内更新检查与更新管理器接线（状态透出渲染层、按事件驱动 UI）。(`2a2e290`, `a88241b`, `35d931a`, `c5bcfe4`)
- Chat2API 工具测试 skills 与工具配置恢复命令文档。(`95a6d47`, `1fa0244`, `c0bed31`)

### Changed（变更）

- 供应商模型清单刷新（Z.ai 新模型、Qwen AI 模型表、代理徽标）。(`82a63a4`, `2de8b88`, `09349ca`)
- 清理源码产物并简化 provider 分发。(`318a8ef`)

### Fixed（修复）

- DeepSeek web2 模式保留搜索文本；选择映射模型时同步供应商；内置模型映射与持久化模型迁移；模型映射表单控件易用性。(`be83a68`, `20d56a0`, `d0d363a`, `ab4c7d5`, `306e573`, `98ba370`)

## [1.3.0] - 2026-05-07

版本边界：无 tag；以 `package.json` 升至 1.3.0 的提交 `d22e4f6` 为准。

### Changed（变更）

- 请求日志持久化重设计，降低日志 I/O 并修复会话清理。(`fea5f12`, `7215512`)
- 供应商模型流程更新。(`8c6d7b2`)

### Added（新增）

- DeepSeek Expert 模型可通过模型映射接入。(`d969bd8`)

### Fixed（修复）

- 语言设置在应用重启后丢失。(`e22b202`)
- 生产构建找不到 `electron-updater`：先补 `asarUnpack`，再改为 external 策略。(`280a1f6`, `23da35d`)

## [1.2.0] - 2026-04-07

版本边界：无 tag；以 `b0f3255`（"implement automatic application update system ... Update version to 1.2.0"）为准。

### Changed（变更）

- **BREAKING**：会话管理改为无状态单轮，移除多轮模式；新增上下文管理服务（滑动窗口、token 上限、摘要策略）。(`8e744ec`)
- 移除会话设置与上下文管理字幕，界面不再展示已删除的能力。(`449bf51`)

### Added（新增）

- Mimo 供应商，并做了一轮架构优化。(`a9edc38`)
- 多供应商聊天记录批量删除；Kimi 思考模式增强。(`a224a83`)
- 应用内更新检查：主进程请求 GitHub Release 对比版本，规避渲染层 CORS；Qwen AI 与 Z.ai 适配器随之改进（思考模式自动判定、`reasoning_content` 实时下发）。(`e2549f1`)
- 自动更新：`electron-updater` 接线、实时下载进度、一键安装重启、错误重试与双语界面。(`b0f3255`)
- 自定义模型管理（新增/删除/重置）。(`4ffb09c`)
- 供应商动态模型更新；MiniMax 流式处理修复。(`2463120`)

### Fixed（修复）

- Mimo 思考模式解析；forwarder 工具调用处理重构。(`953118a`)

## [1.1.4] - 2026-03-26

版本边界：无 tag；以 `package.json` 升至 1.1.4 的提交 `38abf6b` 为准。

### Added（新增）

- 新增 Perplexity 供应商（OAuth、流式适配与界面资源）。(`5754074`)
- 管理 API（远程管理）：账号、API Key、配置、模型映射、供应商、代理、会话、统计，带密钥鉴权与设置界面。(`3576813`)
- Qwen AI 与 MiniMax 的"清空聊天记录"（含确认弹窗）；Qwen AI 模型名后缀 `-thinking` / `-fast` 控制思考模式；MiniMax 积分改用会员端点并显示到期时间。(`8ef30c2`)
- 请求日志记录响应体、`web_search` 与 `reasoning_effort`，日志详情新增"响应"页。(`08e8982`)

### Changed（变更）

- 模型映射配置增加未保存更改保护。(`6b60637`)
- 多供应商适配器改进：Kimi 思考阶段跟踪、Qwen/Qwen-AI `parent_id`、MiniMax 工具调用、DeepSeek fold/search 流式。(`08e8982`)
- 清理 store 中未使用的方法与属性。(`506493b`)

### Fixed（修复）

- Qwen AI 非流式空内容与重复 resolve；Perplexity 错误处理；Z.ai 与 MiniMax 的 `handleNonStream` 参数处理；Z.ai 非流式响应。(`a013849`, `2595230`, `255e915`, `1190304`)
- 多轮对话 `parent_id` 更新与 DeepSeek web search 模型处理。(`b2170c1`)

## [1.1.3] - 2026-03-11

版本边界：无 tag；以 `package.json` 升至 1.1.3 的提交 `39d1f62` 为准。

### Changed（变更）

- 日志详情弹窗重设计，并修复文本溢出。(`1d2c51d`, `4c80743`)
- 发布工作流支持带后缀的版本 tag，并为产物上传补 actions write 权限。(`1903981`, `2709c43`)

### Fixed（修复）

- 固定加密密钥：原实现用 `safeStorage.encryptString()` 生成密钥，每次结果不同，导致 `electron-store` 读不回旧数据、配置每次重启被重置。(`a300b94`)
- 补齐缺失的日志组件并修正 `.gitignore`。(`403ed1e`)

## [1.1.2] - 2026-03-11

版本边界：无 tag；以 `3784b78` 同时修复问题并升至 1.1.2 为准。

### Added（新增）

- 持久化请求日志与统计系统：`RequestLogEntry`、`PersistentStatistics`/`DailyStatistics`、日志与统计 IPC，仪表盘改用持久数据。(`81800b8`)
- 托盘窗口与紧凑仪表盘（`/tray` 路由与托盘 API）。(`14a49e3`)
- 代理重启对话框与配置处理改进。(`6f44c3c`)

### Changed（变更）

- 更新 macOS 图标。(`0f7d1a5`)

### Fixed（修复）

- `data.json` 损坏时的启动崩溃（"Storage not initialized"）：备份损坏文件、以默认值重建，并新增 `STORE_INIT_ERROR`/`STORE_RETRY_INIT` 前端错误处理。(`3784b78`)

## [1.1.0] - 2026-03-09

版本边界：无 tag；以 `3f08369` 升至 1.1.0 为准（初始版本见 1.0.0）。

### Added（新增）

- Function Calling 模拟：面向不原生支持工具的模型，用文本协议模拟工具调用，并新增 SystemPrompt 管理。(`aee98eb`)
- 多轮会话管理：`SessionConfig`/`SessionRecord`、单/多轮模式、设置页会话标签。(`2a100b1`)
- 工具提示词注入：三种模式（always/smart/never），smart 按消息长度阈值决定是否注入；识别 Cline、KiloCode、RooCode、VS Code Copilot、Cherry Studio 等客户端并按配置跳过；按模型提供多套提示词变体。(`9e81c23`, `1d3d6db`)
- DeepSeek 网页搜索与推理：支持 `web_search`、`reasoning_effort`，新增 `DeepSeek-Search`、`DeepSeek-R1`、`DeepSeek-R1-Search` 模型变体，并支持通过请求头传递特性参数。(`d85e274`)

### Changed（变更）

- 统一工具调用处理：GLM、MiniMax、Qwen、Z.ai 等适配器改为"内容即时下发、刷新时解析工具调用"，统一按 `[function_calls]` 检测，并补全 `finish_reason`（`tool_calls` 与 `stop`）。(`10416c7`)
- 统一各适配器的会话上下文处理。(`94d8c9b`)
- 发布流水线修复：Actions 权限、产物上传与图标步骤；国内网络改用 npmmirror 的 Electron 镜像。(`754f036`, `17502f8`, `cde52cd`, `bf93807`, `89f5aec`)

### Fixed（修复）

- 流重复结束：Qwen/Z.ai 增加 `safeEnd` 与 `streamEnded` 守卫，避免流结束后继续处理数据。(`ef2d8e1`)
- 代理绑定地址在重启后回落 127.0.0.1，改为持久化 `proxyHost`。(`8db3e11`)

## [1.0.0] - 2026-02-26

版本边界：初始提交 `c55dae2`（"initial commit - Chat2API v1.0.0"）。

### Added（新增）

- 首次发布（Chat2API）：Electron + React 桌面应用，为 DeepSeek、GLM、Kimi、MiniMax、Qwen、Z.ai 等服务商提供 OpenAI 兼容 API；含仪表盘、API Key 管理、模型管理、请求日志、代理设置、托盘与中英双语界面。(`c55dae2`)

---

## 版本边界与溯源说明

- **有 tag 的版本**：`v1.4.1` – `v1.7.1` 共 21 个 tag，边界即 tag 指向的提交；每个 tag 内 `package.json` 的 `version` 与 tag 名一致（已逐一核对）。
- **无 tag 的早期版本**：以 `package.json` 的版本号变更提交为边界：
  - `1.0.0` = `c55dae2`；`1.1.0` = `3f08369`；`1.1.2` = `3784b78`；`1.1.3` = `39d1f62`；`1.1.4` = `38abf6b`；`1.2.0` = `b0f3255`；`1.3.0` = `d22e4f6`；`1.4.0` = `c81dfe1`；`1.4.1` = `ac62cea`。
  - `1.0.0` 与 `1.1.0` 之间、`1.2.0` 与 `1.3.0` 之间的提交在 `package.json` 中仍沿用旧版本号，按"提交在下一个版本号提交之前即归入下一版本"处理。
- **仓库中没有 `v1.1.1`**：`git log -- package.json` 的版本序列为 1.0.0 → 1.1.0 → 1.1.2 → 1.1.3，不存在 1.1.1 的版本提交；CODE_WIKI §13 中"v1.1.1"一条缺乏证据，本文件未收录。
- **`CODE_WIKI.md` §13 的归属错误已在此纠正，但未改动该文件**：
  - 其 "v1.5.0" 条目描述的是退役 8 家 Web UI 供应商与聚合渠道目录，实际发生于 `1.4.1`（`ac62cea`，2026-10-29）；`1.5.0` 的真实内容是 HTTPS 监听、证书与凭据 `v1:` 封装。
  - 其 "v1.1.3" 条目称"新增函数调用支持"，函数调用模拟实际落在 `1.1.0`（`aee98eb`，2026-03-02）。
- **条目取舍**：只写能从提交、tag 或仓库文档核对到的用户可见变更；纯内部测试、注释与文档整理一般不单列，除非它改变了运行方式（例如 CI gate、Node 版本、发布流程）。提交历史中无法确认归属的零散改动不写入任何版本。
