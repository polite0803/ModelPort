import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  capabilityHintOf,
  qualifyChannelModel,
  readModelList,
  readModelListSource,
  splitModelLabel,
} from '../../src/main/providers/accountChannels/modelCatalog.ts'

test('the multiplier is split out of the display name', () => {
  assert.deepEqual(splitModelLabel('MiniMax M3 · x4.0'), { name: 'MiniMax M3', free: false, weight: 4 })
  assert.deepEqual(splitModelLabel('Kimi-K3 · x1'), { name: 'Kimi-K3', free: false, weight: 1 })
  assert.deepEqual(splitModelLabel('Spark X2.5 · x0.1'), { name: 'Spark X2.5', free: false, weight: 0.1 })
})

test('a promo window keeps the original rate next to the effective one', () => {
  assert.deepEqual(splitModelLabel('GLM-5-3-Flash · x0.2→x0.1'), {
    name: 'GLM-5-3-Flash',
    free: false,
    weight: 0.1,
    baseWeight: 0.2,
  })
})

test('免费 means weight 0, and a zero rate is free too', () => {
  assert.deepEqual(splitModelLabel('Qwen3.8-Flash · 免费'), { name: 'Qwen3.8-Flash', free: true, weight: 0 })
  assert.deepEqual(splitModelLabel('Zero · x0'), { name: 'Zero', free: true, weight: 0 })
})

test('a label without a rate keeps an unknown weight, never 0', () => {
  // trae/minimax 这类渠道根本不报倍率：把「未知」当成免费会让用户按免费额度
  // 选一个按量计费的模型。
  assert.deepEqual(splitModelLabel('Trae Pro'), { name: 'Trae Pro', free: false })
  assert.equal(splitModelLabel('').weight, undefined)
})

test('同名变体标记跟在倍率后面时，倍率照样拆出来，名字原样保留', () => {
  // buddy 给两条同名模型追加变体（`… · x0.03 SG`）：变体是去重键，拆掉它会吞掉一条
  // 模型；倍率不拆出来则这条模型的消耗档永远是「未标注」。
  assert.deepEqual(splitModelLabel('Deepseek-V4.1-Flash · x0.03 SG'), {
    name: 'Deepseek-V4.1-Flash · x0.03 SG',
    free: false,
    weight: 0.03,
  })
  assert.deepEqual(splitModelLabel('GLM-5-3-Flash · x0.2→x0.1 X'), {
    name: 'GLM-5-3-Flash · x0.2→x0.1 X',
    free: false,
    weight: 0.1,
    baseWeight: 0.2,
  })
  // 变体后面还有空格的多词尾巴不认：只接受单个短标记，避免把名字里的普通词当变体。
  assert.equal(splitModelLabel('Some Model · x2 extra words').weight, undefined)
})

test('目录来源只认已知三态，未知值按「没有来源概念」处理', () => {
  assert.equal(readModelListSource({ source: 'upstream' }), 'upstream')
  assert.equal(readModelListSource({ source: 'official-cache' }), 'official-cache')
  assert.equal(readModelListSource({ source: 'static-fallback' }), 'static-fallback')
  // 拼错/未来新增的值不能触发「降级目录」提醒。
  assert.equal(readModelListSource({ source: 'cache' }), undefined)
  assert.equal(readModelListSource({}), undefined)
  assert.equal(readModelListSource(undefined), undefined)
})

test('model.list payloads are normalised, malformed entries dropped', () => {
  const models = readModelList({
    models: [
      { id: 'MiniMax-M3', name: 'MiniMax M3 · x4.0', disabled: false, dead: false },
      { id: 'Qwen3.8-Flash', name: 'Qwen3.8-Flash · 免费', isFree: true },
      { id: 'paid', name: 'Paid · x2', isFree: true },
      { name: 'no id' },
      'garbage',
      null,
    ],
  })
  assert.deepEqual(models, [
    { id: 'MiniMax-M3', name: 'MiniMax M3', free: false, disabled: false, dead: false, weight: 4 },
    { id: 'Qwen3.8-Flash', name: 'Qwen3.8-Flash', free: true, disabled: false, dead: false, weight: 0 },
    // 免费的唯一判据是权重 0：展示名写了 `x2`，即使上游标了 `isFree` 也不算免费。
    { id: 'paid', name: 'Paid', free: false, disabled: false, dead: false, weight: 2 },
  ])

  assert.deepEqual(readModelList(undefined), [])
  assert.deepEqual(readModelList({ models: 'nope' }), [])
})

