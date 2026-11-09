import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The panel shows two trust readings and they answer different questions: what the machine
 * running the *listener* trusts, and what the machine running the *client* trusts. Under WSL
 * and remote deployments those are different computers, and the whole bug this file fences
 * was the panel printing the gateway's `trusted: true` next to a browser that still refused
 * the handshake - a false green in the one field the operator uses to decide whether to act.
 *
 *判据吃文本，负控用内存里改过的源文喂进去。
 */

const componentPath = 'src/renderer/src/components/proxy/ProxyConfigForm.tsx'
const localePaths = ['src/renderer/src/i18n/locales/en-US.json', 'src/renderer/src/i18n/locales/zh-CN.json']

const component = readFileSync(componentPath, 'utf8')
const locales = localePaths.map((path) => ({ path, json: JSON.parse(readFileSync(path, 'utf8')) }))

function check(source) {
  const problems = []

  if (!/machineTrustApi\(\)/.test(source)) {
    problems.push('the panel never asks the console what this computer trusts')
  }
  if (!/api\.installGatewayCertificateTrust\(\)/.test(source) || !/api\.uninstallGatewayCertificateTrust\(\)/.test(source)) {
    problems.push('the trust buttons must go through the console, not through the gateway RPC')
  }
  if (!/proxy\.httpsGatewayTrust/.test(source)) {
    problems.push('the gateway-side trust reading is not labelled as the gateway machine')
  }
  if (!/machineTrust\.trusted === null/.test(source)) {
    problems.push('the machine reading must keep "no probe" distinct from "not trusted"')
  }
  if (!/!machineTrust && !pageServesRemoteGateway\(\)/.test(source)) {
    problems.push('the gateway-machine buttons must not be offered to a page whose gateway is another computer')
  }
  if (!/NODE_EXTRA_CA_CERTS=\{machineTrust\.certPath\}/.test(source)) {
    problems.push('the Node-client line for this computer is not rendered from the certificate the console cached')
  }

  const usedKeys = [...source.matchAll(/t\('(proxy\.(https[A-Za-z]+))'/g)].map((match) => match[1])
  return { problems, usedKeys: [...new Set(usedKeys)] }
}

test('the HTTPS panel splits certificate trust into the gateway machine and this computer', () => {
  const { problems } = check(component)
  assert.deepEqual(problems, [])
})

test('both trust readings and both Node lines have copy in every shipped locale', () => {
  const { usedKeys } = check(component)
  for (const locale of locales) {
    const missing = usedKeys.filter((key) => {
      const shortKey = key.split('.')[1]
      return typeof locale.json.proxy?.[shortKey] !== 'string' || locale.json.proxy[shortKey].trim() === ''
    })
    assert.deepEqual(missing, [], `${locale.path} is missing ${missing.join(', ')}`)
  }
  // The machine block is the new half; without these the split would be invisible to the user.
  for (const locale of locales) {
    for (const key of ['httpsMachineTrust', 'httpsGatewayTrust', 'httpsMachineCertPath', 'httpsBootstrapHint']) {
      assert.ok(typeof locale.json.proxy?.[key] === 'string' && locale.json.proxy[key].trim() !== '', `${locale.path} lacks ${key}`)
    }
  }
})

test('the checks fail on the mutations they are meant to catch', () => {
  // 把动作退回网关 RPC ⇒ 红（这正是接通档之前的样子）。
  const viaGatewayOnly = component.replace('api.installGatewayCertificateTrust()', 'tlsStatus.trusted')
  assert.match(check(viaGatewayOnly).problems.join('\n'), /must go through the console/)

  // 把两行合并成一行「系统信任」⇒ 红（两个主机的读数不能共用一个名目）。
  const mergedLabels = component.replace(/proxy\.httpsGatewayTrust/g, 'proxy.httpsCertTrust')
  assert.match(check(mergedLabels).problems.join('\n'), /not labelled as the gateway machine/)

  // 本机读数读不到时当成「未信任」⇒ 红（缺席不能被画成结论）。
  const claimedAbsence = component.replace('machineTrust.trusted === null', 'machineTrust.trusted === false')
  assert.match(check(claimedAbsence).problems.join('\n'), /must keep "no probe" distinct/)

  // 远程页面继续显示网关主机的按钮 ⇒ 红（点下去改的是别人的电脑）。
  const alwaysButtons = component.replace(/!machineTrust && !pageServesRemoteGateway\(\)/g, 'tlsBusy === false')
  assert.match(check(alwaysButtons).problems.join('\n'), /must not be offered to a page/)

  // 只补一种语言的机器文案 ⇒ 红。
  const zhWithout = {
    path: locales[1].path,
    json: JSON.parse(
      JSON.stringify(locales[1].json, (key, value) => (key === 'httpsMachineTrust' ? undefined : value)),
    ),
  }
  const { usedKeys } = check(component)
  assert.deepEqual(
    usedKeys.filter((key) => typeof zhWithout.json.proxy?.[key.split('.')[1]] !== 'string'),
    ['proxy.httpsMachineTrust'],
  )
})
