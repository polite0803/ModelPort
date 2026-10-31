import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGeminiAvailableModels,
  collapseGeminiTiers,
  geminiModelFamily,
  geminiCatalogFamilies,
} from '../../vendor/channel-pack/src/gemini-models.ts'

/** 档位表与 `gemini.ts` 的 `GEMINI_EFFORT_IDS` 同源（这里按调用方注入的方式传）。 */
const TIERS = ['low', 'medium', 'high', 'tiered']

test('models 是以 id 为键的对象：解析出条目，displayName 缺失时回退 id', () => {
  const parsed = parseGeminiAvailableModels({
    models: {
      'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)', maxTokens: 1048576, maxOutputTokens: 65536 },
      'gemini-3.8-flash-medium': {},
    },
  })
  assert.deepEqual(parsed.map((m) => m.id), ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium'])
  assert.equal(parsed[0]?.displayName, 'Gemini 3.8 Flash (High)')
  assert.equal(parsed[0]?.contextWindow, 1048576)
  assert.equal(parsed[0]?.maxOutputTokens, 65536)
  assert.equal(parsed[1]?.displayName, 'gemini-3.8-flash-medium', 'displayName 缺失时回退成 id')
  assert.equal(parsed[1]?.contextWindow, undefined, '上游没给就是没给，不补 0')
})

test('形状不认识 ⇒ 空数组（调用方回落静态表），不把异常形状读成「该账号没有模型」', () => {
  assert.deepEqual(parseGeminiAvailableModels({ models: [] }), [], '数组形态不是这条线的形状')
  assert.deepEqual(parseGeminiAvailableModels({}), [])
  assert.deepEqual(parseGeminiAvailableModels(null), [])
  assert.deepEqual(parseGeminiAvailableModels('models'), [])
})

test('非法数值字段一律不采信：0 / 负数 / NaN / 字符串都当没给', () => {
  const parsed = parseGeminiAvailableModels({
    models: { 'x-flash': { displayName: 'X', maxTokens: 0, maxOutputTokens: -5 }, 'y-flash': { maxTokens: Number.NaN }, 'z-flash': { maxTokens: '1048576' } },
  })
  assert.equal(parsed[0]?.contextWindow, undefined)
  assert.equal(parsed[0]?.maxOutputTokens, undefined)
  assert.equal(parsed[1]?.contextWindow, undefined)
  assert.equal(parsed[2]?.contextWindow, undefined, '字符串数字不折算')
})

test('内部/预览条目被滤掉，旧型号**不**被滤（不替上游做删除决定）', () => {
  const parsed = parseGeminiAvailableModels({
    models: {
      chat_20706: { displayName: 'internal' },
      chat_23310: { displayName: 'internal' },
      tab_jump_flash_lite_preview: { displayName: 'tab preview' },
      'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro' },
    },
  })
  assert.deepEqual(parsed.map((m) => m.id), ['gemini-2.5-pro'])
})

test('档位后缀剥得掉、剥错不认：只按传入的档位表剥', () => {
  assert.equal(geminiModelFamily('gemini-3.8-flash-high', TIERS), 'gemini-3.8-flash')
  assert.equal(geminiModelFamily('gemini-3.8-flash', TIERS), 'gemini-3.8-flash')
  // 不在表里的后缀不得剥（未来真名以别的词结尾时不会被误伤）。
  assert.equal(geminiModelFamily('gemini-3.8-flash-ultra', TIERS), 'gemini-3.8-flash-ultra')
})

test('同族四个档位归并成一条，efforts 按档位表顺序而不是上游返回顺序', () => {
  const entries = collapseGeminiTiers(
    parseGeminiAvailableModels({
      models: {
        'gemini-3.8-flash-tiered': { displayName: 'T', maxTokens: 1048576, maxOutputTokens: 65536 },
        'gemini-3.8-flash-high': { displayName: 'H', maxTokens: 1048576, maxOutputTokens: 65536 },
        'gemini-3.8-flash-low': { displayName: 'L', maxTokens: 1048576, maxOutputTokens: 65536 },
        'gemini-3.8-flash-medium': { displayName: 'M', maxTokens: 1048576, maxOutputTokens: 65536 },
      },
    }),
    TIERS,
  )
  assert.equal(entries.length, 1, '四个档位必须归成一条')
  assert.equal(entries[0]?.id, 'gemini-3.8-flash')
  assert.deepEqual(entries[0]?.effortOptions, ['low', 'medium', 'high', 'tiered'])
  assert.equal(entries[0]?.defaultEffort, 'medium')
  assert.equal(entries[0]?.contextWindow, 1048576)
  assert.equal(entries[0]?.maxTokens, 65536)
})

test('只有裸 id（上游没列档位条目）时不声明 efforts：空数组会变成点不开的空下拉框', () => {
  const entries = collapseGeminiTiers(parseGeminiAvailableModels({ models: { 'gemini-4-argon': { displayName: 'Argon' } } }), TIERS)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.effortOptions, undefined)
  assert.equal(entries[0]?.defaultEffort, undefined)
  assert.equal(entries[0]?.contextWindow, 0, '上游没给窗口 ⇒ 0（未知），不编一个数')
})

test('上游列出档位但没有 medium 时，默认档取列出的第一个', () => {
  const entries = collapseGeminiTiers(
    parseGeminiAvailableModels({ models: { 'a-high': {}, 'a-low': {} } }),
    TIERS,
  )
  assert.deepEqual(entries[0]?.effortOptions, ['low', 'high'])
  assert.equal(entries[0]?.defaultEffort, 'low')
})

test('图片支持默认 false，按族名由调用方给（上游不报模态，不把未知当支持）', () => {
  const remote = parseGeminiAvailableModels({ models: { 'flash-vision': {}, 'text-only': {} } })
  const entries = collapseGeminiTiers(remote, TIERS, { supportsImage: (family) => family === 'flash-vision' })
  assert.equal(entries.find((e) => e.id === 'flash-vision')?.supportsImage, true)
  assert.equal(entries.find((e) => e.id === 'text-only')?.supportsImage, false)
  assert.equal(collapseGeminiTiers(remote, TIERS)[0]?.supportsImage, false, '不传回调时一律 false')
})

test('准入表 = 目录里的族名（校验与目录同源）', () => {
  const entries = collapseGeminiTiers(
    parseGeminiAvailableModels({ models: { 'gemini-3.8-flash-high': {}, 'claude-sonnet-4-6-thinking': {} } }),
    TIERS,
  )
  const families = geminiCatalogFamilies(entries)
  // ⚠️ `claude-sonnet-4-6-thinking` 的 `-thinking` **不是**档位后缀（档位只有
  // low/medium/high/tiered），按既定规则不剥 —— 它自成一族。写在这里是为了把
  // 「只剥已知后缀」这条限制钉住：将来加后缀表时必须显式改这一条。
  assert.deepEqual([...families].sort(), ['claude-sonnet-4-6-thinking', 'gemini-3.8-flash'])
  assert.equal(families.has('gemini-3.8-flash-high'), false, '带档位的名字不是准入项')
})