test('image support is carried through only when the channel declares it', () => {
  const models = readModelList({
    models: [
      { id: 'vision', name: 'Vision', supportsImage: true },
      { id: 'text-only', name: 'Text', supportsImage: false },
      // 上游没写 / 类型不对时保持「未知」，不能当成「不支持」。
      { id: 'silent', name: 'Silent' },
      { id: 'weird', name: 'Weird', supportsImage: 'yes' },
    ],
  })
  assert.deepEqual(
    models.map((model) => [model.id, model.supportsImage]),
    [
      ['vision', true],
      ['text-only', false],
      ['silent', undefined],
      ['weird', undefined],
    ],
  )
})

test('capability hints carry only what the catalogue actually declares', () => {
  const models = readModelList({
    models: [
      { id: 'vision-free', name: 'Vision Free · 免费', supportsImage: true },
      { id: 'text-paid', name: 'Text Paid · x2', supportsImage: false },
      // 没有任何已知字段：返回 undefined，调用方据此保持「未知」
      { id: 'silent', name: 'Silent' },
      // 有模态但没有倍率（trae / minimax 这类渠道不报倍率）：
      // `free` 两个方向都不写 —— 「不知道」既不是免费，也不是收费。
      { id: 'no-rate', name: 'No Rate', supportsImage: false },
    ],
  })

  assert.deepEqual(capabilityHintOf(models[0]), { vision: 'yes', weight: 0, free: true })
  // 明确的正倍率就是「不免费」：这是渠道自己报的价，不是把缺失折成 false。
  assert.deepEqual(capabilityHintOf(models[1]), { vision: 'no', weight: 2, free: false })
  assert.equal(capabilityHintOf(models[2]), undefined)
  assert.deepEqual(capabilityHintOf(models[3]), { vision: 'no' })
})

/**
 * 裸 id 补回渠道前缀（2026-11-01 192.168.85.131 实测 8 笔 400「模型 ID 无效：big-pickle」）。
 *
 * 钉三条方向：已带前缀的**一个字节都不动**（绝大多数请求走这格）；裸名补上
 * **本**渠道 id；带的是**别家**前缀时不擅自改目标 —— 那是用户自己写的映射。
 */
test('qualifyChannelModel keeps an already-qualified id untouched', () => {
  assert.equal(qualifyChannelModel('opencode', 'opencode/big-pickle'), 'opencode/big-pickle')
  // 模型 id 自己带斜杠时，只按第一个斜杠切分，不能切成三段。
  assert.equal(qualifyChannelModel('cline', 'cline/nvidia/beam-free'), 'cline/nvidia/beam-free')
})

test('qualifyChannelModel prefixes a bare id with the provider the host already knows', () => {
  assert.equal(qualifyChannelModel('opencode', 'big-pickle'), 'opencode/big-pickle')
  assert.equal(qualifyChannelModel('qodercn', 'qfmodel'), 'qodercn/qfmodel')
  assert.equal(qualifyChannelModel('opencode', '  big-pickle  '), 'opencode/big-pickle')
})

test('qualifyChannelModel never rewrites another channel as the prefix', () => {
  // 跨渠道的映射值是用户/旧数据写的意图，改它等于替他换供应商；真要出错也该
  // 由那条映射的归属来解释，不在这里悄悄换掉目标。
  assert.equal(qualifyChannelModel('opencode', 'qoder/qfmodel'), 'qoder/qfmodel')
})

test('qualifyChannelModel leaves an empty name empty instead of inventing one', () => {
  assert.equal(qualifyChannelModel('opencode', '   '), '')
})

/* ───────────────────────── 时变折价（渠道包上抛 `discount`） ───────────────────────── */

test('a reported discount window survives normalisation with both prices', () => {
  // 渠道包上抛的形态（`RpcModelDiscount`）：时段 + 窗口内的价 + 窗口外的原价。
  // 展示名只有窗口**开着**时才印箭头，所以窗口外的目录里只剩原价 —— 窗口与
  // 折后价必须来自这个字段，不能靠解析名字。
  const [model] = readModelList({
    models: [{
      id: 'glm-5.2',
      name: 'GLM-5.2 · x0.5',
      discount: {
        weight: 0.5,
        baseWeight: 1,
        daily: [{ start: '23:00', end: '7:50' }],
        timezone: 'Asia/Shanghai',
      },
    }],
  })
  assert.equal(model.weight, 0.5)
  assert.equal(model.baseWeight, 1)
  assert.equal(model.promoWeight, 0.5)
  assert.deepEqual(model.discountWindow, {
    daily: [{ start: '23:00', end: '7:50' }],
    timezone: 'Asia/Shanghai',
  })
})

