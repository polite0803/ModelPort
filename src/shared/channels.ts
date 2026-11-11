/**
 * Account-channel types shared between main and renderer.
 *
 * A channel is an account pool backed by a third-party coding assistant
 * (browser login, device code, SMS): one provider record per channel, many
 * accounts inside it. The transport, login flows, credit claims and model
 * catalogues all live in `vendor/channel-pack`; this file only describes what
 * crosses the IPC boundary.
 */

/** How the user proves ownership of a channel account. */
export type ChannelLoginKind = 'browser' | 'device-code' | 'sms' | 'oauth' | 'api-key'

/**
 * 添加账号的交互形态。
 *
 * - `redirect`：宿主让渠道包生成登录地址，在系统浏览器里完成，界面轮询 `login.poll`；
 * - `credential`：不跳浏览器，界面自己收 key / 加匿名槽，直接调渠道包那两个方法。
 */
export type ChannelAddFlow = 'redirect' | 'credential'

export function channelAddFlowOf(kind: ChannelLoginKind): ChannelAddFlow {
  return kind === 'api-key' ? 'credential' : 'redirect'
}

/** Static description of one channel; shipped as data, never mutated. */
export interface ChannelDefinition {
  /** Pack provider id (also the provider record id and model namespace). */
  id: string
  name: string
  /** Company behind the assistant, shown under the name. */
  vendor: string
  loginKind: ChannelLoginKind
  /**
   * 表单型登录（`api-key`）的加账号方法名 —— 渠道包 RPC。
   *
   * 跳转型渠道统一走 `account.create`，方法名不随渠道变化；表单型没有统一入口
   * （`account.create` 对它没有分支），所以方法名必须由目录声明，界面只照着调。
   */
  credentialAdd?: { withKey: string; anonymous?: string }
  /**
   * 该渠道上游**是否有每日签到（领取积分）接口**。
   *
   * 必填，不是可选：可选字段会被新渠道按「不写 = 有」填进去，于是界面照常渲染
   * 「领取积分」按钮，点下去拿到渠道包 `credits.claimAll` 的兜底文案
   * `unsupported provider: <id>`（用户报障 2026-11-02，opencode）。
   * 判据只有一条：**渠道包的 `credits.claimAll` 有没有这家自己的分支**。
   */
  dailyCheckin: boolean
  /**
   * 该渠道上游**是否有「完成任务领积分」接口**（成长中心 / 新手任务一类的逐项奖励）。
   *
   * 与 {@link dailyCheckin} 同样**必填**，理由也是那条先例（用户报障 2026-11-02 opencode）：
   * 可选字段会被新渠道按「不写 = 有」填进去，于是界面照常渲染按钮，点下去只拿到
   * 渠道包 `onboarding.claimAll` 的兜底文案。判据同样只有一条：
   * **渠道包的 `onboarding.claimAll` 有没有这家自己的分支**。
   *
   * ⚠️ 与 `dailyCheckin` 语义独立：签到是每天一次的固定动作，任务奖励是每项一次性、
   * 且要服务端先认定「做完了」。两个按钮点出去的是两套请求。
   */
  growthTasks: boolean
  /** One-line description of what the account unlocks. */
  description: string
  /**
   * 该渠道上游对 `tools` 数量的硬上限；不设表示未知/不限制。
   *
   * 已知边界（用户报障 2026-10-30）：cline 上游走 Vercel AI Gateway，硬限
   * `tools ≤ 128`，超限请求 400（且以 HTTP 200 的 SSE 流内错误帧浮现，换家
   * 循环拦不到）。auto 选候选时按此跳过装不下的渠道，请求根本不发出去。
   */
  maxTools?: number
  /**
   * 渠道能力位（PLAN P1-4）。缺省字段 = 不限（fail-open）。
   * - `tools: false`：渠道不支持原生工具调用，带工具的请求整个渠道跳过；
   *   不带工具的请求照常路由（能力位只挡它描述的能力）。
   * 盘点结论（2026-10-30）：12 个渠道适配器都原生支持工具调用，暂时没有
   * 渠道需要标 false；将来实测发现某渠道不支持时，只改这里的目录数据。
   */
  capabilities?: {
    tools?: boolean
  }
  /**
   * The client identity this channel presents upstream, and how likely that is
   * to be read as "non-official usage".
   *
   * This is **disclosure, not configuration**: nothing in the app is allowed to
   * align these values to the vendor's current client. The point is to let the
   * user see what is being sent (`declared`, verbatim from the adapter) before
   * deciding to keep using the channel. Absent for key-based providers.
   */
  upstreamIdentity?: {
    /** What the adapter actually sends, copied from its constants. */
    declared: string
    /**
     * `high`: the vendor has stopped accounts on this line, or the identity is
     *         a frozen copy of a first-party client behind several releases.
     * `medium`: a partial/derived identity (some headers, signature clones).
     * `low`: official SDK shape or no client identity at all.
     */
    risk: 'high' | 'medium' | 'low'
  }
}

