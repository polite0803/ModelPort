import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 面板这一层的价值只在于「用户看得见那条缺席」。字段加在 `TlsStatus` 上而组件不读它，
 * 等于没有；i18n 键写了 en 忘了 zh，缺译在这一屏是静默的。
 *
 * 判据写成吃文本的纯函数：负控用内存里改过的源文喂进去，不落盘、不碰工作树。
 */

const componentPath = 'src/renderer/src/components/proxy/ProxyConfigForm.tsx'
const localePaths = ['src/renderer/src/i18n/locales/en-US.json', 'src/renderer/src/i18n/locales/zh-CN.json']

const component = readFileSync(componentPath, 'utf8')
const locales = localePaths.map((path) => ({ path, json: JSON.parse(readFileSync(path, 'utf8')) }))

/** 断言组件真的把这两样东西画出来了，并返回它用到的全部 proxy.* 文案键。 */
function check(source) {
  const problems = []

  if (!/NODE_EXTRA_CA_CERTS=\{tlsStatus\.certificate\.certPath\}/.test(source)) {
    problems.push('the copyable NODE_EXTRA_CA_CERTS line is not rendered from the certificate path')
  }
  if (!/tlsStatus\?\.certificate &&/.test(source)) {
    problems.push('the Node-client block is not gated on an existing certificate')
  }
  if (!/tlsStatus\.handshakeRejections/.test(source)) {
    problems.push('handshakeRejections is never read by the panel')
  }
  if (!/proxy\.httpsHandshakeNone/.test(source) || !/proxy\.httpsHandshakeCount/.test(source)) {
    problems.push('the zero count and the non-zero count must be two different sentences')
  }

  const usedKeys = [...source.matchAll(/t\('(proxy\.(https[A-Za-z]+))'/g)].map((match) => match[1])
  if (usedKeys.length === 0) problems.push('no proxy.https* translation key is used')
  return { problems, usedKeys: [...new Set(usedKeys)] }
}

test('the HTTPS panel renders the Node-client line and the handshake refusal reading', () => {
  const { problems } = check(component)
  assert.deepEqual(problems, [])
})

test('every proxy.https* key the panel uses exists in both shipped locales', () => {
  const { usedKeys } = check(component)
  assert.ok(usedKeys.length >= 20, `expected the whole HTTPS panel, saw ${usedKeys.length} keys`)
  for (const locale of locales) {
    const missing = usedKeys.filter((key) => {
      const shortKey = key.split('.')[1]
      return typeof locale.json.proxy?.[shortKey] !== 'string' || locale.json.proxy[shortKey].trim() === ''
    })
    assert.deepEqual(missing, [], `${locale.path} is missing ${missing.join(', ')}`)
  }
})

test('the checks fail on the mutations they are meant to catch', () => {
  // 撤掉那一行 ⇒ 第一条红。
  const withoutEnvLine = component.replace(
    /NODE_EXTRA_CA_CERTS=\{tlsStatus\.certificate\.certPath\}/,
    'certPath',
  )
  assert.match(check(withoutEnvLine).problems.join('\n'), /NODE_EXTRA_CA_CERTS line is not rendered/)

  // 把缺席读数从组件里换成别的字段 ⇒ 红，而不是「字段在类型里所以肯定没问题」。
  const withoutRejections = component.replace(/tlsStatus\.handshakeRejections/g, 'tlsStatus.running')
  assert.match(check(withoutRejections).problems.join('\n'), /never read by the panel/)

  // 两种缺席合成一句 ⇒ 红（界面不能把「没有」和「有 N 次」说成同一个数）。
  const mergedAbsence = component.replace(/proxy\.httpsHandshakeNone/g, 'proxy.httpsHandshakeCount')
  assert.match(check(mergedAbsence).problems.join('\n'), /two different sentences/)

  // 只补一种语言时，键名判据必须抓到第二种。
  const enOnly = { ...locales[0], json: locales[0].json }
  const zhWithout = {
    path: locales[1].path,
    json: JSON.parse(
      JSON.stringify(locales[1].json, (key, value) =>
        key === 'httpsHandshakeRejections' ? undefined : value,
      ),
    ),
  }
  const { usedKeys } = check(component)
  const missingInZh = usedKeys.filter(
    (key) => typeof zhWithout.json.proxy?.[key.split('.')[1]] !== 'string',
  )
  assert.deepEqual(missingInZh, ['proxy.httpsHandshakeRejections'])
  assert.ok(enOnly.json.proxy.httpsHandshakeRejections)
})
