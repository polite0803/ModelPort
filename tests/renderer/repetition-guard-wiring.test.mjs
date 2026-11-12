import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 判据本身有纯函数测试，这里钉的是**接线**：读数有没有进 trace、两个结算点是不是都撤了
 * 粘性锚点、面板有没有真的读写这个配置项、两种语言是不是都在。
 *
 * 判据写成吃文本的纯函数，负控用内存里改过的源文喂进去 —— 不落盘、不碰共享工作树。
 */

/** Windows 检出是 CRLF，多行锚点必须先在归一化后的文本上匹配。 */
const readSource = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const chat = readSource('src/main/proxy/routes/chat.ts')
const router = readSource('src/main/proxy/autoRouter.ts')
const policy = readSource('src/main/proxy/streamOutcomePolicy.ts')
const panel = readSource('src/renderer/src/components/proxy/LoadBalanceConfig.tsx')
const locales = ['src/renderer/src/i18n/locales/en-US.json', 'src/renderer/src/i18n/locales/zh-CN.json']
  .map((path) => ({ path, json: JSON.parse(readFileSync(path, 'utf8')) }))

const GUARD_KEYS = [
  'repetitionGuardTitle',
  'repetitionGuardDesc',
  'repetitionGuardMinLines',
  'repetitionGuardMaxRatio',
  'repetitionGuardMaxRatioHelp',
  'repetitionGuardNonStreamNote',
]

function checkMainProcess(chatSource, routerSource, policySource) {
  const problems = []
  if (!/storeManager\.getConfig\(\)\.streamRepetitionGuard/.test(chatSource)) {
    problems.push('chat.ts never reads the configured thresholds')
  }
  if (!/repetition: measureStreamRepetition\(collectedContent, repetitionGuard\)/.test(chatSource)) {
    problems.push('the stream trace does not carry the repetition reading')
  }
  // 三个结算点：流错误（含首块后超时）、直通路径正常结束、转换路径正常结束。
  const settleCalls = (chatSource.match(/settleSticky\(trace, /g) ?? []).length
  if (settleCalls !== 3) {
    problems.push(`all three stream settle paths must settle stickiness, saw ${settleCalls}`)
  }
  // 第三个实参是 2026-11-12 新增的池内首字门槛（第六类退化）。摘掉它 ⇒ 慢回合
  // 不再撤锚点，这条接线要红。
  if (!/shouldRevokeStickyAfterStream\(trace, truncated, autoDecision\?\.latencyGateMs\)/.test(chatSource)) {
    problems.push('settleSticky does not delegate to the shared policy')
  }
  if (!/isSlowTurnAfterStream\(trace, latencyGateMs\)/.test(policySource)) {
    problems.push('the policy does not revoke on a slow first token')
  }
  if (!/endReason === 'timeout' \|\| trace\.endReason === 'error'/.test(policySource)) {
    problems.push('the policy does not revoke on timeout or upstream error')
  }
  if (!/if \(truncated\) return true/.test(policySource)) {
    problems.push('the policy does not revoke on an upstream output-cap truncation')
  }
  if (!/trace\.repetition\?\.degraded === true/.test(policySource)) {
    problems.push('the policy is not gated on the degraded verdict')
  }
  if (!/revokeSticky\(key: string \| undefined, route\?: ModelRoute\): void \{/.test(routerSource)) {
    problems.push('autoRouter has no revokeSticky')
  }
  if (!/this\.sticky\.delete\(stickyMapKey\(route\?\.name/.test(routerSource)) {
    problems.push('revokeSticky does not actually delete the keyed sticky entry')
  }
  return problems
}

function checkPanel(source) {
  const problems = []
  if (!/\{guard && \(/.test(source)) {
    problems.push('the panel renders the guard before the persisted config has been read')
  }
  for (const binding of ['guard.minLines', 'guard.maxDedupRatio', 'guard.enabled']) {
    if (!source.includes(binding)) problems.push(`the panel does not bind ${binding}`)
  }
  if (!/streamRepetitionGuard: guard/.test(source)) {
    problems.push('saving the form does not persist streamRepetitionGuard')
  }
  if (!/appConfig\.streamRepetitionGuard \?\? DEFAULT_REPETITION_GUARD/.test(source)) {
    problems.push('the form does not fall back to the shipped defaults for an old config file')
  }
  return problems
}

function checkLocales(jsons, keys) {
  return jsons
    .filter(({ json }) => keys.some((key) => typeof json.proxy?.[key] !== 'string' || json.proxy[key].trim() === ''))
    .map(({ path }) => `${path} is missing one of ${keys.join(', ')}`)
}

test('the repetition reading reaches the row and all stream settle paths revoke stickiness', () => {
  assert.deepEqual(checkMainProcess(chat, router, policy), [])
})

test('the settings panel reads and writes the guard, and waits for the persisted config', () => {
  assert.deepEqual(checkPanel(panel), [])
})

test('both shipped locales carry every guard string the panel uses', () => {
  assert.deepEqual(checkLocales(locales, GUARD_KEYS), [])
})

test('each check fails on the mutation it is meant to catch', () => {
  // 摘掉读数 ⇒ 只有主进程那条红。
  const noReading = chat.replace('repetition: measureStreamRepetition(collectedContent, repetitionGuard) ?? undefined,', '')
  assert.deepEqual(
    checkMainProcess(noReading, router, policy).map((p) => p.includes('stream trace')),
    [true],
  )

  // 只在一个结算点撤粘性（另一个分支漏了）⇒ 也是红，而且是计数那条。
  const oneRevoke = chat.replace('settleSticky(trace, truncated)\n          reportStreamOutcome(\n            endReason,\n            elapsed,\n            truncated', 'reportStreamOutcome(\n            endReason,\n            elapsed,\n            truncated')
  assert.match(checkMainProcess(oneRevoke, router, policy).join('\n'), /saw 2/)

  // 摘掉「截断撤锚点」那条判据 ⇒ 红，而且点名的正是它。
  const noTruncation = policy.replace('if (truncated) return true', '')
  assert.match(checkMainProcess(chat, router, noTruncation).join('\n'), /output-cap truncation/)

  // 阈值写死成常量（不再读配置）⇒ 红。
  const hardcoded = chat.replace('storeManager.getConfig().streamRepetitionGuard ?? DEFAULT_REPETITION_GUARD', 'DEFAULT_REPETITION_GUARD')
  assert.match(checkMainProcess(hardcoded, router, policy).join('\n'), /never reads the configured thresholds/)

  // 面板存了别的键 ⇒ 红。
  const wrongSave = panel.replace('streamRepetitionGuard: guard', 'loadBalanceStrategyNote: guard')
  assert.match(checkPanel(wrongSave).join('\n'), /does not persist streamRepetitionGuard/)

  // 撤掉「读到配置前不渲染」的门 ⇒ 红（这条防的是默认值被保存回盘）。
  const alwaysRender = panel.replace('{guard && (', '{(')
  assert.match(checkPanel(alwaysRender).join('\n'), /before the persisted config/)

  // 只补一种语言 ⇒ 红，且点名是哪一份。
  const zhWithout = { path: locales[1].path, json: JSON.parse(JSON.stringify(locales[1].json)) }
  delete zhWithout.json.proxy.repetitionGuardMinLines
  assert.deepEqual(checkLocales([locales[0], zhWithout], GUARD_KEYS), [
    `${zhWithout.path} is missing one of ${GUARD_KEYS.join(', ')}`,
  ])
})
