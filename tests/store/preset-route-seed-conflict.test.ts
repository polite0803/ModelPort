/**
 * 「协议路由」播种遇到名字被占用时的处置（与 `protocol-route-seed.test.ts` 分文件，
 * 因为一个测试文件 = 一个 store 单例，而这一格要的初始存储对象里目录名已经是 `codex`）。
 *
 * 判据：`checkRouteName` 的三级校验（字符集 → 表内唯一 → 与模型名/别名冲突）在生产侧
 * 是硬门，播种不许绕过去 —— 绕过去就等于系统替用户造了一个客户端点不到、界面也改不动
 * 的名字。被挡下时**照样记档**：这个名字已被别的东西占住，每次重启再试一次只会把日志刷满。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

import { bootstrapStore } from '../routes/harness.mjs'
import { PRESET_ROUTE_SEEDS } from '../../src/main/store/modelRoutes.ts'

const harness = await bootstrapStore({
  // 这一份要的就是真实播种行为（默认夹具会写记档键跳过它，见 harness.mjs）。
  seedPresetRoutes: true,
  initialData: {
    providers: [
      {
        id: 'occupant',
        name: 'Occupant Provider',
        type: 'custom',
        authType: 'token',
        apiEndpoint: 'http://127.0.0.1:1/v1',
        chatPath: '/chat/completions',
        headers: {},
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        // 目录里已经有一个叫 `codex` 的模型 ⇒ 路由名冲突。
        supportedModels: ['codex'],
      },
    ],
    accounts: [],
    sessions: [],
    logs: [],
    requestLogs: [],
    statistics: {},
    userModelOverrides: {},
    config: {
      routes: {},
      loadBalanceStrategy: 'round-robin',
      autoRouting: { enabled: true, maxAttempts: 2, stickyMinutes: 0, prefer: 'balanced', poolStrategies: [] },
    },
  },
})
const sm = harness.storeManager

after(() => harness.dispose())

test('名字被模型目录占用时跳过播种，但记档仍然写下', () => {
  const routes = sm.getConfig().routes as Record<string, any>

  assert.equal(routes.codex, undefined, '冲突的名字不许被绕过校验塞进表里')
  assert.deepEqual(Object.keys(routes).sort(), ['daily', 'performance', 'stable'], '这张表本来就是空的（routes 键存在 ⇒ 不走 auto 迁移）')
  assert.deepEqual(harness.dataFile().config.seededPresetRoutes, PRESET_ROUTE_SEEDS.map(seed => seed.name), '被挡下也算处理过，重启不再试')
})

test('跳过的原因是目录里那个同名模型，占用者名单确实读得到它', () => {
  // 这一格钉住「播种走的是同一条校验路径」：占用者名单来自 `getRouteNameOccupants()`，
  // 与界面新建路由时用的是同一份，不是播种自己另判一套。
  assert.deepEqual(
    (sm as unknown as { getRouteNameOccupants(): { modelNames: string[] } }).getRouteNameOccupants().modelNames,
    ['codex'],
  )
})
