import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { isSameTargetRetryableStatus } from '../../src/main/proxy/failover.ts'

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

test('转发层把「订阅端点」这一事实传给重试预算：纯函数测不到这一层', () => {
  const source = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')

  // `planForwardRetries(..., { planEntry })` 是这条封顶的唯一入口。`isPlanEntry`
  // 的判据是手写清单（`shared/aggregateCost.AGGREGATE_PLAN_ENTRIES`），它按
  // **套餐**而不是 id 里有没有 "plan" 来判定（`sensenova` 的端点就没有 plan 字样）。
  // 只对 aggregate 生效：内建/自定义端点没有订阅概念。
  assert.match(source, /planEntry:\s*provider\.type === 'aggregate' && isPlanEntry\(/)
  assert.match(source, /import \{ isPlanEntry \} from '\.\.\/\.\.\/shared\/aggregateCost'/)
})

test('静默通道：首块超时带机读码、只统计真流量、具名与 auto/钉泳道都在派发前快速失败', () => {
  const forwarder = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')
  const chat = readFileSync(join(root, 'src/main/proxy/routes/chat.ts'), 'utf8')
  const completions = readFileSync(join(root, 'src/main/proxy/routes/completions.ts'), 'utf8')

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

  // 消费端 1：具名单候选在派发前查一次，命中就直接收口成 503 + Retry-After，
  // 不再陪它等 30–44s。两条入口同一不变量：chat 有、completions 没有就是漏格。
  assert.match(chat, /const silent = accountRuntime\.silentChannel\(account\.id, actualModel\)/)
  assert.match(chat, /code: SILENT_CHANNEL_SKIP_CODE/)
  assert.match(chat, /retryAfter: String\(retryAfterSeconds\)/)
  assert.match(completions, /const silent = accountRuntime\.silentChannel\(account\.id, actualModel\)/)
  assert.match(completions, /code: SILENT_CHANNEL_SKIP_CODE/)
  assert.match(completions, /retryAfter: String\(retryAfterSeconds\)/)

  // 消费端 2：auto/钉泳道的换家循环同样在派发前查（现网 2026-11-15：loomy 钉
  // 10 笔 504 循环 19 分钟 —— 窗口有武装、这条泳道却不读）。命中不派发、不记
  // 账号故障，合成 503 + Retry-After 换下一家；只剩这一家时客户端毫秒级拒答。
  assert.match(
    forwarder,
    /const silent = accountRuntime\.silentChannel\(candidate\.account\.id, candidate\.actualModel\)/,
    'auto/pin lane must consult the silent window before dispatch',
  )
  assert.match(forwarder, /errorDetails: \{ message, code: SILENT_CHANNEL_SKIP_CODE \}/)
  // 静默收口不进恢复轮：窗口 60s–5min，等 5s 再派只会再撞同一个窗口。
  assert.match(forwarder, /last\.result\.errorDetails\?\.code !== SILENT_CHANNEL_SKIP_CODE/)
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

test('单候选链的连接层失败给一次原地重试；多家链仍是零', () => {
  const source = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')

  // 硬钉 / 具名模型只有一个账号时，「失败就换下一个」没有下一个。而连接层失败
  // （上游一个字节都没收到）换一次 DNS 解析就可能自愈：2026-11-15 火山实测
  // `connect ETIMEDOUT 180.184.47.154:443`，同域名另外两个 IP 38ms 就通。
  // 零重试把这种可自愈故障直接判成 500，现网 16 笔里中了 7 笔。
  assert.match(
    source,
    /const soloRetry =\s*candidates\.length === 1 && remainingBudgetMs >= MIN_REMAINING_FOR_NEXT_ATTEMPT_MS \? 1 : 0/,
    '单候选 + 预算还够，才给这一次原地重试',
  )
  assert.match(source, /\{ maxRetries: soloRetry \}/)
  assert.doesNotMatch(source, /\{ maxRetries: 0 \}/, '链上不得再留写死的零重试')

  // 放宽只到「一次」，且不得绕过原地重试的状态码闸门：额度/请求/超时类仍就地停手。
  assert.equal(isSameTargetRetryableStatus(undefined), true, '连接层失败才值得原地重打')
  assert.equal(isSameTargetRetryableStatus(429), false)
  assert.equal(isSameTargetRetryableStatus(400), false)
  assert.equal(isSameTargetRetryableStatus(408), false)
  assert.equal(isSameTargetRetryableStatus(504), false)
  assert.equal(isSameTargetRetryableStatus(524), false)
})

/**
 * 裁剪结果的**采纳判据**（2026-11-16）。
 *
 * 曾经是 `processResult.finalCount !== originalCount`：只认「条数变了」。而预算
 * 截断恰好保持条数不变、只改写内容 —— 于是裁剪算完被整份丢掉，超预算的原文
 * 照发。现网一笔 125,024 token 的请求打在 65,536 的上限上就是这个形状。
 *
 * 纯函数测不到这一层：`process()` 的返回值是对的，是调用方没读。所以钉源码。
 */
test('转发层按「内容变了」采纳裁剪结果，而不是「条数变了」', () => {
  const source = readFileSync(join(root, 'src/main/proxy/forwarder.ts'), 'utf8')

  assert.match(source, /if \(processResult\.changed\) \{/, '采纳判据必须是 changed')
  assert.doesNotMatch(
    source,
    /if \(processResult\.finalCount !== originalCount\) \{/,
    '条数判据会把「只截断不改条数」的结果整份丢掉',
  )
  // 改写本身也要留痕：否则日志里看不出这次裁剪是删了消息还是切了内容。
  assert.match(source, /result\.rewrote === true \? ' \(content truncated\)' : ''/)
})
