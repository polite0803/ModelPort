/**
 * 换家判据的回归测试（纯函数 + 真实流行为，无 electron、无网络）。
 *
 * 背景（用户报障 2026-10-30）：客户端 harness 带着上百个工具走 auto，命中
 * cline（上游 Vercel AI Gateway 硬限 tools ≤ 128）直接 400，且这个失败原先
 * 以「流内错误帧」浮现 —— auto 的换家机制看不到，整场失败。修复后：
 * 1. 账号渠道流式路径等「首块 vs 首错」，建流阶段的失败转成普通 ForwardResult；
 * 2. 工具数超限类 400 判为可换家（渠道装不下，账号本身无过）。
 *
 * 缺 reasoning 历史的 400（用户报障 2026-10-31，cline / reflection/beam-free）：
 * 6. 历史 assistant 消息缺 reasoning_content 的 400 同判可换家 —— 推理模型的
 *    历史校验与客户端历史形状不匹配，重试同一家只会原样再撞。
 *
 * 渠道目录漂移的 404（用户报障 2026-11-01，auto → opencode/qwen3.8-max）：
 * 7. 「模型不存在或已停用」这类 404 同判可换家 —— 这一家的目录不认这个模型，
 *    换一家就能成，且请求在自己的进程里就被拒，账号本身无过。
 *
 * PLAN-auto-routing-freellmapi P0-1/P0-2 追加：
 * 3. 换家按错误类分级（账号故障类 3 家封顶；排队/额度/限流类放宽到 6 家）；
 * 4. 换家有墙钟总预算（90s），预算耗尽返回最后失败；
 * 5. 前置剔除的候选透出为 X-ModelPort-Auto-Skipped。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'stream'

import {
  AUTO_RECOVERABLE_EXTRA_ATTEMPTS,
  AUTO_WALL_CLOCK_BUDGET_MS,
  FIRST_EVENT_TIMEOUT_MS,
  firstStreamEvent,
  isChannelModelUnavailableError,
  isFailoverEligibleStatus,
  isMissingReasoningHistoryError,
  isRecoverableChannelFailure,
  isToolOverflowError,
  probeSseHead,
  shouldTryNextAutoCandidate,
} from '../../src/main/proxy/failover.ts'

const forwarderSource = readFileSync('src/main/proxy/forwarder.ts', 'utf-8')
const autoRouterSource = readFileSync('src/main/proxy/autoRouter.ts', 'utf-8')
const chatRouteSource = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')

test('工具数超限识别：命中用户报障的上游原文', () => {
  // 用户报障原文（cline / Vercel AI Gateway 400 的 error.message 片段）
  assert.ok(isToolOverflowError(
    "Invalid value for 'tools': maximum number of items is 128.",
  ))
  // 大小写不敏感 + 变体措辞
  assert.ok(isToolOverflowError('Too many tools provided: 150 > 128'))
  assert.ok(isToolOverflowError('tools: too many items'))
})

test('工具数超限识别：窄口径，无关 400 不得误判', () => {
  assert.equal(isToolOverflowError(undefined), false)
  assert.equal(isToolOverflowError(''), false)
  // 没提 tools 语境的超限（如消息条数超限）不算
  assert.equal(isToolOverflowError('maximum number of messages is 128'), false)
  // 提了 tools 但不是数量问题（如 schema 校验失败）不算
  assert.equal(isToolOverflowError("Invalid value for 'tools': schema is invalid"), false)
  // 普通业务错误不算
  assert.equal(isToolOverflowError('model not found'), false)
})

test('缺 reasoning 历史识别：命中用户报障的上游原文（2026-10-31 beam-free）', () => {
  // 用户报障原文（cline / Vercel AI Gateway 400 的 error.message 片段）
  assert.ok(isMissingReasoningHistoryError(
    "Missing required parameter: 'messages[6].reasoning_content'. This model needs the "
    + "reasoning of every earlier assistant message: send back the 'reasoning_content' "
    + "returned with that message. If 'reasoning_content' is not available, consider "
    + 'starting a new session or conversation history.',
  ))
  // 字段名在 param 路径里、message 措辞变体也要认
  assert.ok(isMissingReasoningHistoryError(
    "Missing required parameter: 'messages[2].reasoning_content'",
  ))
})

test('缺 reasoning 历史识别：窄口径，无关 400 不得误判', () => {
  assert.equal(isMissingReasoningHistoryError(undefined), false)
  assert.equal(isMissingReasoningHistoryError(''), false)
  // 缺别的参数（如 messages 缺 role）不算
  assert.equal(isMissingReasoningHistoryError("Missing required parameter: 'messages[6].role'"), false)
  // 提到 reasoning_content 但不是「缺参数」语义（如值非法）不算
  assert.equal(isMissingReasoningHistoryError("Invalid value for 'reasoning_content': must be a string"), false)
  // 普通业务错误不算
  assert.equal(isMissingReasoningHistoryError('model not found'), false)
})

test('渠道目录不认模型识别：命中渠道 worker 抛出的原文（2026-11-01 auto/opencode 报障）', () => {
  // worker.ts 的 `complete()` 请求前校验：宿主从 `model.list`（不套身份档）拿到的
  // 付费模型，只有匿名槽的渠道在请求时拒绝 —— 换下一家就能成。
  assert.ok(isChannelModelUnavailableError('模型不存在或已停用'))
  // 跨桥时文案可能被包在更长的一句里（渠道名/前缀），仍要认
  assert.ok(isChannelModelUnavailableError('opencode: 模型不存在或已停用'))
})

test('渠道目录不认模型识别：窄口径，其它 404 与无关文案不得误判', () => {
  assert.equal(isChannelModelUnavailableError(undefined), false)
  assert.equal(isChannelModelUnavailableError(''), false)
  // 上游自己的「模型不存在」：语义是客户端写了个不存在的名字，换家没有意义
  assert.equal(isChannelModelUnavailableError('model not found'), false)
  assert.equal(isChannelModelUnavailableError('The model `gpt-9` does not exist'), false)
  // 额度/排队类走自己的分支
  assert.equal(isChannelModelUnavailableError('insufficient_quota: You exceeded your current quota'), false)
})

test('firstStreamEvent：建流失败在首块之前到达时，以 error 浮现并带上状态码', () => {
  const stream = new PassThrough()
  const pending = firstStreamEvent(stream)
  stream.destroy(Object.assign(new Error('cline: 400 tools overflow'), { status: 400 }))
  return pending.then((first) => {
    assert.equal(first.kind, 'error')
    if (first.kind !== 'error') return
    assert.equal((first.error as { status?: number }).status, 400)
    assert.match(first.error.message, /tools overflow/)
  })
})

test('firstStreamEvent：首块原样交还，后续块经 pipe 完整续传（不丢块）', async () => {
  const stream = new PassThrough()
  const pending = firstStreamEvent(stream)
  stream.write('data: first\n\n')
  const first = await pending
  assert.equal(first.kind, 'data')
  if (first.kind !== 'data') return

  const target = new PassThrough()
  let received = ''
  target.on('data', (chunk) => { received += chunk.toString() })
  const ended = new Promise<void>(resolve => target.once('end', resolve))
  // 与 forwardAccountChannel 相同的接法：首块补发 + pipe 接管
  target.write(first.chunk)
  stream.pipe(target)
  stream.write('data: second\n\n')
  stream.end()
  await ended
  assert.equal(received, 'data: first\n\ndata: second\n\n')
})

test('firstStreamEvent：未产出任何数据就关闭（含无错误销毁）判为 closed', async () => {
  const destroyed = new PassThrough()
  const pendingDestroyed = firstStreamEvent(destroyed)
  destroyed.destroy()
  assert.equal((await pendingDestroyed).kind, 'closed')

  const ended = new PassThrough()
  const pendingEnded = firstStreamEvent(ended)
  ended.end()
  assert.equal((await pendingEnded).kind, 'closed')
})

test('firstStreamEvent：等首事件超时判为 timeout（渠道假死要能进换家循环）', async () => {
  // 假死证据（用户报障 2026-10-30）：qoder/qfmodel 三次 HTTP 200 零字节挂
  // 165s / 285s / 625s —— 墙钟预算只在尝试之间检查，单次悬挂时永远等不到
  // 检查点，所以「等首事件」本身必须有上限。
  assert.equal(FIRST_EVENT_TIMEOUT_MS, 60_000, '等首事件超时钉在 60s')

  const stream = new PassThrough()
  const first = await firstStreamEvent(stream, 20)
  assert.equal(first.kind, 'timeout')

  // 超时结算后监听必须摘干净：流不被消费、不破坏，处置权留给调用方
  // （forwarder 负责 destroy）。迟到的数据不得让已结算的 promise 二次触发。
  stream.write('data: late\n\n')
  const late = stream.read()
  assert.ok(late !== null, '超时后流应保持未消费状态')
})

test('probeSseHead：HTTP 200 流内的错误帧判为 error，message 取自帧内（cline 场景）', async () => {
  const stream = new PassThrough()
  const pending = probeSseHead(
    stream,
    'data: {"error":{"message":"cline: Failed to create stream: inference request failed: failed to generate stream from Vercel: failed to invoke model \'reflection/beam-free\' with streaming: request failed with status 400: Invalid value for \'tools\': maximum number of items is 128.","statusCode":400}}\n\n'
  )
  // 错误帧就是首块：嗅探应同步判定，无需等待更多数据
  const probe = await pending
  assert.equal(probe.kind, 'error')
  if (probe.kind !== 'error') return
  assert.match(probe.message, /maximum number of items is 128/)
})

test('probeSseHead：错误帧后紧跟 [DONE] 与 end 也不改判', async () => {
  const stream = new PassThrough()
  const pending = probeSseHead(stream, 'data: {"error":{"message":"boom"}}\n\n')
  stream.write('data: [DONE]\n\n')
  stream.end()
  const probe = await pending
  assert.equal(probe.kind, 'error')
})

test('probeSseHead：OpenAI 规范形状的错误帧（choices:[] + error）也必须判 error（2026-10-31 报障）', async () => {
  // 03:30:14 实发帧：渠道投影的错误帧带 choices:[]（OpenAI 中流错误规范形状），
  // 旧判定 `'choices' in record` 先命中 → 被当内容帧放行 → auto 换家失明 →
  // 错误帧透传给 Qoder 踩中其 outerProvider 崩溃。
  const stream = new PassThrough()
  const firstChunk = 'data: {"id":"chatcmpl-mvvd9z4l-mlsczv","object":"chat.completion.chunk","created":1793388614,"model":"cline/reflection/beam-free","choices":[],"error":{"message":"cline: inference request failed","type":"server_error","code":"SERVER"}}\n\n'
  const pending = probeSseHead(stream, firstChunk)
  stream.write('data: [DONE]\n\n')
  stream.end()
  const probe = await pending
  assert.equal(probe.kind, 'error', '带 choices:[] 的错误帧不得被判成内容帧')
  if (probe.kind !== 'error') return
  assert.match(probe.message, /inference request failed/)
})

test('probeSseHead：正常 role 首帧立即放行，缓冲块原样带回', async () => {
  const stream = new PassThrough()
  const firstChunk = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":""}}]}\n\n'
  const pending = probeSseHead(stream, firstChunk)
  const probe = await pending
  assert.equal(probe.kind, 'ok')
  if (probe.kind !== 'ok') return
  assert.equal(probe.buffered.length, 1)
  assert.equal(probe.buffered[0], firstChunk)
})

test('probeSseHead：注释帧与半帧跨块后见到内容帧判 ok，buffered 不丢块', async () => {
  const stream = new PassThrough()
  const pending = probeSseHead(stream, ': ping\n\ndata: {"choices":[{"del')
  const probePromise = pending.then((probe) => {
    assert.equal(probe.kind, 'ok')
    if (probe.kind !== 'ok') return
    assert.equal(probe.buffered.length, 2)
  })
  stream.write('ta":{"content":"hi"}}]}\n\n')
  await probePromise
})

test('probeSseHead：流在内容帧之前 end（纯 [DONE] / 空）判为 error 参与换家', async () => {
  const doneOnly = new PassThrough()
  const pendingDone = probeSseHead(doneOnly, 'data: [DONE]\n\n')
  doneOnly.end()
  assert.equal((await pendingDone).kind, 'error')

  const empty = new PassThrough()
  const pendingEmpty = probeSseHead(empty, '')
  empty.end()
  assert.equal((await pendingEmpty).kind, 'error')
})

test('forwarder 的流式路径必须先嗅探头部再转发（HTTP 200 流内错误帧要能进换家循环）', () => {
  assert.match(
    forwarderSource,
    /const probe = await probeSseHead\(upstream, first\.chunk\)/,
    'account-channel streaming must probe the SSE head before piping to the client',
  )
})

test('autoRouter 必须按渠道 maxTools 前置跳过装不下的渠道（cline ≤ 128）', () => {
  const source = readFileSync('src/main/proxy/autoRouter.ts', 'utf-8')
  // P1-4 之后渠道定义先取一次（能力位与 maxTools 同一循环共用），再查 maxTools。
  assert.match(
    source,
    /getChannelDefinition\(provider\.id\)/,
    'auto candidate selection must consult the channel definition before sending upstream',
  )
  assert.match(
    source,
    /channelDefinition\?\.maxTools/,
    'auto candidate selection must skip channels whose tools limit is exceeded before sending upstream',
  )
})

test('worker 的 model.rateLimits rpc 必须剥 provider 前缀再查限流键', () => {
  // 宿主 actualModel 形如 loomy/spark-x2.6，worker 限流键是裸名 spark-x2.6 ——
  // 不剥前缀预检永远查不到（2026-10-30 限流预检漏拦的根因）。
  const source = readFileSync('vendor/channel-pack/src/channel-pack-rpc.ts', 'utf-8')
  assert.match(
    source,
    /modelId\.startsWith\(`\$\{req\.provider\}\/`\)/,
    'model.rateLimits handler must strip the provider prefix before looking up rate-limit keys',
  )
})

test('forwarder 的换家判据必须接上：超限 400 参与换家，普通 400 仍然直接失败', () => {
  // 钉调用点：forwardFirstReachable 在 4xx 判定之前先查「换一家就能成」的三类
  // （工具数超限 + 历史缺 reasoning_content + 渠道目录不认这个模型）
  assert.match(
    forwarderSource,
    /const capabilityMismatch = isToolOverflowError\(result\.error\)\s*\n\s*\|\| isMissingReasoningHistoryError\(result\.error\)\s*\n\s*\|\| isChannelModelUnavailableError\(result\.error\)/,
    'forwardFirstReachable must consult the switch-to-next-candidate classes before rejecting failover',
  )
  // probe 错误帧映射：能力不匹配类 400 保持 400（换取「不计账号失败」的换家语义）
  assert.match(
    forwarderSource,
    /isToolOverflowError\(probe\.message\) \|\| isMissingReasoningHistoryError\(probe\.message\)\s*\n\s*\? 400\s*\n\s*: 502/,
    'probe error frames must keep capability-mismatch 400s at 400 so they fail over without account-failure penalty',
  )
  // 钉不变量：普通 4xx（非超限）依旧不可换家 —— 这条语义不许被顺手改掉
  assert.equal(isFailoverEligibleStatus(400), false)
  assert.equal(isFailoverEligibleStatus(404), false, '404 仍靠消息判据单独放行，纯状态码语义不许漂')
  assert.equal(isFailoverEligibleStatus(429), true)
  assert.equal(isFailoverEligibleStatus(502), true)
})

test('forwarder 的流式路径必须等首事件再定成败（建流失败要能进换家循环）', () => {
  assert.match(
    forwarderSource,
    /const first = await firstStreamEvent\(upstream\)/,
    'account-channel streaming must await the first stream event before declaring success',
  )
})

test('forwarder 的流式路径必须处理等首事件超时（假死渠道不能悬住换家循环）', () => {
  // 超时分支必须存在且先销毁源流（触发 openStream 的 close → cancel，
  // 渠道 worker 才会中止上游请求，配额不被白烧到自然结束）。
  assert.match(
    forwarderSource,
    /first\.kind === 'timeout'/,
    'account-channel streaming must treat a first-event timeout as a failure',
  )
  assert.match(
    forwarderSource,
    /status: 504/,
    'a first-event timeout must map to 504 so the failover loop keeps trying',
  )
})

/* ---------------- PLAN P0-1：分级尝试上限 + 墙钟预算 ---------------- */

