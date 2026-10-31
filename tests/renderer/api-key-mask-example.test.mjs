import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const read = (relative) => readFileSync(join(root, relative), 'utf8')

const apiKeysPage = () => read('src/renderer/src/pages/ApiKeys.tsx')

/**
 * The 数据与安全 tab used to carry a "示例" block showing a masked API key plus two
 * switches (`credentialEncryption`, `logDesensitization`) that nothing in `src/main`
 * ever read - flipping them changed no behaviour, and the masking rule they
 * illustrated belongs to the API Key list. The fences below keep both halves fixed:
 * the example lives where the masking happens, and no decorative switch comes back.
 */
test('the API key list shows its own masking rule, derived from the real masker', () => {
  const page = apiKeysPage()

  assert.match(page, /\{t\('apiKeys\.maskHint'\)\}/, 'the list card must caption what the Key column shows')
  // The masked half is `maskKey(SAMPLE)`, never a hand-written `sk-1234****cdef`:
  // a typed copy silently survives a change to the rule it is meant to document.
  assert.match(page, /\{MASK_EXAMPLE_KEY\} → \{maskKey\(MASK_EXAMPLE_KEY\)\}/)
  assert.doesNotMatch(page, /['"]sk-[0-9a-f*]+['"]\s*→/, 'the masked example must not be typed out')
})

test('the example was not left behind under settings', () => {
  assert.throws(
    () => read('src/renderer/src/components/settings/SecuritySettings.tsx'),
    'the component that held the misplaced example must be gone, not merely unreferenced',
  )
  assert.doesNotMatch(read('src/renderer/src/components/settings/index.ts'), /SecuritySettings/)
  assert.doesNotMatch(read('src/renderer/src/pages/Settings.tsx'), /SecuritySettings/)
})

test('no renderer-only security switch can come back', () => {
  const store = read('src/renderer/src/stores/settingsStore.ts')

  // A store field that never reaches `window.electronAPI.config.update` is a UI
  // decoration with a persistence layer. These two were exactly that.
  for (const dead of ['credentialEncryption', 'logDesensitization']) {
    assert.doesNotMatch(store, new RegExp(dead), `settingsStore must not carry ${dead}`)
  }

  // The real desensitization control is the request-log one, which is persisted
  // and read by the main process - it must stay, and stay wired.
  const dataManagement = read('src/renderer/src/components/settings/DataManagement.tsx')
  assert.match(dataManagement, /checked=\{requestLogConfig\.redactSensitiveData\}/)
  assert.match(dataManagement, /updateRequestLogConfig\(\{ redactSensitiveData: checked \}\)/)
})

test('both locales carry the surviving keys and drop the orphaned ones', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`))

    assert.equal(typeof messages.apiKeys?.maskHint, 'string', `${locale} is missing apiKeys.maskHint`)
    assert.equal(typeof messages.settings?.requestLogRedactSensitive, 'string', `${locale} lost the real redaction label`)
    assert.equal(messages.settings?.example, undefined, `${locale} still has the orphaned settings.example`)
    for (const key of ['credentialEncryption', 'logDesensitization', 'securitySettings']) {
      assert.equal(messages.settings?.[key], undefined, `${locale} still has the orphaned settings.${key}`)
    }
  }
})
