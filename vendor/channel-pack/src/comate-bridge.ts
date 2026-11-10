/**
 * 文心快码 agent 工具 → 客户端工具 的桥接层。
 *
 * 官方 Comate 客户端自己执行 agent 的 `run_command`/`read_file`/... 工具；
 * Codex / Claude Code 也有一套自己的工具。本模块只做**翻译**：
 * - 把 agent 的工具调用映射成客户端已有的工具名与参数；
 * - 把客户端返回的 tool result 翻译成 agent 的 `toolUseResults`。
 *
 * ⚠️ 本模块**不执行任何文件/命令操作**。工具在客户端工作区运行，沿用客户端
 * 的权限确认与沙箱；网关不获得 shell 权限。
 *
 * 映射策略：
 * - 有同名/近义工具时直接映射（Claude Code 的 Read/Write/Edit/Grep/Glob/Bash）。
 * - 没有直接工具但有 shell 时，退化为 shell 命令（Codex 只有 `shell`，也能用）。
 * - 两者都没有时返回“工具不可用”，让 agent 换一种做法，而不是整轮失败。
 */
import type { HarnessMessageLike } from './message-shape.js'

export interface ClientToolDefinition {
  name: string
  description?: string
  parameters?: unknown
}

export interface MappedComateTool {
  /** 客户端工具名；`mapped:false` 时为空。 */
  name: string
  /** 客户端工具参数 JSON；`mapped:false` 时为空串。 */
  arguments: string
  mapped: boolean
  /** 不需要客户端执行、直接给 agent 成功结果（todo_write 等）。 */
  noop: boolean
  /** 无法映射时回给 agent 的原因。 */
  failure?: string
}

export interface PendingToolCall {
  /** agent 的工具调用 id（同时作为客户端 tool_call id）。 */
  agentId: string
  agentName: string
  agentInput: Record<string, unknown>
  clientId: string
  clientName: string
  clientArgs: string
  mapped: boolean
  noop: boolean
  failure?: string
}

export interface ClientToolResult {
  toolCallId: string
  text: string
  isError: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 合并 agent 的 `*_PARAMS_APPEND` 增量字符串分片。 */
export function mergeToolInput(
  target: Record<string, unknown>,
  fragment: Record<string, unknown>,
  replaceOnMismatch = false,
): void {
  for (const [key, value] of Object.entries(fragment)) {
    if (typeof value === 'string') {
      if (value.length === 0) continue
      const previous = typeof target[key] === 'string' ? target[key] as string : ''
      // 增量分片：不以已累积值为前缀时拼接；`apply_patch` 的 MERGE 帧
      // 发送的是新的完整值，此时必须替换而不是拼接。
      target[key] = value.startsWith(previous) || replaceOnMismatch ? value : previous + value
      continue
    }
    if (value !== undefined) target[key] = value
  }
}

function textOf(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function numberOf(input: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return undefined
}

function boolOf(input: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = input[key]
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
  }
  return undefined
}

function propertiesOf(tool: ClientToolDefinition | undefined): Record<string, unknown> | undefined {
  if (tool === undefined || !isRecord(tool.parameters)) return undefined
  const properties = tool.parameters.properties
  return isRecord(properties) ? properties : undefined
}

function pickField(tool: ClientToolDefinition | undefined, candidates: readonly string[], fallback: string): string {
  const properties = propertiesOf(tool)
  if (properties !== undefined) {
    for (const candidate of candidates) {
      if (candidate in properties) return candidate
    }
  }
  return fallback
}

function filterArgs(tool: ClientToolDefinition | undefined, args: Record<string, unknown>): Record<string, unknown> {
  const properties = propertiesOf(tool)
  if (properties === undefined) return args
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (key in properties) filtered[key] = value
  }
  return filtered
}

