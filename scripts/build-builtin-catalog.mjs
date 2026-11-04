/**
 * 生成随应用发布的内置 LiteLLM 快照。
 *
 * 背景：部分网络到 `raw.githubusercontent.com` 会被重置（ECONNRESET）。运行时已按
 * 「主端点 → jsDelivr → 用户镜像」回退；用户从未成功刷新过时再回退到本脚本产出的
 * 内置快照，保证完全断网也能用标准库补全。
 *
 * 口径：
 * - 只保留 `mode in (chat, vision)` 的条目（与运行时解析器同一条规则），
 *   约 3.3 MB 原始文件裁剪成约 1 MB；丢弃的是 embedding/audio/image/TTS 等
 *   不参与对话补全的条目。
 * - 许可与归属随快照保留：MIT / BerriAI·LiteLLM。
 * - 抓取失败不中断构建：打印醒目告警后以 0 退出，已有旧快照保持不动。
 *
 * 运行：`npm run build:builtin-catalog`
 * 可用 `CATALOG_MIRROR_URL` 指定额外的 https 镜像（仅本脚本使用）。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUTPUT = join(ROOT, 'resources', 'catalog', 'litellm.json')
const TIMEOUT_MS = 60_000
/** 发布用快照陈旧阈值：超过 90 天打 GitHub warning，但不阻断构建。 */
const STALE_DAYS = 90

/** GitHub Actions 注解：本地运行时只是普通日志，不会误伤本地构建。 */
function emitWarning(message) {
  console.warn(`::warning::[builtin-catalog] ${message}`)
}

function readSnapshotFetchedAt() {
  try {
    const snapshot = JSON.parse(readFileSync(OUTPUT, 'utf8'))
    return typeof snapshot?.fetchedAt === 'string' ? snapshot.fetchedAt : undefined
  } catch {
    return undefined
  }
}

function snapshotAgeDays(fetchedAt) {
  const time = new Date(fetchedAt).getTime()
  if (!Number.isFinite(time)) return undefined
  return (Date.now() - time) / (24 * 60 * 60 * 1000)
}

/**
 * 文件最终状态检查：缺失 → 明确告知发布包不含内置快照；存在但陈旧 → warning。
 * 抓取成功/失败/沿用旧快照都走这里，保证 CI 日志里一定有结论。
 */
function reportSnapshotStatus() {
  if (!existsSync(OUTPUT)) {
    emitWarning(`内置快照缺失（${OUTPUT} 不存在）：发布包将不含内置快照，离线场景无法补全`)
    return
  }
  const fetchedAt = readSnapshotFetchedAt()
  const age = fetchedAt === undefined ? undefined : snapshotAgeDays(fetchedAt)
  if (age === undefined) {
    emitWarning(`内置快照缺少可解析的 fetchedAt，无法判断陈旧度：${OUTPUT}`)
    return
  }
  if (age > STALE_DAYS) {
    emitWarning(
      `内置快照已陈旧：fetchedAt=${fetchedAt}（约 ${Math.floor(age)} 天，阈值 ${STALE_DAYS} 天），本次沿用旧快照`,
    )
    return
  }
  console.log(`[builtin-catalog] 内置快照有效：fetchedAt=${fetchedAt}（约 ${Math.floor(age)} 天）`)
}

const ENDPOINTS = [
  {
    label: 'primary',
    url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  },
  {
    label: 'jsdelivr',
    url: 'https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json',
  },
]

const mirror = (process.env.CATALOG_MIRROR_URL ?? '').trim()
if (mirror) {
  try {
    const url = new URL(mirror)
    if (url.protocol === 'https:') ENDPOINTS.push({ label: 'mirror', url: url.toString() })
    else console.warn(`[builtin-catalog] CATALOG_MIRROR_URL 不是 https，已忽略：${mirror}`)
  } catch {
    console.warn(`[builtin-catalog] CATALOG_MIRROR_URL 不是合法 URL，已忽略：${mirror}`)
  }
}

async function fetchJson(endpoint) {
  const startedAt = Date.now()
  try {
    const response = await fetch(endpoint.url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        'user-agent': 'ModelPort builtin-catalog build',
      },
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        ok: false,
        label: endpoint.label,
        url: endpoint.url,
        status: response.status,
        bytes: Buffer.byteLength(text, 'utf8'),
        elapsedMs: Date.now() - startedAt,
        error: `HTTP ${response.status} ${response.statusText}`,
      }
    }
    return {
      ok: true,
      label: endpoint.label,
      url: endpoint.url,
      status: response.status,
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    const cause = error?.cause?.code ? ` / ${error.cause.code}` : ''
    return {
      ok: false,
      label: endpoint.label,
      url: endpoint.url,
      elapsedMs: Date.now() - startedAt,
      error: `${error?.message ?? String(error)}${cause}`,
    }
  }
}

async function main() {
  const parser = await import(
    pathToFileURL(join(ROOT, 'src', 'main', 'providers', 'modelCatalogParsers.ts')).href
  )
  let fetched
  for (const endpoint of ENDPOINTS) {
    const result = await fetchJson(endpoint)
    console.log(
      `[builtin-catalog] ${result.label}: ${result.ok ? `HTTP ${result.status}` : 'FAILED'} ` +
        `${result.elapsedMs}ms${result.bytes ? `, ${result.bytes} bytes` : ''}` +
        `${result.error ? `, ${result.error}` : ''}`,
    )
    if (result.ok) {
      fetched = result
      break
    }
  }

  if (!fetched) {
    const previous = readSnapshotFetchedAt()
    if (previous !== undefined) {
      console.warn(
        `[builtin-catalog] 警告：所有端点均不可达，沿用旧内置快照（fetchedAt=${previous}），构建继续。`,
      )
    } else {
      emitWarning('所有端点均不可达，且没有旧快照：发布包将不含内置快照，离线场景无法补全')
    }
    return
  }

  let raw
  try {
    raw = JSON.parse(fetched.text)
  } catch (error) {
    console.warn(
      `[builtin-catalog] 警告：响应不是合法 JSON，未生成内置快照（${error?.message ?? error}）`,
    )
    return
  }

  const entries = parser.parseCatalogPayload('litellm', raw)
  if (entries.length === 0) {
    console.warn('[builtin-catalog] 警告：没有可用的 chat/vision 条目，未生成内置快照。')
    return
  }

  const rawCount = Object.keys(raw ?? {}).length
  const snapshot = {
    source: 'litellm',
    sourceUrl: fetched.url,
    fetchedAt: new Date().toISOString(),
    contentHash: createHash('sha256').update(fetched.text, 'utf8').digest('hex'),
    license: 'MIT',
    attribution: 'BerriAI / LiteLLM',
    trim: {
      rule: 'mode in (chat, vision)',
      rawEntries: rawCount,
      keptEntries: entries.length,
      droppedEntries: Math.max(0, rawCount - 1 - entries.length),
    },
    entries,
  }

  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(snapshot), 'utf8')
  const outputBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
  console.log(
    `[builtin-catalog] 已写出 ${OUTPUT}：${entries.length} 条（原始 ${rawCount}），` +
      `${outputBytes} bytes，来源 ${fetched.url}`,
  )
}

main()
  .catch((error) => {
    console.error('[builtin-catalog] 生成失败，但构建继续：', error)
    process.exitCode = 0
  })
  .finally(() => {
    reportSnapshotStatus()
  })
