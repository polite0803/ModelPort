/**
 * 出站序列「末条是工具结果」的兜底（2026-11-01，本机 VS Code 反复复现）。
 *
 * ## 故障形状与证据
 *
 * agent 客户端在第 2 轮起发的就是「… assistant tool_calls → tool 结果」结尾的序列。
 * 远程网关的请求日志里，同一会话（Raccoon 商汤 / DeepSeek-V4.1-Flash）第 1 轮全部正常，
 * 第 2/2/4 轮回包原文分别是：
 * - `I don't see a request in your message — what would you like me to do in ModelPort?`
 * - `I'm ready — what would you like me to work on in ModelPort?`
 * - 中文变体「ModelPort 工作区已就绪…告诉我你想做的具体事情即可」
 * 另一次不干活而是调 `ask_user` 反问。四条都发生在末条为 `role:"tool"` 的请求上。
 *
 * ## 触发条件是两条同时成立，不是「末条 tool」单独作恶
 *
 * 真实请求体（system 71,889 字符 + 75 个 tools + 末条 tool）重放 n=10 判空/反问 7 次；
 * 同一请求末尾补一条极简 user → 15 次 0 次；同样大的 system 但末条是 user → 6 次 0 次；
 * 把 system 削到 8,000 字符或整个去掉、末条仍是 tool → 各 3 次 0 次。
 * 所以准确表述是：**大 system 决定易感，末条 tool 决定发作**。这也是精简请求体复现不出来
 * 的原因（本仓构建的 23–36KB 请求实测 0 命中），单次抽样也判不出来（命中率约 7/10，
 * 统计要 n≥10）。兜底只动得了消息序列，故削的是「发作」这一条腿。
 *
 * ## 为什么放在宿主而不是渠道包
 *
 * 兜底必须覆盖**三类**供应商：账号渠道走 `bridge → worker.complete()`，聚合条目与自建
 * 供应商走 axios，永不进 worker（`forwarder` 的注册表只在 `type === 'account'` 时才进
 * 渠道 worker）。只挂 `worker.ts` 会留下两条没修的线路 —— 而报障文档自己把 ovh（聚合）
 * 列为同现象。所以这里是一份纯函数，由 `doForward` 在分派**之前**调用一次：它是三条线路
 * 最后一个共用点，且排在重复度/存活观测、内容压缩与上下文裁剪之后，造的这一句不会被
 * 内部消费者当成用户本轮的诉求。
 *
 * ## 为什么默认开
 *
 * 「末条是工具结果」本身就是 agent 多轮的常态形状，也是故障形状；默认关等于没修。
 * 关掉的方式是设置里的开关（`config.trailingUserGuard = false`），不是代码常量。
 */

/**
 * 注入文案。要求：短、祈使、不留确认余地，不带参数也不带换行。
 * 改文案前请重做对照实验（真请求体 A/B），不要凭感觉加长。
 */
export const TRAILING_USER_TEXT = '继续执行上一条消息中的任务，直接开始，不要向我确认。'

/**
 * 开关语义：`undefined`（没配过）= 开启，`false` = 关闭。
 *
 * ⚠️ 判据是 `!== false`，不是 `=== true`：新字段是可选的，历史 `data.json` 里
 * 根本没有这一格，写成 `=== true` 会让所有老装机在没碰过面板的情况下静默失去兜底。
 */
export function trailingUserGuardEnabled(flag?: boolean): boolean {
  return flag !== false
}

/**
 * 末条为 `role:"tool"` 时追加一条极简 user；其它形态原样返回同一个引用。
 *
 * 幂等由「只看末条 role」保证：追加之后末条是 user，再调一次不会叠加（重试、
 * 以及 `auto` 换家时同一份消息被多次装配都安全）。
 */
export function injectTrailingUser(
  messages: unknown,
): { messages: unknown; injected: boolean } {
  if (!Array.isArray(messages) || messages.length === 0) return { messages, injected: false }
  const last = messages[messages.length - 1] as { role?: unknown } | undefined
  if (last?.role !== 'tool') return { messages, injected: false }
  return { messages: [...messages, { role: 'user', content: TRAILING_USER_TEXT }], injected: true }
}