function findTool(
  tools: readonly ClientToolDefinition[],
  candidates: readonly string[],
): ClientToolDefinition | undefined {
  for (const candidate of candidates) {
    const exact = tools.find(tool => tool.name === candidate)
    if (exact !== undefined) return exact
  }
  const lowered = candidates.map(candidate => candidate.toLowerCase())
  return tools.find(tool => lowered.includes(tool.name.toLowerCase()))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function shellCommand(tool: ClientToolDefinition | undefined, command: string): MappedComateTool | undefined {
  if (tool === undefined) return undefined
  const properties = propertiesOf(tool)
  // Cline/Roo 的 execute_command 用 requires_approval 告诉客户端「这条要人工确认」；
  // 网关生成的是 agent 的命令，默认要求确认，避免客户端静默执行。
  const args = filterArgs(tool, {
    command,
    ...properties?.requires_approval !== undefined ? { requires_approval: true } : {},
  })
  return { name: tool.name, arguments: JSON.stringify(args), mapped: true, noop: false }
}

function direct(
  tool: ClientToolDefinition | undefined,
  args: Record<string, unknown>,
): MappedComateTool | undefined {
  if (tool === undefined) return undefined
  return { name: tool.name, arguments: JSON.stringify(filterArgs(tool, args)), mapped: true, noop: false }
}

function unavailable(agentName: string, reason: string): MappedComateTool {
  return {
    name: '',
    arguments: '',
    mapped: false,
    noop: false,
    failure: `tool "${agentName}" is not available in the connected client: ${reason}. Use run_command/shell or another available tool.`,
  }
}

/**
 * 把一次 agent 工具调用映射成客户端工具调用。
 *
 * `tools` 来自 `GenerateOptions.tools`，即客户端本轮真正提供的工具定义；
 * 映射必须基于它，不能硬编码某个客户端的工具名。
 */
export function mapComateToolCall(
  agentName: string,
  input: Record<string, unknown>,
  tools: readonly ClientToolDefinition[],
): MappedComateTool {
  const shell = findTool(tools, ['Bash', 'bash', 'shell', 'run_command', 'exec', 'terminal', 'execute_command'])
  const read = findTool(tools, ['Read', 'read_file', 'read'])
  const write = findTool(tools, ['Write', 'write_file', 'write', 'write_to_file'])
  const edit = findTool(tools, ['Edit', 'edit_file', 'edit', 'replace_in_file'])
  const grep = findTool(tools, ['Grep', 'grep', 'search', 'search_files'])
  const glob = findTool(tools, ['Glob', 'glob'])
  const list = findTool(tools, ['LS', 'List', 'list_dir', 'ls', 'list_files'])
  const remove = findTool(tools, ['Delete', 'delete_file', 'delete'])
  const webFetch = findTool(tools, ['WebFetch', 'web_fetch', 'fetch'])
  const webSearch = findTool(tools, ['WebSearch', 'web_search', 'search'])

  switch (agentName) {
    case 'run_command': {
      const command = textOf(input, 'command')
      return command !== undefined && shell !== undefined
        ? shellCommand(shell, command) ?? unavailable(agentName, 'shell tool unavailable')
        : unavailable(agentName, 'no shell/Bash tool was provided')
    }
    case 'read_file': {
      const path = textOf(input, 'file_path', 'target_file', 'path')
      if (path === undefined) return unavailable(agentName, 'file_path is missing')
      if (read !== undefined) {
        const pathField = pickField(read, ['file_path', 'path', 'target_file'], 'file_path')
        const properties = propertiesOf(read)
        const offset = numberOf(input, 'offset')
        const limit = numberOf(input, 'limit')
        // Cline/Roo 的 read_file 用 start_line/end_line；Claude 的 Read 用 offset/limit。
        if (properties?.start_line !== undefined || properties?.end_line !== undefined) {
          return direct(read, {
            [pathField]: path,
            ...offset !== undefined ? { start_line: offset } : {},
            ...offset !== undefined && limit !== undefined ? { end_line: offset + limit - 1 } : {},
          }) ?? unavailable(agentName, 'read tool unavailable')
        }
        return direct(read, {
          [pathField]: path,
          ...offset !== undefined ? { offset } : {},
          ...limit !== undefined ? { limit } : {},
        }) ?? unavailable(agentName, 'read tool unavailable')
      }
      if (shell !== undefined) {
        const offset = numberOf(input, 'offset')
        const limit = numberOf(input, 'limit')
        const command = offset !== undefined || limit !== undefined
          ? `sed -n '${offset ?? 1},${offset !== undefined && limit !== undefined ? offset + limit - 1 : '$'}p' -- ${shellQuote(path)}`
          : `cat -- ${shellQuote(path)}`
        return shellCommand(shell, command) ?? unavailable(agentName, 'shell tool unavailable')
      }
      return unavailable(agentName, 'no Read or shell tool was provided')
    }
    case 'write_file': {
      const path = textOf(input, 'file_path', 'path', 'target_file')
      const content = typeof input.content === 'string' ? input.content : undefined
      if (path === undefined || content === undefined) return unavailable(agentName, 'file_path/content is missing')
      if (write !== undefined) {
        const pathField = pickField(write, ['file_path', 'path', 'target_file'], 'file_path')
        return direct(write, { [pathField]: path, content }) ?? unavailable(agentName, 'write tool unavailable')
      }
      if (shell !== undefined) {
        const command = `mkdir -p -- $(dirname -- ${shellQuote(path)}) && printf %s ${shellQuote(base64(content))} | base64 -d > ${shellQuote(path)}`
        return shellCommand(shell, command) ?? unavailable(agentName, 'shell tool unavailable')
      }
      return unavailable(agentName, 'no Write or shell tool was provided')
    }
    case 'edit_file': {
      const path = textOf(input, 'file_path', 'target_path', 'path')
      const oldString = typeof input.old_string === 'string' ? input.old_string : undefined
      const newString = typeof input.new_string === 'string' ? input.new_string : undefined
      if (path === undefined || oldString === undefined || newString === undefined) {
        return unavailable(agentName, 'file_path/old_string/new_string is missing')
      }
      if (edit === undefined) {
        return unavailable(agentName, 'no Edit tool was provided; use apply_patch or run_command')
      }
      const pathField = pickField(edit, ['file_path', 'path', 'target_path'], 'file_path')
      const properties = propertiesOf(edit)
      // Cline/Roo 的 replace_in_file 吃的是 SEARCH/REPLACE diff，不是 old/new 字符串。
      if (edit.name === 'replace_in_file' || properties?.diff !== undefined) {
        const diff = `------- SEARCH\n${oldString}\n=======\n${newString}\n+++++++ REPLACE`
        return direct(edit, { [pathField]: path, diff }) ?? unavailable(agentName, 'edit tool unavailable')
      }
      return direct(edit, {
        [pathField]: path,
        old_string: oldString,
        new_string: newString,
        ...boolOf(input, 'replace_all') !== undefined ? { replace_all: boolOf(input, 'replace_all') } : {},
      }) ?? unavailable(agentName, 'edit tool unavailable')
    }
    case 'delete_file': {
      const path = textOf(input, 'file_path', 'target_file', 'path')
      if (path === undefined) return unavailable(agentName, 'file_path is missing')
      if (remove !== undefined) {
        const pathField = pickField(remove, ['file_path', 'path', 'target_file'], 'file_path')
        return direct(remove, { [pathField]: path }) ?? unavailable(agentName, 'delete tool unavailable')
      }
      return shell !== undefined
        ? shellCommand(shell, `rm -- ${shellQuote(path)}`) ?? unavailable(agentName, 'shell tool unavailable')
        : unavailable(agentName, 'no Delete or shell tool was provided')
    }
    case 'apply_patch': {
      const patch = textOf(input, 'input', 'patch')
      if (patch === undefined) return unavailable(agentName, 'patch input is missing')
      // Codex 的 apply_patch 是 freeform 工具，参数不是 JSON；用 shell 执行
      // 统一补丁命令，避免把结构化 JSON 塞进自由文本工具。
      if (shell === undefined) return unavailable(agentName, 'no shell/Bash tool was provided for apply_patch')
      const encoded = base64(patch)
      const command = `printf %s ${shellQuote(encoded)} | base64 -d > ./.modelport-comate.patch && `
        + `{ git apply --whitespace=nowarn ./.modelport-comate.patch || patch -p1 -i ./.modelport-comate.patch; }; `
        + 'rc=$?; rm -f ./.modelport-comate.patch; exit $rc'
      return shellCommand(shell, command) ?? unavailable(agentName, 'shell tool unavailable')
    }
    case 'grep_content': {
      const pattern = textOf(input, 'pattern')
      if (pattern === undefined) return unavailable(agentName, 'pattern is missing')
      if (grep !== undefined) {
        const properties = propertiesOf(grep)
        const path = textOf(input, 'path') ?? '.'
        const glob = textOf(input, 'glob')
        const args: Record<string, unknown> = {}
        // Cline/Roo 的 search_files 用 regex + file_pattern；其余客户端用 pattern/glob。
        if (properties?.regex !== undefined) args.regex = pattern
        else args.pattern = pattern
        if (properties?.path !== undefined) args.path = path
        if (glob !== undefined) {
          if (properties?.file_pattern !== undefined) args.file_pattern = glob
          else if (properties?.glob !== undefined) args.glob = glob
        }
        const ignoreCase = boolOf(input, '-i')
        if (ignoreCase !== undefined) args['-i'] = ignoreCase
        for (const flag of ['-A', '-B', '-C', 'head_limit'] as const) {
          const value = numberOf(input, flag)
          if (value !== undefined && properties?.[flag] !== undefined) args[flag] = value
        }
        return direct(grep, args) ?? unavailable(agentName, 'grep tool unavailable')
      }
      if (shell !== undefined) {
        const path = textOf(input, 'path') ?? '.'
        const ignoreCase = boolOf(input, '-i') === true ? '-i ' : ''
        const include = textOf(input, 'glob')
        const command = `grep -R -n -E ${ignoreCase}${include !== undefined ? `--include=${shellQuote(include)} ` : ''}${shellQuote(pattern)} ${shellQuote(path)}`
        return shellCommand(shell, command) ?? unavailable(agentName, 'shell tool unavailable')
      }
      return unavailable(agentName, 'no Grep or shell tool was provided')
    }
    case 'glob_path': {
      const pattern = textOf(input, 'pattern')
      if (pattern === undefined) return unavailable(agentName, 'pattern is missing')
      const directory = textOf(input, 'target_directory', 'path') ?? '.'
      if (glob !== undefined) {
        const pathField = pickField(glob, ['path', 'target_directory'], 'path')
        return direct(glob, { pattern, [pathField]: directory }) ?? unavailable(agentName, 'glob tool unavailable')
      }
      if (shell !== undefined) {
        const command = pattern.includes('/')
          ? `find ${shellQuote(directory)} -type f -path ${shellQuote(pattern)}`
          : `find ${shellQuote(directory)} -type f -name ${shellQuote(pattern)}`
        return shellCommand(shell, command) ?? unavailable(agentName, 'shell tool unavailable')
      }
      return unavailable(agentName, 'no Glob or shell tool was provided')
    }
    case 'list_dir': {
      const directory = textOf(input, 'target_directory', 'path') ?? '.'
      if (list !== undefined) {
        const pathField = pickField(list, ['path', 'target_directory'], 'path')
        const properties = propertiesOf(list)
        const depth = numberOf(input, 'depth') ?? 2
        return direct(list, {
          [pathField]: directory,
          ...properties?.recursive !== undefined ? { recursive: depth > 1 } : {},
        }) ?? unavailable(agentName, 'list tool unavailable')
      }
      return shell !== undefined
        ? shellCommand(shell, `ls -la -- ${shellQuote(directory)}`) ?? unavailable(agentName, 'shell tool unavailable')
        : unavailable(agentName, 'no LS or shell tool was provided')
    }
    case 'web_fetch': {
      const url = textOf(input, 'url')
      if (url === undefined) return unavailable(agentName, 'url is missing')
      if (webFetch !== undefined) {
        return direct(webFetch, {
          url,
          ...textOf(input, 'prompt') !== undefined ? { prompt: textOf(input, 'prompt') } : {},
        }) ?? unavailable(agentName, 'web fetch tool unavailable')
      }
      return unavailable(agentName, 'no WebFetch tool was provided')
    }
    case 'web_search': {
      const query = textOf(input, 'query')
      if (query === undefined) return unavailable(agentName, 'query is missing')
      if (webSearch !== undefined) {
        return direct(webSearch, { query }) ?? unavailable(agentName, 'web search tool unavailable')
      }
      return unavailable(agentName, 'no WebSearch tool was provided')
    }
    case 'todo_write':
    case 'send_user_message':
      return { name: '', arguments: '', mapped: false, noop: true }
    default:
      return unavailable(agentName, 'unknown agent tool')
  }
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'tool-result') parts.push(flattenContent(block.content))
  }
  return parts.join('\n')
}

