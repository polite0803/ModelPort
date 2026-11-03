import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

test('header proxy badge renders the configured bind address instead of a hard-coded loopback host', () => {
  const headerSource = readFileSync(join(root, 'src/renderer/src/components/layout/Header.tsx'), 'utf8')
  const handlersSource = readFileSync(join(root, 'src/main/ipc/handlers.ts'), 'utf8')
  const sharedTypesSource = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')

  assert.match(sharedTypesSource, /export interface ProxyStatus \{[\s\S]*?\n\s+host: string/)
  assert.match(handlersSource, /host: proxyHost/)
  assert.match(handlersSource, /proxyStatusManager\.getHost\(\)/)
  assert.match(handlersSource, /key === 'config'[\s\S]*?IpcChannels\.CONFIG_CHANGED/)
  assert.match(headerSource, /const \[host, setHost\] = useState\('127\.0\.0\.1'\)/)
  assert.match(headerSource, /setHost\(status\.host \|\| '127\.0\.0\.1'\)/)
  assert.match(headerSource, /setHost\(config\.proxyHost \|\| '127\.0\.0\.1'\)/)
  assert.match(headerSource, /\{host\}:\{port\}/)
  assert.doesNotMatch(headerSource, /127\.0\.0\.1:\{port\}/)
})

test('preload stays network-free and the settings page shows the endpoint the proxy really serves', () => {
  // 原名「tool calling smoke runs in the main process…」：主进程 smoke 通路随托管工具层
  // 于 2026-11-03 一起退役，那两条断言一起删。留在这里的是当时同一条测试里另外两条
  // 与本征事实：渲染桥不许有网络能力，设置页显示的端点必须是真在服务的那个。
  const preloadSource = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
  const managementSettingsSource = readFileSync(join(root, 'src/renderer/src/components/settings/ManagementApiSettings.tsx'), 'utf8')

  assert.doesNotMatch(preloadSource, /fetch\(/)
  assert.doesNotMatch(preloadSource, /managementApi\?\.managementApiPort \|\| config\.proxyPort/)

  // 退役的 smoke 通道不许被接回来（它当时是 preload ↔ main 唯一的工具层通路）。
  assert.doesNotMatch(preloadSource, /TOOL_CALLING_RUN_SMOKE/)

  // the management endpoint shown in settings still has to be one the proxy serves
  assert.match(managementSettingsSource, /const apiEndpoint = `http:\/\/127\.0\.0\.1:\$\{proxyPort\}\/v1\/management`/)
})
