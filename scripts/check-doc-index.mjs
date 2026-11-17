#!/usr/bin/env node
/**
 * 文档索引核对（跨平台）。
 *
 * `docs/README.md` 自称覆盖 `docs/` 下每一份文档、没有孤立文件。本脚本把这句声明变成
 * 可验证的事实：扫描 docs 下所有 Markdown，收集索引里的相对链接（具体文件或目录），
 * 再报告三类问题 —— 未被索引覆盖的文档、指向不存在路径的链接、AGENTS.md 缺少索引声明。
 *
 * 覆盖率按“路径位于被索引目录之下”计算，因此 `design/` 这类目录链接代表其下全部文档，
 * 不必为每份历史文档逐条罗列。索引本身与生成型数据票据（docs/data/**）不要求逐行登记：
 * 前者是索引入口，后者由 builder 清单在索引中统一登记。
 *
 * 用法：
 *   node scripts/check-doc-index.mjs                  # 核对当前仓库，发现问题退出 1
 *   node scripts/check-doc-index.mjs --root <dir>     # 指定仓库根（测试用）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')

/** 相对链接解析后指向目录时，视作覆盖该目录下全部 Markdown。 */
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g

function listMarkdown(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listMarkdown(full))
    } else if (entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 核对文档索引。返回问题数组，空数组表示索引自洽。
 * @param {string} root 仓库根目录
 */
export function collectIndexIssues(root = DEFAULT_ROOT) {
  const docsDir = path.join(root, 'docs')
  const indexPath = path.join(docsDir, 'README.md')
  const agentsPath = path.join(root, 'AGENTS.md')
  const issues = []

  if (!existsSync(indexPath)) return [`docs/README.md 不存在（索引入口缺失）`]
  if (!existsSync(agentsPath)) return [`AGENTS.md 不存在（智能体全局参考入口缺失）`]

  const indexText = readFileSync(indexPath, 'utf8')
  const linkedFiles = new Set()
  const linkedDirs = new Set()

  for (const match of indexText.matchAll(LINK_RE)) {
    const raw = match[1].split('#', 1)[0].trim()
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue // 跳过空锚点与 URL
    const target = path.resolve(docsDir, raw)
    if (!existsSync(target)) {
      issues.push(`索引链接指向不存在的路径：${raw}`)
      continue
    }
    if (statSync(target).isDirectory()) linkedDirs.add(target)
    else linkedFiles.add(target)
  }

  // docs/README.md 自身即索引；data/ 由索引里的 builder 清单登记，不要求逐票列出。
  const self = path.resolve(indexPath)
  const dataDir = path.resolve(docsDir, 'data')
  for (const file of listMarkdown(docsDir)) {
    const resolved = path.resolve(file)
    if (resolved === self || resolved.startsWith(dataDir + path.sep)) continue
    const covered =
      linkedFiles.has(resolved) ||
      [...linkedDirs].some((dir) => resolved.startsWith(dir + path.sep))
    if (!covered) {
      issues.push(`文档未被索引覆盖：docs/${path.relative(docsDir, file).split(path.sep).join('/')}`)
    }
  }

  const agentsText = readFileSync(agentsPath, 'utf8')
  if (!agentsText.includes('docs/README.md')) {
    issues.push('AGENTS.md 未声明 docs/README.md 为智能体全局文档索引')
  }

  return issues
}

function parseRoot(argv) {
  const idx = argv.indexOf('--root')
  if (idx >= 0 && argv[idx + 1]) return path.resolve(argv[idx + 1])
  return DEFAULT_ROOT
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const issues = collectIndexIssues(parseRoot(process.argv.slice(2)))
  if (issues.length) {
    for (const issue of issues) console.error(`[check-doc-index] ${issue}`)
    process.exitCode = 1
  } else {
    console.log('[check-doc-index] 文档索引自洽：无孤立文档、无失效链接、AGENTS.md 已声明索引')
  }
}
