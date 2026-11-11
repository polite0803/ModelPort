import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 「同步模型」按钮的接线自证。
 *
 * 这个按钮把三类模型清单来源收进一个入口，所以它最典型的坏法不是算错增删，
 * 而是**只接了其中一类**：按钮点下去、聚合变了、账号渠道没动，界面上看不出
 * 差别。这些断言钉的是接线本身：通道、API 表、类型镜像、主进程三个分支、
 * 界面按钮，以及批量入口「整包只 resync 一轮」这条性能不变量。
 */

const read = (path: string): string => readFileSync(path, 'utf8')

const channels = read('src/main/ipc/channels.ts')
const api = read('src/shared/api.ts')
const electronTypes = read('src/renderer/src/types/electron.d.ts')
const handlers = read('src/main/ipc/handlers.ts')
const manager = read('src/main/providers/accountChannels/manager.ts')
const modelList = read('src/renderer/src/components/models/ModelList.tsx')

test('通道与 API 表：providers:syncModels 一处声明、一处绑定', () => {
  assert.match(channels, /PROVIDERS_SYNC_MODELS: 'providers:syncModels'/)
  assert.match(
    api,
    /syncModels: \(providerIds\?: string\[\]\): Promise<ProviderModelSyncResult\[\]> =>\s*\n\s*wire\.invoke\(IpcChannels\.PROVIDERS_SYNC_MODELS, providerIds\)/,
  )
  // 渲染层是手写类型镜像，漏一处界面就看不到方法
  assert.match(
    electronTypes,
    /syncModels: \(providerIds\?: string\[\]\) => Promise<ProviderModelSyncResult\[\]>/,
  )
})

test('主进程：三类来源都有分支，缺省范围只含已启用的可同步供应商', () => {
  assert.match(handlers, /IpcChannels\.PROVIDERS_SYNC_MODELS/)
  // 账号渠道走批量入口（不是逐家 refreshModels）
  assert.match(handlers, /accountChannelManager\.syncModels\(channelIds\)/)
  assert.match(handlers, /aggregateProviderManager\.syncModels\(provider\.id\)/)
  assert.match(handlers, /storeManager\.applyFetchedModels\(provider\.id, fetched\.models\)/)
  // 缺省集合：停用的供应商不进同步范围（界面上也看不到它们）
  assert.match(
    handlers,
    /provider\.enabled &&\s*\n\s*\(provider\.type === 'aggregate' \|\| provider\.type === 'account' \|\| provider\.type === 'builtin'\)/,
  )
  // 自定义供应商没有清单来源：明确失败，不静默跳过
  assert.match(handlers, /item\.type === 'builtin' \|\| item\.type === 'custom'/)
})

test('账号渠道批量入口：整包只 resync 一轮，并清掉被删模型的停用标记', () => {
  const start = manager.indexOf('async syncModels(ids: string[]): Promise<ChannelModelSyncResult[]>')
  assert.ok(start >= 0, '批量入口不存在')
  const rest = manager.slice(start)
  const end = rest.indexOf('\n  /**', 1)
  const body = end === -1 ? rest : rest.slice(0, end)

  assert.equal(
    (body.match(/await this\.resync\(\)/g) ?? []).length,
    1,
    '批量入口必须只跑一轮 resync；逐渠道调用会把同一轮目录扫描重复 N 次',
  )
  assert.match(body, /storeManager\.setModelsServed\(id, removed, true\)/)
  // 同步前的快照来自 provider 记录，而不是这份内存目录
  assert.match(body, /supportedModels/)
})

test('界面：按钮接在工具栏，作用域跟供应商筛选走', () => {
  assert.match(modelList, /const handleSyncModels = useCallback\(async \(\) => \{/)
  assert.match(modelList, /window\.electronAPI\.providers\.syncModels\(scope\)/)
  // 选中一家 = 那一家；all = 缺省全量
  assert.match(modelList, /selectedProvider === 'all' \? undefined : \[selectedProvider\]/)
  // 同步重写了供应商记录，必须重取再触发目录重读
  assert.match(modelList, /setModelsLastUpdated\(Date\.now\(\)\)/)
  assert.match(modelList, /window\.electronAPI\.providers\.getAll\(\)/)
  assert.match(modelList, /setProviders\(providerRows\)/)
  // 按钮本体 + 筛选为「模型映射」时不可点
  assert.match(modelList, /onClick=\{\(\) => void handleSyncModels\(\)\}/)
  assert.match(modelList, /selectedProvider === 'mapping'/)
})

test('文案：中英都在，插值占位符一致', () => {
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en-US.json')).models
  const zh = JSON.parse(read('src/renderer/src/i18n/locales/zh-CN.json')).models
  const keys = [
    'syncModels',
    'syncAllModels',
    'syncModelsHint',
    'syncRunning',
    'syncDone',
    'syncUnchanged',
    'syncPartial',
    'syncNothing',
    'syncReasonEmpty',
    'syncReasonNoSource',
  ]
  const slots = (text: string): string[] => (text.match(/\{\{\w+\}\}/g) ?? []).sort()
  for (const key of keys) {
    assert.equal(typeof en[key], 'string', `en-US 缺 models.${key}`)
    assert.equal(typeof zh[key], 'string', `zh-CN 缺 models.${key}`)
    assert.deepEqual(slots(en[key]), slots(zh[key]), `models.${key} 的占位符两边不一致`)
  }
})