test('可恢复类失败识别：各家渠道的排队/额度原文命中', () => {
  // 排队：ModelQueuedError 的 message 与原始排队 JSON 体
  assert.ok(isRecoverableChannelFailure('模型排队中'))
  assert.ok(isRecoverableChannelFailure('{"code":"10605","message":"{\\"isQueued\\":true}"}'))
  // 额度：qoder 110 / buddy 所有账号受限 / 通用 quota 文案
  assert.ok(isRecoverableChannelFailure('qoder: Billing daily count exceeded (110/model_error)'))
  assert.ok(isRecoverableChannelFailure('loomy: 模型 spark-x2.6 所有账号均受限，请稍后再试'))
  assert.ok(isRecoverableChannelFailure('insufficient_quota: You exceeded your current quota'))
})

test('可恢复类失败识别：窄口径，账号故障与无关文案不得误判', () => {
  assert.equal(isRecoverableChannelFailure(undefined), false)
  assert.equal(isRecoverableChannelFailure(''), false)
  // 账号故障类：5xx / 网络错误 —— 这些要走账号故障类的紧上限
  assert.equal(isRecoverableChannelFailure('Internal Server Error'), false)
  assert.equal(isRecoverableChannelFailure('socket hang up'), false)
  assert.equal(isRecoverableChannelFailure('Request failed with status code 502'), false)
  // 工具数超限走自己的分支，不属于可恢复渠道失败
  assert.equal(isRecoverableChannelFailure("Invalid value for 'tools': maximum number of items is 128."), false)
})

