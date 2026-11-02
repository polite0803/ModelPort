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
