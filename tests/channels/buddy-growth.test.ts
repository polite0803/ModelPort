import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

/**
 * 直接驱动 vendor 源码。
 *
 * ⚠️ 这里**不用 esbuild**（`workbuddy-port.test.ts` 那条路）：`buddy-growth.ts` 的三条
 * import 全是 `import type`，运行时零依赖，node 原生类型擦除就能加载 —— 而 esbuild 的
 * service 二进制在网络共享盘上会 `spawn EPERM`（本仓库已知的环境性红），用它就把一组
 * 纯逻辑测试绑死在「只能在本地镜像跑」上。
 */
async function loadGrowth() {
  const target = join(ROOT, 'vendor', 'channel-pack', 'src', 'buddy-growth.ts')
  return await import(pathToFileURL(target).href)
}

/** 2026-11-08 对真实账号取证的那份响应的**裁剪版**（键名与层级逐字保留）。 */
function tasksFixture() {
  return {
    code: 0,
    msg: 'OK',
    requestId: 'bac9c469-e4b9-4b76-95fa-80e873205768',
    data: {
      tasks: [
        {
          task_code: 'playbook_prompt',
          title: '探索优秀灵感',
          description: '前往「Workbuddy」，点击「更多」，进入「灵感」界面',
          task_desc: '体验1款「灵感」优秀案例。',
          task_type: 'single',
          jump_url: 'workbuddy://playbook',
          valid_start: null,
          valid_end: null,
          reward_credit: 100,
          reward_energy: 5,
          reward_buddy: false,
          template_id_fixed: 0,
          badge_name: '',
          accept_status: 'claimed',
          progress: { current: 1, target: 1 },
          is_pinned: false,
          is_new: true,
          tag: 'PC',
          locked: false,
          has_reward: true,
        },
        {
          task_code: 'RichMeow_Chat',
          title: '桌面端对话1次',
          description: '',
          task_desc: '下载并使用桌面端，即可解锁限定款 Buddy 盲盒',
          task_type: 'single',
          jump_url: 'workbuddy://chat',
          reward_credit: 100,
          reward_energy: 5,
          reward_buddy: true,
          template_id_fixed: 11,
          accept_status: 'completed',
          progress: { current: 1, target: 1 },
          locked: false,
          has_reward: true,
        },
        {
          task_code: 'Library_read',
          title: '体验「资料库」',
          description: '',
          task_desc: '前往「资料库」，读完《WorkBuddy 资料库介绍》这篇文档',
          task_type: 'single',
          jump_url: 'workbuddy://library',
          reward_credit: 100,
          reward_energy: 5,
          reward_buddy: false,
          // 实测：未接单的项服务端下发的是 **null**，不是 {0,0}。
          accept_status: 'not_accepted',
          progress: null,
          locked: false,
          has_reward: true,
        },
      ],
    },
  }
}

const PRODUCT = { endpoint: 'https://copilot.tencent.com', userAgent: 'WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/5.9.3' }
const CREDENTIAL = { access_token: 'jwt-token-value', domain: 'www.codebuddy.cn' }

/** 记录每次调用的假 fetcher，并按 URL 返回预设响应。 */
function recorder(responder) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, init, headers: new Headers(init?.headers ?? {}) })
    const responderResult = responder(String(url), init?.method ?? 'GET')
    return {
      status: responderResult.status,
      // 与真实 Response 同形：`.text()` 只能取一次。
      async text() {
        return responderResult.body
      },
    }
  }
  return { fetcher, calls }
}

test('清单解析：状态原值直传、claimable 只认 completed、progress 为 null 时省略', async () => {
  const mod = await loadGrowth()
  const { fetcher } = recorder(() => ({ status: 200, body: JSON.stringify(tasksFixture()) }))
  const tasks = await mod.fetchGrowthTasks(CREDENTIAL, PRODUCT, fetcher)

  assert.equal(tasks.length, 3)
  const byCode = new Map(tasks.map((task) => [task.code, task]))

  const claimed = byCode.get('playbook_prompt')
  assert.equal(claimed.status, 'claimed')
  assert.equal(claimed.claimable, false, '已领取的项不能再算「可领」')
  assert.equal(claimed.description, '体验1款「灵感」优秀案例。', '取 task_desc，不取冗长的 description')
  assert.deepEqual(claimed.progress, { current: 1, target: 1 })

  const claimable = byCode.get('RichMeow_Chat')
  assert.equal(claimable.claimable, true)
  assert.equal(claimable.rewardCredit, 100)
  assert.equal(claimable.rewardEnergy, 5)
  assert.equal(claimable.rewardBuddy, true)

  const notAccepted = byCode.get('Library_read')
  assert.equal(notAccepted.claimable, false)
  // ⚠️ 必须是**没有这个键**，而不是 {current:0,target:0}：补零会把「还没开始」
  // 渲染成「0/0 已完成」，本仓库反复出过这类「缺席伪装成结果」。
  assert.equal('progress' in notAccepted, false, 'progress 为 null 时应省略字段而不是补 0')
})

