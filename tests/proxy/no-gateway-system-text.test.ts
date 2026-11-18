/**
 * 铁律：网关不向用户对话写入任何提示词（2026-11-18）。
 *
 * `gateway-authored-text.test.ts` 对账的是**已经打了 `GATEWAY-TEXT:` 标签**的注入点，
 * 也就是说它只能抓住「登记过的」文本 —— 一处忘记打标签的新注入对它是隐形的。2026-11-18
 * 审查时就是这么发现 `FREEFORM_INPUT_PARAMETERS` 的：它给模型塞了一句自造 description，
 * 却不在台账里。
 *
 * 所以这里补的是**另一侧**的判据：凡是把 `role:'system'` 写进消息的地方，要么在
 * 客户端透传白名单里（内容来自客户端，网关只是搬字节），要么必须带 `GATEWAY-TEXT:` 标签。
 * 两条测试合起来，才同时守住「打了标签的要登记」与「没登记的不能存在」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src/main/proxy', 'src/shared', 'src/main/channelPack']

/**
 * 客户端自己的 system 内容在这里被透传 —— 字节是客户端的，网关只做映射。
 * 往这个名单里加文件等于声明「这个落点写的是客户端的话」，加之前先看内容。
 */
const CLIENT_PASSTHROUGH = new Set([
  'src/shared/responsesInbound.ts', // instructions / developer 消息 → system（客户端原文）
  'src/shared/anthropicWire.ts', // Anthropic system → system（客户端原文）
])

/** 判据本体：源码里是否**写入**了一条 system 消息。独立出来才有坏样本自证。 */
export function writesSystemRole(source: string): boolean {
  // `{ role: 'system', content: … }` 才是写入；类型声明里的 `role: 'system' | 'user'`
  // 后面跟的是联合类型，注释里的 `role: system` 连引号都没有 —— 两者都不命中。
  return /role:\s*['"]system['"]\s*,\s*content/.test(source)
}

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

test('判据有分辨力：写 system 的源码真被判中，不写的不会被误判', () => {
  assert.equal(writesSystemRole("messages.push({ role: 'system', content })"), true)
  assert.equal(writesSystemRole('messages.push({ role: "system", content })'), true)
  // 类型声明不是写入点：`role: 'system' | 'user'` 后面是联合类型
  assert.equal(writesSystemRole("  role: 'system' | 'user' | 'assistant'"), false)
  assert.equal(writesSystemRole("messages.push({ role: 'user', content })"), false)
  assert.equal(writesSystemRole('// role: system 只是注释'), false)
})

test('除客户端透传外，没有任何源码把 system 文本写进对话', () => {
  const offenders: string[] = []
  const seen: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(process.cwd(), file).replace(/\\/g, '/')
      const source = readFileSync(file, 'utf8')
      if (!writesSystemRole(source)) continue
      seen.push(rel)
      if (CLIENT_PASSTHROUGH.has(rel)) continue
      if (!source.includes('GATEWAY-TEXT:')) offenders.push(rel)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a file writes role:system without a GATEWAY-TEXT tag and is not a client passthrough',
  )
  // 正控：扫描面不能是空的，否则这条门禁恒真
  assert.ok(
    seen.length >= CLIENT_PASSTHROUGH.size,
    `scan found only ${seen.length} system sites (whitelist ${CLIENT_PASSTHROUGH.size})`,
  )
  for (const rel of CLIENT_PASSTHROUGH) {
    assert.ok(seen.includes(rel), `${rel} no longer writes system text — drop it from the whitelist`)
  }
})