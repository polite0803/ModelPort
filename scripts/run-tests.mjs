#!/usr/bin/env node
/**
 * 全量测试入口（跨平台）。
 *
 * 为什么需要它：WorkBuddy 沙箱会给 shell 注入 `http_proxy` / `https_proxy` /
 * `HTTP_PROXY` / `HTTPS_PROXY` 等环境变量（指向本机 127.0.0.1:<port> 的 MCP 服务
 * 代理）。axios 默认读取这些环境变量，会把测试里打到 127.0.0.1 回环替身服务的请求
 * 劫持到代理上 —— 于是 `req.url` 从相对路径变成绝对 URL、`127.0.0.1:1` 也不再拒连，
 * 全量测试因此误报 16 条失败（credit-query-fetch 3 / completions-empty-prompt 2 /
 * routing 请求级差集 10 / 聚合删除 R1 1）。清代理后实测 1539/1539 全绿。
 *
 * 本套测试全部只打回环替身（绝不打真实上游域名），清除代理变量是安全的；CI 三 OS
 * 矩阵本来就没有这些变量，清不清都是同一行为。因此把清除放在这里，让 `npm run gate`
 * 在任意环境下都给出可靠读数。
 *
 * 用法：node scripts/run-tests.mjs "tests/**\/*.test.ts" "tests/**\/*.test.mjs" "tests/**\/*.test.js"
 */
import { spawnSync } from 'node:child_process'

// 只清代理类环境变量；其它环境（npm registry、git 等）不受影响。
const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'all_proxy',
  'ALL_PROXY',
  'no_proxy',
  'NO_PROXY',
]

const env = { ...process.env }
for (const key of PROXY_ENV_KEYS) delete env[key]

// 原样透传剩余参数（glob 由 node --test 自己展开，不经过 shell）。
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

if (result.error) {
  console.error(`[run-tests] ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
