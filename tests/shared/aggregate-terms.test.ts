import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { AGGREGATE_TERMS_WARNINGS, getTermsWarning } from '../../src/shared/aggregateTerms.ts'
import { AGGREGATE_REGISTRY } from '../../src/main/providers/aggregate/registry.ts'

const IDS = new Set(AGGREGATE_REGISTRY.map(entry => entry.id))
const FREE_TIER_IDS = new Set(
  AGGREGATE_REGISTRY.filter(entry => entry.category === 'free-tier').map(entry => entry.id)
)

test('every terms warning is a real entry with a verbatim source', () => {
  assert.ok(AGGREGATE_TERMS_WARNINGS.length > 0, 'the warning list must not be silently empty')

  for (const warning of AGGREGATE_TERMS_WARNINGS) {
    assert.ok(IDS.has(warning.entryId), `${warning.entryId} is not in the aggregate catalogue`)
    assert.ok(warning.quote.length > 20, `${warning.entryId} has no verbatim clause to show`)
    assert.match(warning.docUrl, /^https:\/\//, `${warning.entryId} needs a fetchable source`)
    assert.match(warning.asOf, /^\d{4}-\d{2}-\d{2}$/, `${warning.entryId} needs the verification date`)
    assert.ok(
      warning.scope === 'all-requests' || warning.scope === 'free-tier-models',
      `${warning.entryId} has an unknown scope`
    )
  }
})

test('only the entries whose clause was actually read are warned about', () => {
  assert.deepEqual(
    AGGREGATE_TERMS_WARNINGS.map(warning => warning.entryId).sort(),
    [
      'bailian_coding_plan',
      'glm-cn',
      'jd_coding_plan',
      'opencode_zen',
      'qianfan_coding_plan',
      'qianfan_token_plan',
      'qwencloud_coding',
      'tencent_coding_plan',
    ],
    'adding a warning needs a verified clause; zai, alibaba_cloud and the iFlytek/Token-Plan pages have none yet'
  )

  // 同厂商但不是套餐端点的条目不得被连带警告：alibaba_cloud 是按量 compatible-mode，zai_api 是 PAYG。
  assert.equal(getTermsWarning('alibaba_cloud'), undefined)
  assert.equal(getTermsWarning('zai_api'), undefined)
  // 智谱的 coding 端点确实被标了，普通 open-platform 条目不受影响。
  assert.ok(getTermsWarning('glm-cn'))
})

test('the free-tier-only clause never blankets the paid models of the same entry', () => {
  const zen = getTermsWarning('opencode_zen')
  assert.equal(zen?.scope, 'free-tier-models', 'OpenCode restricts the free rows, not the endpoint')
  assert.ok(FREE_TIER_IDS.has('opencode_zen'))

  for (const warning of AGGREGATE_TERMS_WARNINGS) {
    if (warning.scope === 'free-tier-models') continue
    assert.ok(!FREE_TIER_IDS.has(warning.entryId),
      `${warning.entryId} is a free-tier row carrying an all-requests clause - recheck the wording`)
  }
})

test('both locales carry the three warning keys with intact interpolation slots', () => {
  const locales = ['en-US', 'zh-CN'].map(name => ({
    name,
    aggregate: (JSON.parse(
      readFileSync(`src/renderer/src/i18n/locales/${name}.json`, 'utf-8')
    ) as { aggregate: Record<string, string> }).aggregate,
  }))

  for (const key of ['termsWarningAll', 'termsWarningFreeOnly', 'termsWarningSource']) {
    for (const { name, aggregate } of locales) {
      assert.equal(typeof aggregate[key], 'string', `${name} is missing aggregate.${key}`)
      assert.ok(aggregate[key].length > 8, `${name} aggregate.${key} is a stub`)
    }
  }

  const slots = (text: string): string[] => (text.match(/{{\s*[\w.]+\s*}}/g) ?? []).sort().join(',')
  const [en, zh] = locales.map(l => slots(l.aggregate.termsWarningSource))
  assert.equal(en, '{{date}}', 'the source label must interpolate exactly the date slot')
  assert.equal(zh, en, 'the two locales must interpolate the same slots')
})
