import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 网关往出向请求里写字，就是替用户说话，也是给模型一句可以被复述的话。
 * 所以每个注入点必须在代码里打 `GATEWAY-TEXT: <id>`，并在
 * `docs/AGENTS-full.md` §Gateway-Authored Text 的出处表里占一行。
 * 这道门防的是「排障时顺手塞一句提示词，三个月后没人知道它从哪来」。
 */

const TAG = /GATEWAY-TEXT: ([a-z0-9-]+)/g

function sourceTags(dir = 'src/main'): Set<string> {
  const found = new Set<string>()
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    if (!entry.endsWith('.ts')) continue
    const text = readFileSync(join(dir, entry), 'utf8')
    for (const match of text.matchAll(TAG)) found.add(match[1])
  }
  return found
}

function tableIds(doc: string): Set<string> {
  const start = doc.indexOf('## Gateway-Authored Text Reaching the Model')
  if (start < 0) throw new Error('the provenance section is gone from docs/AGENTS-full.md')
  const section = doc.slice(start, doc.indexOf('\n## ', start + 10))
  const ids = new Set<string>()
  for (const line of section.split('\n')) {
    const row = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|/)
    if (row) ids.add(row[1])
  }
  return ids
}

function retiredIds(doc: string): Set<string> {
  const start = doc.indexOf('### Retired, with the evidence that retired it')
  if (start < 0) throw new Error('the retired inventory is gone from docs/AGENTS-full.md')
  const rest = doc.slice(start)
  const end = Math.min(...['\n### ', '\n## '].map((mark) => {
    const at = rest.indexOf(mark, 10)
    return at < 0 ? rest.length : at
  }))
  const ids = new Set<string>()
  for (const match of rest.slice(0, end).matchAll(/\*\*`([a-z0-9-]+)`\*\*/g)) ids.add(match[1])
  return ids
}

/** 台账里某一条退役项正文：从它的条目行到下一条条目/小节标题为止。 */
function retiredEntry(doc: string, id: string): string {
  const start = doc.indexOf(`**\`${id}\`**`)
  if (start < 0) return ''
  const rest = doc.slice(start)
  const next = rest.slice(1).search(/\n\* \*\*`|\n### /)
  return rest.slice(0, next < 0 ? rest.length : next + 1)
}

/** 双向差集：漏文档和漏标记都算失败，"文档里列了但代码已退役"也算。 */
function compare(tags: Set<string>, documented: Set<string>): string[] {
  const problems: string[] = []
  for (const id of tags) if (!documented.has(id)) problems.push(`undocumented injection site: ${id}`)
  for (const id of documented) if (!tags.has(id)) problems.push(`documented but no longer tagged in code: ${id}`)
  return problems.sort()
}

// 文档按 LF 规范化：Windows 检出是 CRLF 时，`\n## ` / `\n* **` 这类锚点会失配。
const doc = readFileSync('docs/AGENTS-full.md', 'utf8').replace(/\r\n/g, '\n')
const tags = sourceTags()
const documented = tableIds(doc)
const retired = retiredIds(doc)

test('the scanner has power: both inventories are populated and disjoint', () => {
  assert.ok(tags.size >= 1, 'no GATEWAY-TEXT tag found at all means the scan is broken')
  assert.ok(documented.size >= 1, 'an empty provenance table would make the diff vacuous')
  for (const id of retired) assert.equal(documented.has(id), false, `${id} cannot be both live and retired`)
})

/**
 * 退役批落地后，活着的注入点只剩两条「不是替用户说话」的例外：
 * `ccr-sentinel`（压缩自身的取回指针）与 `liveness-ping`（不进任何对话的探针）。
 * 这一格是**精确集合**判据，不是下界：把退役的东西接回来、或者新加第三条，都要在这里红。
 */
test('only the two ruled exceptions still write gateway text', () => {
  assert.deepEqual([...tags].sort(), ['ccr-sentinel', 'liveness-ping'])
  assert.deepEqual([...documented].sort(), ['ccr-sentinel', 'liveness-ping'])
})

test('every retired site keeps its ledger entry and its commit', () => {
  assert.deepEqual(
    [...retired].sort(),
    [
      'context-summary-marker',
      'context-summary-prompt',
      'managed-tool-prompt',
      'output-steering',
      'trailing-user-guard',
    ],
  )
  const commits: Record<string, string> = {
    'trailing-user-guard': 'fb720f9',
    'managed-tool-prompt': 'aee98eb',
    'output-steering': '9d07417',
    'context-summary-prompt': '8e744ec',
    'context-summary-marker': '8e744ec',
  }
  for (const [id, commit] of Object.entries(commits)) {
    const entry = retiredEntry(doc, id)
    assert.ok(entry.length > 0, `${id} is not in the retirement ledger`)
    assert.match(entry, new RegExp(commit), `${id} must cite the commit that introduced it`)
    assert.match(entry, /2026-11-03/, `${id} must cite the retirement date`)
  }
})

test('tags and the provenance table agree exactly, both directions', () => {
  assert.deepEqual(compare(tags, documented), [])
})

test('the guard added while chasing a report is retired, and says so with its commit', () => {
  assert.equal(tags.has('trailing-user-guard'), false, 'its GATEWAY-TEXT tag must be gone with the code')
  assert.equal(documented.has('trailing-user-guard'), false, 'a retired id must leave the live table')
  assert.ok(retired.has('trailing-user-guard'), 'but it must stay in the retirement ledger')
  const entry = retiredEntry(doc, 'trailing-user-guard')
  assert.match(entry, /fb720f9/, 'the ledger entry carries the commit that introduced it')
  assert.match(entry, /2026-11-03/, 'and the date it was retired')
  const source = readFileSync('src/main/proxy/forwarder.ts', 'utf8')
  assert.equal(/trailingUserGuard|injectTrailingUser/.test(source), false, 'the call site must be gone')
  assert.equal(existsSync('src/main/proxy/trailingUserGuard.ts'), false)
})

test('the gate fails on the omissions it exists to catch', () => {
  // 新塞一个没登记的注入点。
  const withNewSite = new Set([...tags, 'mystery-prompt'])
  assert.deepEqual([...compare(withNewSite, documented)], ['undocumented injection site: mystery-prompt'])

  // 出处表里留了一行、代码里的标记已撤（那会让文档变成假账）。
  const documentedWithoutOne = new Set(documented)
  const [first] = [...documented]
  documentedWithoutOne.delete(first as string)
  assert.deepEqual([...compare(tags, documentedWithoutOne)], [`undocumented injection site: ${first}`])

  const tagsWithoutOne = new Set(tags)
  tagsWithoutOne.delete(first as string)
  assert.deepEqual(
    [...compare(tagsWithoutOne, documentedWithoutOne)],
    [],
    'removing a site from both sides is a clean retirement',
  )
  assert.deepEqual(
    [...compare(tagsWithoutOne, documented)],
    [`documented but no longer tagged in code: ${first}`],
    'code retired but the table still claims it is live: red',
  )
  assert.deepEqual(
    [...compare(tags, documentedWithoutOne)],
    [`undocumented injection site: ${first}`],
    'table dropped but the code still writes it: red',
  )

  // 出处表整段被删 ⇒ 直接抛，而不是"看起来没问题"。
  assert.throws(() => tableIds('# nothing\n'), /provenance section is gone/)
  assert.throws(() => retiredIds('# nothing\n'), /retired inventory is gone/)
})
