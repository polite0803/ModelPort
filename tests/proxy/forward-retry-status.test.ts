import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('重试循环把失败的状态码带给调用方，而不是退化成 500', () => {
  const source = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')

  // 丢状态码 ⇒ mapUpstreamError(undefined) ⇒ 500：客户端看到"服务器错误"，
  // 而不是"被限流 / 这个请求有问题"，也就不会退避
  assert.match(source, /lastStatus = result\.status/)
  assert.match(source, /const error = lastError \|\| 'Request failed after retries'/)
  // 客户端取消不能把 undefined 状态码传下去（那会被当成网络错误继续换家，
  // 还会给账号记一次失败）；统一落成 400。
  assert.match(source, /status: aborted \? 400 : lastStatus,/)
  assert.match(source, /errorDetails: lastErrorDetails \?\? errorDetailsOf\(error\)/)
})

test('429 不再原样重试', () => {
  const source = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')

  // 同一个账号原地重打对 4xx 没用（换家才有意义）；408/504/524 也不原地重试。
  assert.match(source, /if \(!isSameTargetRetryableStatus\(result\.status\)\) \{\s*break/)
  assert.doesNotMatch(source, /result\.status < 500 && result\.status !== 429/)
})

test('静默通道：首块超时带机读码、只统计真流量、具名单候选在派发前快速失败', () => {
  const forwarder = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')
  const chat = readFileSync(join(root, 'src/main/proxy/routes/chat.ts'), 'utf8')

  // 生产端：首块前零字节超时必须带机读码，否则日志行与客户端错误体只能读中文散文，
  // 静默通道判定也只能去 match 文案。
  assert.match(
    forwarder,
    /errorDetails: \{ message: timeoutMessage, code: FIRST_BLOCK_TIMEOUT_CODE \}/,
    'first-block timeout must carry FIRST_BLOCK_TIMEOUT_CODE',
  )
  // 记账端：只数这一类超时（块间静默说明这家会开口），且探测流量不进统计。
  assert.match(
    forwarder,
    /result\.status === 504\s*&& result\.errorDetails\?\.code === FIRST_BLOCK_TIMEOUT_CODE/,
  )
  assert.match(forwarder, /accountRuntime\.recordFirstBlockTimeout\(account\.id, actualModel\)/)

  // 消费端：具名单候选在派发前查一次，命中就直接收口成 503 + Retry-After，
  // 不再陪它等 30–44s。
  assert.match(chat, /const silent = accountRuntime\.silentChannel\(account\.id, actualModel\)/)
  assert.match(chat, /code: SILENT_CHANNEL_SKIP_CODE/)
  assert.match(chat, /retryAfter: String\(retryAfterSeconds\)/)
})

test('失败 app log 落机读字段（状态码/上游状态/错误码/真实模型）', () => {
  const chat = readFileSync(join(root, 'src/main/proxy/routes/chat.ts'), 'utf8')

  // 消息是中文散文；统计脚本与排查要靠 data 里的机读事实，否则「40s 没首块」
  // 与「上游 504」在日志里只差一句话。
  assert.match(chat, /data: \{\s*statusCode: mapped\.status,/)
  assert.match(chat, /upstreamStatus: result\.status/)
  assert.match(chat, /errorCode: mapped\.code/)
  assert.match(chat, /actualModel,\s*latency,/)
})
