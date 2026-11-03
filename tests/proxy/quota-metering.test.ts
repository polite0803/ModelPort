import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chatRoute = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')
const ledger = readFileSync('src/main/proxy/quota/ledger.ts', 'utf-8')

/**
 * 记账的三个成功出口必须都接上：非流式一处、流式两条分支（`skipTransform` 与需转换）各一处。
 * 只测 usage/ledger 的纯函数会放过「路由根本没调用」的半改状态，所以按调用点钉。
 */
test('every success exit meters the quota ledger', () => {
  const calls = chatRoute.match(/^\s*meterQuota\(/gm) ?? []
  assert.equal(calls.length, 3, `chat.ts must meter on all three exits, found ${calls.length}`)

  const streamMeter = chatRoute.match(/readOrEstimateUsage\(usageInputText\(request\), collectedContent\)/g) ?? []
  assert.equal(streamMeter.length, 2, 'both stream branches must meter from the collected SSE text')

  assert.equal(
    chatRoute.split('readOrEstimateUsage(usageInputText(request), outputText, result.body)').length - 1,
    1,
    'the non-stream branch meters straight from the upstream body'
  )

  // ⚠️ 这条以前是钉不住的：它反过来**要求**旧写法 `JSON.stringify(request.messages ?? [])`。
  // 那个式子有两个方向的错：output 直接吃原始 SSE（帧壳被当成模型输出，实测虚高
  // 40–65 倍）；input 漏掉 `tools`（agent 客户端每轮最大的一块）。两处都由
  // `quota/usage.ts` 内的 `usageInputText` / `sseDeltaText` 修好，所以围栏现在钉：
  // **任何出口都不许再把 messages 单独 stringify 去估算**。
  assert.doesNotMatch(chatRoute, /readOrEstimateUsage\(JSON\.stringify\(request\.messages/,
    'an estimate must never be built from messages alone - tool schemas belong to the input')
})

test('metering never changes the response the client got', () => {
  assert.match(ledger, /flushSync\(\)/, 'pending counts are written out before shutdown')
  assert.match(chatRoute, /console\.error\('\[Chat\] quota ledger record failed:'/,
    'a ledger write failure is logged, never thrown into the request path')
  assert.doesNotMatch(chatRoute, /meterQuota[\s\S]{0,200}?throw/, 'metering must not abort a successful reply')

  // 缓存命中这条信号必须一路走到日计数，否则仪表盘上"真付 vs 命中"永远是空的。
  assert.match(chatRoute, /cacheReadTokens: reading\.cacheReadTokens/,
    'the reported cache-read figure must reach the day counters')

  // ⚠️ 刻意**没有**改的一件事：上限（tpm/tpd/monthlyTokens）仍然按 `totalTokens`
  // 扣。上游把 cached_tokens 报进 prompt_tokens 里，但"命中缓存的部分是否也计入
  // 供应商自己的额度"这一点我们没有任何证据 —— 把它从扣减里减掉会让 `smart`/`pace`
  // 以为配额比实际更空，那是把一个未知的经济学问题当成已知的答案。
  assert.match(ledger, /Math\.max\(0, Math\.floor\(usage\.totalTokens/,
    'caps stay fed by the total; a cache read is reported, never subtracted')
})

test('the fabricated zero usage is gone from the live paths', () => {
  assert.doesNotMatch(chatRoute, /prompt_tokens:\s*0/, 'chat.ts must not hand out a made-up zero usage')
  assert.doesNotMatch(ledger, /prompt_tokens/, 'the ledger speaks camelCase only')
  const stream = readFileSync('src/main/proxy/stream.ts', 'utf-8')
  assert.match(stream, /usage: usage \? toWireUsage\(usage\) : null/, 'unknown usage is null, not zero')
})

/**
 * 第二跳：同名第一家 429/5xx 之后换下一家。两条路径必须共用同一个循环，
 * 否则"auto 会换、具名不会换"这种口径分裂会在下一次改动里悄悄长回来。
 */
test('failover across providers uses one shared loop', () => {
  const forwarder = readFileSync('src/main/proxy/forwarder.ts', 'utf-8')

  assert.equal((forwarder.match(/for \(const candidate of candidates\)/g) ?? []).length, 1,
    'only one candidate loop may exist')
  assert.match(forwarder, /private async forwardFirstReachable<T extends ChainCandidate>\(/,
    'the loop is a shared private method')
  // 两个入口都必须是「把同一个循环 + 一份换家预算交出去」。`context` 后面多出来的
  // 第四个参数是 signature 变化（baseCap 不再由循环自己读全局 autoRouting），
  // 钉点的意图不变：不许长出第二个候选循环。
  assert.match(forwarder, /return this\.forwardFirstReachable\(request, candidates, context,/,
    'both entry points delegate to it')
  assert.match(forwarder, /async forwardChainCompletion\(/, 'the chain entry point exists')

  const loadBalancer = readFileSync('src/main/proxy/loadbalancer.ts', 'utf-8')
  assert.match(loadBalancer, /selectChainCandidates\(model: string, preferredAccountId\?: string\): AccountSelection\[\]/)
  assert.match(loadBalancer, /if \(order\.size < 2\) return \[\]/, 'a single-provider chain falls back to the normal path')

  assert.match(chatRoute, /} else if \(chainCandidates\.length > 1\) \{/, 'the chain branch is taken only for real chains')
  assert.match(chatRoute, /result = outcome\.result\r?\n\s+account = outcome\.candidate\.account/,
    'the account that actually answered must replace the initial guess for logging and metering')
  assert.match(chatRoute, /chainCandidates\.map\(selection => \(\{\r?\n\s+account: selection\.account,/,
    'each candidate carries the catalogue display name the forwarder expects')
})
test('the bare-name chain lives in the load balancer, once', () => {
  const loadBalancer = readFileSync('src/main/proxy/loadbalancer.ts', 'utf-8')

  assert.match(loadBalancer, /resolveAggregateChain\(AGGREGATE_REGISTRY, model, \{ headroom: aggregateHeadroom \}\)/,
    'a bare name must be expanded into a chain ordered by headroom')
  assert.match(loadBalancer, /if \(!preferredProviderId && !model\.includes\('\/'\)\) \{/,
    'a prefixed name, or a pinned provider, must not be expanded into a chain')
  assert.match(loadBalancer, /this\.providerSupportsModel\(provider, chained\?\.displayName \?\? model\)/,
    'the chain entry is matched through its catalogue display name')
  assert.match(loadBalancer, /const actualModel = chained\?\.actualModelId \?\? this\.mapModel\(model, provider\)/,
    'the upstream model id comes from the chain entry, not from the requested bare name')
  assert.match(loadBalancer, /\.filter\(account => !quotaBlockReason\(provider, account\.id, actualModel\)\)/,
    'an exhausted aggregate account must not become a candidate')
  assert.match(loadBalancer, /candidates\.sort\(\(a, b\) => rank\(a\.provider\.id\) - rank\(b\.provider\.id\)\)/,
    'candidates follow the chain order so the head is tried first')

  assert.doesNotMatch(chatRoute, /function selectViaAggregateChain/,
    'the chain must not be implemented twice')
  assert.match(chatRoute, /ctx\.set\('X-ModelPort-Aggregate-Chain', toHeaderValue\(selection\.provider\.id\)\)/,
    'the chosen entry stays observable in the response headers')
  assert.match(chatRoute, /selection && !request\.model\.includes\('\/'\) && selection\.provider\.type === 'aggregate'/,
    'the header only marks bare names that landed on an aggregate entry')
})
test('both exits feed the quota learner from what upstream already sent back', () => {
  const calls = chatRoute.match(/^\s*learnQuotaCaps\(/gm) ?? []
  assert.equal(calls.length, 2, `success and failure exits must both learn, found ${calls.length}`)

  assert.match(chatRoute, /learnQuotaCaps\(provider, result\.headers, result\.error\)/,
    'the failure branch learns from the 429 body too')
  assert.match(chatRoute, /learnQuotaCaps\(provider, result\.headers\)/,
    'the success branch learns from the rate-limit headers')

  const autoRouter = readFileSync('src/main/proxy/autoRouter.ts', 'utf-8')
  assert.match(autoRouter, /const quotaBlocked = quotaBlockReason\(provider, account\.id, model\.actualModelId, gateContext\)\r?\n\s*if \(quotaBlocked !== undefined\) \{\r?\n\s*skipped\.add\(`\$\{provider\.id\}\/\$\{model\.displayName\}:\$\{quotaBlocked\}`\)\r?\n\s*continue/,
    'exhausted aggregate candidates must not enter the ranking at all (and their skip reason must be recorded)')

  const gate = readFileSync('src/main/proxy/quota/gate.ts', 'utf-8')
  assert.match(gate, /if \(provider\.type !== 'aggregate'\) return undefined/,
    'the gate stays scoped to the aggregate catalogue')
  assert.match(gate, /if \(!caps\.enforceable\) return 0\.5/,
    'undocumented entries stay neutral instead of ranking last')
  assert.match(gate, /return worst >= 1 \? -1 : 1 - worst/, 'an exhausted entry sorts behind a healthy one')
})
