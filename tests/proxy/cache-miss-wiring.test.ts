import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chatRoute = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')

/**
 * 缺口分类靠「同一会话的上一轮」才成立：只接一部分出口，读数会变成
 * 「流式有分类、非流式没有」的半改状态，卡片上表现为某些模型永远只有 `-`。
 */
test('三个计量出口都把会话键交给缺口分类', () => {
  // 允许后面还跟别的实参（压缩回合与压缩后预热）：这一条钉的是
  // 「每个出口都传了会话键」，不是「它是最后一个实参」。
  const tails = chatRoute
    .split('\n')
    .filter((line) => line.trim() === 'missConversationKey' || line.trim() === 'missConversationKey,')
  assert.equal(tails.length, 3, `expected 3 metering exits to pass the key, found ${tails.length}`)
})

test('三个计量出口都把压缩回合形态交给缺口分类', () => {
  const exits = chatRoute.split('\n').filter((line) => line.trim() === 'compactionTurn,')
  assert.equal(exits.length, 3, `expected 3 metering exits to pass the compaction turn, found ${exits.length}`)
  assert.match(chatRoute, /const compactionTurn = compactionTurnOf\(request\.messages\)/)
  // 压缩回合的未命中是真实开销，必须照常分类落账；不能靠不记账把命中率「算」上去。
  assert.match(chatRoute, /const missReading = cacheMissLedger\.classify\(\{/)
  assert.doesNotMatch(chatRoute, /const missReading = compactionTurn === undefined/)
  // 但它不能触发预热：前缀已经断了，预热只是白买一份无人复用的前缀。
  assert.match(chatRoute, /missReading\.prevPromptTokens !== undefined\n\s*&& \(compactionTurn === undefined \|\| compactionTurn === 'none'\)/)
})

test('三个计量出口都把入站时刻交给缺口分类', () => {
  const exits = chatRoute.match(/\b(?:nonStreamReading|streamReading),\n\s+startTime,/g) ?? []
  assert.equal(exits.length, 3, `expected 3 metering exits to pass request start time, found ${exits.length}`)
  assert.match(chatRoute, /cacheMissLedger\.snapshot\(missConversationKey, requestStartedAt\)/)
  assert.match(chatRoute, /cacheMissLedger\.classify\(\{[\s\S]*?now: requestStartedAt,/)
})

test('具名模型路径也按同一口径算会话键', () => {
  assert.match(chatRoute, /autoRouter\.conversationKeyFor\(request, clientSession\)/)
})

test('token 落账带上账号，但既有分类实参一行不动', () => {
  const start = chatRoute.indexOf('storeManager.recordTokenUsage({')
  assert.ok(start >= 0)
  const block = chatRoute.slice(start, start + 1800)
  assert.match(block, /\n      accountId,\n/)
  assert.match(block, /cacheMissClass: missReading\.class/)
  assert.match(block, /cacheMissDetail: missReading\.detail/)
  assert.match(block, /cacheMissIdleGap: missReading\.idleGap/)
})

test('诊断环只在 coldResumed 旁路记录，位于 classify 之后、warm 之前', () => {
  const classifyAt = chatRoute.indexOf('const missReading = cacheMissLedger.classify(')
  const appendAt = chatRoute.indexOf('coldResumeTrace.append(')
  const warmAt = chatRoute.indexOf('// 压缩后预热')
  assert.ok(classifyAt >= 0 && appendAt > classifyAt && appendAt < warmAt)
  assert.match(chatRoute, /missReading\?\.idleGap !== undefined && \(missReading\.detail\?\.coldResumed \?\? 0\) > 0/)
})

test('诊断环不进任何判决链路，也不读请求日志/存储/日志', () => {
  const coldTrace = readFileSync('src/main/proxy/coldResumeTrace.ts', 'utf-8')
  for (const file of ['autoRouter.ts', 'forwarder.ts', 'cacheWarm.ts', 'accountAffinity.ts']) {
    const source = readFileSync(`src/main/proxy/${file}`, 'utf-8')
    assert.doesNotMatch(source, /coldResumeTrace/, `${file} must not read the diagnostic ring`)
  }
  assert.doesNotMatch(coldTrace, /requestLog|storeManager|console\./)
})

test('只读诊断通道在 IPC 与 handler 中登记', () => {
  const channels = readFileSync('src/main/ipc/channels.ts', 'utf-8')
  const handlers = readFileSync('src/main/ipc/handlers.ts', 'utf-8')
  assert.match(channels, /DIAGNOSTICS_GET_COLD_RESUME_TRACE: 'diagnostics:getColdResumeTrace'/)
  assert.match(handlers, /IpcChannels\.DIAGNOSTICS_GET_COLD_RESUME_TRACE/)
  assert.match(handlers, /coldResumeTrace\.snapshot\(\)/)
})