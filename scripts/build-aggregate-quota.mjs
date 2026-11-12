/**
 * 由取证回执生成聚合目录的额度旁表。
 *
 * 取证回执在 docs/data/free-quota-research/*.json（6 组 + 重取组），每条都必须带
 * 逐字原句与出处 URL；本脚本只做归一与产出，不补任何数字。重取组回来后直接再跑一次即可。
 *
 * 归一规则（唯一一条）：`source` 只在「至少有一个非 null 数字」时才是 documented。
 * 上一轮取证有 14 行找到了页面但没找到数字却标成 documented，照原样落库会让面板
 * 把它们渲染成"有额度数据"。
 *
 * 单位不是 token 的官方上限（Neurons/日、请求/小时/IP、并发路数、美元/月）不折算：
 * 折算等于替厂商发明换算率。原文照抄进 `officialNote`，只在面板显示，预检不读。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const RESEARCH_DIR = 'docs/data/free-quota-research'
const OUTPUT = 'src/shared/aggregateQuota.ts'
const FIELDS = ['rpm', 'rpd', 'tpm', 'tpd', 'monthlyTokens', 'contextWindow']

const asText = value => {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ')
  if (typeof value === 'object') return Object.values(value).map(asText).filter(Boolean).join(' ')
  return String(value)
}

const asNumber = value =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

const rows = new Map()
/** 已从目录撤下、但回执仍保留作证据的条目（撤下原因写在回执里）。 */
const withdrawn = []
// 重取组（走代理那轮）优先于首轮同名家：首轮有多家是被"CLI 没走代理"挡住的假失败。
const FILES = readdirSync(RESEARCH_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()
  .sort((a, b) => (a.includes('retry') ? 1 : 0) - (b.includes('retry') ? 1 : 0))

for (const name of FILES) {
  const parsed = JSON.parse(readFileSync(join(RESEARCH_DIR, name), 'utf-8'))
  for (const row of Array.isArray(parsed) ? parsed : parsed.entries ?? []) {
    const id = row.entryId
    if (!id) throw new Error(`${name}: 一条记录没有 entryId`)
    if (row.withdrawn) {
      withdrawn.push({ id, file: name, reason: asText(row.withdrawnReason) })
      continue
    }
    if (rows.has(id) && !name.includes('retry')) {
      throw new Error(`${basename(name)}: ${id} 被两组重复取证，需人工合并`)
    }
    if (rows.has(id)) {
      console.log(`重取覆盖：${id}（首轮来自 ${rows.get(id).file}）`)
    }

    const quota = row.quota ?? {}
    const numbers = Object.fromEntries(
      FIELDS.map(field => [field, asNumber(quota[field])]).filter(([, value]) => value !== null)
    )
    rows.set(id, {
      file: name,
      entryId: id,
      source: Object.keys(numbers).length > 0 ? 'documented' : 'undocumented',
      numbers,
      perModel: (row.perModel ?? []).map(model => ({
        modelId: model.modelId,
        ...Object.fromEntries(
          FIELDS.map(field => [field, asNumber(model[field])]).filter(([, value]) => value !== null)
        ),
      })).filter(model => model.modelId),
      docUrl: asText(row.docUrl).startsWith('https://') ? asText(row.docUrl) : '',
      asOf: asText(row.asOf) || '2026-10-29',
      officialNote: asText(row.notes).replace(/\s+/g, ' ').trim(),
    })
  }
}

const declaredIds = readFileSync('src/main/providers/aggregate/registry.ts', 'utf-8')
  .split('\n')
  .filter(line => /^ {4}"id": "/.test(line))
  .map(line => line.match(/^ {4}"id": "([^"]+)"/)[1])

/**
 * 目录里有、但**从未取过额度回执**的条目：它们照常出现在聚合页，额度卡显示"未录入"。
 *
 * 不给它们发一条 `quota: {}` 的回执：那会被归一成 `undocumented`，也就是替厂商宣称
 * "官方没有公布"——而我们根本还没去读过它的额度页。"没查" 和 "查了没有" 是两件事。
 * 名单里的 id 必须仍在目录里，否则本条失效就等于悄悄放宽了门。
 */
const NO_QUOTA_RECEIPT = {
  ppio: '2026-11-10 只核实了端点与模型清单，额度页未取证',
  huawei_maas: '2026-11-10 只核实了端点，额度页未取证',
  infini_ai: '2026-11-10 只核实了端点，额度页未取证',
  nous_portal: '2026-11-12 只核实了端点与匿名档不可达，额度页未取证',
}

for (const id of Object.keys(NO_QUOTA_RECEIPT)) {
  if (!declaredIds.includes(id)) {
    console.error(`NO_QUOTA_RECEIPT 里的 ${id} 不在目录里，删除该豁免`)
    process.exit(1)
  }
}

const missing = declaredIds.filter(id => !rows.has(id) && !(id in NO_QUOTA_RECEIPT))
if (missing.length > 0) {
  console.error(`缺 ${missing.length} 家的取证回执：${missing.join(', ')}`)
  process.exit(1)
}
const unknown = [...rows.keys()].filter(id => !declaredIds.includes(id))
if (unknown.length > 0) {
  console.error(`取证回执里有目录不存在的家：${unknown.join(', ')}`)
  process.exit(1)
}

const body = [...rows.values()]
  .sort((a, b) => a.entryId.localeCompare(b.entryId))
  .map(row => {
    const lines = [`  '${row.entryId}': {`, `    source: '${row.source}',`]
    for (const field of FIELDS) {
      if (row.numbers[field] !== undefined) lines.push(`    ${field}: ${row.numbers[field]},`)
    }
    if (row.docUrl) lines.push(`    docUrl: '${row.docUrl}',`)
    lines.push(`    asOf: '${row.asOf}',`)
    if (row.perModel.length > 0) {
      const models = row.perModel
        .map(model => {
          const parts = Object.entries(model)
            .map(([key, value]) => `${key}: ${typeof value === 'number' ? value : `'${value}'`}`)
            .join(', ')
          return `{ ${parts} }`
        })
        .join(', ')
      lines.push(`    perModel: [${models}],`)
    }
    if (row.officialNote) lines.push(`    officialNote: ${JSON.stringify(row.officialNote)},`)
    lines.push('  },')
    return lines.join('\n')
  })
  .join('\n')

const documented = [...rows.values()].filter(row => row.source === 'documented')
const withNote = [...rows.values()].filter(row => row.officialNote.length > 0)

writeFileSync(
  OUTPUT,
  `/**
 * 聚合目录的额度旁表 —— 由 scripts/build-aggregate-quota.mjs 从
 * docs/data/free-quota-research/*.json 生成，请勿手改；要改数值就改取证回执再重新生成。
 *
 * 每个数字都来自该供应商自己的官方文档，带 docUrl 与 asOf（复核日期）。
 * \`undocumented\` 表示官方没有公布可登记的数字 —— 消费方必须把"没有"显示成"没有"，
 * 不得当作 0、不得当作无限、也不得参与额度预检。
 * 单位不是 token 的官方上限保留在 officialNote 里，只供面板显示，不参与预检。
 *
 * 生成于 ${new Date().toISOString().slice(0, 10)}；${documented.length} 家有数字，
 * ${rows.size - documented.length} 家官方未公布，${withNote.length} 家带口径备注。
 */

export interface AggregateModelQuota {
  modelId: string
  rpm?: number
  rpd?: number
  tpm?: number
  tpd?: number
  monthlyTokens?: number
  contextWindow?: number
}

export interface AggregateEntryQuota {
  source: 'documented' | 'undocumented'
  rpm?: number
  rpd?: number
  tpm?: number
  tpd?: number
  monthlyTokens?: number
  contextWindow?: number
  perModel?: AggregateModelQuota[]
  docUrl?: string
  asOf: string
  /** 官方原文的口径说明（单位、条件、档位、档位互斥等），不参与预检 */
  officialNote?: string
}

export const AGGREGATE_QUOTA: Record<string, AggregateEntryQuota> = {
${body}
}

export function getAggregateQuota(entryId: string): AggregateEntryQuota | undefined {
  return AGGREGATE_QUOTA[entryId]
}

/** 只有 documented 的行才允许参与额度预检；undocumented 一律放行。 */
export function isQuotaEnforceable(entryId: string): boolean {
  return AGGREGATE_QUOTA[entryId]?.source === 'documented'
}
`,
  'utf-8'
)

console.log(
  `已生成 ${OUTPUT}：${rows.size} 家，其中 ${documented.length} 家有数字、${rows.size - documented.length} 家 undocumented`
)
console.log(`带官方数字的家：${documented.map(row => row.entryId).join(', ')}`)
if (withdrawn.length > 0) {
  for (const item of withdrawn) {
    console.log(`已撤下（回执保留）：${item.id} — ${item.reason || '未写原因'}（${item.file}）`)
  }
}