test('分级尝试上限：纯账号故障撞基础上限收手；排队/额度类放行到扩展上限', () => {
  const base = { baseCap: 3, extendedCap: 6, elapsedMs: 0, budgetMs: AUTO_WALL_CLOCK_BUDGET_MS }
  // 连续 3 次 5xx：第 4 家不再试（与旧行为一致）
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 3, accountFailures: 3 }), false)
  // 连续排队/额度失败：不占账号故障上限，第 4~6 家继续试
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 3, accountFailures: 0 }), true)
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 5, accountFailures: 1 }), true)
  // 扩展上限到顶：总尝试不超过候选列表长度
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 6, accountFailures: 0 }), false)
  // 混合序列：1 次额度失败 + 3 次 5xx → 账号故障撞满，收手
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 4, accountFailures: 3 }), false)
})

test('墙钟预算：预算耗尽停止换家，但首个候选永远要试', () => {
  const base = { attempts: 3, accountFailures: 1, baseCap: 3, extendedCap: 6, budgetMs: AUTO_WALL_CLOCK_BUDGET_MS }
  assert.equal(AUTO_WALL_CLOCK_BUDGET_MS, 90_000, '换家墙钟预算钉在 90s')
  // 未超预算：继续换家
  assert.equal(shouldTryNextAutoCandidate({ ...base, elapsedMs: 89_999 }), true)
  // 超预算：停止（返回最后失败，而不是零结果）
  assert.equal(shouldTryNextAutoCandidate({ ...base, elapsedMs: 90_000 }), false)
  // 首个候选不受预算约束：预检等前置步骤耗光预算时，零尝试会变成莫名 503
  assert.equal(shouldTryNextAutoCandidate({
    attempts: 0,
    accountFailures: 0,
    baseCap: 3,
    extendedCap: 6,
    elapsedMs: 120_000,
    budgetMs: AUTO_WALL_CLOCK_BUDGET_MS,
  }), true)
})

