# PLAN-fault-injection-failover.md —— 故障注入：钉住换家与流边界

> 状态：已实施 ｜ 日期：2026-11-16（重建于 2026-11-17）
> 落地：`tests/proxy/fault-injection.test.ts`（6 用例全过）

## 背景

对照外部「模型切换五类风险」方法论（静默降级、流式重播、重试风暴、上下文断裂、
可观测性缺失）逐条核对本仓库后，确认分层、重试分类、黏性、留痕四项均已落地并有
测试；真正的缺口有两项——**没有故障注入式端到端集成测试**，以及**「首块后不换家」
边界靠时序而非显式守卫**。

## 问题

现有测试几乎全是纯函数单测（`failover.test.ts`、`attempt-trace.test.ts`、
`stream-error-frame.test.ts` 等），只验证判定函数的输入输出。**没有任何测试
拉起真实的换家循环**：把一个带多候选的池、一条会 429/502/假死的上游、一个
客户端连接串起来，验证整条链的行为。纯函数单测证明零件正确，不证明装配正确——
`forwarder.ts:1245-1290` 的首块等待、`failover.ts` 的换家循环、`autoRouter.ts`
的排除集重选三者之间的时序契约，目前完全靠约定。

同时，「流式首块一旦交付、不再跨模型切换」这条边界**没有显式守卫**：它由
「先 `firstStreamEvent` 再向客户端交付」的时序保证（forwarder.ts:1248）。将来
任何往交付路径里加「提前 flush headers」「边收边发」的改动都会无声地破坏它。

## 方案

参照 `account-channel-stream-error-status.test.ts` 的骨架：**真 store + 真
`requestForwarder.forwardAutoCompletion` 换家循环 + 真 `probeSseHead` 帧解析 +
真 `describeAttemptFailure` 记账**；替身只有渠道 Worker 的流
（`accountChannelManager.openStream`），按模型名分派故障剧本。

六种注入与期望：

| 注入 | 期望 |
| --- | --- |
| 429（带 `Retry-After`） | 换到下一家，attemptTrace 记 `status:429 / outcome:failover` |
| 502 | 换到下一家，记 `failover`；账号故障档由 `baseCap` 计数 |
| 裸 400 ×2 | 池语义换满 2 次后收口，第 3 家不被派发 |
| HTTP 200 但零字节假死 | 首块超时 → 504 `first_block_timeout` → 换下一家 |
| 首块后断流 | **下一家不被派发**；断流错误在交付流上浮现（路由层据此写错误帧） |
| 首块后到达的流中错误帧 | 在 `skipTransform` 管道上原样透传，下一家不被派发 |

每个用例断言三样：① 客户端最终形态（success / status / 错误码）；②
attemptTrace 的 outcome 序列与注入一一对应；③ 「首块后不换家」——流已经交付
（probe 通过、pipe 已接管）之后，任何失败都不得再派发下一家候选。

## 实施记录（2026-11-16）

- 未拆成两个文件：`fault-injection.test.ts` 里「假死上游换到下一家」与「首块后
  断流下一家不派发」两个用例已分别钉住「首块前可换」与「首块后不换」两个方向，
  再拆文件只会重复。
- 没起 HTTP 层：`forwardAutoCompletion` 是换家循环的直接入口，HTTP 中间件不在
  本层证明范围（`tests/routes/` 已有 HTTP 层测试）。
- 实施中校准的三处语义（测试按现状钉，不是按草案的想象钉）：
  1. `AutoAttemptFailure.kind` 枚举只有 `capability|failover|fatal`，没有
     `account-fault`——账号故障档是 `baseCap` 计数维度，不体现在 kind。
  2. 池语义（`forwardAutoCompletion` → `switchOnRejectedRequest`）下裸 400
     **设计为换家**，上限 `MAX_REJECTED_REQUEST_SWITCHES = 2`（forwarder.ts:74）；
     且 `describeAttemptFailure` 的口径是「kind 与当时实际走的分支一致」，所以
     trace `outcome=fatal` 与 `failures kind=failover` 并存是**有意**的，用例把
     这两处记账都钉住。
  3. 「首块后断流」的桩必须在 probe 窗口（forwarder.ts:83，200ms）**之后**
     断流——太早会撞进建流失败路径参与换家，那不是这条边界要钉的场景。

## 验收

- 新测试文件进 `node --test` 全量，`npm run gate` 四项全过。
- 不改任何 `src/` 源码：这批测试只钉行为，不动实现。若实施中发现现状与
  期望不符（例如「首块后断流」现状真的重播了），**停下来报给用户**，那不是
  补测试能解决的事。

## 明确不做

- 不引入一致性哈希会话黏性（单进程桌面网关，现有 sticky 记录机制够用）。
- 不给 attemptTrace 加 `fallbackChain`/`switchReason` 冗余字段——outcome
  序列 + errorCode 已承载同样信息，加字段只会制造第二份真相。
- 不做应用层 SDK 重试归零（那是 `/clients` 客户端改写能力的既有职责）。