/** 从客户端下一轮消息里提取 tool-result（兼容 0.1.7 的 role:'tool' 形态）。 */
export function extractClientToolResults(messages: readonly HarnessMessageLike[]): ClientToolResult[] {
  const results: ClientToolResult[] = []
  for (const message of messages) {
    const content = message.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool-result') continue
      const toolCallId = typeof block.toolCallId === 'string'
        ? block.toolCallId
        : typeof message.toolCallId === 'string' ? message.toolCallId : ''
      if (toolCallId.length === 0) continue
      results.push({
        toolCallId,
        text: flattenContent(block.content),
        isError: block.isError === true,
      })
    }
  }
  return results
}

/** 把客户端结果与未映射/no-op 的工具合并成 agent 的 toolUseResults。 */
export function buildToolUseResults(
  pending: readonly PendingToolCall[],
  results: readonly ClientToolResult[],
): Array<{ id: string; name: string; success: boolean; params: Record<string, unknown>; message: string }> {
  const byId = new Map(results.map(result => [result.toolCallId, result]))
  return pending.map(call => {
    if (call.noop) {
      return { id: call.agentId, name: call.agentName, success: true, params: call.agentInput, message: 'ok' }
    }
    if (!call.mapped) {
      return {
        id: call.agentId,
        name: call.agentName,
        success: false,
        params: call.agentInput,
        message: call.failure ?? 'tool is not available in the connected client',
      }
    }
    const result = byId.get(call.clientId)
    if (result === undefined) {
      return {
        id: call.agentId,
        name: call.agentName,
        success: false,
        params: call.agentInput,
        message: 'the client did not return a result for this tool call',
      }
    }
    return {
      id: call.agentId,
      name: call.agentName,
      success: !result.isError,
      params: call.agentInput,
      message: result.text,
    }
  })
}
