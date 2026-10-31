import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resyncsAfterChannelRpc } from '../../src/main/providers/accountChannels/rpcSync.ts'
import { ACCOUNT_CHANNELS } from '../../src/main/providers/accountChannels/catalogue.ts'

test('加账号的方法要触发宿主重镜像，只读方法不要', () => {
  assert.equal(resyncsAfterChannelRpc('opencode.addAccount'), true)
  assert.equal(resyncsAfterChannelRpc('opencode.addAnonymous'), true)
  // 反过来：只读/无副作用的方法不该拖起一次全量 syncProviders
  assert.equal(resyncsAfterChannelRpc('account.list'), false)
  assert.equal(resyncsAfterChannelRpc('login.poll'), false)
  assert.equal(resyncsAfterChannelRpc('opencode.setProxy'), false)
})

test('目录声明的每个加账号方法都在重镜像名单里', () => {
  // 两个方向都防：目录换了方法名而名单没跟上（账号加进池子、provider 记录却不出现，
  // 卡永远停在「未配置」），以及名单里留着一个已经没人调用的方法。
  const declared = ACCOUNT_CHANNELS.flatMap(channel => {
    if (channel.credentialAdd === undefined) return []
    const methods = [channel.credentialAdd.withKey]
    if (channel.credentialAdd.anonymous !== undefined) methods.push(channel.credentialAdd.anonymous)
    return methods
  })
  assert.ok(declared.length > 0, 'fixture: 至少要有一个表单型渠道')
  for (const method of declared) {
    assert.equal(resyncsAfterChannelRpc(method), true, `${method} 不在重镜像名单里`)
  }
})

test('manager.rpc 真的接了这个判据', () => {
  // 判据本身对、但调用点被删掉，症状与「判据不存在」一样：账号加了、记录没出现。
  const source = readFileSync(
    join(process.cwd(), 'src/main/providers/accountChannels/manager.ts'),
    'utf8',
  )
  assert.match(source, /if \(result\.ok && resyncsAfterChannelRpc\(method\)\) this\.notifyChanged\(\)/)
  // 渠道包自己广播的那条路也走同一个方法，避免两处实现漂移成两种行为。
  assert.match(source, /onChanged: \(\) => \{\s*this\.notifyChanged\(\)/)
})

test('界面按 channelAddFlowOf 分流，不靠渠道 id 硬编码', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/renderer/src/pages/Channels.tsx'),
    'utf8',
  )
  assert.match(source, /channelAddFlowOf\(channel\.loginKind\) === 'credential'/)
  assert.match(source, /channel\.credentialAdd\?\.withKey/)
  assert.match(source, /channel\.credentialAdd\?\.anonymous/)
  // 表单型必须真的调那两个方法，而不是仍旧走 account.create
  assert.match(source, /window\.electronAPI\.channels\.rpc\(method, payload\)/)
})
