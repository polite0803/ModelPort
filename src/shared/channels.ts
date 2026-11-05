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
   */
  remaining?: number
  /** Accounts that answered with a usable balance. */
  reported: number
  /** The channel does not expose a balance endpoint at all. */
  unsupported?: boolean
  /** Whole-call failure (network, credentials); per-account causes live on the rows. */
  error?: string
  accounts: Array<{
    accountId: string
    nickname: string
    /** `false` when the account is parked; its reading is shown but not summed into `remaining`. */
    enabled?: boolean
    remaining?: number
    /** Why this account returned nothing (upstream wording first, e.g. "未登录"). */
    error?: string
  }>
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
  /** 今天是否已经自动领取过。 */
  ranToday: boolean
  /** 这一轮正在执行（刚打开开关会立刻跑一轮）。 */
  running: boolean
  /** 上次结果摘要（渠道包给的中文短句）。 */
  lastResult: string
  /** 上次跑完的时刻（毫秒）；0 = 从未跑过。 */
  lastAt: number
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
  return `${channelName} / ${baseName}`
}

export interface ChannelModelsResult {
  success: boolean
  models: ChannelModelInfo[]
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
