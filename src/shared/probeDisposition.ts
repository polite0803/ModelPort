/**
 * 探测的两道纯判定：**模态闸门**与**确定性失败的终局结论**。
 *
 * 存在的理由（2026-11-04 的运行实例证据）：当天 100 条错误请求行里 73 条是
 * `kind:'probe'`，且按 provider 100% 全失败 —— SiliconFlow 32/32（上游原话
 * `Model does not exist. Please check it carefully.`）、ModelScope 30/30（403 邮箱未验证）、
 * 讯飞星火 8/8（500 `AppIdNoAuthError`，而该 provider 当时 `enabled:false`）、
 * 阿里云百炼 2/2（400 产品未开通）。规划层每轮都重探这些条目，因为
 * `modelCatalogBatch::shouldProbeFact` 只看「这个字段还没测出来」，既不看这条目
 * 能不能被 chat 探测行使，也不看上一次上游已经给出的确定回答。
 *
 * 两条判定的边界：
 * - **只回答「当前能不能服务」，不回答「窗口多大」**。终局结论永不折成
 *   `contextTokens` / `maxOutputTokens`（见 `modelProbe.ts::probeRowToLayer`），
 *   也永不进入路由候选筛选与 `/v1/models` 的广告口径。
 * - **缺席即未知，未知就放行**。「没有能力声明 ≠ 非 chat」（AGENTS.md 的
 *   `undocumented 永不阻断`同一条精神），判据只认**已声明**字段，且只认
 *   `declared` 置信度（人工标记 / 上游声明）；第三方旁表、家族规则、推定值
 *   一律不足以阻断一次探测。
 *
 * 纯函数：不读 store、不发请求、不落盘，主进程与测试共用这一份。
 */
import type { InputModality } from './types.ts'

// ── 模态闸门 ────────────────────────────────────────────────────────────────

/** 一条目录条目相对「chat-completion 探测报文」的模态判定。 */
export type ProbeModalityVerdict = 'probeable' | 'non-chat'

/**
 * 判据输入。全部来自**已有声明**，且都是可选的：缺席表示「没人说过」。
 *
 * - `inputModalities` —— 现有点上唯一真实存在的字段（`ModelCapabilityHint.modalities`，
 *   由上游同步 / 人工标记写入）；
 * - `outputModalities` / `taskType` —— 判据形状先留好。**当前任何摄取链路都没有把
 *   这两个字段落库**：`modelListReaders.ts` 只取 `id` + `name`，`parseModelsDev` 只取
 *   `modalities.input`，models.dev 的 `type` 非 chat 条目在入库前就被整条丢弃
 *   （`modelsDev.ts::NON_CHAT_TYPE`）。所以这两条规则今天命中 0 个条目，
 *   等摄取链路补上字段后自动生效，不需要再改判据。
 */
export interface ProbeModalityFacts {
  inputModalities?: readonly InputModality[]
  outputModalities?: readonly string[]
  taskType?: string
}

/**
 * 非对话任务类型。口径来自两份既有摄取判据的并集，**不是新建的模型名单**：
 * - `src/shared/modelsDev.ts::NON_CHAT_TYPE`（models.dev 的 `type`）；
 * - `src/main/providers/modelCatalogParsers.ts::LITELLM_CHAT_MODES` 的反面（LiteLLM 的 `mode`）。
 * `tests/proxy/probe-modality-gate.test.ts` 钉住它与 models.dev 那份不许分叉。
 */
export const NON_CHAT_TASK_TYPES: readonly string[] = [
  // models.dev 的写法
  'embedding',
  'reranking',
  'transcription',
  'image',
  'video',
  'speech',
  // LiteLLM 的写法
  'rerank',
  'image_generation',
  'audio_transcription',
  'audio_speech',
  'audio_tts',
  'moderation',
  // Responses / realtime 一类的任务名
  'realtime',
  'realtime-audio',
] as const