/** One account inside a channel, as the pack reports it. */
export interface ChannelAccountView {
  id: string
  nickname: string
  enabled: boolean
  createdAt?: number
  /** Epoch ms; undefined when the channel does not report expiry. */
  expiresAt?: number
  refreshable: boolean
  /**
   * Upstream stopped serving this account and said so; the pack parked it
   * (`enabled: false`) in the same write. `text` is the upstream wording, kept
   * verbatim so the row can say which of the three kinds of grey it is.
   */
  serviceStopped?: { at: number; text: string }
}

/** Per-channel state rendered on one card. */
export interface ChannelView {
  id: string
  name: string
  vendor: string
  loginKind: ChannelLoginKind
  credentialAdd?: { withKey: string; anonymous?: string }
  /** 来自 {@link ChannelDefinition.dailyCheckin} —— 界面按它决定渲染不渲染「领取积分」。 */
  dailyCheckin: boolean
  /** 来自 {@link ChannelDefinition.growthTasks} —— 决定渲染不渲染「领取任务积分」。 */
  growthTasks: boolean
  description: string
  /** A provider record exists, so its models are routable. */
  configured: boolean
  /** The provider record is enabled (models listed and routable). */
  enabled: boolean
  /** Disclosure of the upstream client identity; see {@link ChannelDefinition}. */
  upstreamIdentity?: { declared: string; risk: 'high' | 'medium' | 'low' }
  accounts: {
    total: number
    enabled: number
    list: ChannelAccountView[]
  }
  models: {
    /** Models the channel advertises, disabled ones included. */
    total: number
    /** Models switched off by the user. */
    disabled: number
    /** 已知的目录来源；`undefined` = 本轮还没拉过目录。 */
    source?: ChannelModelSource
  }
}

/**
 * One channel's live client identity (B4): the values the wire headers will
 * actually carry on the next request.
 *
 * 来源标记与 `vendor/channel-pack/src/client-identity.ts` 的取值链一一对应：
 * `env`（用户钉子）优先级最高，`official` 是官方接口 6h 刷新值，
 * `local-install` 是官网不可达时读本机安装的兜底，`fallback` 是最后的代码常量
 * —— 两个动态源都失效时才会看到它，值得在 UI 上提醒。
 */
export interface ChannelIdentityEntry {
  /** Channel id: `workbuddy` / `buddy` / `qoder` / `qodercn` / `trae`. */
  channel: string
  /** Version the request headers will carry right now. */
  version: string
  source: 'env' | 'official' | 'local-install' | 'fallback'
  /** When this value was read (epoch ms). */
  checkedAt: number
  /** Human-readable extras (e.g. Trae's version code and VS Code baseline). */
  detail?: string
}

/** Response of the `identity.snapshot` channel RPC. */
export interface ChannelIdentitySnapshot {
  entries: ChannelIdentityEntry[]
  /** Whole-call failure (worker down, rpc rejected); entries stay empty then. */
  error?: string
}

