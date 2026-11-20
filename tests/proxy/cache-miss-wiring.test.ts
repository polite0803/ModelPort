import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chatRoute = readFileSync('src/main/proxy/routes/chat.ts', 'utf-8')

/**
 * 缺口分类靠「同一会话的上一轮」才成立：只接一部分出口，读数会变成
 * 「流式有分类、非流式没有」的半改状态，卡片上表现为某些模型永远只有 `-`。
 */
test('三个计量出口都把会话键交给缺口分类', () => {
  // 允许后面还跟别的实参（压缩后预热就是新增的那一个）：这一条钉的是
  // 「每个出口都传了会话键」，不是「它是最后一个实参」。
  const tails = chatRoute
    .split('\n')
    .filter((line) => line.trim() === 'missConversationKey' || line.trim() === 'missConversationKey,')
  assert.equal(tails.length, 3, `expected 3 metering exits to pass the key, found ${tails.length}`)
})

test('具名模型路径也按同一口径算会话键', () => {
  assert.match(chatRoute, /autoRouter\.conversationKeyFor\(request, clientSession\)/)
})