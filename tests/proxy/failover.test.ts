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
  AUTO_EXHAUSTED_RETRY_AFTER_SECONDS,
  AUTO_WALL_CLOCK_BUDGET_MS,
  autoExhaustedResponse,
  createIdleWatchdog,
  describeAttemptFailure,
  FIRST_EVENT_TIMEOUT_MS,
  firstStreamEvent,
  isAccountFaultStatus,
  isChannelCredentialFailure,
  isChannelHumanRequiredFailure,
  isChannelRiskControlFailure,
  isChannelModelUnavailableError,
  isFailoverEligibleStatus,
  isSameProviderRotationStatus,
  isForcedToolChoiceUnsupported,
  isMissingReasoningHistoryError,
  isMissingSessionAffinityError,
  isAccountArrearsError,
  isRecoverableChainExhaustion,
  isOpaqueAggregateBadRequest,
  isRecoverableChannelFailure,
  isSameTargetRetryableStatus,
  isContextOverflowError,
  isReasoningEffortUnsupportedError,
  isToolOverflowError,
  isUpstreamCatalogMissError,
  parseRetryAfterSeconds,
  probeSseHead,
  shouldTryNextAutoCandidate,
} from '../../src/main/proxy/failover.ts'

/**
 * 源码钉点统一按 LF 读取：Windows 检出是 CRLF 时，`\n`-only 的锚点正则会在
 * `\r\n` 上失配。规范化只影响换行符，不改变被断言的内容。
 */
function readSource(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
}

const forwarderSource = readSource('src/main/proxy/forwarder.ts')
const autoRouterSource = readSource('src/main/proxy/autoRouter.ts')
const chatRouteSource = readSource('src/main/proxy/routes/chat.ts')
const completionsRouteSource = readSource('src/main/proxy/routes/completions.ts')
const channelsManagerSource = readSource('src/main/providers/accountChannels/manager.ts')

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

test('上下文超限识别：命中各家上游的真实文案', () => {
  // OpenAI 形状（code 在 details 里，message 自带 maximum context length）
  assert.ok(isContextOverflowError(
    "This model's maximum context length is 8192 tokens, however you requested 30000 tokens"))
  assert.ok(isContextOverflowError('Invalid request: context_length_exceeded'))
  // Anthropic 形状
  assert.ok(isContextOverflowError('prompt is too long: 1000000 tokens > 200000 maximum'))
  // 自研网关的英文与中文措辞
  assert.ok(isContextOverflowError('context window exceeded for this request'))
  assert.ok(isContextOverflowError('input tokens exceed the model limit'))
  assert.ok(isContextOverflowError('请求超出模型上下文长度限制'))
})

test('上下文超限识别：窄口径，别的 400 一律不得误判成可换家', () => {
  assert.equal(isContextOverflowError(undefined), false)
  assert.equal(isContextOverflowError(''), false)
  // 只有 token / context 单词，没有超限短语
  assert.equal(isContextOverflowError('usage of tokens is billed per request'), false)
  assert.equal(isContextOverflowError('context is not a supported field'), false)
  // 数量超限但不是上下文（消息条数 / 工具数）
  assert.equal(isContextOverflowError('maximum number of messages is 128'), false)
  assert.equal(isContextOverflowError("Invalid value for 'tools': maximum number of items is 128."), false)
  // 额度/计费类超限不该被当成窗口不够
  assert.equal(isContextOverflowError('quota exceeded, please recharge'), false)
  assert.equal(isContextOverflowError('rate limit exceeded'), false)
})