test('清单读不到时返回 null，不返回空数组（「查不到」≠「没有可领」）', async () => {
  const mod = await loadGrowth()
  const cases = [
    // 信封非 0
    { status: 200, body: JSON.stringify({ code: 401, msg: 'unauthorized', data: null }) },
    // data 缺 tasks
    { status: 200, body: JSON.stringify({ code: 0, msg: 'OK', data: {} }) },
    // tasks 不是数组
    { status: 200, body: JSON.stringify({ code: 0, msg: 'OK', data: { tasks: null } }) },
    // 网关 HTML 错误页（凭据失效的真实形态）
    { status: 401, body: '<html><h1>Unauthorized</h1></html>' },
  ]
  for (const response of cases) {
    const { fetcher } = recorder(() => response)
    const tasks = await mod.fetchGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
    assert.equal(tasks, null, `应返回 null：${JSON.stringify(response).slice(0, 60)}`)
  }
})

test('请求头：WorkBuddy 客户端身份（显式 UA + X-Client-Platform: workbuddy），不发归属头', async () => {
  const mod = await loadGrowth()
  const { fetcher, calls } = recorder(() => ({ status: 200, body: JSON.stringify(tasksFixture()) }))
  await mod.fetchGrowthTasks({ ...CREDENTIAL, user_id: 'u-1', enterprise_id: 'e-1' }, PRODUCT, fetcher)

  const headers = calls[0].headers
  assert.equal(headers.get('Authorization'), 'Bearer jwt-token-value')
  assert.equal(headers.get('X-Client-Platform'), 'workbuddy')
  assert.equal(headers.get('Accept-Language'), 'zh-CN')
  assert.equal(headers.get('Accept'), 'application/json')
  // ⚠️ 这条是本次修复的正题：调用方不设 UA 时 Node fetch 发的是 `user-agent: node`，
  // 而同账号的其余 buddy 请求全是 WorkBuddy 身份 —— 唯独领积分是 node 就是异常形状。
  assert.equal(headers.get('User-Agent'), PRODUCT.userAgent)
  assert.notEqual((headers.get('User-Agent') || '').toLowerCase(), 'node')
  // ⚠️ 这三条是签到那条路（CLI/IDE 形态）发的头。成长接口实测**不需要**它们，
  // 而官方网页从不发送它们 —— 发出去等于造一个官方客户端不存在的组合。
  for (const name of ['X-Domain', 'X-Product', 'X-Product-Code', 'X-User-Id', 'X-Enterprise-Id', 'X-Tenant-Id']) {
    assert.equal(headers.get(name), null, `${name} 不应出现在成长中心请求里`)
  }
  assert.ok(calls[0].url.endsWith('/v2/activity/growth/tasks'), '清单走 GET 且路径正确')
})

test('批量领取：只对服务端认可为 completed 的项发 POST，计数分三档、奖励分两域', async () => {
  const mod = await loadGrowth()
  const posts = []
  const { fetcher, calls } = recorder((url, method) => {
    if (method === 'POST') {
      posts.push(url)
      return { status: 200, body: JSON.stringify({ code: 0, msg: 'OK', requestId: 'r-1' }) }
    }
    return { status: 200, body: JSON.stringify(tasksFixture()) }
  })

  const run = await mod.claimAllGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.ok(run !== null)
  // 3 项里只有 1 项 completed ⇒ 恰好一次 POST，且打在正确的 code 上。
  assert.deepEqual(posts, ['https://copilot.tencent.com/activity/growth/tasks/RichMeow_Chat/claim'])
  assert.equal(run.claimed.length, 1)
  assert.equal(run.alreadyClaimed, 1, 'claimed 状态算「此前已领」，不发请求')
  assert.equal(run.notClaimable, 1, 'not_accepted 算「还没做完」，单独一档')
  assert.equal(run.failures.length, 0)
  assert.deepEqual(run.gained, { credit: 100, energy: 5 })
  // 只读那次在前，写那次在后 ⇒ 串行，不是并发。
  assert.equal(calls.length, 2)
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].headers.get('Content-Type'), 'application/json')
  assert.equal(calls[1].init.body, '{}')
})

