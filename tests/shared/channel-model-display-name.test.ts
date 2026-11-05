import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { channelModelDisplayName } from '../../src/shared/channels.ts'

/**
 * 渠道模型的展示名是标注的两个键之一（`(providerId, displayName)`）：
 * 主进程写目录用它的返回值，界面查目录也必须用同一个函数。
 * 任何一侧自己拼字符串，标注就会拿到「模型不属于该供应商」。
 */
describe('channelModelDisplayName', () => {
  it('有展示名时按「渠道名 / 模型名」拼，与 syncProviders 写入目录的形状一致', () => {
    assert.equal(
      channelModelDisplayName('TRAE', 'trae', { id: 'qmodel_38max', name: 'GLM-5.1' }),
      'TRAE / GLM-5.1',
    )
  })

  it('展示名为空或全空格时回落渠道内部 id，不产出「TRAE / 」这种尾巴', () => {
    assert.equal(channelModelDisplayName('TRAE', 'trae', { id: 'qmodel_38max', name: '' }), 'TRAE / trae/qmodel_38max')
    assert.equal(channelModelDisplayName('TRAE', 'trae', { id: 'x1', name: '   ' }), 'TRAE / trae/x1')
  })

  it('倍率与免费标记不进展示名：目录键只用去掉标记的 name', () => {
    // `model.list` 把倍率拼在展示名里，解析时已拆到 `weight` / `free`，
    // 若拼回目录键，同一家促销前后的两次同步会把标注劈成两个键。
    assert.equal(
      channelModelDisplayName('Kimi', 'kimi', { id: 'k3', name: 'Kimi-K3', weight: 0.2, free: false } as never),
      'Kimi / Kimi-K3',
    )
  })

  it('同一模型在不同渠道名下得到不同键，跨渠道重名不会互相覆盖', () => {
    const model = { id: 'glm-5', name: 'GLM-5' }
    assert.notEqual(
      channelModelDisplayName('TRAE', 'trae', model),
      channelModelDisplayName('Qoder', 'qoder', model),
    )
  })
})
