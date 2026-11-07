/**
 * TRAE 官方客户端模型缓存的归一（2026-11-08 用户报障「trae 无法刷新模型清单」）。
 *
 * 背景：batch 端点现在只回空组 + `config_source: 3` 的自定义模型，官方模型
 * 在客户端缓存的 `model_list_map` 里（`config_source: 1`）。本用例锁死：
 * - 只收白名单通道、只收官方预置（自定义仍打 `isCustomModel` 由适配器剔除）；
 * - 上下文取 `dev`（不是 Max 的 `max`）、输出上限取 `max_tokens`、倍率取
 *   `features.consumption_rate.data.rate`；
 * - 同一模型出现在多个通道时沿用既有合并规则（空档位不覆盖有档位）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const VENDOR_SRC = join(ROOT, 'vendor', 'channel-pack', 'src')
const COMPAT_LLM = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'dshLlm.ts')
const COMPAT_SCHEMASTERY = join(ROOT, 'src', 'main', 'channelPack', 'compat', 'schemastery.ts')

async function loadCache(t: { after(fn: () => void): void }) {
  const esbuild = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'channel-pack-trae-cache-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({
    stdin: {
      contents: `export {
        parseTraeCachedModelMap,
        traeStateDbCandidates,
      } from ${JSON.stringify(join(VENDOR_SRC, 'trae-model-cache.ts'))}`,
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
      '@deepseek-ai/dsh-llm': COMPAT_LLM,
      '@deepseek-ai/schemastery': COMPAT_SCHEMASTERY,
    },
  })
  return await import(pathToFileURL(outfile).href)
}

const CACHED_MAP = {
  solo_agent: [
    {
      config_name: 'glm-5.3',
      display_name: 'GLM-5.3',
      config_source: 1,
      status: true,
      multimodal: true,
      context_window_tokens: { dev: 200_000, max: 1_000_000 },
      max_tokens: 64_000,
      reasoning_effort_config: {
        support_thinking: true,
        options: ['light', 'high', 'extra_high'],
        default_level: 'high',
      },
      features: { consumption_rate: { enable: true, data: { rate: 0.78 } } },
    },
    {
      config_name: 'custom_openai_compatible//daily',
      display_name: 'Custom daily',
      config_source: 3,
      status: true,
      provider: 'custom_openai_compatible',
      base_url: 'http://127.0.0.1:8080',
    },
  ],
  solo_work_lite: [
    {
      // 同一模型、通道优先级更低、没有思考档位：不得覆盖 solo_agent 那条。
      config_name: 'glm-5.3',
      display_name: 'GLM-5.3 (lite)',
      config_source: 1,
      status: true,
      context_window_tokens: { dev: 100_000 },
      max_tokens: 32_000,
      reasoning_effort_config: { support_thinking: false },
    },
  ],
  not_whitelisted: [
    { config_name: 'should-not-appear', config_source: 1, status: true },
  ],
}

test('白名单 + 官方预置 + 字段映射', async (t) => {
  const { parseTraeCachedModelMap } = await loadCache(t)
  const models = parseTraeCachedModelMap(CACHED_MAP)
  assert.equal(models.length, 2, '应保留官方模型与自定义模型各一条（自定义由适配器剔除）')
  const official = models.find((model: { id: string }) => model.id === 'glm-5.3')
  assert.ok(official, '缺少 glm-5.3')
  assert.equal(official.function, 'solo_agent', '重复条目应取优先级更高的通道')
  assert.equal(official.contextWindow, 200_000, '上下文必须取 dev，不能取 max')
  assert.equal(official.maxOutputTokens, 64_000)
  assert.equal(official.creditsRate, 0.78)
  assert.equal(official.multimodal, true)
  assert.deepEqual(official.reasoningConfig?.options, ['light', 'high', 'extra_high'])
  assert.equal(official.isCustomModel, undefined)

  const custom = models.find((model: { id: string }) => model.id === 'custom_openai_compatible//daily')
  assert.equal(custom?.isCustomModel, true, '自定义模型必须打标，交给适配器统一剔除')
  assert.equal(models.some((model: { id: string }) => model.id === 'should-not-appear'), false)
})

test('停用条目与非法条目被剔除', async (t) => {
  const { parseTraeCachedModelMap } = await loadCache(t)
  const models = parseTraeCachedModelMap({
    solo_agent: [
      { config_name: 'disabled', config_source: 1, status: false },
      { display_name: 'no id', config_source: 1, status: true },
      null,
    ],
  })
  assert.deepEqual(models, [])
})

test('缓存路径覆盖 Windows / WSL Windows 侧 / macOS', async (t) => {
  const { traeStateDbCandidates } = await loadCache(t)
  const paths = traeStateDbCandidates()
  assert.ok(paths.length > 0)
  for (const file of paths) assert.match(file, /state\.vscdb$/)
  assert.ok(
    paths.some((file: string) => file.includes('Trae CN') || file.includes('Trae')),
    '候选路径必须覆盖 Trae CN / Trae',
  )
})