test('领取（POST）带同一套客户端身份，不因为换了方法就漏 UA', async () => {
  const mod = await loadGrowth()
  const { fetcher, calls } = recorder((url, method) => method === 'POST'
    ? { status: 200, body: JSON.stringify({ code: 0, msg: 'OK' }) }
    : { status: 200, body: JSON.stringify(tasksFixture()) })
  await mod.claimAllGrowthTasks(CREDENTIAL, PRODUCT, fetcher)

  const post = calls.find((call) => call.init?.method === 'POST')
  assert.ok(post !== undefined, '应当发出一次 POST')
  assert.equal(post.headers.get('User-Agent'), PRODUCT.userAgent)
  assert.equal(post.headers.get('X-Client-Platform'), 'workbuddy')
  assert.equal(post.headers.get('Authorization'), 'Bearer jwt-token-value')
})

test('领取响应非 0 时按失败上报并带服务端原文，不猜成「已领过」', async () => {
  const mod = await loadGrowth()
  const { fetcher } = recorder((url, method) => {
    if (method === 'POST') {
      // 幂等码未取证（见模块头与 PLAN §4.1）：这里的 10001 只是「非 0」的一个实例。
      return { status: 400, body: JSON.stringify({ code: 10001, msg: '今天已签到，请明天再来' }) }
    }
    return { status: 200, body: JSON.stringify(tasksFixture()) }
  })
  const run = await mod.claimAllGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.equal(run.claimed.length, 0)
  assert.equal(run.failures.length, 1)
  assert.equal(run.failures[0].task.code, 'RichMeow_Chat')
  assert.ok(run.failures[0].message.includes('今天已签到，请明天再来'), '要带上服务端原文，用户才知道该做什么')
  assert.ok(run.failures[0].message.includes('code 10001'))
  assert.deepEqual(run.gained, { credit: 0, energy: 0 })
})

test('领取遇到网关 HTML 错误页（凭据失效）时报「重新登录」，不报 JSON 解析错', async () => {
  const mod = await loadGrowth()
  const { fetcher } = recorder((url, method) => method === 'POST'
    ? { status: 401, body: '<html><h1>401 Unauthorized</h1></html>' }
    : { status: 200, body: JSON.stringify(tasksFixture()) })
  const run = await mod.claimAllGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.equal(run.failures.length, 1)
  assert.match(run.failures[0].message, /凭据已失效/)
  assert.doesNotMatch(run.failures[0].message, /is not valid JSON/, '原始 JSON 解析报错对用户毫无意义')
})

test('清单读到 null 时整号报「问不出结果」，不静默当成没有任务', async () => {
  const mod = await loadGrowth()
  const { fetcher } = recorder(() => ({ status: 200, body: JSON.stringify({ code: 401, msg: 'no' }) }))
  const run = await mod.claimAllGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.equal(run, null)
})

test('code 里含特殊字符时进 URL 的要转义（路径注入面）', async () => {
  const mod = await loadGrowth()
  const fixture = tasksFixture()
  fixture.data.tasks = [{
    ...fixture.data.tasks[1],
    task_code: 'a/b?c=1',
    accept_status: 'completed',
  }]
  const posts = []
  const { fetcher } = recorder((url, method) => {
    if (method === 'POST') posts.push(url)
    return method === 'POST'
      ? { status: 200, body: JSON.stringify({ code: 0, msg: 'OK' }) }
      : { status: 200, body: JSON.stringify(fixture) }
  })
  await mod.claimAllGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.deepEqual(posts, ['https://copilot.tencent.com/activity/growth/tasks/a%2Fb%3Fc%3D1/claim'])
})

test('奖励文案：两个量纲各带一个 +、零的域整段不渲染', async () => {
  const mod = await loadGrowth()
  assert.equal(mod.formatGrowthGains({ credit: 100, energy: 5 }), '+100积分, +5能量')
  assert.equal(mod.formatGrowthGains({ credit: 100, energy: 0 }), '+100积分', '零能量不该渲染成 +0能量')
  assert.equal(mod.formatGrowthGains({ credit: 0, energy: 5 }), '+5能量')
  assert.equal(mod.formatGrowthGains({ credit: 0, energy: 0 }), null, '全零要返回 null，让调用方整段不渲染')
  // 小数积分按两位（与 credits.ts::formatCreditAmount 同口径）；能量整数不带小数位。
  assert.equal(mod.formatGrowthGains({ credit: 12.5, energy: 3 }), '+12.50积分, +3能量')
})

