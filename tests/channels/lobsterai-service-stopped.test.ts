/**
 * LobsterAI「上游已停止为该账号服务」的分类回归测试（用户报障 2026-11-04）。
 *
 * 上游原文：`账号已停止提供服务。请通过官方渠道使用有道龙虾；如有异议，请联…`
 *
 * 修之前这条文案一张关键词表都不命中，于是判成 `client`，而 `client` 既参与
 * 换号（同一段对话正文再打给另外两个账号）、又不写任何标记（被封的号仍是池里
 * 排序第一，之后每条请求都再去敲它一次）。本测试钉住四件事：
 *
 * 1. 该文案判为 `service-stopped`，且**先于状态码**（403 与 HTTP 200 流内帧同判）；
 * 2. `service-stopped` 不换号，其余可重试类别照旧换号（保住「非成功即轮转」基线）；
 * 3. 它**不**记限流徽章 —— 徽章的含义是「该模型受限」，封号不是限流；
 * 4. 负控：普通额度文案仍判 `hard-credit`，不带标记的 403 仍判 `client`，
 *    `40100` 仍判 `session-dead` —— 误判成终态会停用还在工作的账号。
 *
 * ⚠️ 被测模块 `lobsterai-errors.ts` **零 import**，可直接以 TS 源动态加载
 *    （同 `account-balance-gate.test.ts`），不走 esbuild，因此在无 spawn 权限的
 *    沙箱里也能跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')

async function loadErrors() {
  return await import(pathToFileURL(join(VENDOR_SRC, 'lobsterai-errors.ts')).href)
}

/** 用户报障的上游原文（截到给出的那半句为止）。 */
const UPSTREAM_TEXT = '账号已停止提供服务。请通过官方渠道使用有道龙虾；如有异议，请联'

test('该文案判为 service-stopped，且先于状态码分支', async () => {
  const { classifyLobsteraiError } = await loadErrors()
  // 对话车道：HTTP 403 + 该文案。
  assert.equal(classifyLobsteraiError(403, UPSTREAM_TEXT), 'service-stopped')
  // 积分车道：HTTP 200 + 同样这句话（流内错误帧），不能被状态码分支吞掉。
  assert.equal(classifyLobsteraiError(200, UPSTREAM_TEXT), 'service-stopped')
  // 上游也把它包在 JSON 信封里返回过，关键词匹配对整段原文生效。
  assert.equal(
    classifyLobsteraiError(403, JSON.stringify({ code: -1, message: UPSTREAM_TEXT })),
    'service-stopped',
  )
})

test('service-stopped 不换号，其余非成功类别照旧换号', async () => {
  const { shouldRotateLobsteraiAccount } = await loadErrors()
  assert.equal(shouldRotateLobsteraiAccount('service-stopped'), false, '封号换号=把同一段正文再打给别人')
  assert.equal(shouldRotateLobsteraiAccount('none'), false)
  // 基线（对齐 Go 的 handler.go：除成功外每一类都轮转）不能被我这一刀削窄。
  for (const kind of ['hard-credit', 'soft-rate', 'session-dead', 'not-found', 'server', 'client']) {
    assert.equal(shouldRotateLobsteraiAccount(kind), true, `${kind} 仍应换号`)
  }
})

test('service-stopped 不记限流徽章', async () => {
  const { recordsLobsteraiRateLimit } = await loadErrors()
  assert.equal(recordsLobsteraiRateLimit('service-stopped'), false, '封号显示成「限额重置」是虚假信息')
  for (const kind of ['hard-credit', 'soft-rate', 'not-found']) {
    assert.equal(recordsLobsteraiRateLimit(kind), true, `${kind} 仍应记徽章`)
  }
})

test('流内错误帧同样识别为终态（而不是 default 的 client）', async () => {
  const { classifyLobsteraiStreamError } = await loadErrors()
  assert.equal(classifyLobsteraiStreamError(UPSTREAM_TEXT), 'service-stopped')
  // default 分支保持不变：读不懂的业务失败仍可轮转。
  assert.equal(classifyLobsteraiStreamError('some other failure'), 'client')
})

test('负控：普通额度/会话/无关 403 的既有判定不变', async () => {
  const { classifyLobsteraiError } = await loadErrors()
  assert.equal(classifyLobsteraiError(400, '免费额度已用完，请升级套餐'), 'hard-credit')
  assert.equal(classifyLobsteraiError(402, '{"message":"insufficient credit"}'), 'hard-credit')
  assert.equal(classifyLobsteraiError(401, '{"code":40100}'), 'session-dead')
  assert.equal(classifyLobsteraiError(429, 'too many requests'), 'soft-rate')
  assert.equal(classifyLobsteraiError(404, 'model not found'), 'not-found')
  assert.equal(classifyLobsteraiError(500, '服务器内部错误'), 'server')
  // 一张标记都没有的 403（凭据失效一类）绝不能被判成封号——那会停用还在工作的账号。
  assert.equal(classifyLobsteraiError(403, 'invalid token'), 'client')
})