test('转发层把上下文超限接进「换一家就能成」，普通 400 仍终止', () => {
  // 窗口 600 → 900：这条链的中文注释在 2026-11-06 之前已把距离推到 657
  // （HEAD 5536aac 上就已经红），断言要钉的是「谓词在这条链里」，不是相邻
  // 字符数。下一个同名谓词在 8.3k 字符之外，900 仍不会误配到 probe 分支。
  assert.match(
    forwarderSource,
    /const capabilityMismatch = isToolOverflowError\(result\.error\)[\s\S]{0,900}?\|\| isContextOverflowError\(result\.error\)/,
    'capabilityMismatch 必须包含上下文超限判据',
  )
  // 判据的接线位置只此一处：别的分支（isFailoverEligible / 状态码表）不许出现
  // isContextOverflowError，否则就等于把 400 整体变成可换家（窄口径由上面的
  // 路由级用例 proxy-routes-context-overflow 的 generic400 负控钉住）。
  // 四个调用点都要接上：import + auto 换家分支 + probe 错误帧 + 最终状态映射。
  // 少了 probe 那一支，流内浮现的超限会被算成 502 账号故障（2026-10-30 的老坑）。
  assert.equal(forwarderSource.split('isContextOverflowError').length - 1, 4)
  assert.match(forwarderSource, /\|\| isContextOverflowError\(probe\.message\)/)
  assert.match(forwarderSource, /\|\| isContextOverflowError\(message\)/)
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
  // DeepSeek 官方文案（2026-11-07 实测，聚合 deepseek 线 400）：没有
  // 「Missing required parameter」，只说必须回传 —— 同样要求字段名同时出现。
  assert.ok(isMissingReasoningHistoryError(
    'The `reasoning_content` in the thinking mode must be passed back to the API. '
    + '(request_id: 5cfc1895-47bb-4e19-9a39-ae61bfe6674d)',
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
  const source = readSource('src/main/proxy/autoRouter.ts')
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
  const source = readSource('vendor/channel-pack/src/channel-pack-rpc.ts')
  assert.match(
    source,
    /modelId\.startsWith\(`\$\{req\.provider\}\/`\)/,
    'model.rateLimits handler must strip the provider prefix before looking up rate-limit keys',
  )
})

test('forwarder 的换家判据必须接上：超限 400 参与换家，普通 400 仍然直接失败', () => {
  // 钉调用点：forwardFirstReachable 在 4xx 判定之前先查「换一家就能成」的那几类
  // （工具数超限 + 历史缺 reasoning_content + 渠道目录不认这个模型 + 强制 tool_choice
  // + 窗口装不下 + 不接受 reasoning_effort）
  assert.match(
    forwarderSource,
    /const capabilityMismatch = isToolOverflowError\(result\.error\)\s*\r?\n\s*\|\| isMissingReasoningHistoryError\(result\.error\)\s*\r?\n\s*\|\| isChannelModelUnavailableError\(result\.error\)/,
    'forwardFirstReachable must consult the switch-to-next-candidate classes before rejecting failover',
  )
  // probe 错误帧映射：能力不匹配类 400 保持 400（换取「不计账号失败」的换家语义）。
  // 逐谓词钉死两处出口，而不是给一个宽容差：新增一类能力失败（例如 2026-11-03 的
  // 「上游目录不认这个模型」）时，两个出口都必须显式接上，否则一处漏接就会把
  // 400 记成 fatal、连带记账。
  const probeStatusBlocks = [...forwarderSource.matchAll(/(isToolOverflowError\([^;]*?)\?\s*400\s*:\s*502/g)]
  assert.equal(probeStatusBlocks.length, 2, 'both probe exits must map capability 400s')
  for (const [index, block] of probeStatusBlocks.entries()) {
    for (const predicate of [
      'isToolOverflowError',
      'isMissingReasoningHistoryError',
      'isContextOverflowError',
      'isReasoningEffortUnsupportedError',
      'isUpstreamCatalogMissError',
    ]) {
      assert.ok(
        block[1].includes(predicate),
        `probe exit #${index + 1} must keep ${predicate} on the 400 side`,
      )
    }
  }
  // 换家循环必须把这类失败认成「换一家就能成」：不记冷却、不计账号失败
  assert.match(forwarderSource, /\|\| isUpstreamCatalogMissError\(result\.error\)/,
    'catalog-miss failures must take the capability-mismatch branch (fail over without account penalty)')
  // 2026-11-02 对齐 new-api：400 仍终止（能力类例外由文案判据放行）；
  // 401-407 / 409-499 / 5xx / 网络错误都可以换下一家。
  assert.equal(isFailoverEligibleStatus(400), false)
  assert.equal(isFailoverEligibleStatus(401), true, '凭据失效要换账号')
  assert.equal(isFailoverEligibleStatus(403), true, '权限/地区限制要换渠道')
  assert.equal(isFailoverEligibleStatus(404), true, '目录漂移要换下一家')
  assert.equal(isFailoverEligibleStatus(408), true, '超时要换下一家')
  assert.equal(isFailoverEligibleStatus(409), true)
  assert.equal(isFailoverEligibleStatus(429), true)
  assert.equal(isFailoverEligibleStatus(502), true)
  // 同目标重试与换家分开：408/504/524 不原地重试。
  assert.equal(isSameTargetRetryableStatus(408), false)
  assert.equal(isSameTargetRetryableStatus(504), false)
  assert.equal(isSameTargetRetryableStatus(524), false)
  assert.equal(isSameTargetRetryableStatus(429), false)
  assert.equal(isSameTargetRetryableStatus(502), true)
  assert.equal(isSameTargetRetryableStatus(undefined), true)
})

test('账号记账只收渠道级故障：客户端 400/404/422 不把健康账号打进失败池', () => {
  for (const status of [401, 403, 408, 429, 500, 502, 503]) {
    assert.equal(isAccountFaultStatus(status), true, `${status} 应记账号故障`)
  }
  for (const status of [400, 404, 405, 409, 413, 422, 499]) {
    assert.equal(isAccountFaultStatus(status), false, `${status} 不该记账号故障`)
  }
  assert.equal(isAccountFaultStatus(undefined), true, '网络错误记账号故障')

  // 同供应商换 Key 只在账号级故障时有用；404 是目录问题，换 Key 白打。
  assert.equal(isSameProviderRotationStatus(401), true)
  assert.equal(isSameProviderRotationStatus(404), false)
  assert.equal(isSameProviderRotationStatus(429), true)
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
  // BazaarLink 额度为 0：402 "requires more credits ... can only afford 0"（2026-11-03 用户报障）
  assert.ok(isRecoverableChannelFailure('This request requires more credits, or fewer max_tokens. You requested up to 1 tokens, but can only afford 0.'))
  assert.ok(isRecoverableChannelFailure('bazaarlink: You have insufficient credits for this request'))
  assert.ok(isRecoverableChannelFailure('You do not have enough credits for this request'))
  assert.ok(isRecoverableChannelFailure('Your credit balance is too low'))
  // opencode 匿名槽：「所有通道对该模型均受限（…(free_usage_limit)）」（2026-11-03 DSH 那笔）
  assert.ok(isRecoverableChannelFailure(
    'opencode: 所有通道对该模型均受限（opencode-anon-7b81de(free_usage_limit)）',
  ))
  // 渠道包池空门控：「账号池中的账号当前均不可用（余额为 0、已停用或凭据不可用）」（2026-11-11 codex 路由那笔 429）
  assert.ok(isRecoverableChannelFailure(
    'Cline：账号池中的账号当前均不可用（余额为 0、已停用或凭据不可用），已停止回退默认单凭据；请在 Channel Pack 重测账号或充值（这不是重新登录能解决的问题）。',
  ))
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
  // 「credit」不带不足语义时不命中（否则 payment/credit card 类文案会被误判成额度用尽）
  assert.equal(isRecoverableChannelFailure('Your credit card was declined'), false)
  assert.equal(isRecoverableChannelFailure('credits are added within 24 hours'), false)
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
  // 账号故障类计数：可恢复类与聚合不透明 400 都不得计入
  assert.match(
    forwarderSource,
    /result\.status !== 429 && !opaqueAggregateBadRequest && !isRecoverableChannelFailure\(result\.error\)/,
    'only non-recoverable, non-opaque-aggregate failures may count toward the account-failure cap',
  )
})

test('候选链不预裁家数，可恢复类失败由墙钟预算收口（源码钉点）', () => {
  // 2026-11-04 之前这条钉的是 `candidates.slice(0, maxAttempts + AUTO_RECOVERABLE_EXTRA_ATTEMPTS)`：
  // 选号阶段把池子裁到 6 家，等于替供应商决定「这条路由只准用这几个模型」。
  // 现在整条排序结果都交给换家循环，`extendedCap` 就是链长，可恢复类失败的家数上限
  // 落在墙钟预算上 —— 账号故障类仍然撞满 `baseCap` 就收手。
  assert.doesNotMatch(
    autoRouterSource,
    /candidates\.slice\(/,
    'select must hand the forwarder the whole ranked chain, not a pre-trimmed tail',
  )
  assert.match(
    forwarderSource,
    /extendedCap: candidates\.length/,
    'the failover loop caps attempts at the chain it was handed',
  )
  assert.equal(AUTO_WALL_CLOCK_BUDGET_MS, 90_000, '一条全是排队/额度失败的长链最多跑到这里')
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
  // 头必须在任何 return 之前写（候选被剔光的 503 也带得上解释），并且只透前
  // `AUTO_SKIPPED_HEADER_LIMIT` 条、其余折成 `+N`：候选链不再裁短之后，一条整渠道
  // 限流的链能把几十条原因塞进同一个每请求都发的响应头。
  assert.match(
    chatRouteSource,
    /const shown = autoDecision\.skipped\.slice\(0, AUTO_SKIPPED_HEADER_LIMIT\)/,
    'the skipped list must be capped before it goes into a header',
  )
  assert.match(
    chatRouteSource,
    /ctx\.set\('X-ModelPort-Auto-Skipped', toHeaderValue\(/,
    'the skipped list must be surfaced as X-ModelPort-Auto-Skipped, through toHeaderValue',
  )
  assert.match(
    chatRouteSource,
    /\+\$\{hidden\}/,
    'the hidden tail must be reported, not dropped silently',
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

test('失败分类：聚合条目的不透明 400 可换家，账号渠道仍 fatal', () => {
  // OVH 2026-11-02 实测：400 + "Unknown error"，换下一家（WorkBuddy/Loomy/Qoder）能成。
  assert.equal(isOpaqueAggregateBadRequest(400, 'Unknown error', 'aggregate'), true)
  assert.equal(isOpaqueAggregateBadRequest(400, '', 'aggregate'), true)
  assert.equal(describeAttemptFailure({
    candidate: 'ovh/gpt-oss-120b',
    status: 400,
    error: 'Unknown error',
    providerType: 'aggregate',
  }).kind, 'failover')

  // 负样本：同一状态码在账号渠道上仍是 fatal；聚合条目有明确文案时也不放行。
  assert.equal(isOpaqueAggregateBadRequest(400, 'Unknown error', 'account'), false)
  assert.equal(describeAttemptFailure({
    candidate: 'buddy/hy3',
    status: 400,
    error: 'Unknown error',
    providerType: 'account',
  }).kind, 'fatal')
  assert.equal(describeAttemptFailure({
    candidate: 'ovh/gpt-oss-120b',
    status: 400,
    error: 'invalid api key',
    providerType: 'aggregate',
  }).kind, 'fatal')
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

test('自动路由候选耗尽：多家试过且失败在候选侧才收口成可重试 503', () => {
  assert.deepEqual(autoExhaustedResponse(404, 'daily', '模型不存在或已停用', 2), {
    status: 503,
    type: 'service_unavailable_error',
    code: 'no_available_model',
    message: "Route 'daily' exhausted all 2 candidates (last: 模型不存在或已停用)",
    retryAfterSeconds: AUTO_EXHAUSTED_RETRY_AFTER_SECONDS,
  })

  // 2026-11-11 codex 路由那笔：链在第 3 家收手，最后一笔是渠道包的池空门控，透传成
  // 429 insufficient_quota ⇒ Codex 读成「你已达到使用上限」并终止这一轮。429 在客户端
  // 是终止语义，必须收成 503 + Retry-After 才是「等一会再来」。
  const poolExhausted = autoExhaustedResponse(
    429,
    'codex',
    'Cline：账号池中的账号当前均不可用（余额为 0、已停用或凭据不可用），已停止回退默认单凭据；'
    + '请在 Channel Pack 重测账号或充值（这不是重新登录能解决的问题）。',
    3,
  )
  assert.equal(poolExhausted?.status, 503)
  assert.equal(poolExhausted?.code, 'no_available_model')
  assert.equal(poolExhausted?.retryAfterSeconds, AUTO_EXHAUSTED_RETRY_AFTER_SECONDS)

  // 上游给了解禁时刻就用它，不吃默认值
  assert.equal(autoExhaustedResponse(429, 'codex', '均在限流中', 4, 1800)?.retryAfterSeconds, 1800)

  // 5xx / 401 / 403 在多家之后同属候选侧耗尽
  assert.ok(autoExhaustedResponse(500, 'daily', 'boom', 3))
  assert.ok(autoExhaustedResponse(401, 'daily', 'invalid api key', 2))
  assert.ok(autoExhaustedResponse(403, 'daily', 'permission_error', 2))

  // 第一家就失败：那是上游对这条请求的真回答，原样透传才准确
  assert.equal(autoExhaustedResponse(404, 'daily', 'The model does not exist', 1), null)
  assert.equal(autoExhaustedResponse(429, 'daily', '排队中', 1), null)

  // 客户端形状问题永不收口成「等一会再来」
  assert.equal(autoExhaustedResponse(400, 'daily', "Invalid value for 'tools'", 5), null)
  assert.equal(autoExhaustedResponse(422, 'daily', 'unprocessable', 5), null)

  // 既不是候选侧也不是客户端形状：不猜，交回既有映射
  assert.equal(autoExhaustedResponse(200, 'daily', 'stream ended without a message', 3), null)
  assert.equal(autoExhaustedResponse(undefined, 'daily', undefined, 3), null)
})

test('Retry-After 归一：秒数与 HTTP 日期都读，读不懂就当没给', () => {
  assert.equal(parseRetryAfterSeconds('120'), 120)
  assert.equal(parseRetryAfterSeconds(' 30 '), 30)
  assert.equal(parseRetryAfterSeconds(45), 45)
  assert.equal(parseRetryAfterSeconds(undefined), undefined)
  assert.equal(parseRetryAfterSeconds(''), undefined)
  assert.equal(parseRetryAfterSeconds('not a time'), undefined)
  assert.equal(parseRetryAfterSeconds(-1), undefined)
  const seconds = parseRetryAfterSeconds(new Date(Date.now() + 90_000).toUTCString())
  assert.ok(seconds !== undefined && seconds >= 80 && seconds <= 95, `date form -> ${seconds}`)
})

test('换家取证必须落到源码：循环记录每次失败，日志写出 failures（源码钉点）', () => {
  // 循环里的记账点必须在 capability/fatal 分支之前 —— fatal 也要留痕，
  // 否则「为什么链在这里断了」仍然无处可查。
  assert.match(
    forwarderSource,
    /failures\.push\(describeAttemptFailure\(\{\s*\r?\n\s*candidate: candidate\.displayName,\s*\r?\n\s*error: result\.error,\s*\r?\n\s*status: result\.status,\s*\r?\n\s*providerType: candidate\.provider\.type,[\s\S]{0,240}?\}\)\)[\s\S]{0,1600}?if \(!capabilityMismatch\)/,
    'every failed attempt must be described before the failover branch decides where to go next',
  )
  // 每个出口都要带上清单（成功那轮的返回值同样含此前被跳过的家）
  assert.match(
    forwarderSource,
    /const finish = \(\): ForwardChainOutcome<T> \| null =>[\s\S]{0,400}?failures: failures\.slice\(0, MAX_LOGGED_ATTEMPT_FAILURES\),[\s\S]{0,200}?attemptTrace: attemptTrace\.slice\(\)/,
    'the chain loop must return the failure list and attempt trace from one capped exit helper',
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
const bridgeSource = readSource('src/main/channelPack/bridge.ts')
const storeSource = readSource('src/main/store/store.ts')

test('请求超时这一格必须被读进等待计划（否则设置又是装饰品）', () => {
  assert.match(storeSource, /configureRequestDeadlines\(\s*(rawConfig|config)\.requestTimeout\s*\)/,
    'store must feed config.requestTimeout into the deadline mirror on every config read')
  assert.match(bridgeSource, /requestDeadlines\(\)\.completeMs/,
    'the channel non-stream completion must be bounded by the plan, not by 0 (never-timeout)')
  assert.match(bridgeSource, /DSH_QODER_QUEUE_TIMEOUT_MS\s*:/,
    'the pack queue budget must be injected from the plan, otherwise it stays at its 30-minute default')
})

test('墙钟预算必须折算成单次截止（不然一笔悬挂就吃掉整条链）', () => {
  assert.match(forwarderSource, /const attemptDeadlineMs = planAttemptDeadline\(\{/,
    'the failover loop must derive a per-attempt deadline from the remaining wall budget')
  assert.match(forwarderSource, /attemptRequest: ChatCompletionRequest = \{[\s\S]{0,220}?attemptDeadlineMs,/,
    'the derived deadline must actually reach the attempt request')
  assert.match(forwarderSource, /elapsedMs: budgetElapsedMs,/,
    'the deadline must be planned from elapsed wall time, not re-derived from a second clock')
  assert.match(forwarderSource, /capMs: FIRST_ATTEMPT_CAP_MS/,
    'the first attempt must get the lowered slice (user ruling 2026-11-12)')
  assert.match(forwarderSource, /remainingBudgetMs < MIN_REMAINING_FOR_NEXT_ATTEMPT_MS/,
    'the loop must not start another attempt once the wall budget is spent')
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
  assert.match(forwarderSource, /if\s*\(\s*isChannelHumanRequiredFailure\(result\.error\)\s*\)\s*\{?\s*\r?\n?\s*break/,
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
    /recordFailure\(\s*account\.id\s*,\s*429\s*,\s*Date\.now\(\)\s*,\s*actualModel\s*(?:,\s*retryAfterMs\s*)?\)/,
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

test('渠道包上报的解禁时刻必须透传到冷却（bridge → forwarder → accountRuntime）', () => {
  // 渠道包 429 时算出上游真实解禁时刻（providerRetryAfterMs）上报；宿主侧曾丢弃它，
  // 只看自己的指数退避 → 「冷却到期→放一笔→又 429→再冷却」的自维持循环。
  // 语义判据在 tests/proxy/accountRuntime.test.ts（取更晚），这里只管三段接线都真的读到它。
  // bridge：从 worker 消息里读 providerRetryAfterMs，喂进 ChannelBridgeError 第三参。
  assert.match(
    bridgeSource,
    /message\.providerRetryAfterMs/,
    'the bridge must read the pack-reported unblock time from the worker error message',
  )
  assert.match(
    bridgeSource,
    /new ChannelBridgeError\(\s*[\s\S]*?providerRetryAfterMs\s*,?\s*\)/,
    'the bridge must hand providerRetryAfterMs to ChannelBridgeError',
  )
  // forwarder：forwardAccountChannel 捕获后把 error.retryAfterMs 转成 ForwardResult.retryAfter（秒）。
  assert.match(
    forwarderSource,
    /failure\.retryAfterMs/,
    'the account-channel forward must read retryAfterMs off the bridge error',
  )
  assert.match(
    forwarderSource,
    /Math\.ceil\(\s*failure\.retryAfterMs\s*\/\s*1000\s*\)/,
    'the channel error retryAfterMs must be surfaced as an integer-seconds Retry-After',
  )
  // forwarder：429 记冷却处把 retryAfter 解析回毫秒，随可选尾参喂进 recordFailure。
  assert.match(
    forwarderSource,
    /Number\.parseInt\(\s*lastRetryAfter\s*,\s*10\s*\)/,
    'the 429 cooldown must parse the surfaced Retry-After back into milliseconds',
  )
  assert.match(
    forwarderSource,
    /recordFailure\(\s*account\.id\s*,\s*429\s*,\s*Date\.now\(\)\s*,\s*actualModel\s*,\s*retryAfterMs\s*\)/,
    'the parsed retryAfterMs must be the fifth argument to recordFailure',
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
    candidate: 'WorkBuddy (国际版) / Hy3',
    error: 'workbuddy: 请求被拦截，请重新发送 request illegal',
    status: 400,
  })
  assert.equal(failure.kind, 'failover')
  assert.equal(failure.status, 400)
})

test('「这一家不接受 reasoning_effort」识别：命中用户报障原文，且不吞掉别的 400', () => {
  // 2026-11-03 用户报障原文（OVH 的 Meta-Llama-3_3-70B-Instruct，daily 路由，att=1 整轮终止）
  assert.ok(isReasoningEffortUnsupportedError(
    "feature 'reasoning_effort for this model' is not currently supported [request_id: chatcmpl-mw00pl8g-2po1fv]",
  ))
  assert.ok(isReasoningEffortUnsupportedError('The model does not support reasoning_effort.'))
  assert.ok(isReasoningEffortUnsupportedError('unsupported reasoning effort value'))
  // 窄口径：只有字段名不构成换家理由
  assert.equal(isReasoningEffortUnsupportedError('reasoning_effort must be one of low, medium, high'), false)
  assert.equal(isReasoningEffortUnsupportedError("Invalid value for 'tools': maximum number of items is 128."), false)
  assert.equal(isReasoningEffortUnsupportedError('messages: must be a non-empty array'), false)
  assert.equal(isReasoningEffortUnsupportedError(undefined), false)

  // 接线：四个调用点都要接上（import + auto 换家分支 + probe 错误帧 + 最终状态映射）
  assert.equal(forwarderSource.split('isReasoningEffortUnsupportedError').length - 1, 4)
  assert.match(forwarderSource, /\|\| isReasoningEffortUnsupportedError\(result\.error\)/)
  assert.match(forwarderSource, /\|\| isReasoningEffortUnsupportedError\(probe\.message\)/)
  assert.match(forwarderSource, /\|\| isReasoningEffortUnsupportedError\(message\)/)
})

test('「上游目录不认这个模型」识别：按目录缺失语义判 capability，客户端写错的名字不在此列', () => {
  // 2026-11-03 真机两笔（daily 路由，第一个候选 400 就整轮终止）
  assert.ok(isUpstreamCatalogMissError(
    'Model id : Tencent-Hunyuan/Hy3 , has no provider supported',
  ))
  assert.ok(isUpstreamCatalogMissError(
    'Unknown model: mimo-v2.5-pro. This model is not in our catalog.',
  ))

  // 客户端自己的请求错误不构成「换一家就能成」：换家不会改变写错的名字
  // 2026-11-12 现网补的两条（`codex` 线路 26 笔 503 里占 20 笔）
  assert.ok(isUpstreamCatalogMissError('cline: model not supported [request_id: chatcmpl-mwcdwma1-4sdbds]'),
    '这一家的目录里没有这个模型 —— 与 Unknown model 同一类，换一家就能成')
  assert.ok(isUpstreamCatalogMissError('This model is not available in your region.'),
    '这一家对本账号所在地区供不了这个模型')
  // 客户端写坏参数/写错名字的 400 仍然不算（换家没有意义）
  assert.equal(isUpstreamCatalogMissError('model not found'), false)
  assert.equal(isUpstreamCatalogMissError("Invalid value for 'tools': maximum number of items is 128."), false)
  assert.equal(isUpstreamCatalogMissError('messages: must be a non-empty array'), false)
  assert.equal(isUpstreamCatalogMissError(undefined), false)

  // 日志分类必须与换家分支同一口径：目录缺失是 capability，不是账号故障
  assert.equal(describeAttemptFailure({
    candidate: 'bazaarlink/mimo-v2.5-pro',
    error: 'Unknown model: mimo-v2.5-pro. This model is not in our catalog.',
    status: 400,
    providerType: 'aggregate',
  }).kind, 'capability')
})

/**
 * 2026-11-03 用户报障那一笔的完整复盘（远程网关 192.168.85.131 实测）。
 *
 * DSH 客户端（UA `deepseek-harness/0.2.1`）经 `daily` 路由发出
 * `claude-opus-4.7`（上下文 224983 tokens，`max_tokens=1`），三次尝试分别是：
 *
 * | # | 候选 | 状态码 | 文案 | 原判 | 现在 |
 * |---|------|--------|------|------|------|
 * | 1 | OpenCode / Nemotron 3.5 | 502 | 所有通道对该模型均受限（free_usage_limit） | 账号故障 | 可恢复 |
 * | 2 | MiniMax Code / M3.1-Flash | 502 | 模型未返回任何内容块 | 账号故障 | 账号故障（仍算） |
 * | 3 | bazaarlink / claude-opus-4.7 | 402 | requires more credits … can only afford 0 | 账号故障 | 可恢复 |
 *
 * 第 1 家与第 3 家都是**上游暂时不可服务**（匿名槽限流 / 积分用尽），却都被
 * 当成账号故障计入了 `accountFailures`。加上第 2 家那笔普通 502，账户故障上限
 * （`baseCap = 3`）在第 3 次尝试后就撞满，换家循环在第 4 家（Raccoon）之前
 * 收手 —— 池里其实还有两家活着的候选没试。
 *
 * 这个测试把三段判据钉死：
 * 1. 前两家的文案必须判**可恢复类**（不占账号故障上限）；
 * 2. 于是 `accountFailures` 只剩 1，链还能继续往下试（Raccoon / Qoder）；
 * 3. 三条日志记录的 `kind` 都必须是 `failover`（换家类），不能是 `fatal`。
 */
test('2026-11-03 DSH 那笔 402：额度/限流类失败必须不占账号故障上限', () => {
  const opencode = 'opencode: 所有通道对该模型均受限（opencode-anon-7b81de(free_usage_limit)）'
  const minimax = 'minimax: 模型未返回任何内容块'
  const bazaar = 'This request requires more credits, or fewer max_tokens. You requested up to 1 tokens, but can only afford 0.'

  // 1) 前两家不再被当成账号故障
  assert.equal(isRecoverableChannelFailure(opencode), true)
  assert.equal(isRecoverableChannelFailure(bazaar), true)
  // 第 2 家是上游空响应，仍是普通 502（账号故障）—— 不放宽它，只放开额度/限流那两类
  assert.equal(isRecoverableChannelFailure(minimax), false)

  // 2) 换家循环因此不会在第 4 家之前收手
  const base = { baseCap: 3, extendedCap: 6, elapsedMs: 0, budgetMs: AUTO_WALL_CLOCK_BUDGET_MS }
  // 修好之前：3 次全是账号故障 → accountFailures=3 → 撞满基础上限，收手
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 3, accountFailures: 3 }), false)
  // 修好之后：只有第 2 家那笔普通 502 计入 → accountFailures=1，还能继续试第 4、5 家
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 3, accountFailures: 1 }), true)
  assert.equal(shouldTryNextAutoCandidate({ ...base, attempts: 5, accountFailures: 1 }), true)

  // 3) 三条日志记录的分类都必须是 failover（换家），不是 fatal
  for (const failure of [
    { candidate: 'OpenCode / Nemotron 3.5 Lightning Free', status: 502, error: opencode },
    { candidate: 'MiniMax Code / M3.1-Flash', status: 502, error: minimax },
    { candidate: 'bazaarlink/claude-opus-4.7', status: 402, error: bazaar },
  ]) {
    assert.equal(describeAttemptFailure(failure).kind, 'failover', failure.candidate)
  }
})

test('「这一家要求我们没发的会话亲和头」识别：命中报障原文，且不吞掉别的 400', () => {
  // 2026-11-11 16:51 实测原文（`codex` 线路按分数首选 opencode_go/kimi-k3.1-pro，
  // att=1、outcome=fatal，其后 9 个候选一个没试）
  assert.ok(isMissingSessionAffinityError(
    'Request is missing x-opencode-session and cannot be routed efficiently. '
    + 'Please see https://opencode.ai/v2/docs/console/go/#where-can-i-use-it [request_id: chatcmpl-mwbvqma3-2v4h6i]',
  ))
  // 第二判据单独成立（文案换了头名也认）
  assert.ok(isMissingSessionAffinityError('missing session affinity header: cannot be routed efficiently'))

  // 窄口径：只提 session 不构成换家理由 —— 客户端自己漏传会话参数不该被替他绕开
  assert.equal(isMissingSessionAffinityError("Invalid value: 'session_id' must be a string"), false)
  assert.equal(isMissingSessionAffinityError('session expired, please re-authenticate'), false)
  assert.equal(isMissingSessionAffinityError("Invalid value for 'tools': maximum number of items is 128."), false)
  assert.equal(isMissingSessionAffinityError(undefined), false)
  assert.equal(isMissingSessionAffinityError(''), false)

  // 接线：auto 换家分支与 attemptTrace 的 outcome 分类都要接上
  assert.match(forwarderSource, /\|\| isMissingSessionAffinityError\(result\.error\)/,
    'session-affinity 400 must take the capability-mismatch branch (fail over without account penalty)')
})

test('「这一家账号欠费」识别：命中百炼 Arrearage 原文，且不吞掉别的 400', () => {
  // 2026-11-12 05:24 实测原文（bailian/qwen3.7-max-2026-05-17，kind=fatal，整条链打死）
  assert.ok(isAccountArrearsError(
    'Access denied, please make sure your account is in good standing. For details, see: '
    + 'https://help.aliyun.com/zh/model-studio/error-code#overdue-payment [request_id: chatcmpl-mwbx7zpn-sc18ep]',
  ))
  assert.ok(isAccountArrearsError('Arrearage'))
  assert.ok(isAccountArrearsError('账户已欠费，请充值后继续使用'), '中文文案同样认')
  assert.ok(isAccountArrearsError('overdue payment detected'))

  // 窄口径：泛化的 access denied / 权限措辞不算（那些本来就走 403 换家）
  assert.equal(isAccountArrearsError('Access denied: invalid API key'), false)
  assert.equal(isAccountArrearsError('permission_error: not allowed to use this model'), false)
  assert.equal(isAccountArrearsError("Invalid value for 'tools': maximum number of items is 128."), false)
  assert.equal(isAccountArrearsError(undefined), false)
  assert.equal(isAccountArrearsError(''), false)

  // 接线：auto 换家分支与 attemptTrace 的 outcome 分类都要接上
  assert.match(forwarderSource, /\|\| isAccountArrearsError\(result\.error\)/,
    'arrears 400 must fail over instead of ending the whole chain')
})

test('首块超时的文案不许承诺一个不会执行的换家（2026-11-12 现网 tried=1）', () => {
  // 那两行打印的「5s」是剩余墙钟预算，不是出厂 60s —— 预算在第一次尝试前就烧光了，
  // 池里还有 10 个候选却一个没试。无条件写「已中止并换下一家」会让人一直等。
  assert.doesNotMatch(forwarderSource, /疑似假死），已中止并换下一家/,
    'the timeout message must not promise a switch unconditionally')
  // 两种截断各有归因（`planFirstEventWait`）：`attempt-budget` 是链内剩余预算，
  // `single-candidate` 是「这条模型没有下家」。文案按它分叉，不能一律写成预算。
  assert.match(forwarderSource, /clampedBy === 'attempt-budget'/,
    'the message must say when the printed timeout is the remaining budget, not the factory cap')
  assert.match(forwarderSource, /clampedBy === 'single-candidate'/,
    'a single-candidate model must not be described as budget-clamped')
})

test('kind 必须与换家分支一致：新接入的两类 400 不能只改一侧', () => {
  // 换家链（forwarder::capabilityMismatch）接了这两条，`describeAttemptFailure` 漏掉
  // 就会让 `auto.failures[].kind` 记成 fatal —— 同一笔尝试在日志里两种结论。
  assert.equal(describeAttemptFailure({
    candidate: 'bailian/qwen3.7-max-2026-05-17',
    status: 400,
    error: 'Access denied, please make sure your account is in good standing. '
      + 'For details, see: https://help.aliyun.com/zh/model-studio/error-code#overdue-payment',
  }).kind, 'capability')
  assert.equal(describeAttemptFailure({
    candidate: 'opencode_go/kimi-k3.1-pro',
    status: 400,
    error: 'Request is missing x-opencode-session and cannot be routed efficiently.',
  }).kind, 'capability')
})

test('失败记录带上预算读数，没传时不造空字段', () => {
  const row = describeAttemptFailure({
    candidate: 'cline/deepseek-v4-pro-0813',
    status: 504,
    error: '渠道 20s 内未产出任何首块（疑似假死），已中止',
    budgetElapsedMs: 85_000,
    attemptDeadlineMs: 5_000,
  })
  assert.equal(row.budgetElapsedMs, 85_000)
  assert.equal(row.attemptDeadlineMs, 5_000, '等于下限 ⇒ 规划时预算已归零，这就是那两行的形状')
  const bare = describeAttemptFailure({ candidate: 'cline/x', status: 502 })
  assert.equal('budgetElapsedMs' in bare, false)
  assert.equal('attemptDeadlineMs' in bare, false)
})

test('恢复轮的准入范围：限流/额度/本地准入算，欠费与永久失败不算', () => {
  assert.equal(isRecoverableChainExhaustion({ status: 429 }), true)
  assert.equal(isRecoverableChainExhaustion({ status: 402 }), true)
  assert.equal(isRecoverableChainExhaustion({ localAdmissionRejected: true }), true,
    '自家 AIMD 并发满了，等就对了')
  assert.equal(isRecoverableChainExhaustion({ status: 502, error: '该模型全部启用账号均在限流中' }), true)
  assert.equal(isRecoverableChainExhaustion({ status: 502, error: '上游排队中 isQueued' }), true)

  // 不会在十几秒内自己变好的，等一轮只是白占客户端时间
  assert.equal(isRecoverableChainExhaustion({
    status: 400,
    error: 'Access denied, please make sure your account is in good standing. #overdue-payment',
  }), false)
  assert.equal(isRecoverableChainExhaustion({ status: 502, error: 'cline: model not supported' }), false)
  assert.equal(isRecoverableChainExhaustion({ status: 500, error: 'Request failed after retries' }), false)
  assert.equal(isRecoverableChainExhaustion({}), false)
})

test('恢复轮最多一次，且等待用剩余墙钟（不提高总预算）', () => {
  assert.match(forwarderSource, /roundsLeft: 1, failures: \[\], attemptTrace: \[\]/,
    'the chain gets exactly one recovery round by default')
  assert.match(forwarderSource, /roundsLeft: 0,/,
    'the recursive recovery pass must carry zero rounds left — no rolling retry loop')
  assert.match(forwarderSource, /await sleep\(waitMs\)/,
    'the wait must be honoured by the gateway itself, not handed to the client as 503')
  assert.match(forwarderSource, /elapsedMs: Date\.now\(\) - budgetStart,\s*\r?\n\s*budgetMs: AUTO_WALL_CLOCK_BUDGET_MS,/,
    'the recovery wait is bounded by the same wall budget, never beyond it')
})
