/**
 * ZCode 身份头回归测试（2026-11-05）。
 *
 * 钉两件事：
 * 1. 版本兜底只有一个来源 `ZCODE_APP_VERSION_FALLBACK`，不再出现 3.14.3 / 3.14.4 双值；
 * 2. `X-Platform` / `X-Os-Category` 按宿主平台实取，不写死 win32/windows。
 *
 * ⚠️ 这里用源码断言而不是 import `zcode-upstream.ts`：vendor 源码内部用 `.js`
 * 后缀互相引用（vite 打包时解析），Node 原生 strip-types 不认，直接 import 会
 * `ERR_MODULE_NOT_FOUND`。运行时行为由渠道包的集成测试覆盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, 'vendor', 'channel-pack', 'src', rel), 'utf8')

test('ZCode 的版本兜底只有一个来源', async () => {
  const module = await import(
    pathToFileURL(join(ROOT, 'vendor', 'channel-pack', 'src', 'zcode.ts')).href
  )
  assert.equal(module.ZCODE_APP_VERSION_FALLBACK, '3.14.3')

  const upstream = read('zcode-upstream.ts')
  assert.match(upstream, /credential\.app_version \?\? ZCODE_APP_VERSION_FALLBACK/)
  assert.doesNotMatch(upstream, /'3\.14\.4'/)

  const transport = read('zcode-transport.ts')
  assert.match(transport, /credential\.app_version \?\? ZCODE_APP_VERSION_FALLBACK/)
  assert.doesNotMatch(transport, /'3\.14\.4'/)
})

test('ZCode 的平台头按宿主实取，不写死 win32/windows', () => {
  const upstream = read('zcode-upstream.ts')
  assert.match(upstream, /'X-Platform': process\.platform/)
  assert.match(upstream, /'X-Os-Category': process\.platform === 'win32'/)

  const transport = read('zcode-transport.ts')
  assert.match(transport, /'X-Platform': process\.platform/)
})
