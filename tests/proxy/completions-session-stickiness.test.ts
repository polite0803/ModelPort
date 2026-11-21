/**
 * `/v1/completions` 的选路键与分类键必须来自同一份会话解析结果。
 *
 * 此前 `autoRouter.select()` 收到的是只含 model/messages/stream 的投影且漏传
 * sessionKey，而几行之后的 `missConversationKey` 却用 clientSession；客户端一压缩，
 * 选路可以换账号，缺口分类还记成同一个会话，短间隔 coldResumed 就被误归因。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readSource(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
}

test('接线门：completions 先解析会话，再让 select 与分类键共用它', () => {
  const source = readSource('src/main/proxy/routes/completions.ts')
  assert.match(source, /clientSessionKey\(\{ body: request, headers: ctx\.headers \}\)/)
  assert.match(source, /autoRouter\.select\(routingRequest, config\.loadBalanceStrategy, undefined, route, clientSession\)/)
  assert.match(source, /autoRouter\.conversationKeyFor\(routingRequest, clientSession\)/)
  assert.doesNotMatch(source, /messages: promptMessages,\n\s*stream: request\.stream,\n\s*\},\n\s*config\.loadBalanceStrategy/)
})

test('同一会话的任务前缀变化切成不同键，压缩摘要与后续轮次仍保底同键', async () => {
  const { autoRouter } = await import('../routes/harness.mjs').then(async (harness) => {
    await harness.bootstrapStore({
      initialData: {
        providers: [],
        accounts: [],
        sessions: [],
        logs: [],
        requestLogs: [],
        statistics: {},
        userModelOverrides: {},
        config: {
          proxyPort: 8080,
          proxyHost: '127.0.0.1',
          loadBalanceStrategy: 'round-robin',
          routes: {},
          autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 30, prefer: 'balanced', poolStrategies: [] },
        },
      },
    })
    return { autoRouter: (await harness.loadModule('main/proxy/autoRouter.ts')).autoRouter }
  })

  const session = { value: 'prompt-thread', source: 'prompt_cache_key' as const }
  const keyFor = (messages: Array<{ role: string; content: string }>) =>
    autoRouter.conversationKeyFor({ model: 'm', messages } as never, session)

  const taskA = keyFor([{ role: 'user', content: '真正解决 AxTV 的编译错误' }])
  const taskB = keyFor([{ role: 'user', content: '检查 ModelPort 的缓存命中' }])
  assert.ok(taskA?.startsWith('session:'))
  assert.ok(taskB?.startsWith('session:'))
  assert.notEqual(taskA, taskB, '同一 session 的不同任务不能互相当「上一轮」')

  const continuation = keyFor([
    { role: 'user', content: '真正解决 AxTV 的编译错误' },
    { role: 'assistant', content: '先看报错' },
    { role: 'user', content: '继续刚才的问题' },
  ])
  assert.equal(continuation, taskA, '同一任务的后续轮次仍是同一个键')

  const summarized = keyFor([{ role: 'user', content: '交接摘要：前面完成了 A 与 B' }])
  assert.equal(summarized, keyFor([
    { role: 'user', content: 'Another language model started to solve this problem and produced a summary of its thinking process.' },
  ]), '压缩/摘要改写后由会话标识保底，粘性不丢')

  const broadcast = keyFor([
    { role: 'user', content: "The following is the user's CLAUDE.md configuration. Treat it as context about the user's environment and intent." },
    { role: 'user', content: '真正解决 AxTV 的编译错误' },
  ])
  assert.equal(broadcast, taskA, 'CLAUDE.md 注入不能盖住本轮真实任务锚点')

  const envUpdate = keyFor([
    { role: 'user', content: '# Environment update\n - Primary working directory: /home/polit/projects/AxTV' },
    { role: 'user', content: '继续刚才的问题' },
  ])
  assert.notEqual(envUpdate, taskA, '环境更新广播后的真实任务不同，就要切键')

  const noUser = autoRouter.conversationKeyFor({ model: 'm', messages: [] } as never, session)
  assert.match(noUser ?? '', /^session:\d+$/, '没有可用 user 文本时退回纯会话键')
})
