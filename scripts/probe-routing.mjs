#!/usr/bin/env node
/**
 * 路由连通性探针：对任何一个 ModelPort 网关跑一遍**单模型全量 + auto 全形状**，
 * 打出可直接对拍的读数（状态码分布 / p50-p90-max 延迟 / 无响应笔数 / 换家次数）。
 *
 * 用法（PowerShell 或 bash 都行）：
 *   $env:MP_BASE='http://192.168.85.131:8080/v1'
 *   $env:MP_KEY='sk-…'
 *   node scripts/probe-routing.mjs                 # 全量：每个模型一笔 + auto 各形状
 *   node scripts/probe-routing.mjs --models-only   # 只跑单模型
 *   node scripts/probe-routing.mjs --auto-only     # 只跑 auto
 *   node scripts/probe-routing.mjs --limit 8       # 只跑前 8 个模型（快速冒烟）
 *   node scripts/probe-routing.mjs --conc 2 --timeout 60000
 *
 * 为什么默认 120s 而不是更短：探针的意义是**区分「慢」与「永不返回」**。
 * 客户端超时比宿主截止时间（`config.requestTimeout`，宿主侧最迟在 2026-11-01 之后
 * 必然兑现）短，就会把「宿主已经换家/报错」误报成挂死。留 1.5 倍余量。
 *
 * 本脚本只读：除了发 `/v1/chat/completions` 与 `/v1/models`，不改任何服务端状态。
 */

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const BASE = (process.env.MP_BASE || 'http://127.0.0.1:8080/v1').replace(/\/$/, '')
const KEY = process.env.MP_KEY || ''
if (!KEY) {
  console.error('MP_KEY is required (the gateway API key). MP_BASE defaults to http://127.0.0.1:8080/v1')
  process.exit(1)
}
const TIMEOUT = Number(opt('--timeout', 120_000))
const CONC = Number(opt('--conc', 3))
const LIMIT = Number(opt('--limit', 0))

const MODELS_ONLY = flag('--models-only')
const AUTO_ONLY = flag('--auto-only')

/** @typedef {{label:string, model:string, messages:unknown, stream?:boolean, tools?:unknown, tool_choice?:string, timeoutMs?:number}} Job */

const TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the weather for a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
}

/** 一次最小往返：非流式看 body，流式看帧。返回可直接汇总的读数。 */
async function probe(job) {
  const body = { model: job.model, messages: job.messages }
  if (job.stream) body.stream = true
  if (job.tools) body.tools = job.tools
  if (job.tool_choice) body.tool_choice = job.tool_choice

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), job.timeoutMs || TIMEOUT)
  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    })
    const raw = await response.text()
    const headers = Object.fromEntries([...response.headers.entries()])
    let error = null
    let content = null
    let frames = 0
    if (job.stream) {
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]' || payload === '') continue
        frames += 1
        try {
          const parsed = JSON.parse(payload)
          if (parsed.error) error = parsed.error.message || JSON.stringify(parsed.error)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) content = (content || '') + delta
        } catch {
          /* 半帧忽略 */
        }
      }
    } else {
      try {
        const parsed = JSON.parse(raw)
        if (parsed.error) error = parsed.error.message || JSON.stringify(parsed.error)
        content = parsed.choices?.[0]?.message?.content ?? null
      } catch {
        error = `unparseable body: ${raw.slice(0, 160)}`
      }
    }
    return {
      ...job,
      status: response.status,
      ms: Date.now() - started,
      error,
      answered: job.stream ? !!content : !!content,
      frames,
      route: headers['x-modelport-route'] ?? null,
      attempts: headers['x-modelport-auto-attempts'] ?? null,
      requestId: headers['x-request-id'] ?? null,
    }
  } catch (failure) {
    // AbortError = 客户端等不到结果，正是「无响应」那一格，必须与 5xx 分开计。
    return {
      ...job,
      status: 0,
      ms: Date.now() - started,
      error: `${failure.name}: no answer within ${job.timeoutMs || TIMEOUT}ms`,
      answered: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function listModels() {
  const response = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } })
  if (!response.ok) throw new Error(`GET /v1/models -> ${response.status}`)
  const json = await response.json()
  return (json.data ?? []).map(model => model.id).filter(id => id !== 'auto')
}

