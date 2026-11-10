import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { channelModelDisplayName, channelModelVariantSuffix } from '../../src/shared/channels.ts'

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

  /**
   * 2026-11-10 实测：cline 的免费变体与付费版展示名完全相同，同步按展示名去重时
   * 免费那条连 `weight: 0` 一起被吞，既不进 `/v1/models`，`auto` 的「免费优先」
   * 也看不见它。后缀只从「id 比名字多了什么」推出来，不看别的模型，保证主进程
   * 与界面现算一致。
   */
  it('id 带免费变体标记时给展示名加「· 免费」，付费版保持原名', () => {
    assert.equal(
      channelModelDisplayName('Cline', 'cline', {
        id: 'nvidia/nemotron-3.5-lightning:free',
        name: 'Nemotron 3.5 Lightning',
      }),
      'Cline / Nemotron 3.5 Lightning · 免费',
    )
    assert.equal(
      channelModelDisplayName('Cline', 'cline', {
        id: 'nvidia/nemotron-3.5-lightning',
        name: 'Nemotron 3.5 Lightning',
      }),
      'Cline / Nemotron 3.5 Lightning',
      '付费版不带后缀，免得把老键全部改名',
    )
  })

  it('非免费变体不加后缀：多出来的片段多半是厂商标识，猜不出语义就别造名', () => {
    // `Seed-Code-doubao` 的 `doubao` 是厂商，不是变体；`DeepSeek-V4-Pro-Official`
    // 与 `multimodal_image_kimi-k2.5` 确实可能是不同后端（后者倍率 0.75 vs 0.48），
    // 但名字里没有语义可推，继续按别名处理，等有证据（倍率/探测）再说。
    assert.equal(
      channelModelDisplayName('TRAE', 'trae', { id: 'Seed-Code-doubao', name: 'Seed-Code' }),
      'TRAE / Seed-Code',
    )
    assert.equal(
      channelModelDisplayName('TRAE', 'trae', { id: 'DeepSeek-V4-Pro-Official', name: 'DeepSeek-V4-Pro' }),
      'TRAE / DeepSeek-V4-Pro',
    )
    assert.equal(
      channelModelDisplayName('TRAE', 'trae', { id: 'multimodal_image_kimi-k2.5', name: 'Kimi-K2.5' }),
      'TRAE / Kimi-K2.5',
    )
  })

  it('id 与名字没有前后缀关系时不加后缀：内部 id 不该污染命名', () => {
    assert.equal(channelModelVariantSuffix('qmodel_38max', 'GLM-5.1'), undefined)
    assert.equal(channelModelVariantSuffix('LoRA/Qwen/Qwen2.5-14B-Instruct', 'Qwen2.5-14B-Instruct'), undefined)
    assert.equal(channelModelVariantSuffix('x1', ''), undefined, '没有展示名时回落 id，不叠两层后缀')
  })
})
