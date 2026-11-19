import type { AutoModelTier, WriteToolTier } from '../../shared/types.ts'
import { DEFAULT_WRITE_TOOL_TIER } from '../../shared/types.ts'
import { applyMinTier, type PoolStrategyCandidate } from './autoRouting.ts'
import type { ChatCompletionRequest } from './types.ts'

/**
 * 写入型请求的档位托底。
 *
 * 网关判不了「这个任务难不难」——那是语义。但「这条请求会不会落盘」是结构事实：
 * 工具名就那十几个。写坏的代价（半个补丁、改错文件）远大于慢一点，所以判据取结构。
 *
 * 名字表只做**精确小写匹配**，不做前缀模糊：`mcp__fs__write` 这类自定义工具认不出来，
 * 按普通请求处理。宁可漏抬，不可把只读请求也拖去贵模型 —— 误抬是成本，误判是
 * 「路由突然变慢还不说为什么」。
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Codex（Responses 自由文本工具，入向会翻成同名 function）
  'apply_patch',
  // Claude Code / Claude Desktop
  'write',
  'edit',
  'multiedit',
  'notebookedit',
  // Anthropic 通用 editor 系列
  'str_replace_editor',
  'str_replace_based_edit_tool',
  // Copilot / Qoder 一类
  'create_file',
  'write_file',
  'edit_file',
  'insert_edit_into_file',
  'replace_string_in_file',
  // 删除也是写：删错文件同样是不可逆产物
  'delete_file',
  'delete_path',
])

function isWriteToolName(raw: unknown): boolean {
  return typeof raw === 'string' && WRITE_TOOL_NAMES.has(raw.trim().toLowerCase())
}

/**
 * 请求里是否已有写入类工具。
 *
 * 两处都看：`tools` 是这一轮声明的（Claude Code 每轮都带），历史的 `tool_calls`
 * 是上一轮真的调过的。只看 `tools` 会漏掉「这一轮精简了工具列表、但正在续写上一轮
 * 补丁」的回合。
 */
export function requestUsesWriteTools(request: ChatCompletionRequest | undefined): boolean {
  if (request === undefined) return false

  for (const tool of request.tools ?? []) {
    if (isWriteToolName(tool?.function?.name)) return true
  }

  for (const message of request.messages ?? []) {
    const calls = (message as unknown as { tool_calls?: unknown }).tool_calls
    if (!Array.isArray(calls)) continue
    for (const call of calls) {
      const fn = (call as { function?: { name?: unknown } } | null)?.function
      if (isWriteToolName(fn?.name)) return true
    }
  }

  return false
}

/**
 * 这一轮应该施加的档位下限。`undefined` = 不施加（非写入请求，或用户关了）。
 */
export function requestWriteToolFloor(
  configured: WriteToolTier | undefined,
  request: ChatCompletionRequest | undefined,
): AutoModelTier | undefined {
  const tier = configured ?? DEFAULT_WRITE_TOOL_TIER
  if (tier === 'off') return undefined
  return requestUsesWriteTools(request) ? tier : undefined
}

export interface RequestTierFloorOutcome<T extends PoolStrategyCandidate> {
  inputs: T[]
  /** 抬档把整组筛空、已回落到抬档前的池：调用方必须把这件事写成降级 */
  relaxed: boolean
}

/**
 * 抬高下限；抬空了就回落。
 *
 * 回落不是「偷偷降回去」：调用方把 `relaxed` 写进 `degraded`，响应头
 * `X-ModelPort-Auto-Degraded` 会带 `write_tool_tier`。宁可这一轮用低档模型并说出来，
 * 也不能因为「这轮是写入」把一条本来可用的路由打成 503。
 */
export function applyRequestTierFloor<T extends PoolStrategyCandidate>(
  candidates: readonly T[],
  floor: AutoModelTier | undefined,
): RequestTierFloorOutcome<T> {
  if (floor === undefined) return { inputs: [...candidates], relaxed: false }
  const kept = applyMinTier(candidates, floor)
  if (kept.length > 0) return { inputs: kept, relaxed: false }
  if (candidates.length === 0) return { inputs: [], relaxed: false }
  return { inputs: [...candidates], relaxed: true }
}