/** 队列式并发：慢的一家不会把整轮的墙钟拖成串行。 */
async function runAll(jobs) {
  const results = []
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (index >= jobs.length) return
      const result = await probe(jobs[index])
      results.push(result)
      const mark = result.status === 200 ? 'ok ' : String(result.status)
      console.log(
        `[${results.length}/${jobs.length}] ${mark} ${String(result.ms).padStart(6)}ms `
        + `${result.model}${result.stream ? ' (stream)' : ''}`
        + (result.route ? ` -> ${result.route}` : '')
        + (result.attempts ? ` [attempts=${result.attempts}]` : '')
        + (result.error ? ` ERR ${String(result.error).replace(/\s+/g, ' ').slice(0, 150)}` : ''),
      )
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONC) }, worker))
  return results
}

function summarize(title, rows) {
  const byStatus = {}
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] || 0) + 1
  const latencies = rows.map(row => row.ms).sort((a, b) => a - b)
  const pick = q => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]
  const hangs = rows.filter(row => row.status === 0)
  const answered = rows.filter(row => row.status === 200 && row.answered).length

  console.log(`\n=== ${title} ===`)
  console.log(`total ${rows.length} | 200-and-answered ${answered} | by status ${JSON.stringify(byStatus)}`)
  console.log(`latency ms p50=${pick(0.5)} p90=${pick(0.9)} max=${latencies[latencies.length - 1]}`)
  if (hangs.length > 0) {
    console.log(`NO ANSWER within timeout (${hangs.length}):`)
    for (const row of hangs) console.log(`  ${row.model} :: ${row.error}`)
  }
  const failures = rows.filter(row => row.status !== 0 && row.status !== 200)
  if (failures.length > 0) {
    console.log(`failures (${failures.length}):`)
    for (const row of failures) {
      console.log(`  ${row.status} ${row.model} :: ${String(row.error || '').replace(/\s+/g, ' ').slice(0, 180)}`)
    }
  }
  const multi = rows.filter(row => row.attempts && Number(row.attempts) > 1)
  if (multi.length > 0) {
    console.log(`换家成功（attempts>1）${multi.length} 笔：` + multi.map(r => `${r.route}@${r.attempts}次/${r.ms}ms`).join('  '))
  }
}

const main = async () => {
  const jobs = []

  if (!AUTO_ONLY) {
    const models = await listModels()
    const picked = LIMIT > 0 ? models.slice(0, LIMIT) : models
    console.log(`gateway ${BASE} | ${models.length} routable models${LIMIT > 0 ? ` (probing ${picked.length})` : ''}`)
    picked.forEach((model, index) => jobs.push({
      label: `model-${index}`,
      model,
      messages: [{ role: 'user', content: `Reply with exactly: OK ${index}` }],
    }))
  }

  if (!MODELS_ONLY) {
    // auto 的形状覆盖：正文 / 带工具历史 / 强制 tool_choice / 图片 / JSON 模式 /
    // 长上下文 / 流式。每笔换一个会话首句，避免粘性把全部请求钉在同一家。
    jobs.push({ label: 'auto-plain', model: 'auto', messages: [{ role: 'user', content: 'Reply with exactly: OK plain' }] })
    jobs.push({
      label: 'auto-tools',
      model: 'auto',
      messages: [
        { role: 'user', content: 'Weather in Paris? (probe case A)' },
        { role: 'assistant', content: 'Checking.', tool_calls: [{ id: 'call_probe_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] },
        { role: 'tool', tool_call_id: 'call_probe_1', content: '22C sunny' },
      ],
    })
    jobs.push({ label: 'auto-tool-required', model: 'auto', tools: [TOOL], tool_choice: 'required', messages: [{ role: 'user', content: 'Call the weather tool (probe case B)' }] })
    jobs.push({
      label: 'auto-image',
      model: 'auto',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'What colour is this pixel? (probe case C)' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } },
      ] }],
    })
    jobs.push({ label: 'auto-stream', model: 'auto', stream: true, messages: [{ role: 'user', content: 'Say hi. (probe case D)' }] })
    const filler = '示例句子。'.repeat(6000)
    jobs.push({ label: 'auto-longctx', model: 'auto', messages: [{ role: 'user', content: `${filler}\n\nSummarize in five words. (probe case E)` }] })
  }

  const started = Date.now()
  const rows = await runAll(jobs)
  summarize(`全部 ${rows.length} 笔（墙钟 ${Math.round((Date.now() - started) / 1000)}s）`, rows)
  if (!AUTO_ONLY && !MODELS_ONLY) {
    summarize('单模型', rows.filter(row => row.model !== 'auto'))
    summarize('auto', rows.filter(row => row.model === 'auto'))
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