/** Credits for one channel; `null` means "the channel has no balance endpoint". */
export interface ChannelCredits {  /**
   * Sum of **enabled** accounts' usable balance; undefined when no account answered.
   *
   * 停用账号的余额不出现在这里（它们的读数仍在 `accounts` 明细行里）——
   * 否则启停一个账号渠道总额不会变化，用户看不出积分的加或减。
   *
   * ⚠️ 口径：**只累计积分账号**。token 计量的账号（`unit: 'token'`）单列在明细行，
   * 与积分相加会得到无意义的数，见 `mixedUnits`。
   */
  remaining?: number
  /** `remaining` 的口径；缺省 `'credit'`（表头写「剩余积分」）。只在整渠道都是 token 计量时给出。 */
  remainingUnit?: 'token' | 'credit'
  /** Accounts that answered with a usable balance. */
  reported: number
  /** The channel does not expose a balance endpoint at all. */
  unsupported?: boolean
  /**
   * 渠道没有数字余额、但能给出额度状态时的读数（目前用于 Comate）。
   *
   * - `limited`：当前套餐额度受限，服务端会回退到 `note` 里的 Auto 模型；
   * - `available`：额度可用，但上游不提供剩余数字；
   * - `unknown`：状态不可判定（接口失败/账号未登录）。
   *
   * ⚠️ 与 `remaining` 互斥：有数字余额时不要设置 status。
   */
  status?: 'limited' | 'available' | 'unknown'
  /** 额度状态的说明文本（上游文案优先），用于面板 tooltip。 */
  note?: string
  /** Whole-call failure (network, credentials); per-account causes live on the rows. */
  error?: string
  /**
   * 本渠道同时存在**积分与 token 两种计量口径**（2026-11-11 华为云码道）。
   *
   * 为 `true` 时 `remaining` 只含积分账号，token 账号的读数在 `accounts` 明细行里
   * 各自带单位显示 —— 两个口径的数量级差三个数量级，相加得到的数没有任何含义，
   * 但把它们收敛成同一个数又正是用户最容易误读的地方，故界面必须显式说明。
   */
  mixedUnits?: boolean
  accounts: Array<{
    accountId: string
    nickname: string
    /** `false` when the account is parked; its reading is shown but not summed into `remaining`. */
    enabled?: boolean
    remaining?: number
    /** `remaining` 的口径；缺省 `'credit'`。`'token'` 的行不参与渠道总额相加。 */
    unit?: 'token' | 'credit'
    /** 无数字余额时的额度状态（目前用于 Comate 的免费额度）。 */
    status?: 'limited' | 'available' | 'unknown'
    /** 状态说明（上游文案 / 最近一次请求结果），用于明细行与 tooltip。 */
    note?: string
    /** 最近一次能证明该状态的 Auto 请求时刻（毫秒）；`unknown` 时可能缺失。 */
    lastAt?: number
    /** Why this account returned nothing (upstream wording first, e.g. "未登录"). */
    error?: string
  }>
}

/** `credits.balances` 返回的账号行（worker 版本不同，字段都可能缺，故全部可选）。 */
export interface CreditsBalanceRow {
  accountId?: string
  nickname?: string
  enabled?: boolean
  balance?: { total?: number; unit?: string } | null
  status?: unknown
  note?: unknown
  lastAt?: unknown
  error?: unknown
}

/** 渠道级附带读数（Comate 这类没有数字余额、只有额度状态的渠道）。 */
export interface CreditsChannelState {
  status?: unknown
  note?: unknown
}

const quotaStatusOf = (value: unknown): 'limited' | 'available' | 'unknown' | undefined =>
  value === 'limited' || value === 'available' || value === 'unknown' ? value : undefined

/**
 * 把 `credits.balances` 的账号行折成面板用的 {@link ChannelCredits}。
 *
 * 三条判据各自对应一次真实缺陷，改动时必须保持：
 * 1. **只有启用账号进总额**（2026-10-30：启停一个号渠道总额纹丝不动）；
 * 2. **积分与 token 分桶**（2026-11-11 华为云码道：老计费账号只回 token 配额，
 *    与积分相加会得到「4428.19 + 4545965」这种没有含义的数，而表头写着「剩余积分」）；
 * 3. **逐账号读数与失败原因并存**（2026-11-01：只给渠道总额时，一个号查询失败
 *    表现为「总额凭空少一截」，用户不知道少了谁、为什么少）。
 */
