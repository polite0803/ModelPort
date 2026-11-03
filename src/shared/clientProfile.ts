/**
 * 按 `User-Agent` 识别调用方客户端。
 *
 * 目的只有一个：**排障与分流**。同一个 `auto` 路由下，不同 IDE 客户端
 * （Trae / WorkBuddy / Qoder / dsh …）发来的请求在工具数量、流式分片容忍度、
 * 是否回传 `reasoning_content` 上差别很大，出问题时第一件事就是知道
 * 「这是谁发来的」。识别结果只写进请求日志与响应头，不参与任何路由决策，
 * 也不读请求体内容。
 *
 * 匹配是启发式的：UA 可被任意客户端伪造/省略，所以未知一律落到 `other`
 * 并保留原始产品名，而不是猜一个具体客户端。
 */

export type ClientId =
  | 'trae'
  | 'workbuddy'
  | 'qoder'
  | 'dsh'
  | 'opencode'
  | 'codex'
  | 'cline'
  | 'cursor'
  | 'continue'
  | 'openai-python'
  | 'openai-node'
  | 'curl'
  | 'other'

export interface ClientIdentity {
  id: ClientId
  /** 供日志/界面展示的可读名；`other` 时是 UA 里的原始产品名 */
  label: string
  /** UA 里能解析到的第一个版本号，没有就省略 */
  version?: string
}

interface ClientRule {
  id: ClientId
  label: string
  pattern: RegExp
}

/**
 * 规则顺序即优先级。`workbuddy` 必须排在通用的 buddy/AI 规则前，
 * `dsh` 用词边界避免命中 `dashboard` 之类的子串。
 */
const CLIENT_RULES: readonly ClientRule[] = [
  { id: 'workbuddy', label: 'WorkBuddy / CodeBuddy', pattern: /workbuddy|codebuddy/i },
  { id: 'trae', label: 'Trae', pattern: /\btrae\b|trae[-_/]/i },
  { id: 'qoder', label: 'Qoder', pattern: /\bqoder\b|qoder[-_/]/i },
  { id: 'dsh', label: 'DSH', pattern: /\bdsh\b|dsh[-_/]|deepseek[-_]ai\/dsh|deepseek[-_]harness/i },
  { id: 'opencode', label: 'OpenCode', pattern: /opencode/i },
  // Codex 的 UA 尾巴是 `codex_cli_rs/<版本> (<平台>; …)`；`_` 在正则里算单词字符，
  // 所以光靠 `\bcodex\b` 命中不了它，得再给一条 `codex[-_/]`。
  { id: 'codex', label: 'Codex', pattern: /\bcodex\b|codex[-_/]/i },
  { id: 'cline', label: 'Cline', pattern: /\bcline\b/i },
  { id: 'cursor', label: 'Cursor', pattern: /\bcursor\b/i },
  { id: 'continue', label: 'Continue', pattern: /\bcontinue\b/i },
  { id: 'openai-python', label: 'OpenAI Python', pattern: /openai[-_/]?python|python[-_/]?openai/i },
  { id: 'openai-node', label: 'OpenAI Node', pattern: /openai[-_/]?node|openai\/node/i },
  { id: 'curl', label: 'curl', pattern: /\bcurl\b/i },
]

const VERSION_PATTERN = /\d+\.\d+(?:[.\-]\d+)?/
/** UA 里常见的控制字符；响应头只接受可见字符 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * 把 UA 归类。传入 undefined/空串返回 `other` + `unknown`：
 * 这不是错误，很多 SDK 根本不发 UA。
 */
export function identifyClientByUserAgent(userAgent: string | string[] | undefined | null): ClientIdentity {
  const raw = Array.isArray(userAgent) ? userAgent[0] : userAgent
  const ua = typeof raw === 'string' ? raw.trim() : ''
  if (!ua) return { id: 'other', label: 'unknown' }

  const versionMatch = VERSION_PATTERN.exec(ua)
  const version = versionMatch?.[0]

  for (const rule of CLIENT_RULES) {
    if (!rule.pattern.test(ua)) continue
    return {
      id: rule.id,
      label: rule.label,
      ...(version === undefined ? {} : { version }),
    }
  }

  const product = normalizeProductName(ua)
  return {
    id: 'other',
    label: product,
    ...(version === undefined ? {} : { version }),
  }
}

/**
 * 响应头 `X-ModelPort-Client` 的值：`<id>[/<version>]`。
 *
 * 只放稳定 id 与版本，不放可读 label —— header 是要给人看「哪一类客户端」，
 * 中文/空格交给 `toHeaderValue` 反而变成百分号编码，不如直接给 slug。
 */
export function clientHeaderValue(identity: ClientIdentity): string {
  return identity.version === undefined
    ? identity.id
    : `${identity.id}/${identity.version}`
}

/** UA 的第一个产品名：`Trae/1.0 (Windows)` → `Trae`；`python-requests/2.31` → `python-requests` */
function normalizeProductName(ua: string): string {
  const head = ua.split(/[;(]/)[0]?.trim() ?? ''
  const product = head.split('/')[0]?.trim() ?? ''
  const cleaned = product.replace(CONTROL_CHARS, '').slice(0, 40)
  return cleaned.length > 0 ? cleaned : 'unknown'
}