/** 输出侧一旦落到这几个值，这条目就没有「文本回复」可探。 */
const NON_TEXT_OUTPUT_MODALITIES: readonly string[] = ['image', 'audio', 'video', 'speech', 'embedding']

function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * 这条目能不能被一次 chat-completion 探测行使。
 *
 * 三条阻断规则都要求**正向声明**，其余一律放行：
 * 1. 声明了输出模态、且不含 `text` —— 探测报文拿不到文本回复（图像生成 / TTS / 视频）；
 * 2. 声明了任务类型、且命中 {@link NON_CHAT_TASK_TYPES}（embedding / rerank / realtime-audio）；
 * 3. 声明了输入模态、且不含 `text` —— 探测只发一条纯文本 user 消息，
 *    这类条目根本无法被这条报文行使。
 */
export function classifyProbeModality(facts: ProbeModalityFacts): ProbeModalityVerdict {
  const outputs = facts.outputModalities?.map(normalizeToken).filter((value) => value !== '')
  if (outputs !== undefined && outputs.length > 0 && !outputs.includes('text')) {
    if (outputs.some((value) => NON_TEXT_OUTPUT_MODALITIES.includes(value))) return 'non-chat'
  }

  const taskType = normalizeToken(facts.taskType)
  if (taskType !== '' && NON_CHAT_TASK_TYPES.includes(taskType)) return 'non-chat'

  const inputs = facts.inputModalities?.map(normalizeToken).filter((value) => value !== '')
  if (inputs !== undefined && inputs.length > 0 && !inputs.includes('text')) return 'non-chat'

  return 'probeable'
}

// ── 终局结论 ────────────────────────────────────────────────────────────────

/**
 * 终局结论的类别。每一个都由上游**原话**点亮，而不是由状态码点亮：
 * 429 与 401 这类时序性回答永远不在这里。
 */
export type ProbeTerminalReason =
  /** 这家不把这个模型提供到对话端点上（SiliconFlow 20012「Model does not exist」）*/
  | 'model-not-supplied'
  /** 账号级：邮箱未验证 / 只放行已验证账号（ModelScope 403）*/
  | 'account-unverified'
  /** 凭据级授权缺失（讯飞星火 500 `AppIdNoAuthError` / 11200）*/
  | 'app-not-authorized'
  /** 该模型所属产品未开通（阿里云百炼 400「The product is not activated」）*/
  | 'product-not-activated'
  /** 余额/额度耗尽且需要充值才会变（402 类）*/
  | 'insufficient-balance'

/**
 * `model` = 只对这一条目成立；`account` = 上游说的是**账号状态**，
 * 同一 provider 的其它条目在这一轮也服务不了。
 *
 * 只有两条会升 `account`：邮箱未验证与余额不足 —— 它们的话术主语就是账号本身。
 * 其余即使带 403/400 也按 `model` 存：例如「产品未开通」只说了那个产品，
 * 把它折成全供应商会让同一家里真能服务的模型一起静音。
 */
export type ProbeTerminalScope = 'model' | 'account'

export interface ProbeTerminalVerdict {
  reason: ProbeTerminalReason
  scope: ProbeTerminalScope
  /** 上游原话（截断），只作证据展示，不参与判定。 */
  evidence: string
  /** 结论成立时刻。与探测读数的 `asOf` 分开：一个是判定，一个是测量。 */
  asOf: string
}

/** 终局结论的有效期：7 天。 */
export const PROBE_TERMINAL_TTL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
export const PROBE_TERMINAL_TTL_MS = PROBE_TERMINAL_TTL_DAYS * DAY_MS

/** 判定输入里能拿到的上游信息。 */
export interface ProbeFailureSignal {
  status?: number
  errorText?: string
  timedOut?: boolean
  localAdmissionRejected?: boolean
}

const EVIDENCE_MAX_CHARS = 240

function evidenceOf(text: string): string {
  const trimmed = (text ?? '').replace(/\s+/g, ' ').trim()
  return trimmed.length > EVIDENCE_MAX_CHARS ? `${trimmed.slice(0, EVIDENCE_MAX_CHARS)}…` : trimmed
}