export function summarizeChannelCredits(
  rows: readonly CreditsBalanceRow[],
  channel?: CreditsChannelState,
): ChannelCredits {
  let creditTotal = 0
  let tokenTotal = 0
  let creditCount = 0
  let tokenCount = 0
  let reported = 0
  const accounts = rows.map(row => {
    const remaining = typeof row.balance?.total === 'number' ? row.balance.total : undefined
    const unit: 'token' | 'credit' = row.balance?.unit === 'token' ? 'token' : 'credit'
    if (remaining !== undefined) {
      reported += 1
      if (row.enabled !== false) {
        if (unit === 'token') {
          tokenTotal += remaining
          tokenCount += 1
        } else {
          creditTotal += remaining
          creditCount += 1
        }
      }
    }
    const status = quotaStatusOf(row.status)
    return {
      accountId: String(row.accountId ?? ''),
      nickname: String(row.nickname ?? row.accountId ?? ''),
      enabled: row.enabled !== false,
      remaining,
      ...remaining !== undefined ? { unit } : {},
      ...status !== undefined ? { status } : {},
      ...typeof row.note === 'string' && row.note.length > 0 ? { note: row.note } : {},
      ...typeof row.lastAt === 'number' && Number.isFinite(row.lastAt) ? { lastAt: row.lastAt } : {},
      error: typeof row.error === 'string' ? row.error : undefined,
    }
  })
  const status = quotaStatusOf(channel?.status)
  // 表头写的是「剩余积分」，故积分桶优先；整渠道只有 token 时改报 token 并带单位，
  // 两桶都有时另一桶只出现在明细行里（`mixedUnits` 让界面把这件事说明白）。
  const tokenOnly = creditCount === 0 && tokenCount > 0
  return {
    reported,
    accounts,
    ...(creditCount > 0 || tokenCount > 0
      ? { remaining: Math.round((creditCount > 0 ? creditTotal : tokenTotal) * 100) / 100 }
      : {}),
    ...tokenOnly ? { remainingUnit: 'token' as const } : {},
    ...creditCount > 0 && tokenCount > 0 ? { mixedUnits: true } : {},
    ...status !== undefined ? { status } : {},
    ...typeof channel?.note === 'string' && channel.note.length > 0 ? { note: channel.note } : {},
  }
}

/** RPC envelope returned by the pack. `ok:false` carries a human-readable cause. */
export type ChannelRpcResult =
  | { ok: true; value?: unknown }
  | { ok: false; error?: { code?: string; message?: string } }

export interface ChannelOperationResult {
  success: boolean
  /** Machine-readable cause when `success` is false. */
  reason?: string
  detail?: string
}

/**
 * 全局「每日自动领取签到积分」开关的状态。
 *
 * 开关**不分渠道**：打开后渠道包会为所有有账号的渠道各领一次，且每个 UTC+8
 * 自然日只跑一次（`lastDate` 就是「今天跑过了」的凭据）。渠道包启动后 30 秒
 * 也会自己排一轮，所以这里读到的可能是别人（后台任务）刚跑出来的结果。
 */
export interface ChannelAutoCheckin {
  enabled: boolean
  /** 上次**完成**自动领取的 UTC+8 日期（`YYYY-MM-DD`）；空串 = 从未跑过。 */
  lastDate: string
  /** 今天的轮次是否已全部完成（仍有渠道待重试时为 false）。 */
  ranToday: boolean
  /** 这一轮正在执行（刚打开开关会立刻跑一轮）。 */
  running: boolean
  /** 上次结果摘要（渠道包给的中文短句）。 */
  lastResult: string
  /** 上次跑完的时刻（毫秒）；0 = 从未跑过。 */
  lastAt: number
  /** 今天仍未处理完的渠道数（0 = 今天的轮次已完成）。失败 / 渠道刷新的重试会补。 */
  pending: number
  /** 今天仍未处理完的渠道 id（逐渠道文本见 `channels`）。 */
  pendingProviders: string[]
  /** 下一次自动重试的时刻（毫秒）；0 = 没有排定。 */
  nextRetryAt: number
  /** 逐渠道结果（渠道包给的短文本，顺序即遍历顺序）。 */
  channels: Array<{ provider: string; text: string }>
  dismissed: boolean
}

