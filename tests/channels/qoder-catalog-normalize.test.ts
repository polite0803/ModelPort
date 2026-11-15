/**
 * Qoder 在线目录归一（`normalizeQoderCatalogEntry`）与 CN 离线兜底基线的一致性回归。
 *
 * 背景（用户报障 2026-11-15）：账号渠道页面的 Qoder 清单与「免费」标注是静态快照，
 * 官方调价 / 上新 / 改名后不更新 —— `qfmodel` 倍率已从 0 调到 0.1（页面仍标「免费」）、
 * `qmodel_latest` 改名「Qwen4-Max-Preview」且页面缺该模型。修法是把目录改为在线拉取
 * （`GET {encryptedInferBase}/algo/api/v2/model/list` 的 chat 场景，5 分钟 TTL），
 * 静态表降为离线兜底。
 *
 * 本测试驱动**生产用的那份 vendor 源码**（经 esbuild 按 `scripts/build-channel-pack.mjs`
 * 的同一套别名 / 插件打包），断言两件事：
 *  1. 兜底基线 `QODER_CN.fallbackModels` 与「在线目录经 normalize 归一」逐条相等
 *     —— 保证兜底本身不失真，且重采快照有可复现的对照基准；
 *  2. normalize 的边界口径（缺 key / 无上下文 / 档位取最大 / 0 倍率合法 / 思考档位键序）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR = join(ROOT, 'vendor', 'channel-pack')
const VENDOR_SRC = join(VENDOR, 'src')
const COMPAT = join(ROOT, 'src', 'main', 'channelPack', 'compat')

async function loadVendorBundle(t) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-qoder-catalog-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: [
        `export { normalizeQoderCatalogEntry } from ${JSON.stringify(join(VENDOR_SRC, 'qoder-adapter.ts'))}`,
        `export { QODER, QODER_CN } from ${JSON.stringify(join(VENDOR_SRC, 'qoder-product.ts'))}`,
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: {
      '@deepseek-ai/dsh-llm': join(COMPAT, 'dshLlm.ts'),
      '@deepseek-ai/dsh-credentials': join(COMPAT, 'dshCredentials.ts'),
      '@deepseek-ai/cordis': join(COMPAT, 'cordis.ts'),
      '@deepseek-ai/schemastery': join(COMPAT, 'schemastery.ts'),
      '@deepseek-ai/dsh-agent': join(COMPAT, 'dshAgent.ts'),
    },
    plugins: [{
      name: 'channel-pack-compat',
      setup(build) {
        build.onResolve({ filter: /^undici$/ }, args => {
          if (!args.importer.startsWith(VENDOR + sep)) return undefined
          return { path: join(COMPAT, 'undici.ts') }
        })
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\/image-pricing\.js$/ }, args => {
          if (!args.importer.startsWith(VENDOR + sep)) return undefined
          return { path: join(COMPAT, 'imagePricing.ts') }
        })
      },
    }],
    banner: {
      js: [
        "import { createRequire as __cr } from 'node:module'",
        'const require = __cr(import.meta.url)',
      ].join('\n'),
    },
  })
  return await import(pathToFileURL(outfile).href)
}

const LIVE_FIXTURE = join(ROOT, 'tests', 'channels', 'fixtures', 'qoder-cn-catalog-live.json')
const INTL_FIXTURE = join(ROOT, 'tests', 'channels', 'fixtures', 'qoder-intl-catalog-live.json')

test('CN 离线兜底基线 == 在线目录经 normalize 归一（2026-11-15 现网重采）', async (t) => {
  const { normalizeQoderCatalogEntry, QODER_CN } = await loadVendorBundle(t)
  const chat = JSON.parse(readFileSync(LIVE_FIXTURE, 'utf8'))
  const normalized = chat.map(normalizeQoderCatalogEntry)
  assert.ok(normalized.every(m => m !== undefined), '每条现网目录都应能归一')
  assert.deepEqual(normalized, QODER_CN.fallbackModels,
    '兜底基线必须与在线归一结果逐条相等（含顺序）；不等说明快照漂移或归一口径变了')
})

test('国际版离线兜底基线 == 在线目录经 normalize 归一（2026-11-15 现网重采）', async (t) => {
  const { normalizeQoderCatalogEntry, QODER } = await loadVendorBundle(t)
  const chat = JSON.parse(readFileSync(INTL_FIXTURE, 'utf8'))
  const normalized = chat.map(normalizeQoderCatalogEntry)
  assert.ok(normalized.every(m => m !== undefined), '每条现网目录都应能归一')
  assert.deepEqual(normalized, QODER.fallbackModels,
    '国际版兜底基线必须与在线归一结果逐条相等（含顺序）')
})

test('normalize：缺 key 或无上下文窗口 → undefined（不伪造条目）', async (t) => {
  const { normalizeQoderCatalogEntry } = await loadVendorBundle(t)
  assert.equal(normalizeQoderCatalogEntry(null), undefined)
  assert.equal(normalizeQoderCatalogEntry({ display_name: 'X', context_config: { '1M': { token_count: 1_000_000 } } }), undefined)
  assert.equal(normalizeQoderCatalogEntry({ key: 'x', display_name: 'X' }), undefined)
  assert.equal(normalizeQoderCatalogEntry({ key: 'x', context_config: {} }), undefined)
})

test('normalize：contextWindow 取档位表最大档，无档位表才退 max_input_tokens', async (t) => {
  const { normalizeQoderCatalogEntry } = await loadVendorBundle(t)
  const tiered = normalizeQoderCatalogEntry({
    key: 'x', display_name: 'X', max_input_tokens: 96_000,
    context_config: { '200K': { token_count: 200_000 }, '1M': { token_count: 1_000_000 }, '400K': { token_count: 400_000 } },
  })
  assert.equal(tiered.contextWindow, 1_000_000, '档位表存在时只认最大档，不被 max_input_tokens 拉低')
  const flat = normalizeQoderCatalogEntry({ key: 'y', display_name: 'Y', max_input_tokens: 128_000 })
  assert.equal(flat.contextWindow, 128_000, '无档位表退回 max_input_tokens')
})

test('normalize：priceFactor 0 是合法免费值，不被丢弃；思考档位按键序、default 取 is_default', async (t) => {
  const { normalizeQoderCatalogEntry } = await loadVendorBundle(t)
  const m = normalizeQoderCatalogEntry({
    key: 'qfmodel', display_name: 'Qwen3.8-Flash',
    context_config: { '1M': { token_count: 1_000_000 } },
    is_vl: true, is_reasoning: true, is_free: true, price_factor: 0, original_price_factor: 0.1,
    thinking_config: {
      enabled: { efforts: { xhigh: {}, low: {}, medium: { is_default: true } } },
      disabled: {},
    },
    promotion: { active: false, discount_factor: 0.4, before_promotion_price_factor: 0.1, window_start: '22:00', window_end: '08:00', badge: { zh: '错峰 4 折' } },
  })
  assert.equal(m.priceFactor, 0, '0 倍率必须保留（免费），不能用 >0 过滤')
  assert.equal(m.isFree, true)
  assert.deepEqual(m.efforts, ['xhigh', 'low', 'medium'], 'efforts 取目录键序')
  assert.equal(m.defaultEffort, 'medium', 'default 取 is_default:true 的键')
  assert.equal(m.supportsDisable, true, '存在 disabled 分支 → 可关闭思考')
  assert.deepEqual(m.promotion, {
    active: false, discountFactor: 0.4, beforePromotionPriceFactor: 0.1,
    windowStart: '22:00', windowEnd: '08:00', badgeZh: '错峰 4 折',
  })
})

test('normalize：无 thinking_config → 不声明 efforts/supportsDisable（不可选档位）', async (t) => {
  const { normalizeQoderCatalogEntry } = await loadVendorBundle(t)
  const m = normalizeQoderCatalogEntry({
    key: 'auto', display_name: 'Auto', context_config: { '1M': { token_count: 1_000_000 } }, price_factor: 0.5,
  })
  assert.equal(m.efforts, undefined)
  assert.equal(m.defaultEffort, undefined)
  assert.equal(m.supportsDisable, undefined)
})