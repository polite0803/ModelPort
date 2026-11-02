import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

test('代理设置页读到持久化配置前不渲染输入框，读到后同步而不是锁死默认值', () => {
  const source = readFileSync(
    join(root, 'src/renderer/src/components/proxy/ProxyConfigForm.tsx'),
    'utf8',
  )
  const storeSource = readFileSync(join(root, 'src/renderer/src/stores/proxyStore.ts'), 'utf8')
  const zh = readFileSync(join(root, 'src/renderer/src/i18n/locales/zh-CN.json'), 'utf8')
  const en = readFileSync(join(root, 'src/renderer/src/i18n/locales/en-US.json'), 'utf8')

  // 读取完成标记来自 store，而不是表单自己的初始 state。
  assert.match(source, /const appConfig = useProxyStore\(\(state\) => state\.appConfig\)/)

  // 加载完成前不渲染输入框：默认 127.0.0.1 / HTTPS 关闭不能被当成现状保存。
  assert.match(source, /if \(appConfig === null\) \{[\s\S]{0,600}?proxy\.loadingSettings/)
  assert.match(zh, /"loadingSettings":/)
  assert.match(en, /"loadingSettings":/)

  // 读到配置后同步表单；用户已有未保存修改时不覆盖。
  assert.match(
    source,
    /if \(appConfig === null \|\| hasChanges\) return[\s\S]{0,800}?setFormData\(newFormData\)[\s\S]{0,200}?\}\, \[appConfig, hasChanges, proxyConfig\]\)/,
    '表单必须在 appConfig 变化时同步，且受 hasChanges 保护',
  )
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{[\s\S]{0,400}?setFormData\(newFormData\)[\s\S]{0,80}?\}, \[\]\)/,
    '挂载时一次性锁死默认值的旧写法不能回来',
  )

  // 外部 CONFIG_CHANGED 必须同时刷新表单用的 proxyConfig，不能只换 appConfig。
  assert.match(storeSource, /function proxyConfigFromAppConfig\(config: AppConfig\)/)
  assert.match(
    storeSource,
    /onConfigChanged[\s\S]{0,300}?proxyConfig: proxyConfigFromAppConfig\(config\)/,
  )
})