export interface ChannelAutoCheckinResult {
  success: boolean
  state?: ChannelAutoCheckin
  reason?: string
}

/**
 * 渠道内一个模型的**在线**目录条目。
 *
 * 积分权重（倍率）在各渠道的展示名里，没有独立字段（`provider/model` 之外
 * 上游只把倍率拼进 `name`，形如 `MiniMax M3 · x4.0`、`Kimi-K3 · x0.2→x0.1`、
 * `Qwen3.8-Flash · 免费`），故这里解析后拆出来：`name` 是去掉标记的展示名，
 * `weight` 是生效倍率，`baseWeight` 只在有促销时存在。
 *
 * ⚠️ `weight` 缺失 = **不知道**，不是 0 —— 没有倍率信息的渠道（如 trae）不该
 * 被当成免费。只有 `free === true` 才是免费模型。
 */
export interface ChannelModelInfo {
  /** 裸模型 id（不含 `<channel>/` 前缀）。 */
  id: string
  /** 去掉「· xN / · 免费」标记的展示名。 */
  name: string
  /** 生效积分权重（倍率）；缺失表示上游没报。 */
  weight?: number
  /** 原价倍率（有促销窗口时才有）。 */
  baseWeight?: number
  /** 是否免费：唯一判据是消耗权重为 0（`isFree` 只在没有倍率标注时等义于权重 0）。 */
  free: boolean
  /**
   * 上游/适配器目录是否声明该模型接受图片输入（多模态）。
   *
   * ⚠️ 缺失 = 渠道包没有这份信息（不是「确认纯文本」）—— 界面据此显示「未知」。
   */
  supportsImage?: boolean
  /**
   * 上游声明的上下文窗口（token 数），来自渠道包 `/v1/models` 视图的
   * `context_window`，**不是** `model.list`（那份目录没有这个字段）。
   *
   * ⚠️ 缺失 = 渠道包没说。没说就**既不参与 `/v1/models` 的窗口广告，也不因上下文淘汰
   * 这个候选**（「没公布上限」不是「超限」的证据）。
   * 绝不能因为「64K 总比没有强」就填一个猜测值：TRAE / loomy / Qoder 实测都在服务
   * 300K–500K+，写死小值会让 `auto` 把整条渠道在长上下文请求上判为「装不下」而全部
   * 排除；反过来把它广告出去，客户端会按这个假上界安排压缩时机（2026-11-03 实测
   * Codex 按 64000×0.95=60800 提前摘要整轮历史，之后模型看不见任务）。
   */
  contextWindow?: number
  /**
   * 上游声明的输出上限（token 数），来自渠道包视图的 `max_output_tokens` /
   * `maxOutputTokens`。缺失 = 没说，**不是**默认 4096。
   *
   * 与窗口同一口径：未知就既不参与路由打分，也不被当成 0；
   * 只是 `auto` 在客户端要的输出超过已知上限时小扣一分（不淘汰）。
   */
  maxOutputTokens?: number
  /** 用户在渠道包内关掉了这个模型。 */
  disabled: boolean
  /** 渠道包判定该模型已失效。 */
  dead: boolean
}

/**
 * 渠道模型在供应商记录里的展示名 —— **唯一**口径。
 *
 * 标注（`userModelMarks`）与标准库采用（`catalogAdoptions`）都以
 * `(providerId, displayName)` 为键，且两侧写入前都会校验「这个名字在该供应商目录里」
 * （`store::setUserModelMark` / `modelCatalogService::adoptCatalogField`）。界面自己拼一份
 * 字符串迟早和 `syncProviders` 写的名字漂移，漂移的结果是每次点标注都拿到归属错误，
 * 所以主进程写名字和界面查名字必须调用同一个函数。
 */
export function channelModelDisplayName(
  channelName: string,
  channelId: string,
  model: Pick<ChannelModelInfo, 'id' | 'name'>,
): string {
  const baseName = model.name.trim().length > 0 ? model.name : `${channelId}/${model.id}`
  const suffix = channelModelVariantSuffix(model.id, model.name)
  return suffix === undefined ? `${channelName} / ${baseName}` : `${channelName} / ${baseName} · ${suffix}`
}