test('接单：一次批量请求只带 not_accepted 的 code，其余状态一个请求都不发', async () => {
  const mod = await loadGrowth()
  const fixture = tasksFixture()
  // 造齐五种状态：只有 not_accepted 该被接。
  fixture.data.tasks.push({
    task_code: 'expert_5',
    title: '召唤 5 次专家',
    task_desc: '召唤 5 位不同的专家并发起对话。',
    accept_status: 'in_progress',
    progress: { current: 1, target: 5 },
    reward_credit: 100,
    reward_energy: 5,
    reward_buddy: false,
    locked: false,
  }, {
    task_code: 'playbook_prompt_again',
    title: '已接单的项',
    task_desc: '',
    accept_status: 'accepted',
    progress: { current: 0, target: 1 },
    reward_credit: 100,
    reward_energy: 5,
    reward_buddy: false,
    locked: false,
  })
  const posts = []
  const { calls, fetcher } = recorder((url, method) => {
    if (method === 'POST') {
      posts.push(url)
      return { status: 200, body: JSON.stringify({ code: 0, msg: 'OK' }) }
    }
    return { status: 200, body: JSON.stringify(fixture) }
  })

  const run = await mod.acceptAllPendingGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.ok(run !== null)
  assert.equal(posts.length, 1, '接单是**一次**批量请求，不是每项一次')
  const acceptCall = calls.find(call => call.init?.method === 'POST')
  assert.ok(acceptCall !== undefined)
  assert.equal(acceptCall.url, 'https://copilot.tencent.com/activity/growth/tasks/accept')
  assert.deepEqual(JSON.parse(acceptCall.init.body), { task_codes: ['Library_read'] })
  assert.equal(acceptCall.headers.get('User-Agent'), PRODUCT.userAgent)
  assert.equal(acceptCall.headers.get('X-Client-Platform'), 'workbuddy')
  assert.equal(run.accepted.length, 1)
  // 其余四项（claimed / completed / in_progress / accepted）都不该再发。
  assert.equal(run.untouched, 4)
  assert.equal(run.failure, undefined)
})

test('接单被拒时带服务端原文，不报成「接了 0 项」', async () => {
  const mod = await loadGrowth()
  const { fetcher } = recorder((url, method) => method === 'POST'
    ? { status: 200, body: JSON.stringify({ code: 100001, msg: 'template_id required' }) }
    : { status: 200, body: JSON.stringify(tasksFixture()) })
  const run = await mod.acceptAllPendingGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.equal(run.accepted.length, 0)
  assert.match(run.failure, /template_id required/)
  assert.match(run.failure, /code 100001/)
})

test('没有未接单项时不发任何写请求', async () => {
  const mod = await loadGrowth()
  const fixture = tasksFixture()
  fixture.data.tasks = fixture.data.tasks.map(task => ({ ...task, accept_status: 'claimed' }))
  const { calls, fetcher } = recorder(() => ({ status: 200, body: JSON.stringify(fixture) }))
  const run = await mod.acceptAllPendingGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.equal(calls.filter(call => call.init?.method === 'POST').length, 0)
  assert.equal(run.accepted.length, 0)
  assert.equal(run.untouched, 3)
})

test('清单读不到时接单返回 null（不把故障说成「没有要接的」）', async () => {
  const mod = await loadGrowth()
  const { fetcher } = recorder(() => ({ status: 200, body: JSON.stringify({ code: 401, msg: 'no' }) }))
  const run = await mod.acceptAllPendingGrowthTasks(CREDENTIAL, PRODUCT, fetcher)
  assert.equal(run, null)
})

test('两域合计：各自求和，互不折算', async () => {
  const mod = await loadGrowth()
  // 输入恒为本模块 `parseTask` 的产物（两个字段一定是数字），这里不测脏数据分支。
  const tasks = [
    { rewardCredit: 100, rewardEnergy: 5 },
    { rewardCredit: 200, rewardEnergy: 10 },
  ]
  assert.deepEqual(mod.sumGrowthRewards(tasks), { credit: 300, energy: 15 })
})
