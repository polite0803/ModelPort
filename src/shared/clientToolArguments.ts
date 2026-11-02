/**
 * Codex `exec_command` 参数校正。
 *
 * 2026-11-03 实测：多个上游模型把 Windows 会话当成 Linux/PowerShell 混合体——
 * - `shell:"bash"` 里写 `Get-Location` / `Get-ChildItem`；
 * - `shell:"powershell"` 被 Codex 忽略，落到 cmd.exe，`git status --short; ...`
 *   被当成一个参数；
 * - `workdir:"/root"`（把系统提示里的“你是 /root”当成路径）→
 *   `CreateProcessWithLogonW failed: 267`；
 * - 非 escalated 调用也带 `justification` / `prefix_rule`，被 Codex 直接拒绝。
 *
 * 这些都不是上游 HTTP 失败，而是工具参数不可执行。网关在把工具调用交回客户端
 * 前做一次最小校正：能执行比让整轮空转重要。只处理 `exec_command`，不碰其它工具。
 */

const POWERSHELL_CMD = /\b(?:Get|Set|New|Remove|Start|Stop|Test|Select|Where|ForEach|Format|Out|Write|Join|Split|Sort|Measure|Invoke|Add|Clear|Copy|Move)-[A-Za-z]|\$env:/i
const UNIX_CMD = /(?:^|[;&|]\s*)(?:ls|pwd|cat|grep|rg|find|sed|awk|head|tail|mkdir|rm|cp|mv|chmod|chown|env|export|which|curl|wget)\b/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedShell(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const shell = value.trim()
  if (shell === '') return undefined
  const lower = shell.toLowerCase()
  if (lower === 'powershell' || lower === 'powershell.exe' || lower === 'ps' || lower === 'pwsh' || lower === 'pwsh.exe') {
    return 'pwsh'
  }
  return shell
}

/**
 * 只对 `exec_command` 生效；非对象/非 JSON 原样返回。
 * `platform` 传 `process.platform`；缺省按非 Windows 处理，不改 workdir。
 */
export function sanitizeClientToolArguments(
  name: string,
  rawArguments: string,
  platform?: string
): string {
  if (name !== 'exec_command') return rawArguments
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return rawArguments
  }
  if (!isRecord(parsed)) return rawArguments

  const args: Record<string, unknown> = { ...parsed }
  let changed = false
  const deleteKey = (key: string): void => {
    if (key in args) {
      delete args[key]
      changed = true
    }
  }

  const escalated = args.sandbox_permissions === 'require_escalated'
  if (!escalated) {
    deleteKey('justification')
    deleteKey('prefix_rule')
  }

  const cmd = typeof args.cmd === 'string' ? args.cmd : ''
  const shell = normalizedShell(args.shell)
  if (shell !== undefined && shell !== args.shell) {
    args.shell = shell
    changed = true
  }
  if (shell === 'bash' && POWERSHELL_CMD.test(cmd)) {
    args.shell = 'pwsh'
    changed = true
  } else if (shell === undefined && platform === 'win32') {
    if (POWERSHELL_CMD.test(cmd)) {
      args.shell = 'pwsh'
      changed = true
    } else if (UNIX_CMD.test(cmd)) {
      args.shell = 'bash'
      changed = true
    }
  }

  if (platform === 'win32' && typeof args.workdir === 'string') {
    const workdir = args.workdir.trim()
    // `/root`、`/workspace` 这类 POSIX 绝对路径在 Windows 上不存在；Git Bash 的
    // `/c/...`、`/d/...` 盘符路径保留。
    if (workdir.startsWith('/') && !/^\/[a-zA-Z](\/|$)/.test(workdir)) {
      deleteKey('workdir')
    }
  }

  return changed ? JSON.stringify(args) : rawArguments
}