test('a discount with no window is not read as an all-day price', () => {
  // 只给价不给时段：宿主没有「何时生效」的信息，因此**不写窗口** —— 写了空窗口
  // 会读成「整天生效」，那等于凭空延长一次促销。
  const [model] = readModelList({
    models: [{ id: 'x', name: 'X · x0.5', discount: { weight: 0.5, baseWeight: 1 } }],
  })
  assert.equal(model.discountWindow, undefined)
  // 窗口内价仍然记下来（它是渠道明确报过的那个数），但无窗口时它不是时变价。
  assert.equal(model.promoWeight, 0.5)
  assert.equal(model.baseWeight, 1)
})

test('unreadable slot boundaries are dropped, never widened to the whole day', () => {
  const [model] = readModelList({
    models: [{
      id: 'x',
      name: 'X · x0.5',
      discount: {
        weight: 0.5,
        daily: [{ start: '晚上', end: '早上' }, { start: '23:00', end: '7:50' }],
      },
    }],
  })
  assert.deepEqual(model.discountWindow?.daily, [{ start: '23:00', end: '7:50' }])
  // 全部时段都读不懂 → 窗口整个丢弃，而不是留下一个「没有时段」的窗口。
  const [broken] = readModelList({
    models: [{ id: 'y', name: 'Y · x0.5', discount: { weight: 0.5, daily: [{ start: 'x', end: 'y' }] } }],
  })
  assert.equal(broken.discountWindow, undefined)
})

test('validity spans are accepted as epoch ms and reject nonsense', () => {
  const [model] = readModelList({
    models: [{
      id: 'x',
      name: 'X · 免费',
      discount: { weight: 0, baseWeight: 1, validFrom: 1_700_000_000_000, validUntil: 1_700_100_000_000 },
    }],
  })
  assert.deepEqual(model.discountWindow, {
    validFrom: 1_700_000_000_000,
    validUntil: 1_700_100_000_000,
  })
  // 负数 / 非数值一律丢弃：一个畸形的截止时间会把窗口读成永久关闭。
  const [bad] = readModelList({
    models: [{ id: 'y', name: 'Y · x0.5', discount: { weight: 0.5, validUntil: 'soon' } }],
  })
  assert.equal(bad.discountWindow, undefined)
})

test('the capability hint keeps the time-varying fields instead of only the price', () => {
  // 这是第二步的核心：`capabilityHintOf` 旧实现只搬 `weight`，把原价与窗口
  // 一起丢掉，于是宿主手里只有「采集那一刻的价」，无法在边界上切换。
  const [model] = readModelList({
    models: [{
      id: 'qmodel_38max',
      name: 'Qwen3.8-Max · x0.5',
      discount: {
        weight: 0.2,
        baseWeight: 0.5,
        daily: [{ start: '22:00', end: '08:00' }],
        timezone: 'Asia/Singapore',
      },
    }],
  })
  assert.deepEqual(capabilityHintOf(model), {
    // `weight` 是**采集那一刻**的展示价（窗口外是 x0.5），不是窗口内的价。
    weight: 0.5,
    baseWeight: 0.5,
    promoWeight: 0.2,
    discountWindow: { daily: [{ start: '22:00', end: '08:00' }], timezone: 'Asia/Singapore' },
    free: false,
  })
})

test('a zero promo price is kept as free rather than treated as an ended promotion', () => {
  // `factor: 0` 是真的免费（buddy 的夜间活动），但**必须带窗口**：没有窗口的
  // 0 价在渠道包侧就是「已结束占位」，到不了这里。
  const [model] = readModelList({
    models: [{
      id: 'hy4-preview',
      name: 'Hy4 Preview · x0.29',
      discount: { weight: 0, baseWeight: 0.29, daily: [{ start: '23:00', end: '7:50' }] },
    }],
  })
  assert.equal(model.promoWeight, 0)
  assert.equal(model.baseWeight, 0.29)
  // `weight` 仍是采集那一刻的展示价（0.29，窗口外）；免费与否由生效价决定。
  assert.equal(model.weight, 0.29)
  assert.equal(model.free, false)
})
