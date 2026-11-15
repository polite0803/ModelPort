/**
 * esbuild 的 `args.importer` 用**平台分隔符**（Windows 是反斜杠）。
 * vendor 打包守卫里写死正斜杠时，Linux 上恒真、Windows 上恒假：插件静默不接管，
 * 上游越界导入 `../../../src/image-pricing.js`（本仓库只有 compat 替身）就变成
 * 真实的 `Could not resolve`。本地门禁跑在 Linux，这条缺陷只有 windows runner
 * 能看见 —— 故在源码层钉死，不依赖跨平台跑测才暴露。
 *
 * 触发串与坏样本都由 `CALL` 拼出，本文件因此不豁免于自己的扫描面。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const BS = String.fromCharCode(92)
const CALL = ['importer', 'startsWith('].join('.')
const SKIP_DIRS = new Set(['node_modules', 'fixtures', '.worktrees', 'output', 'dist'])

const guardLine = (expr: string) => `if (!args.${CALL}${expr})) return undefined`

/** 违规返回字面量清单，合规返回 null。判据：比较 `importer` 的那一行里出现纯分隔符字面量。 */
export function hardcodedSeparatorGuard(line: string): string | null {
  if (!line.includes('importer')) return null
  const literals = line.match(/'[^']*'|"[^"]*"|`[^`]*`/g) ?? []
  const bad = literals.filter(quoted => {
    const body = quoted.slice(1, -1)
    return body.length > 0 && [...body].every(c => c === '/' || c === BS)
  })
  return bad.length > 0 ? bad.join(', ') : null
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(join(dir, entry.name)))
    } else if (/\.(ts|mjs|js)$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

test('判据自证：写死分隔符的守卫判红，平台安全的写法放行', () => {
  const bad = [
    guardLine(`VENDOR + '/'`),
    guardLine(`VENDOR_SRC + '/'`),
    guardLine(`VENDOR + "${BS}${BS}"`),
    `if (!args.importer.includes('/')) return undefined`,
  ]
  for (const line of bad) assert.ok(hardcodedSeparatorGuard(line), `应判红：${line}`)

  const good = [
    guardLine('VENDOR + sep'),
    guardLine('vendor + path.sep'),
    guardLine('VENDOR_SRC + sep'),
    guardLine('VENDOR_SRC'),
    `const p = join(args.importer, '..')`,
    'const undici = true',
  ]
  for (const line of good) assert.equal(hardcodedSeparatorGuard(line), null, `应放行：${line}`)
})

test('tests/ 与 scripts/ 里所有 importer 守卫都不含写死的路径分隔符', () => {
  const violations: string[] = []
  const guarded: string[] = []
  for (const file of [...sourceFiles(join(ROOT, 'tests')), ...sourceFiles(join(ROOT, 'scripts'))]) {
    const rel = relative(ROOT, file).split(BS).join('/')
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const [i, line] of lines.entries()) {
      if (!line.includes(CALL)) continue
      guarded.push(`${rel}:${i + 1}`)
      const bad = hardcodedSeparatorGuard(line)
      if (bad) violations.push(`${rel}:${i + 1} → ${bad}`)
    }
  }
  // 扫描面自证：走空了不能算绿，生产打包脚本必须在扫描结果里。
  assert.ok(guarded.length > 0, '一个守卫都没扫到，判据形同虚设')
  assert.ok(
    guarded.some(site => site.startsWith('scripts/build-channel-pack.mjs:')),
    `未扫到生产打包脚本的守卫：${guarded.join(', ')}`,
  )
  assert.deepEqual(violations, [], 'importer 守卫必须用 path.sep（或不带分隔符的前缀）')
})