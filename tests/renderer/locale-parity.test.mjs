import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Regression guard added after the 2026-11-03 orphan-key prune: both locale
// files must keep an identical leaf-key set. An asymmetric edit (key deleted
// from one side only, or a translation added without its counterpart) breaks
// the UI at runtime with no type error — this test is the only net.
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function leafKeys(obj, prefix = '') {
  const out = []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafKeys(v, path))
    else out.push(path)
  }
  return out
}

function load(name) {
  return JSON.parse(
    readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8')
  )
}

test('en-US and zh-CN expose the same top-level namespaces', () => {
  const en = new Set(Object.keys(load('en-US')))
  const zh = new Set(Object.keys(load('zh-CN')))
  const onlyEn = [...en].filter(k => !zh.has(k))
  const onlyZh = [...zh].filter(k => !en.has(k))
  assert.deepEqual(onlyEn, [], 'namespaces only in en-US')
  assert.deepEqual(onlyZh, [], 'namespaces only in zh-CN')
})

test('every en-US leaf key exists in zh-CN (no missing translations)', () => {
  const enKeys = leafKeys(load('en-US'))
  const zhKeys = new Set(leafKeys(load('zh-CN')))
  const missing = enKeys.filter(k => !zhKeys.has(k))
  assert.deepEqual(missing, [], `zh-CN is missing ${missing.length} key(s): ${missing.slice(0, 10).join(', ')}`)
})

test('no locale block is an empty object (dead namespaces must be deleted, not stubbed)', () => {
  const problems = []
  const walk = (obj, path, file) => {
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      const p = path ? `${path}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (Object.keys(v).length === 0) problems.push(`${file}: ${p}`)
        else walk(v, p, file)
      }
    }
  }
  for (const name of ['en-US', 'zh-CN']) walk(load(name), '', name)
  assert.deepEqual(problems, [], `empty locale blocks found:\n${problems.join('\n')}`)
})

// `RoutePoolEditor` builds these keys dynamically (`t(\`proxy.routePoolSource_${source}\`)`),
// so a source member without its label renders the raw key — and the leaf-parity test above
// cannot see it, because the key is missing from *both* locale files. The list is read out of
// the production union instead of being retyped here, so adding a source cannot pass silently.
test('every CapabilitySource member has both labels in both locales', () => {
  const lines = readFileSync(join(root, 'src/shared/types.ts'), 'utf8').split('\n')
  const start = lines.findIndex(line => line.startsWith('export type CapabilitySource ='))
  assert.ok(start >= 0, 'CapabilitySource union not found in src/shared/types.ts')
  const sources = []
  for (let i = start + 1; i < lines.length; i++) {
    const member = lines[i].match(/^\s*\|?\s*'([a-z-]+)'/)
    if (!member) break
    sources.push(member[1])
  }
  assert.ok(sources.length >= 8, `union parsed to only ${sources.length} members — the shape changed`)

  const missing = []
  for (const name of ['en-US', 'zh-CN']) {
    const proxy = load(name).proxy
    for (const source of sources) {
      for (const prefix of ['routePoolSource_', 'routePoolSourceShort_']) {
        const key = `${prefix}${source}`
        if (typeof proxy?.[key] !== 'string' || proxy[key].trim() === '') missing.push(`${name}: ${key}`)
      }
    }
  }
  assert.deepEqual(missing, [], `unlabeled capability source(s):\n${missing.join('\n')}`)
})
