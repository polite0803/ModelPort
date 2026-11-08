/**
 * WorkBuddy（国内版）成长中心 —— 完成任务领取积分。
 *
 * 端点与字段来自 2026-11-08 对官方用户中心网页 bundle 的取证 + 真实凭据实测
 * （`docs/plan/PLAN-workbuddy-growth-tasks.md` §4）：
 *
 *   清单  GET  /v2/activity/growth/tasks
 *   领取  POST /activity/growth/tasks/{task_code}/claim
 *   接单  POST /activity/growth/tasks/accept   body { task_codes:[…] }   ← 本模块不调用
 *
 * ## 与每日签到（`buddy-credits.ts`）是两套能力
 *
 * 签到是**每天一次**的固定动作；成长任务是一批**各自有状态机**的一次性奖励，
 * 服务端下发 `accept_status`：`not_accepted → accepted → in_progress → completed → claimed`。
 * 本模块**只领 `completed`**：完成与否由服务端按 `progress{current,target}` 判定
 * （实测 `not_accepted` 项的 `progress` 直接是 `null`），客户端不猜、不伪造。
 *
 * 这也决定了**不实现 accept**：`accept` 只把状态从 `not_accepted` 推到 `in_progress`，
 * 不做对应行为就永远到不了 `completed`，无人值守下等于批量制造假进度。
 *
 * ## ⚠️ 奖励是**两个量纲**，不得相加成一个数
 *
 * 实测每项同时下发 `reward_credit`（积分，样本恒 100）与 `reward_energy`（能量，样本恒 5），
 * 另有布尔 `reward_buddy`（限定款盲盒）。`credits.ts` 的 `normalizeCreditUnit` 只分
 * `token` / `credit` 两域，**能量是第三域**，不与之互相折算 —— 汇成 `+105` 那种数字
 * 既不可核对也无从还原。求和只允许发生在**同一个域内部**。
 *
 * ## ⚠️ 领取响应体字段**未取证**，故分值取自清单声明值
 *
 * 实测只覆盖了只读端点（发写请求要单独授权）。`code:0` 信封约定与签到同源、可以复用；
 * 但 `data` 里到底有没有金额、字段叫什么，没有证据。因此 `claimed` 的 `credit`/`energy`
 * 一律取**刚才那份清单里该项的声明值**（同一服务端、同一次调用内自洽），
 * 不去猜响应体的键名。
 *
 * 同理，**幂等码未取证**：`buddy-credits.ts` 的 `10001` 是签到端点实测出来的，
 * 不能当成成长任务的「已领过」。非 0 一律按 `failed` 回报并带上服务端原文，
 * 宁可让用户看到「服务器说：今天已领过」这句话，也不替它翻译成成功或替它翻译成失败分类。
 */

import type { BuddyCredential } from './buddy.js'
import type { BuddyProduct } from './product.js'
import type { RpcOnboardingTaskItem } from './types.js'

/** 成长任务清单端点（服务端权威状态源）。 */
export const GROWTH_TASKS_PATH = '/v2/activity/growth/tasks'
/** 领取端点前缀，完整路径是 `${前缀}${task_code}/claim`。 */
export const GROWTH_TASK_CLAIM_PREFIX = '/activity/growth/tasks/'

/** 服务端下发的任务状态。未知取值按「不可领」处理，不当成失败。 */
export type BuddyGrowthStatus =
  | 'not_accepted'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'claimed'

/** 一条成长任务（字段名已转为 camelCase，奖励两域分列）。 */
export interface BuddyGrowthTask {
  /** 服务端主键，claim 路径用它（实测如 `playbook_prompt`、`RichMeow_Chat`）。 */
  code: string
  /** 展示名（实测如「探索优秀灵感」）。 */
  title: string
  /** 怎么做（`task_desc`，比 `description` 短且稳定；实测可能为空串）。 */
  description: string
  status: string
  /** 完成进度；未接单的项服务端下发 `null` ⇒ 这里省略而不是补 0。 */
  progress?: { current: number; target: number }
  /** 奖励积分（`reward_credit`）。 */
  rewardCredit: number
  /** 奖励能量（`reward_energy`）——**独立量纲**，见文件头。 */
  rewardEnergy: number
  /** 该项是否给限定款 Buddy（盲盒），非数值奖励。 */
  rewardBuddy: boolean
  /** 服务端标记的锁（未到解锁条件 / 未到时间）。 */
  locked: boolean
  /** 是否「今天这一轮可以点领取」—— 判据只有服务端状态一项。 */
  claimable: boolean
}

