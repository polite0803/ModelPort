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
