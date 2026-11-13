/**
 * 2026-11-13 用户报障回归：从 opencode.ai/auth 复制的**真实** key 被
 * `^sk-[A-Za-z0-9_-]{20,}$` 挡在添加账号弹窗之外（「API key 形状不对」）。
 *
 * `sk-` 前缀只是我们自己的假设 —— 官方文档从未声明 key 格式，有效性只有
 * 上游的 200/401 说了算。现在只挡「明显没粘对」，且先把复制常见的零宽
 * 字符剥掉（`trim` 不处理 U+200B，是「看着没问题却过不了校验」的常见成因）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  API_KEY_MAX_LENGTH,
  normalizeOpencodeApiKey,
  opencodeApiKeyShapeError,
  planOpencodeCredentialRefresh,
} from '../../vendor/channel-pack/src/opencode-api-key.ts'

const rpcSource = readFileSync('vendor/channel-pack/src/opencode-rpc.ts', 'utf-8')
const dispatchSource = readFileSync('vendor/channel-pack/src/channel-pack-rpc.ts', 'utf-8')

test('非 sk- 前缀的真实 key 必须放行', () => {
  for (const key of [
    'oc_live_4f9a1c7e2b3d5a6f8e0c1b2d3a4f5e6d',
    'sk-ant-oat01-abc.def/ghi+jkl=',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-part',
  ]) {
    assert.equal(opencodeApiKeyShapeError(key), undefined, `${key.slice(0, 8)}… 应被接受`)
  }
})

test('复制带进的零宽字符与首尾空白先被剥掉', () => {
  const raw = '  \u200Boc_live_4f9a1c7e2b3d5a6f8e0c1b2d3a4f5e6d\uFEFF\n'
  const key = normalizeOpencodeApiKey(raw)
  assert.equal(key, 'oc_live_4f9a1c7e2b3d5a6f8e0c1b2d3a4f5e6d')
  assert.equal(opencodeApiKeyShapeError(key), undefined)
  // 非字符串（界面没填）落成空串，走「请先填入」那一支。
  assert.equal(normalizeOpencodeApiKey(undefined), '')
})

test('仍然挡住明显没粘对的值', () => {
  assert.match(opencodeApiKeyShapeError('') ?? '', /请先填入/)
  assert.match(opencodeApiKeyShapeError('short') ?? '', /太短/)
  assert.match(opencodeApiKeyShapeError('abc def ghi jkl') ?? '', /空格或换行/)
  assert.match(opencodeApiKeyShapeError('oc_live_密钥abc') ?? '', /非 ASCII/)
  assert.match(opencodeApiKeyShapeError('x'.repeat(API_KEY_MAX_LENGTH + 1)) ?? '', /过长/)
})

test('RPC 不再假设 sk- 前缀', () => {
  assert.doesNotMatch(rpcSource, /KEY_PATTERN/, '不得再按 sk- 前缀拒绝真实 key')
  assert.match(rpcSource, /opencodeApiKeyShapeError\(apiKey\)/, '校验必须走共用模块')
  assert.match(rpcSource, /normalizeOpencodeApiKey\(req\?\.apiKey\)/, '入库前先规范化')
})

/**
 * 2026-11-13 用户报障：点账号行的「刷新凭据」弹
 * 「刷新凭据失败 / Unknown provider: opencode」——`account.refresh` 的 switch
 * 没有 opencode 分支。这里锁住两件事：分派表里有这个 case，且判据本身可用。
 */
test('account.refresh 的分派表里有 opencode 分支', () => {
  assert.match(dispatchSource, /case OPENCODE\.id:\n[\s\S]{0,400}?refreshOpencodeAccountCredential\(/)
})

test('刷新：匿名槽没有可刷新的凭据，直接成功且不写盘', () => {
  const plan = planOpencodeCredentialRefresh(JSON.stringify({ api_key: 'public' }), 'OPENCODE_ANON_AB12', 'public')
  assert.equal(plan.anonymous, true)
  assert.equal(plan.writeValue, undefined)
})

test('刷新：干净 key 是幂等的，不做多余写', () => {
  const raw = JSON.stringify({ api_key: 'oc_sk_live_4f9a1c7e2b3d5a6f', nickname: '主力号' })
  const plan = planOpencodeCredentialRefresh(raw, 'OPENCODE_ACCOUNT_ABCD1234', 'public')
  assert.equal(plan.anonymous, false)
  assert.equal(plan.writeValue, undefined)
})

test('刷新：带零宽字符的 key 被规范化回写，其它字段原样保留', () => {
  const raw = JSON.stringify({ api_key: 'oc_sk_\u200Blive_4f9a1c7e2b3d5a6f', nickname: '主力号', fingerprint: { projectId: 'a'.repeat(40) } })
  const plan = planOpencodeCredentialRefresh(raw, 'OPENCODE_ACCOUNT_ABCD1234', 'public')
  assert.equal(plan.anonymous, false)
  const written = JSON.parse(plan.writeValue ?? '{}') as Record<string, unknown>
  assert.equal(written.api_key, 'oc_sk_live_4f9a1c7e2b3d5a6f')
  assert.equal(written.nickname, '主力号')
  assert.deepEqual(written.fingerprint, { projectId: 'a'.repeat(40) })
})

test('刷新：凭据损坏或缺少 key 时给出可操作错误，而不是假成功', () => {
  assert.throws(() => planOpencodeCredentialRefresh('{not json', 'OPENCODE_ACCOUNT_ABCD1234', 'public'), /凭据已损坏/)
  assert.throws(() => planOpencodeCredentialRefresh(JSON.stringify({ nickname: 'x' }), 'OPENCODE_ACCOUNT_ABCD1234', 'public'), /没有 API key/)
})