/** 一次领取的结果。 */
export type BuddyGrowthClaimOutcome =
  | {
      kind: 'claimed'
      /** 本次新增的积分。 */
      credit: number
      /** 本次新增的能量（与 `credit` **不可相加**）。 */
      energy: number
      task: BuddyGrowthTask
    }
  | { kind: 'not-claimable'; task: BuddyGrowthTask }
  | { kind: 'failed'; code: number; message: string; upstreamRequestId?: string }

/** 请求超时（毫秒）。清单要渲进界面，取比签到更短的 15s。 */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 构造成长中心请求头。
 *
 * ⚠️ **与 `buddy-credits.ts::checkinHeaders` 有意不同**：这里镜像官方**网页**用户中心
 * 实际发出的那组头 —— `X-Client-Platform: web` + `Accept-Language: zh-CN` + Bearer，
 * **不发** `X-Domain` / `X-Product` / `X-Product-Code` / `X-User-Id`。
 * 实测（PLAN §4）这组最小头在三个 host 上都返回 `code:0`，加上归属头与否没有观测差别；
 * 签到那条路走的是 CLI/IDE 形态，两处的客户端形态本来就不同，合成一份反而造出一个
 * 官方网页从不发送的头组合。
 */
function growthHeaders(credential: BuddyCredential): Record<string, string> {
  return {
    Authorization: `Bearer ${credential.access_token}`,
    Accept: 'application/json',
    'X-Client-Platform': 'web',
    'Accept-Language': 'zh-CN',
  }
}

type GetResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; message: string }

/**
 * 发一次只读 GET 并解析信封。
 *
 * ⚠️ 不用 `response.json()`：凭据失效时腾讯网关回 HTML 错误页，`json()` 抛出的
 * `Unexpected token '<'` 对用户毫无意义（这条在 `buddy-credits.ts:334-339` 记过）。
 */