function has(text: string, ...needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

/**
 * 这条失败是不是**确定性**的：同一请求在配置不变时会换回同一句话，
 * 因此重探一次不会带来新信息。
 *
 * 反过来，以下一律 `undefined`（= 不是终局，下一轮照探）：
 * - **429 / 任何「额度已重置就能用」的回答**，包括 BazaarLink 的
 *   `free_daily_limit` —— 它是每日自然重置的免费额度，终局化等于永久静音；
 * - 401（Key 换了就变）、408/超时/网络错误（没有回答）、5xx 的一般故障
 *   （上游恢复就没了，只有 `AppIdNoAuthError`/11200 这种带授权语义原文的例外）；
 * - 本地准入拒绝（并发名额，压根没发请求）。
 *
 * 状态码只作**必要条件**，真正点亮判定的是上游原文：`model does not exist` 这类
 * 话术在别的状态码下出现不算，反之 400 的参数错误也不算。
 */
export function classifyProbeTerminal(
  input: ProbeFailureSignal,
): Omit<ProbeTerminalVerdict, 'asOf'> | undefined {
  if (input.localAdmissionRejected === true) return undefined
  if (input.timedOut === true) return undefined
  const status = input.status
  if (status === undefined) return undefined
  // 时序性的两类永不终局：本地/上游限流与请求超时。
  if (status === 408 || status === 429 || status === 524) return undefined

  const rawText = (input.errorText ?? '').replace(/\s+/g, ' ').trim()
  const text = rawText.toLowerCase()

  // 402 的定义就是「要充值才会变」的账务回答，不需要原文也终局。
  if (status === 402) {
    return {
      reason: 'insufficient-balance',
      scope: 'account',
      evidence: evidenceOf(rawText) || `HTTP ${status}`,
    }
  }

  // 剩下的判定全靠**原话**点亮：状态码只缩小范围，裸 400/403 的一句话不算。
  if (text === '') return undefined

  // 「这个渠道不提供那个模型」：AGENTS.md 已经把 404 定成同一语义
  // （切换候选、但绝不进冷却），这里给的也只是条目级结论。
  if (
    (status === 400 || status === 404 || status === 422)
    && has(
      text,
      'model does not exist',
      'please check it carefully',
      'model not found',
      'model_not_found',
      'no such model',
      'the model you requested does not exist',
      'unknown model',
    )
  ) {
    return { reason: 'model-not-supplied', scope: 'model', evidence: evidenceOf(rawText) }
  }

  // 账号级：上游说的是这个账号本身。
  if (
    (status === 403 || status === 401)
    && has(text, 'email verification', 'verified account', 'complete your profile', 'verify your email')
  ) {
    return { reason: 'account-unverified', scope: 'account', evidence: evidenceOf(rawText) }
  }

  // 400/403 下的「余额不足」话术同样是账务状态：主语是账号，不是那个模型。
  if (
    (status === 403 || status === 400)
    && has(text, 'insufficient balance', '余额不足', 'insufficient credits', 'not enough balance')
  ) {
    return { reason: 'insufficient-balance', scope: 'account', evidence: evidenceOf(rawText) }
  }

  // 讯飞星火：500 但原文是授权缺失（`AppIdNoAuthError` / errorCode 11200），
  // 上游恢复不会改变它 —— 只有用户去控制台给这个 AppId 开权限才会变。
  if (has(text, 'appidnoautherror', 'appidnotauthorized', '11200')) {
    return { reason: 'app-not-authorized', scope: 'model', evidence: evidenceOf(rawText) }
  }

  if ((status === 400 || status === 403) && has(text, 'product is not activated', 'not activated, please confirm')) {
    return { reason: 'product-not-activated', scope: 'model', evidence: evidenceOf(rawText) }
  }

  return undefined
}

/** 终局结论是否仍在有效期内；时间不可解析按过期处理（与探测读数同一口径）。 */
export function probeTerminalFresh(asOf: string, nowMs: number = Date.now()): boolean {
  const stamp = Date.parse(asOf)
  if (!Number.isFinite(stamp)) return false
  return nowMs - stamp <= PROBE_TERMINAL_TTL_MS && nowMs - stamp >= 0
}

const TERMINAL_REASONS: readonly ProbeTerminalReason[] = [
  'model-not-supplied',
  'account-unverified',
  'app-not-authorized',
  'product-not-activated',
  'insufficient-balance',
]

/** 宽松校验落盘/回读的终局记录：形状不对就当作没有，绝不抛错。 */
export function sanitizeProbeTerminal(raw: unknown): ProbeTerminalVerdict | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const reason = record.reason
  if (typeof reason !== 'string' || !TERMINAL_REASONS.includes(reason as ProbeTerminalReason)) {
    return undefined
  }
  const asOf = typeof record.asOf === 'string' ? record.asOf : ''
  if (!Number.isFinite(Date.parse(asOf))) return undefined
  const scope: ProbeTerminalScope = record.scope === 'account' ? 'account' : 'model'
  const evidence = typeof record.evidence === 'string' ? evidenceOf(record.evidence) : ''
  return { reason: reason as ProbeTerminalReason, scope, evidence, asOf }
}

