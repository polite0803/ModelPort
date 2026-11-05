import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 打包产物里没有 node_modules：`package.json` 的 `build.files` 用 `!node_modules` 通配
 * 排除了整个目录，主进程的运行时依赖只能由 rollup 内联进 `out/main`。
 *
 * 1.4.5 把 `electron-store` 从 `externalizeDepsPlugin` 的 `exclude` 列表移出
 * （改成 external）之后，安装包启动时 `await import('electron-store')` 直接
 * `ERR_MODULE_NOT_FOUND`：store 初始化失败，界面里每个走存储的 IPC 都报
 * `Storage not initialized, please call initialize() first`。
 *
 * 两条围栏分别钉住因果关系：打包不带 node_modules（前提），以及
 * `conf`（`electron-store` 转发的那个包）仍然是 bundled（结论）。任何一条被改动，安装包都会再次
 * 在启动时失去存储能力。
 */
test('packaging ships no node_modules, so conf must stay bundled', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies?: Record<string, string>
    build?: { files?: string[] }
  }
  const config = readFileSync('electron.vite.config.ts', 'utf8')

  const files = pkg.build?.files ?? []
  assert.ok(
    files.some(pattern => pattern.replace(/\\/g, '/') === '!node_modules/**/*'),
    'build.files must exclude node_modules: if packaging starts shipping deps, revisit this invariant',
  )

  assert.ok(pkg.dependencies?.['conf'], 'conf must remain a runtime dependency')

  const mainExclude = config.match(/externalizeDepsPlugin\(\{[\s\S]*?exclude:\s*\[([\s\S]*?)\]/)?.[1]
  assert.ok(mainExclude, 'the main bundle must configure externalizeDepsPlugin({ exclude: [...] })')
  assert.match(
    mainExclude,
    /['"]conf['"]/,
    'conf must be in the exclude list (bundled), never external: the packaged app has no node_modules',
  )

  // 管理面限流是同一个坑：server.ts 静态 import koa-ratelimit，一旦留作 external，
  // 安装包在启动时就会 ERR_MODULE_NOT_FOUND（整条代理起不来，不只是限流失效）。
  assert.ok(pkg.dependencies?.['koa-ratelimit'], 'koa-ratelimit must remain a runtime dependency')
  assert.match(
    mainExclude,
    /['"]koa-ratelimit['"]/,
    'koa-ratelimit must be in the exclude list (bundled), never external',
  )
})

/**
 * store.ts 的 `await import('conf')` 必须留在 initialize() 的 try 内。
 * 落在 try 外时异常不会写入 `initializationError`，用户只会看到没有指向性的
 * "please call initialize() first"，也没有存储失败对话框。
 */
test('store initialisation loads conf inside the guarded try', () => {
  const source = readFileSync('src/main/store/store.ts', 'utf8')
  const initializeBody = source.slice(source.indexOf('async initialize(): Promise<void>'))
  const tryIndex = initializeBody.indexOf('try {')
  const importIndex = initializeBody.indexOf("await import('conf')")

  assert.ok(tryIndex >= 0, 'initialize() must keep its try block')
  assert.ok(importIndex >= 0, "initialize() must load conf through await import('conf')")
  assert.ok(
    importIndex > tryIndex,
    'the conf import must sit inside the try block, otherwise initializationError stays empty',
  )
})
