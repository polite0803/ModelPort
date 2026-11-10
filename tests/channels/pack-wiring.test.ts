/**
 * 渠道包 `index.ts` 的接线守卫。
 *
 * 渠道包源码不在两个 `tsc` 程序（renderer/shared 与 main/preload）的 include 里，
 * esbuild 只转译、不做作用域校验。于是「`registerChannelPackRpc(..., codearts, ...)`
 * 传了一个根本不存在的变量」可以一路构建成功，直到 worker 真正 `apply()` 时才以
 * `ReferenceError: codearts is not defined` 让整个渠道包注册失败（2026-11-11 实际
 * 踩到：变量名是 `codeartsService` / `comateService`）。
 *
 * 这条测试只做一件窄事：该调用的每个服务实参都必须是本文件里声明过的标识符。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const INDEX_FILE = join(process.cwd(), 'vendor', 'channel-pack', 'src', 'index.ts')
const RPC_FILE = join(process.cwd(), 'vendor', 'channel-pack', 'src', 'channel-pack-rpc.ts')
const CODEARTS_ADAPTER_FILE = join(process.cwd(), 'vendor', 'channel-pack', 'src', 'llm-adapter.ts')
const COMATE_ADAPTER_FILE = join(process.cwd(), 'vendor', 'channel-pack', 'src', 'comate-adapter.ts')
const COMATE_BRIDGE_FILE = join(process.cwd(), 'vendor', 'channel-pack', 'src', 'comate-bridge.ts')

function registrationArguments(source: string): string[] {
  const marker = 'registerChannelPackRpc(ctx, pool,'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, '找不到 registerChannelPackRpc(ctx, pool, ...) 调用')
  const end = source.indexOf('modelAdapters', start)
  assert.notEqual(end, -1, '找不到该调用里的 modelAdapters 实参，切片口径失效')
  return source
    .slice(start + 'registerChannelPackRpc('.length, end)
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

test('registerChannelPackRpc 的每个服务实参都在 index.ts 中声明过', () => {
  const source = readFileSync(INDEX_FILE, 'utf8')
  const args = registrationArguments(source)
  assert.ok(args.length > 10, `服务实参数量异常：${args.length}`)
  for (const arg of args) {
    // 只检查裸标识符；`ctx` / `pool` 是函数参数，其余服务必须是 const/let/function。
    if (!/^[A-Za-z_$][\w$]*$/.test(arg)) continue
    if (arg === 'ctx' || arg === 'pool') continue
    const declared = new RegExp(`(?:const|let|var|function)\\s+${arg}\\b`).test(source)
    assert.ok(declared, `registerChannelPackRpc 传入了未定义的标识符 ${arg}（会以 ReferenceError 让整个渠道包失败）`)
  }
})

test('CodeArts 不发送可聚合的 framework UA，且排队重投有退避与墙钟上限', () => {
  const source = readFileSync(CODEARTS_ADAPTER_FILE, 'utf8')
  // `attributionHeaders()` 注入 `user-agent: modelport-channel-pack`，跨用户可聚合；
  // 2026-11-11 风控审计后改为运行时默认 UA。
  assert.doesNotMatch(source, /new Headers\(attributionHeaders\(\)\)/)
  // 排队从固定 10s×180 改为 1.35× 退避（封顶 30s）+ ±20% 抖动 + 30 分钟墙钟。
  assert.match(source, /QUEUE_BACKOFF_FACTOR\s*=\s*1\.35/)
  assert.match(source, /QUEUE_BACKOFF_MAX_MS\s*=\s*30_000/)
  assert.match(source, /QUEUE_MAX_WAIT_MS\s*=\s*30 \* 60 \* 1_000/)
  assert.match(source, /0\.8 \+ Math\.random\(\) \* 0\.4/)
})

test('CodeArts 的 Chat-Id 每请求唯一、Session-Id 与 prompt 缓存按账号派生', () => {
  const source = readFileSync(CODEARTS_ADAPTER_FILE, 'utf8')
  // Session-Id 由 AK 派生，换号重试会跟着换；不再让所有账号共用一个进程级 ID。
  assert.match(source, /sessionIdFor\(credential: CodeArtsCredential\)/)
  assert.match(source, /const sessionId = this\.sessionIdFor\(credential\)/)
  assert.match(source, /headers\.set\('Session-Id', sessionId\)/)
  assert.doesNotMatch(source, /headers\.set\('Session-Id', this\.sessionId\)/)
  // Chat-Id 每个请求唯一，避免所有客户端被聚合成同一个长会话。
  assert.match(source, /const chatId = this\.options\.chatId \?\? crypto\.randomUUID\(\)/)
  assert.match(source, /headers\.set\('Chat-Id', chatId\)/)
  assert.doesNotMatch(source, /headers\.set\('Chat-Id', this\.chatId\)/)
  // prompt_cache_key 也按账号隔离。
  assert.match(source, /prompt_cache_key: sessionId/)
  assert.doesNotMatch(source, /prompt_cache_key: this\.sessionId/)
})

test('Comate 免费套餐命中后本地短路付费模型，避免反复打上游', () => {
  const source = readFileSync(COMATE_ADAPTER_FILE, 'utf8')
  assert.match(source, /FREE_ONLY_TTL_MS/)
  assert.match(source, /freeOnlyUntil/)
  assert.match(source, /QUOTA_EXCEEDED/)
  assert.match(source, /options\.model !== COMATE\.freeModelId/)
})

test('Comate 免费额度用最近一次 Auto-Free 结果做状态，不再伪装成 0/N 读数', () => {
  const comate = readFileSync(COMATE_ADAPTER_FILE, 'utf8')
  assert.match(comate, /recordComateFreeQuota\(credential\.license, 'available'\)/)
  assert.match(comate, /recordComateFreeQuota\(credential\.license, 'limited'/)
  const rpc = readFileSync(RPC_FILE, 'utf8')
  assert.match(rpc, /readComateFreeQuota\(credential\.license\)/)
  assert.match(rpc, /status: free\.status/)
  const lib = readFileSync(join(process.cwd(), 'vendor', 'channel-pack', 'src', 'comate.ts'), 'utf8')
  assert.match(lib, /FREE_QUOTA_TTL_MS/)
  assert.match(lib, /export function recordComateFreeQuota/)
  assert.match(lib, /export function readComateFreeQuota/)
})

test('Comate 工具由客户端执行：桥接层不碰 shell/文件，适配器只发 tool_calls', () => {
  const bridge = readFileSync(COMATE_BRIDGE_FILE, 'utf8')
  // 桥接层是纯翻译：一旦引入 child_process/fs/spawn，工具就会偷偷在网关执行。
  assert.doesNotMatch(bridge, /node:child_process|node:fs|execFile|spawn\s*\(/)
  const adapter = readFileSync(COMATE_ADAPTER_FILE, 'utf8')
  assert.match(adapter, /mapComateToolCall/)
  assert.match(adapter, /extractClientToolResults/)
  assert.match(adapter, /buildToolUseResults/)
  assert.match(adapter, /tool-call-delta/)
  assert.doesNotMatch(adapter, /does not support client tool calling/)
  assert.doesNotMatch(adapter, /comate-tools\.js/)
})

test('Comate 的 finish.reason 必须是 {kind} 对象，字符串会触发 incomplete_stream', () => {
  const source = readFileSync(COMATE_ADAPTER_FILE, 'utf8')
  assert.match(source, /type: 'finish', reason: \{ kind: reason \}/)
})
