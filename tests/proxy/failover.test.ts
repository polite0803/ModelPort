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
 *
 * 换家取证（用户报障 2026-11-01，auto 连续两次答「末尾没有用户指令」）：
 * 8. 每个被跳过的候选按错误类记进日志（`auto.failures`）—— 请求日志原先只有
 *    最终赢家，`attempts: 4` 看不出前三家各自答了什么，于是「一家天天全错」
 *    与「一家偶发排队」在日志里长得一模一样。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'stream'

import {
  ATTEMPT_REASON_MAX_CHARS,
  AUTO_RECOVERABLE_EXTRA_ATTEMPTS,
  AUTO_WALL_CLOCK_BUDGET_MS,
  createIdleWatchdog,
  describeAttemptFailure,
  FIRST_EVENT_TIMEOUT_MS,
  firstStreamEvent,
  isChannelCredentialFailure,
  isChannelHumanRequiredFailure,
  isChannelRiskControlFailure,
  isChannelModelUnavailableError,
  isFailoverEligibleStatus,
  isForcedToolChoiceUnsupported,
  isMissingReasoningHistoryError,
  isRecoverableChannelFailure,
  isToolOverflowError,
  probeSseHead,
  shouldTryNextAutoCandidate,
} from '../../src/main/proxy/failover.ts'