const slugOf = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * 同一个展示名在渠道里对应多个 id 时，用 id 与名字的差异给变体做后缀。
 *
 * 起因（2026-11-10 实测）：cline 的 `nvidia/nemotron-3.5-lightning:free` 与
 * `nvidia/nemotron-3.5-lightning` 展示名同为 `Nemotron 3.5 Lightning`，而同步按
 * **展示名**去重、同名只保留第一条 —— 免费那条连 `weight: 0` 一起被当别名吞掉，
 * 于是它既不进 `/v1/models`，`auto` 的「免费优先」也看不见它。trae 的
 * `kimi-k2.5`（x0.48）与 `multimodal_image_kimi-k2.5`（x0.75）同理，两个倍率还不同。
 *
 * 判据只有「id 比名字多了什么」，不猜、不看别的模型，所以主进程写目录与界面现算
 * 得到同一个结果（见 `tests/renderer/model-annotation-entry.test.mjs` 的约束）。
 * id 与名字没有前缀/后缀关系时返回 `undefined`（如 `qmodel_38max` ↔ `GLM-5.1`）：
 * 那种情况多半是渠道内部 id，给它加后缀只会污染命名。
 */
export function channelModelVariantSuffix(id: string, name: string): string | undefined {
  const displayName = name.trim()
  if (displayName.length === 0) return undefined
  const segments = id.split('/')
  const tail = slugOf(segments[segments.length - 1] ?? '')
  const base = slugOf(displayName)
  if (tail.length === 0 || base.length === 0 || tail === base) return undefined

  // **只认免费标记**。id 比名字多出来的其它片段大多是厂商标识（`Seed-Code-doubao`）
  // 或渠道内部写法，给它们加后缀会把 `TRAE / Seed-Code` 改成 `· Doubao`，
  // 属于凭空造名。换言之：同名的非免费变体继续按别名处理（第一条胜出），
  // 这类要区分只能靠证据（如倍率不同）而不是从字符串猜。
  if (tail === `${base}-free` || tail === `free-${base}`) return '免费'
  return undefined
}

/**
 * 模型目录的**来源**（用于 UI 提醒，不是路由判据）。
 *
 * - `upstream`：上游接口现取的目录（正常路径）；
 * - `official-cache`：上游接口不再返回可用模型，改读本机官方客户端缓存；
 * - `static-fallback`：上游与官方客户端缓存都不可用，显示内置兜底表。
 *
 * 后两者意味着「目录可能滞后」，界面必须显式说明，不能伪装成正常刷新结果。
 */
export type ChannelModelSource = 'upstream' | 'official-cache' | 'static-fallback'

export interface ChannelModelsResult {
  success: boolean
  models: ChannelModelInfo[]
  /** 缺省 = 该渠道没有来源概念（旧宿主 / 未接入），按正常路径展示。 */
  source?: ChannelModelSource
  reason?: string
}

/**
 * 消耗倍率分档。基准取 1 倍——上游倍率的单位就是「相对基准消耗」，
 * 所以档位边界只有 0 与 1 两个是有来历的，不是挑的数。
 *
 * `unknown` 单独成档：没有倍率标注不等于便宜，也不等于付费确定，
 * 折进任何一档都会让人按错的预期去选模型。
 */
export type CostBucket = 'free' | 'below-base' | 'base' | 'above-base' | 'unknown'

export function costBucketOf(weight: number | undefined, free: boolean): CostBucket {
  if (weight === undefined) return free ? 'free' : 'unknown'
  if (weight <= 0) return 'free'
  if (weight < 1) return 'below-base'
  if (weight === 1) return 'base'
  return 'above-base'
}

export interface ChannelRefreshResult {
  success: boolean
  /** 刷新后该渠道可用的模型数量。 */
  count?: number
  /** 见 {@link ChannelModelSource}；非 `upstream` 时界面要提醒目录来源。 */
  source?: ChannelModelSource
  reason?: string
}

/** 模型开关 / 失效恢复的结果；成功时带回最新目录，界面一次往返即可重绘。 */
export interface ChannelModelUpdateResult {
  success: boolean
  models: ChannelModelInfo[]
  /** `clearDead` 实际恢复的模型数量。 */
  removed?: number
  reason?: string
}
