/**
 * `/v1/models` 上路由条目所用的窗口下界（纯函数，无 store、无 electron）。
 *
 * 清单只广告路由，而路由没有上游目录可查，广告的是**候选池里最小的窗口**。核心是
 * **省略而不是兜底**：客户端拿 `context_window` 决定压缩时机，虚报上界会让它把超长
 * 上下文直接发出去、被服务端硬拒；写 0 会让它以为模型只有 0 窗口。
 *
 * 原来另一半钉的是单模型条目的查表函数 `contextWindowOf`（精确名 → 通配名 → 多模式
 * 取最小）。`/v1/models` 不再广告单个模型，那个函数失去了唯一的生产调用者，随
 * `docs/plan/PLAN-routes-only-surface.md` 的 R2 一起退役，这里不再留零调用者的用例。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { advertisedContextCeilingOf, UNANNOTATED_CONTEXT_FLOOR } from '../../src/main/proxy/autoRouting.ts'

// 路由条目（`auto` 与用户自建路由）没有上游目录可查，广告的是**候选里最大的已公布窗口**。
// 2026-11-18 改口径：取最小值会让池里一个 128K 候选把整条路由按 128K 广告，1M 的模型也被
// 客户端提前摘要把会话砍断；取最大值后客户端尽量不摘要，超出的部分由网关按这一跳真正的
// 模型裁剪并留 CCR 指针。
test('路由广告取候选里最大的已公布窗口；未公布的候选不贡献值', () => {
  assert.equal(advertisedContextCeilingOf([200_000, 32_768, 128_000]), 200_000)
  // 「没标注」不是「已知 64K」：它既不贡献值，也不被当成上限承诺
  assert.equal(advertisedContextCeilingOf([200_000, undefined]), 200_000)
  assert.equal(advertisedContextCeilingOf([8_192, undefined]), 8_192)
  assert.equal(advertisedContextCeilingOf([undefined, undefined]), undefined)
})

test('0 / 负数 / 非数字的标注等同未标注（不贡献值，绝不顶大）', () => {
  assert.equal(advertisedContextCeilingOf([0, 200_000]), 200_000)
  assert.equal(advertisedContextCeilingOf([-1, 200_000]), 200_000)
  assert.equal(advertisedContextCeilingOf(['abc' as unknown as number, 200_000]), 200_000)
})

test('一家都没公布窗口 → 省略键：没有证据就不承诺（空池同理）', () => {
  assert.equal(advertisedContextCeilingOf([undefined, undefined]), undefined)
  assert.equal(advertisedContextCeilingOf([]), undefined)
})

test('空池省略键：没有候选就没有可说的，不写默认窗口', () => {
  assert.equal(advertisedContextCeilingOf([]), undefined)
})