test('forwarder 的换家循环必须按分级上限与墙钟预算收口（源码钉点）', () => {
  // 循环头调用分级判据
  assert.match(
    forwarderSource,
    /shouldTryNextAutoCandidate\(\{/,
    'forwardFirstReachable must consult the tiered-attempt predicate before each extra attempt',
  )
  // 账号故障类计数：可恢复类失败不得计入
  assert.match(
    forwarderSource,
    /result\.status !== 429 && !isRecoverableChannelFailure\(result\.error\)/,
    'only non-recoverable failures may count toward the account-failure cap',
  )
})

test('autoRouter 候选必须放宽到基础上限 + 可恢复余量（源码钉点）', () => {
  assert.match(
    autoRouterSource,
    /candidates\.slice\(0, maxAttempts \+ AUTO_RECOVERABLE_EXTRA_ATTEMPTS\)/,
    'select must hand the forwarder the extended candidate tail for recoverable failures',
  )
  assert.equal(AUTO_RECOVERABLE_EXTRA_ATTEMPTS, 3, '默认 3 + 3 = 6 家')
})

/* ---------------- PLAN P0-2：跳过原因透出 ---------------- */

test('autoRouter 必须收集 maxTools 与额度门控的剔除原因（源码钉点）', () => {
  assert.match(
    autoRouterSource,
    /skipped\.add\(`\$\{provider\.id\}:tools_limit`\)/,
    'maxTools-excluded channels must be recorded as skipped',
  )
  assert.match(
    autoRouterSource,
    /skipped\.add\(`\$\{provider\.id\}\/\$\{model\.displayName\}:\$\{quotaBlocked\}`\)/,
    'quota-gated candidates must be recorded as skipped with the block reason',
  )
})

test('chat 路由必须把跳过清单写进 X-ModelPort-Auto-Skipped（源码钉点）', () => {
  // 限流预检剔除时要记录原因（带复位时间）
  assert.match(
    chatRouteSource,
    /quota_reset_in_\$\{resetMinutes\}m/,
    'rate-limit pre-check drops must record the reset ETA as the skip reason',
  )
  // 头必须在任何 return 之前写（候选被剔光的 503 也带得上解释）
  assert.match(
    chatRouteSource,
    /ctx\.set\('X-ModelPort-Auto-Skipped', toHeaderValue\(autoDecision\.skipped\.join\(','\)\)\)/,
    'the skipped list must be surfaced as X-ModelPort-Auto-Skipped',
  )
})