async function getJson(
  path: string,
  credential: BuddyCredential,
  product: BuddyProduct,
  fetcher: typeof fetch,
): Promise<GetResult> {
  try {
    const response = await fetcher(`${product.endpoint}${path}`, {
      method: 'GET',
      headers: growthHeaders(credential),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // 401/403 基本就是凭据失效；其余状态如实给出，不做过度推断。
      if (response.status === 401 || response.status === 403) {
        return { ok: false, status: response.status, message: `凭据已失效（HTTP ${response.status}），请重新登录该账号` }
      }
      return {
        ok: false,
        status: response.status,
        message: `服务端返回了非 JSON 响应（HTTP ${response.status}）：${text.trim().slice(0, 80).replace(/\s+/g, ' ')}`,
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, status: response.status, message: '响应无法解析为对象' }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, status: -1, message: error instanceof Error ? error.message : String(error) }
  }
}

/** 安全读字符串（缺失 / 非字符串一律空串，不抛错）。 */
function str(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

/** 安全读数字（缺失 / 非有限值按 0 —— 奖励额度的「服务端没给」就是「0 分」）。 */
function num(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 安全读布尔。 */
function bool(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true
}

/**
 * 解析一条任务。
 *
 * ⚠️ `progress` 在服务端未接单时是 `null`，这里**省略字段**而不是补 `{0,0}`：
 * 补零会让界面把「还没开始」渲染成「0/0 已完成」，正是本仓库反复出过的
 * 「缺席伪装成正常结果」。
 */
function parseTask(entry: Record<string, unknown>): BuddyGrowthTask | null {
  const code = str(entry, 'task_code')
  if (code.length === 0) return null
  const rawProgress = entry.progress
  const status = str(entry, 'accept_status')
  const progress = (typeof rawProgress === 'object' && rawProgress !== null && !Array.isArray(rawProgress))
    ? rawProgress as Record<string, unknown>
    : undefined
  return {
    code,
    // 实测 `description` 常为空串、`task_desc` 才是那句「怎么做」，故取后者为准，
    // 前者兜底（两条键都来自同一响应，不存在哪个更可信的取舍，只是覆盖度差别）。
    title: str(entry, 'title'),
    description: str(entry, 'task_desc') || str(entry, 'description'),
    status,
    ...(progress === undefined
      ? {}
      : { progress: { current: num(progress, 'current'), target: num(progress, 'target') } }),
    rewardCredit: num(entry, 'reward_credit'),
    rewardEnergy: num(entry, 'reward_energy'),
    rewardBuddy: bool(entry, 'reward_buddy'),
    locked: bool(entry, 'locked'),
    // 判据只认服务端状态字符串；`has_reward`/`claimed_button_text` 都是展示层字段，
    // 拿它们当判据会因为文案变化而失效。
    claimable: status === 'completed',
  }
}

/**
 * 读取成长任务清单。
 *
 * 返回 `null` 表示「拿不到」（网络 / 凭据 / 信封非 0）——调用方必须把
 * 「查不到」与「一个任务都没有」分开呈现，不要把故障显示成「无可领」。
 */
export async function fetchGrowthTasks(
  credential: BuddyCredential,
  product: BuddyProduct,
  fetcher: typeof fetch = fetch,
): Promise<BuddyGrowthTask[] | null> {
  const result = await getJson(GROWTH_TASKS_PATH, credential, product, fetcher)
  if (!result.ok) return null
  const body = result.body
  if (body.code !== 0) return null
  const data = body.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const rawTasks = (data as Record<string, unknown>).tasks
  if (!Array.isArray(rawTasks)) return null
  const tasks: BuddyGrowthTask[] = []
  for (const item of rawTasks) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const parsed = parseTask(item as Record<string, unknown>)
    if (parsed !== null) tasks.push(parsed)
  }
  return tasks
}

/**
 * 领取一条已完成的任务。
 *
 * ⚠️ 调用方**必须**先确认 `task.claimable`（即服务端 `accept_status === 'completed'`）。
 * 这里再判一次是防线，不是重试逻辑：状态在两次调用之间被别的客户端改掉时，
 * 返回 `not-claimable` 而不是把一个必然失败的请求打出去。
 *
 * ⚠️ `code:0` 时的分值取清单声明值，不读 `data`（理由见文件头）。
 */
export async function claimGrowthTask(
  credential: BuddyCredential,
  product: BuddyProduct,
  task: BuddyGrowthTask,
  fetcher: typeof fetch = fetch,
): Promise<BuddyGrowthClaimOutcome> {
  if (!task.claimable) {
    return { kind: 'not-claimable', task }
  }
  const path = `${GROWTH_TASK_CLAIM_PREFIX}${encodeURIComponent(task.code)}/claim`
  let response: Response
  try {
    response = await fetcher(`${product.endpoint}${path}`, {
      method: 'POST',
      headers: { ...growthHeaders(credential), 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { kind: 'failed', code: -1, message: error instanceof Error ? error.message : String(error) }
  }
  let text = ''
  try {
    text = await response.text()
  } catch {
    text = ''
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const message = response.status === 401 || response.status === 403
      ? `凭据已失效（HTTP ${response.status}），请重新登录该账号`
      : `服务端返回了非 JSON 响应（HTTP ${response.status}）：${text.trim().slice(0, 80).replace(/\s+/g, ' ')}`
    return { kind: 'failed', code: response.status, message }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'failed', code: response.status, message: '领取响应无法解析为对象' }
  }
  const body = parsed as Record<string, unknown>
  const code = typeof body.code === 'number' ? body.code : -1
  const message = str(body, 'msg') || str(body, 'message')
  const requestId = str(body, 'requestId')
  if (code !== 0) {
    // 非 0 全部如实报失败：幂等码未取证，不做任何「其实已经领过」的推断。
    return {
      kind: 'failed',
      code,
      message: message.length > 0 ? message : `领取失败（code ${code}）`,
      ...(requestId.length > 0 ? { upstreamRequestId: requestId } : {}),
    }
  }
  return { kind: 'claimed', credit: task.rewardCredit, energy: task.rewardEnergy, task }
}

/** 按量纲分组的奖励合计（**两个域各自求和，永不互相折算**）。 */
export interface BuddyGrowthTotals {
  credit: number
  energy: number
}

/** 对清单求两个域的合计（界面「这批一共可得多少」用它，不用于结果文案相加）。 */
export function sumGrowthRewards(tasks: readonly BuddyGrowthTask[]): BuddyGrowthTotals {
  return tasks.reduce<BuddyGrowthTotals>(
    (acc, task) => ({ credit: acc.credit + task.rewardCredit, energy: acc.energy + task.rewardEnergy }),
    { credit: 0, energy: 0 },
  )
}

/**
 * 把一次批量领取的两域所得拼成文案：`+100积分, +5能量`。
 *
 * ⚠️ 不复用 `credits.ts::formatClaimGains`：那个函数的域是 `token` / `credit`
 * 且顺序固定 token 在前，能量不在其定义域内；把能量塞进去会让「分组键与展示名同源」
 * 那条口径失效（`normalizeCreditUnit` 的说明记过这个坑）。
 *
 * ⚠️ 每个域各带一个 `+`，只列非零域，全零返回 `null` 让调用方整段不渲染。
 */
export function formatGrowthGains(totals: Partial<BuddyGrowthTotals> | undefined): string | null {
  if (typeof totals !== 'object' || totals === null) return null
  const parts: string[] = []
  for (const [key, label] of [['credit', '积分'], ['energy', '能量']] as const) {
    const value = Number(totals[key])
    if (!Number.isFinite(value) || value <= 0) continue
    parts.push(`+${Number.isInteger(value) ? String(value) : value.toFixed(2)}${label}`)
  }
  return parts.length === 0 ? null : parts.join(', ')
}

/**
 * 一个账号的批量领取（**串行**，只发服务端认可为可领的项）。
 *
 * ⚠️ 串行不是性能取舍：与 `collectClaimResults` 同一口径 —— 并发打同一账号的
 * 认证接口正是上游判「非官方客户端」时看的那个形状。
 *
 * 返回的计数分三档，因为**给用户的话完全不同**：
 * - `claimed`：这次真领到的；
 * - `alreadyClaimed`：清单里已是 `claimed` 的（没发请求，钱早就到账）；
 * - `notClaimable`：`not_accepted` / `accepted` / `in_progress` —— 「还没做完」，
 *   这一档必须单独存在，否则它会被读成「按钮坏了」或更糟的「领到了 0 分」。
 */
export interface BuddyGrowthClaimRun {
  claimed: { task: BuddyGrowthTask; credit: number; energy: number }[]
  failures: { task: BuddyGrowthTask; message: string }[]
  alreadyClaimed: number
  notClaimable: number
  /** 本次新增所得（两域分列）。 */
  gained: BuddyGrowthTotals
}

export async function claimAllGrowthTasks(
  credential: BuddyCredential,
  product: BuddyProduct,
  fetcher: typeof fetch = fetch,
): Promise<BuddyGrowthClaimRun | null> {
  const tasks = await fetchGrowthTasks(credential, product, fetcher)
  // `null` = 清单读不到（凭据失效 / 网络 / 信封非 0）。返回 null 让调用方把
  // 「这个账号问不出结果」如实报出来，不能当成「一个任务都没有」。
  if (tasks === null) return null
  const run: BuddyGrowthClaimRun = {
    claimed: [],
    failures: [],
    alreadyClaimed: 0,
    notClaimable: 0,
    gained: { credit: 0, energy: 0 },
  }
  for (const task of tasks) {
    if (task.status === 'claimed') {
      run.alreadyClaimed += 1
      continue
    }
    if (!task.claimable) {
      run.notClaimable += 1
      continue
    }
    const outcome = await claimGrowthTask(credential, product, task, fetcher)
    if (outcome.kind === 'claimed') {
      run.claimed.push({ task, credit: outcome.credit, energy: outcome.energy })
      run.gained.credit += outcome.credit
      run.gained.energy += outcome.energy
    } else if (outcome.kind === 'not-claimable') {
      // 取清单与领取之间被别人改动过：算「还没做完」，不算失败。
      run.notClaimable += 1
    } else {
      run.failures.push({ task, message: `${outcome.message}（code ${outcome.code}）` })
    }
  }
  return run
}

/**
 * 转成 RPC 明细（`onboarding.status` 的 `items`）。
 *
 * 放在本模块而不是 RPC 文件里：映射规则（状态原值直传、`progress` 缺席不补 0）
 * 是成长中心特有的，混进那台三千行的分发器就找不到它了。
 */
export function growthTaskItem(task: BuddyGrowthTask): RpcOnboardingTaskItem {
  return {
    key: task.code,
    title: task.title,
    description: task.description,
    status: task.status,
    claimable: task.claimable,
    ...(task.progress === undefined ? {} : { progress: { ...task.progress } }),
    rewardCredit: task.rewardCredit,
    rewardEnergy: task.rewardEnergy,
    rewardBuddy: task.rewardBuddy,
    locked: task.locked,
  }
}
