/**
 * 工具名的出站规范化。
 *
 * 真实缺陷（2026-11-20 实测）：工具名带点号或斜杠（`filesystem.read_file`、
 * `shell/run`）时，WorkBuddy 直接整条 400：
 * `工具名称不规范，请新建任务重试 the tool name is invalid or duplicated`。
 * `sanitizeChatToolDefinitions` 只删空名条目，对这种名字原样透传 —— 一个坏名字
 * 会连累整条请求里所有工具，模型那一轮什么也调用不了，于是自己发明调用语法。
 *
 * 处置是**确定性改名**而不是丢弃：名字里的非法字符换成 `_`，并把「安全名 → 原名」
 * 带给响应侧（见 `restoreToolCallName`），客户端拿回的仍是它自己声明的名字，
 * 因此不需要客户端配合。
 *
 * 不改名的情形：名字本来就合法（`[A-Za-z0-9_-]` 且首字符非数字，长度 ≤ 64）。
 * 这套规则与主流 OpenAI 兼容上游一致；改名只发生在会 400 的名字上。
 */

/**
 * OpenAI 兼容上游接受的工具名字符集：`^[a-zA-Z0-9_-]{1,64}$`。
 *
 * 依据（2026-11-20 核对）：OpenAI Chat Completions 的校验就是这条正则，超过 64
 * 字符报 `string too long`；DeepSeek 字符集相同、上限放宽到 128；MCP 规范本身
 * 允许点号。所以点号/斜杠这类名字在 MCP 客户端里合法，但一到 OpenAI 兼容上游就
 * 整条 400 —— 那正是需要改名的部分。首字符不做额外限制（OpenAI 实际也收数字
 * 开头），避免无谓改名。
 */
const SAFE_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/

export interface ToolNameRename {
  /** 发给上游的名字。 */
  sent: string
  /** 客户端声明的原名。 */
  original: string
}

export interface ToolNamePlan {
  /** 改名后的定义（原对象不动，返回新数组）。 */
  tools: unknown[]
  /** 仅包含真被改过的条目；空数组表示全部合法。 */
  renames: ToolNameRename[]
}

function replaceUnsafe(name: string): string {
  const replaced = name.replace(/[^A-Za-z0-9_-]/g, '_')
  // 全非法字符（例如纯中文名）会得到一串下划线，那仍是个可用名字；
  // 长度按 64 截断，与 OpenAI 的上限一致。
  return replaced.slice(0, 64) === '' ? '_' : replaced.slice(0, 64)
}

/**
 * 给一批工具定义做名字规范化。
 *
 * - 只处理 `type:'function'` 且名字非空的条目（其余由 `sanitizeChatToolDefinitions` 处理）；
 * - 冲突兜底：几个原名映射到同一个安全名时，依次加 `_2`、`_3`，保证一对一；
 * - 返回新数组，不修改入参。
 */
export function planToolNameRenames(tools: unknown): ToolNamePlan {
  if (!Array.isArray(tools)) return { tools: [], renames: [] }
  const renames: ToolNameRename[] = []
  const used = new Set<string>()
  // 先占位所有合法名，避免改名结果与合法名撞车。
  for (const tool of tools) {
    const record = tool as { type?: unknown; function?: { name?: unknown } } | null
    const name = record?.function?.name
    if (typeof name === 'string' && SAFE_TOOL_NAME.test(name)) used.add(name)
  }

  const mapped = tools.map((tool) => {
    const record = tool as { type?: unknown; function?: { name?: unknown } } | null
    if (record === null || typeof record !== 'object') return tool
    if (record.type !== 'function') return tool
    const name = record.function?.name
    if (typeof name !== 'string' || name.trim() === '') return tool
    if (SAFE_TOOL_NAME.test(name)) return tool

    const base = replaceUnsafe(name)
    let candidate = base
    for (let suffix = 2; used.has(candidate); suffix += 1) {
      const tail = `_${suffix}`
      candidate = `${base.slice(0, 64 - tail.length)}${tail}`
    }
    used.add(candidate)
    renames.push({ sent: candidate, original: name })
    return { ...record, function: { ...record.function, name: candidate } }
  })
  return { tools: mapped, renames }
}

/**
 * 把上游回来的调用名还原成客户端声明的原名。
 *
 * 只认精确命中：模型偶尔会自己造名字，那些名字不在表里，必须原样透传，
 * 由既有的「未声明工具名」审计去报。
 */
export function restoreToolCallName(name: string, renames: readonly ToolNameRename[]): string {
  for (const rename of renames) {
    if (rename.sent === name) return rename.original
  }
  return name
}

/** 序列化成响应头用的紧凑形式：`sent=original,sent2=original2`。 */
export function renamesHeaderValue(renames: readonly ToolNameRename[]): string {
  return renames.map(rename => `${rename.sent}=${rename.original}`).join(',')
}