// ── 规划闸门 ────────────────────────────────────────────────────────────────

export type ProbeGateBlockReason = 'provider-disabled' | 'non-chat-modality' | 'terminal-model' | 'terminal-account'

export type ProbeGateDecision =
  | { probe: true }
  | { probe: false; reason: ProbeGateBlockReason; message: string }

export interface ProbeGateInput {
  /** provider 记录上的 `enabled`；`false` 即整家不探。缺席按启用放行（不误静音）。 */
  providerEnabled?: boolean
  modality?: ProbeModalityVerdict
  /** 这一条目自己行上的终局结论。 */
  terminal?: ProbeTerminalVerdict
  /** 同 provider 另一条目行上的**账号级**终局结论。 */
  accountTerminal?: ProbeTerminalVerdict
  /** 判定时刻；缺省用当前时间。 */
  nowMs?: number
}

/**
 * 规划层的唯一裁决入口：批量编排与单模型探测走同一份判定，
 * 保证「预演说发多少请求」就是执行时真正发的量。
 *
 * 顺序是有意的：provider 停用最便宜也最确定，先说；模态其次；终局最后
 * —— 前两条压根没发过请求，第三条是发过一次之后换来的结论。
 *
 * 终局的有效期在这里**自己再判一次**：传进来的行可能来自一个忘了过筛的调用方，
 * 而「一个 8 天前的结论继续拦着今天的探测」正是这批改动要消灭的东西 —— 宁可多探
 * 一次，也不许把过期结论当成新鲜的使用。
 */
export function decideProbeGate(input: ProbeGateInput): ProbeGateDecision {
  const nowMs = input.nowMs ?? Date.now()
  if (input.providerEnabled === false) {
    return {
      probe: false,
      reason: 'provider-disabled',
      message: '该供应商已停用，不发起探测',
    }
  }
  if (input.modality === 'non-chat') {
    return {
      probe: false,
      reason: 'non-chat-modality',
      message: '该条目声明的模态无法由 chat-completion 探测行使（图像 / TTS / 视频 / embedding / rerank / realtime）',
    }
  }
  const account = input.accountTerminal
  if (account !== undefined && account.scope === 'account' && probeTerminalFresh(account.asOf, nowMs)) {
    return {
      probe: false,
      reason: 'terminal-account',
      message: `账号级终局结论（${account.reason}）仍在有效期内：${account.evidence}`,
    }
  }
  const terminal = input.terminal
  if (terminal !== undefined && probeTerminalFresh(terminal.asOf, nowMs)) {
    return {
      probe: false,
      reason: 'terminal-model',
      message: `终局结论（${terminal.reason}）仍在有效期内：${terminal.evidence}`,
    }
  }
  return { probe: true }
}
