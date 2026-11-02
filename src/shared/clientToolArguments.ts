/**
 * Codex `exec_command` 参数校正。
 *
 * 2026-11-03 实测（一轮 280 次 `exec_command`，161 次失败，全部是工具参数不可执行，
 * 不是上游 HTTP 失败）：
 * - `shell:"bash"` 在 Windows 客户端**不被 Codex 认**，直接落到 cmd.exe：
 *   `Get-ChildItem|Select-Object` 60 次、`git status; git log` 这类 `;` 串联 39 次、
 *   `rg --files -g 'AGENTS.md'` 这类单引号 20 次、其余 PowerShell 语法 42 次，四种
 *   全军；只有 `git status --short --branch` 这种单个外部程序才碰巧能跑（25 次）。
 *   同会话里 `shell:"powershell"`（86 次）与 `shell:"pwsh"`（5 次）全部 exit 0。
 * - `shell:"PowerShell"`（大写）同样落到 cmd.exe —— 匹配是大小写敏感的。
 * - `workdir:"/root"`（模型把系统提示里的「你是 /root」当成路径）→
 *   `CreateProcessWithLogonW failed: 267`。
 * - 非 escalated 调用也带 `justification` / `prefix_rule`，被 Codex 直接拒绝。
 *
 * 所以 Windows 客户端上，只要 `shell` 不是 PowerShell 那一族就改成 `pwsh`：PowerShell 7
 * 同时吃 `;`、`&&`、单引号和 cmdlet，实测在这台机器上可用（改成 `powershell` 会让
 * `&&` 那两条回退成失败）。反过来，**绝不主动填 `bash`**：填了等于把能跑的默认
 * shell 换成 cmd.exe。
 *
 * 只处理 `exec_command`，不碰其它工具；工具执行在客户端那台机器上，网关只能按参数
 * 里的线索（`workdir` 是盘符路径就一定是 Windows 客户端）加网关自身平台判断。
 */

const POWERSHELL_SHELLS = new Set(['powershell', 'powershell.exe', 'ps', 'pwsh', 'pwsh.exe'])
const WINDOWS_WORKDIR = /^[a-z]:[\\/]|^\\\\/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedShell(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const shell = value.trim()
  if (shell === '') return undefined
  return POWERSHELL_SHELLS.has(shell.toLowerCase()) ? 'pwsh' : shell
}

/**
 * 只对 `exec_command` 生效；非对象/非 JSON 原样返回。
 * `platform` 传 `process.platform`，是「客户端平台」的近似；`workdir` 里出现盘符
 * 路径时按客户端确定是 Windows 处理。
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

  const shell = normalizedShell(args.shell)
  if (shell !== undefined && shell !== args.shell) {
    args.shell = shell
    changed = true
  }

  const workdir = typeof args.workdir === 'string' ? args.workdir.trim() : ''
  const windowsClient = platform === 'win32' || WINDOWS_WORKDIR.test(workdir)
  if (windowsClient && shell !== undefined && shell !== 'pwsh') {
    args.shell = 'pwsh'
    changed = true
  }

  if (platform === 'win32' && workdir.startsWith('/') && !/^\/[a-zA-Z](\/|$)/.test(workdir)) {
    // `/root`、`/workspace` 这类 POSIX 绝对路径在 Windows 上不存在；Git Bash 的
    // `/c/...`、`/d/...` 盘符路径保留。
    deleteKey('workdir')
  }

  return changed ? JSON.stringify(args) : rawArguments
}