const forwarderSource = readFileSync('src/main/proxy/forwarder.ts', 'utf-8')
const autoRouterSource = readFileSync('src/main/proxy/autoRouter.ts', 'utf-8')
const chatRouteSource = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')
const completionsRouteSource = readFileSync('src/main/proxy/routes/completions.ts', 'utf-8')
const channelsManagerSource = readFileSync('src/main/providers/accountChannels/manager.ts', 'utf-8')

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
    /const first = await firstStreamEvent\(\s*upstream\b/,
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

/* ---------------- 换家取证：被跳过的候选各自答了什么 ---------------- */

test('失败分类：能力不匹配类优先于状态码语义（400 也能换家）', () => {
  // 三类「换一家就能成」的 400/404，kind 都是 capability —— 与 forwarder
  // 循环里不计账号失败、不进冷却的那三个分支同一判据。
  const toolOverflow = describeAttemptFailure({
    candidate: 'cline/reflection/beam-free',
    status: 400,
    error: "Invalid value for 'tools': maximum number of items is 128.",
  })
  assert.equal(toolOverflow.kind, 'capability')
  assert.equal(toolOverflow.status, 400)

  assert.equal(describeAttemptFailure({
    candidate: 'workbuddy/hy3',
    status: 400,
    error: "Missing required parameter: 'messages[6].reasoning_content'",
  }).kind, 'capability')

  assert.equal(describeAttemptFailure({
    candidate: 'opencode/qwen3.8-max',
    status: 404,
    error: '模型不存在或已停用',
  }).kind, 'capability')
})

test('失败分类：账号故障与暂时不可服务记 failover，普通 4xx 记 fatal', () => {
  // 5xx / 429 / 无状态码（网络错误、超时）= 换家循环实际会继续试的那一类
  assert.equal(describeAttemptFailure({ candidate: 'loomy/spark-x2.6', status: 502, error: 'Bad Gateway' }).kind, 'failover')
  assert.equal(describeAttemptFailure({ candidate: 'qoder/qfmodel', status: 429, error: '模型排队中' }).kind, 'failover')
  assert.equal(describeAttemptFailure({ candidate: 'raccoon/glm', error: 'socket hang up' }).kind, 'failover')
  // 400（非能力类）当场把链打断 —— 日志要能看出「这一家之后没再试」的原因不是暂时故障
  assert.equal(describeAttemptFailure({ candidate: 'buddy/hy3', status: 400, error: 'invalid api key' }).kind, 'fatal')
})

test('失败记录：无状态码时不写 status 键，空错误文本给可读兜底', () => {
  // 「键直接不出现」而不是 undefined：日志消费方（仪表盘/JSON 导出）不能看到
  // 一个把「上游没答」和「上游答了 200」混在一起的 null。
  const networkOnly = describeAttemptFailure({ candidate: 'zcode/glm-5.2', error: 'fetch failed' })
  assert.ok(!('status' in networkOnly), 'status 缺失时不得出现该键')
  assert.equal(networkOnly.reason, 'fetch failed')

  // 假死/零字节流只有状态码没有文案，兜底文案要说明白「上游没给错误文本」
  assert.equal(describeAttemptFailure({ candidate: 'trae/deepseek-v4.1-flash', status: 504 }).reason, '上游未给出错误文本')
  assert.equal(describeAttemptFailure({ candidate: 'trae/deepseek-v4.1-flash' }).reason, '上游未给出错误文本')
})

test('失败记录：文案去首尾空白并按上限截断（日志体积有界）', () => {
  assert.equal(ATTEMPT_REASON_MAX_CHARS, 200, '单条原因钉在 200 字符')
  const long = `  ${'排队中，'.repeat(100)}尾部不该出现  `
  const record = describeAttemptFailure({ candidate: 'qoder/dfmodel', status: 429, error: long })
  assert.equal(record.reason.length, ATTEMPT_REASON_MAX_CHARS)
  assert.ok(!record.reason.includes('尾部不该出现'), '只留前 200 字符')
  assert.ok(!record.reason.startsWith(' '), '首尾空白必须先去掉')
})

test('换家取证必须落到源码：循环记录每次失败，日志写出 failures（源码钉点）', () => {
  // 循环里的记账点必须在 capability/fatal 分支之前 —— fatal 也要留痕，
  // 否则「为什么链在这里断了」仍然无处可查。
  assert.match(
    forwarderSource,
    /failures\.push\(describeAttemptFailure\(\{\s*\n\s*candidate: candidate\.displayName,\s*\n\s*error: result\.error,\s*\n\s*status: result\.status,\s*\n\s*\}\)\)[\s\S]{0,1600}?if \(!capabilityMismatch\)/,
    'every failed attempt must be described before the failover branch decides where to go next',
  )
  // 每个出口都要带上清单（成功那轮的返回值同样含此前被跳过的家）
  assert.match(
    forwarderSource,
    /const finish = \(\): ForwardChainOutcome<T> \| null =>\s*\n\s*last === null \? null : \{ \.\.\.last, failures: failures\.slice\(0, MAX_LOGGED_ATTEMPT_FAILURES\) \}/,
    'the chain loop must return the failure list from a single capped exit helper',
  )
  // 日志侧：非空才写键，第一家命中时不出现空数组
  assert.match(
    chatRouteSource,
    /\.\.\.\(failures\.length > 0 \? \{ failures \} : \{\}\)/,
    'the auto log record must carry failures only when a candidate was actually switched past',
  )
  assert.match(
    chatRouteSource,
    /autoFailures = outcome\.failures/,
    'the chat route must adopt the forwarder per-attempt failure list',
  )
})

/**
 * 2026-11-01 新增的两类判据（192.168.85.131 实测：凭据类失败 27 笔、强制
 * tool_choice 类 400 三笔且 `att=1` 直接整场失败）。
 *
 * 两条都要求**负样本**：判据一宽，就会把无关的 4xx 变成「可换家」，那是用
 * 户点名的那一家被悄悄跳过。
 */
test('credential-class failures are recognised from the pack wording only', () => {
  assert.equal(isChannelCredentialFailure('qoder: no usable credential; log in first'), true)
  assert.equal(isChannelCredentialFailure('凭据未配置，请先登录'), true)
  assert.equal(isChannelCredentialFailure('opencode: 没有可用通道'), true)

  // 负样本：目录不认模型、强制 tool_choice、配额、普通正文都不能命中。
  assert.equal(isChannelCredentialFailure('模型不存在或已停用'), false)
  assert.equal(isChannelCredentialFailure('only tool_choice auto and none are supported'), false)
  assert.equal(isChannelCredentialFailure('qoder: Billing daily count exceeded'), false)
  assert.equal(isChannelCredentialFailure('The model `X` does not exist.'), false)
  assert.equal(isChannelCredentialFailure(undefined), false)
})

test('forced tool_choice rejection is a capability gap, not an account fault', () => {
  assert.equal(isForcedToolChoiceUnsupported('only tool_choice auto and none are supported'), true)
  assert.equal(isForcedToolChoiceUnsupported("Error: only 'tool_choice' auto and none are supported"), true)

  // 负样本：只出现 tool_choice、或只出现 auto/none 字样的普通文本都不算。
  assert.equal(isForcedToolChoiceUnsupported('invalid value for tool_choice'), false)
  assert.equal(isForcedToolChoiceUnsupported('the model supports auto and none modes'), false)
  assert.equal(isForcedToolChoiceUnsupported(undefined), false)

  // 归类：capability（换下一家、不记冷却、不计账号故障）。
  const failure = describeAttemptFailure({
    candidate: 'MiniMax Code / M3',
    error: 'only tool_choice auto and none are supported',
    status: 400,
  })
  assert.equal(failure.kind, 'capability')
})

test('credential failures stay a failover class so the chain keeps going', () => {
  // 与 capability 类区分开：凭据死了是这一家真的不可用，要记冷却（冷却档位本身
  // 由 accountRuntime.recordCredentialFailure 钉，见 tests/proxy/accountRuntime.test.ts）。
  const failure = describeAttemptFailure({
    candidate: 'Qoder / Qwen3.8-Flash',
    error: 'qoder: no usable credential; log in first',
    status: 502,
  })
  assert.equal(failure.kind, 'failover')
  assert.equal(failure.status, 502)
})

/**
 * 块间静默看门狗（2026-11-01 实测两笔 `auto` 流式请求各挂 120s 零字节：
 * 首块一到就记成功，之后停摆的流原先没有任何时间上限）。
 *
 * 判据本体抽成 `createIdleWatchdog` 就是为了这四条能真跑，而不是读源码文本。
 */
test('idle watchdog fires once after the configured silence', async () => {
  let fired = 0
  const watchdog = createIdleWatchdog(20, () => { fired += 1 })
  watchdog.arm()
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(fired, 1)
  // 到点后不会自己连发（每笔请求只该被中止一次）。
  assert.equal(fired, 1)
})

test('idle watchdog measures silence between frames, not the whole request', async () => {
  let fired = 0
  const watchdog = createIdleWatchdog(30, () => { fired += 1 })
  // 每 10ms 续一次，共 60ms —— 超过 timeoutMs 的总时长，但没有任何一段静默到点。
  for (let i = 0; i < 6; i++) {
    watchdog.arm()
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(fired, 0, '持续有帧的流永远不该被停摆判死')
  // 停止续期后才炸，且只炸一次。
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(fired, 1)
})

test('idle watchdog clear stops it for good', async () => {
  let fired = 0
  const watchdog = createIdleWatchdog(20, () => { fired += 1 })
  watchdog.arm()
  watchdog.clear()
  watchdog.arm()
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(fired, 0, 'clear 之后 arm 必须无效，否则结算完还会回炸一次')
})

test('a non-positive timeout disables the watchdog instead of firing instantly', async () => {
  let fired = 0
  const watchdog = createIdleWatchdog(0, () => { fired += 1 })
  watchdog.arm()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(fired, 0)
})

/* ---------------- 2026-11-01 接线门：等待与判据必须真的被请求路径读到 ----------------
 *
 * forwarder / bridge 背着 electron 依赖，`node --test` 拉不动（本文件头注释同因），
 * 所以这四条只能按源码文本判。规则与既有那几条一致：**验语义写法而非行号**，
 * 并允许换行与参数形式变化；每条都配一条「不接线就红」的反向说明。
 */
const bridgeSource = readFileSync('src/main/channelPack/bridge.ts', 'utf-8')
const storeSource = readFileSync('src/main/store/store.ts', 'utf-8')

test('请求超时这一格必须被读进等待计划（否则设置又是装饰品）', () => {
  assert.match(storeSource, /configureRequestDeadlines\(\s*(rawConfig|config)\.requestTimeout\s*\)/,
    'store must feed config.requestTimeout into the deadline mirror on every config read')
  assert.match(bridgeSource, /requestDeadlines\(\)\.completeMs/,
    'the channel non-stream completion must be bounded by the plan, not by 0 (never-timeout)')
  assert.match(bridgeSource, /DSH_QODER_QUEUE_TIMEOUT_MS\s*:/,
    'the pack queue budget must be injected from the plan, otherwise it stays at its 30-minute default')
})

test('墙钟预算必须折算成单次截止（不然一笔悬挂就吃掉整条链）', () => {
  assert.match(forwarderSource, /attemptDeadlineMs\s*:\s*planAttemptDeadline\(/,
    'the failover loop must pass a per-attempt deadline derived from the remaining wall budget')
  assert.match(forwarderSource, /request\.attemptDeadlineMs\s*\?\?\s*requestDeadlines\(\)\.completeMs/,
    'the account-channel forward must honour that per-attempt deadline')
})

test('流式首块之后的停摆必须由看门狗兜住', () => {
  assert.match(bridgeSource, /createIdleWatchdog\(\s*requestDeadlines\(\)\.idleMs\s*,/,
    'the stream job must own an idle watchdog sized by the plan')
  assert.match(bridgeSource, /job\?\.watchdog\)\s*job\.watchdog\.arm\(\)/,
    'every sse frame must re-arm the watchdog (it measures silence between frames)')
})

test('凭据类与强制 tool_choice 类判据必须接进请求路径', () => {
  // 凭据类：不重试（否则同一笔等待再付一遍）+ 按人工介入档冷却。
  assert.match(forwarderSource, /if\s*\(\s*isChannelHumanRequiredFailure\(result\.error\)\s*\)\s*\{?\s*\n?\s*break/,
    'credential- and risk-control-class failures must not be retried by the host')
  assert.match(forwarderSource, /autoRouter\.markCredentialCooldown\(/,
    'credential-class failures must use the human-intervention cooldown tier')
  // 强制 tool_choice：按 capability 类换下一家，而不是整场 400。
  assert.match(forwarderSource, /\|\|\s*isForcedToolChoiceUnsupported\(result\.error\)/,
    'forced tool_choice rejection must join the capability-mismatch set so the chain keeps trying')
})

test('限流退避的键必须带到模型粒度（接线门）', () => {
  // 账号渠道在宿主侧只有一个占位账号，整条线路共用它。哪一处调用漏了模型参数，
  // 那一处就退回「同渠道别的模型成功一次 → 把正在限流的模型放出去重付一遍 prefill」。
  // 语义判据本身在 tests/proxy/accountRuntime.test.ts，这里只管接线。
  assert.match(
    forwarderSource,
    /recordFailure\(\s*account\.id\s*,\s*429\s*,\s*Date\.now\(\)\s*,\s*actualModel\s*\)/,
    'the 429 record must be keyed by the model actually sent upstream',
  )
  assert.match(
    forwarderSource,
    /recordSuccess\(\s*account\.id\s*,\s*actualModel\s*\)/,
    'a success must clear only this model rate-limit tier',
  )
  assert.match(
    autoRouterSource,
    /accountRuntime\.snapshot\(\s*account\.id\s*,\s*now\s*,\s*model\.actualModelId\s*\)/,
    'candidate scoring must ask about (account, model), not just the account',
  )
  assert.match(
    chatRouteSource,
    /clearAccountCooldown\(\s*account\.id\s*,\s*actualModel\s*\)/,
    'the chat route success path must pass the model',
  )
  assert.match(
    completionsRouteSource,
    /clearAccountCooldown\(\s*account\.id\s*,\s*actualModel\s*\)/,
    'the completions route success path must pass the model',
  )
  // 反向：池子变化/重新登录是整账号语义，这里必须**不带**模型，否则换了凭据
  // 还要等旧限流窗自然到期。
  assert.match(
    channelsManagerSource,
    /recordSuccess\(\s*account\.id\s*\)/,
    'a channel-pool change must clear every rate-limit tier of that account',
  )
  assert.doesNotMatch(
    channelsManagerSource,
    /recordSuccess\(\s*account\.id\s*,/,
    'the pool-change call must not be narrowed to one model',
  )
})

/**
 * 2026-11-01 部署后从真流量日志里补的两类（各 15 / 9 笔，探针矩阵看不见）：
 * - 「可用账号均在限流中」：渠道包在发请求**之前**就报，且原文明确写「无需重新登录」
 *   —— 是定时限流，不该占账号故障上限，也不该进人工介入冷却档；
 * - 「request illegal / 请求被拦截」：上游风控，渠道包逐账号实测是**账号级**
 *   （同一请求体 7 个账号 2 通 4 拦），落 400 时原先会把整条 `auto` 链打死。
 */
test('定时限流算可恢复类，但不算人工介入类', () => {
  const limited = 'Raccoon (商汤)：模型 sn-deepseek-v4-1-flash-1017 的可用账号均在限流中，'
    + '最近一个将于 2026/11/1 20:00:00 解禁。可改用其它 provider / 模型，或等待解禁后再试（无需重新登录）。'
  assert.equal(isRecoverableChannelFailure(limited), true)
  assert.equal(isChannelCredentialFailure(limited), false)
  assert.equal(isChannelRiskControlFailure(limited), false)
  assert.equal(isChannelHumanRequiredFailure(limited), false)
  assert.equal(isRecoverableChannelFailure('raccoon: 您的模型请求频率超限，请稍后重试'), true)
})

test('风控拦截属人工介入类，凭据类不算风控', () => {
  assert.equal(isChannelRiskControlFailure('workbuddy: 请求被拦截，请重新发送 request illegal'), true)
  assert.equal(isChannelHumanRequiredFailure('workbuddy: 请求被拦截，请重新发送 request illegal'), true)
  assert.equal(isChannelRiskControlFailure('qoder: no usable credential; log in first'), false)
  assert.equal(isChannelHumanRequiredFailure('qoder: no usable credential; log in first'), true)
  // 负样本：普通正文、限流、目录不认模型都不命中。
  assert.equal(isChannelRiskControlFailure('模型不存在或已停用'), false)
  assert.equal(isChannelRiskControlFailure('The safety of your request was reviewed.'), false)
})

test('风控类 400 在日志里记成 failover，而不是 fatal', () => {
  // 判据与换家分支必须同源：`kind` 说 fatal 而循环其实往下试了下一家，
  // 日志就会把「这一家被风控」和「客户端请求写错」写成同一件事。
  const failure = describeAttemptFailure({
    candidate: 'WorkBuddy (腾讯) / Hy3',
    error: 'workbuddy: 请求被拦截，请重新发送 request illegal',
    status: 400,
  })
  assert.equal(failure.kind, 'failover')
  assert.equal(failure.status, 400)
})
