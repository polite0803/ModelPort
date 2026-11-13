import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

/**
 * The connect screen is the first thing a remote-gateway user sees, and it used to be
 * English-only on a Chinese browser: the settings store hardcoded `language: 'en-US'`,
 * rehydrate stamped that over the detector's answer, and the pre-auth page had no switch.
 * Two facts are fenced here: the initial language follows detection (an explicit choice
 * still wins via persistence / gateway config), and the gate itself offers 中文/English
 * without touching the gateway - before the secret is accepted, config.update is a 401.
 */
const gate = () => readFileSync(join(root, 'src/renderer/src/components/ConnectGate.tsx'), 'utf8')

const store = () => readFileSync(join(root, 'src/renderer/src/stores/settingsStore.ts'), 'utf8')

const locale = name =>
  JSON.parse(readFileSync(join(root, 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8'))

test('the initial language follows detection instead of a hardcoded en-US', () => {
  const source = store()
  assert.match(
    source,
    /language: i18n\.language === 'zh-CN' \? 'zh-CN' : 'en-US'/,
    'the store default must read the detector result, not stamp en-US over it',
  )
  assert.doesNotMatch(source, /language: 'en-US',/, 'the hardcoded initial value is the bug')
})

test('the gate offers both languages before the secret is accepted', () => {
  const source = gate()
  assert.match(source, /useSettingsStore\(\(state\) => state\.language\)/)
  assert.match(source, /useSettingsStore\.setState\(\{ language: lng \}\)/)
  assert.match(source, /i18n\.changeLanguage\(lng\)/)
  assert.ok(source.includes("'中文'") && source.includes("'English'"), 'native names, readable in either language')
  assert.ok(source.includes("t('connect.languageLabel')"), 'the toggle needs a label in both locales')
  // setLanguage writes config.update; pre-auth that call has no secret and answers 401.
  assert.doesNotMatch(source, /setLanguage\(/, 'the pre-auth switch must stay local-only')
})

test('both locales carry the toggle label', () => {
  for (const name of ['zh-CN', 'en-US']) {
    const label = locale(name).connect?.languageLabel
    assert.equal(typeof label, 'string', `${name} is missing connect.languageLabel`)
    assert.ok(label.length > 0, `${name} connect.languageLabel must not be empty`)
  }
})