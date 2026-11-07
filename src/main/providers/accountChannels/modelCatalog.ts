/**
 * Model catalogue normalisation for account channels.
 *
 * The pack's `model.list` RPC is the only place that knows a model's **credit
 * weight**: there is no numeric field for it, the multiplier is appended to the
 * display name. The formats in the vendored tree are:
 *
 *   `MiniMax M3 · x4.0`          rate only            (loomy / lobsterai / qoder)
 *   `GLM-5-3-Flash · x0.2→x0.1`  base → effective     (qoder promo / raccoon)
 *   `Qwen3.8-Flash · 免费`       free                 (qoder / cline / raccoon)
 *
 * So the parser below is the single place that turns those labels into
 * `{ name, weight, baseWeight, free }`. Everything else (UI badges, `/v1/models`
 * display names) reads the parsed shape.
 *
 * ⚠️ 缺失 `weight` 一律保持 undefined（= 不知道），绝不回落成 0：trae / minimax
 * 这些渠道根本不报倍率，把它们当成免费模型会让用户按免费额度选一个按量计费的
 * 模型。
 */
import type { ChannelModelInfo, ChannelModelSource } from '../../../shared/channels'
import type { ModelCapabilityHint } from '../../../shared/types.ts'

/** `名称 · 免费` / `名称 · x1.5` / `名称 · x0.2→x0.1`。 */
const LABEL_SUFFIX = /^(.*?)\s*·\s*(免费|x\d+(?:\.\d+)?(?:\s*→\s*x\d+(?:\.\d+)?)?)$/

export interface ParsedModelLabel {
  name: string
  free: boolean
  weight?: number
  baseWeight?: number
}

/** 把展示名拆成「干净的名字 + 倍率」。识别不了就原样返回，不猜。 */
export function splitModelLabel(raw: unknown): ParsedModelLabel {
  const label = typeof raw === 'string' ? raw.trim() : ''
  const match = LABEL_SUFFIX.exec(label)
  if (match === null) return { name: label, free: false }

  const name = match[1].trim()
  const marker = match[2]
  if (marker === '免费') return { name, free: true, weight: 0 }

  const values = marker.split('→').map(part => Number(part.trim().slice(1)))
  if (values.some(value => !Number.isFinite(value))) return { name, free: false }

  const weight = values[values.length - 1]
  return {
    name,
    free: weight === 0,
    weight,
    ...(values.length > 1 ? { baseWeight: values[0] } : {}),
  }
}

/**
 * 把 `model.list` 的返回值归一化成目录条目。
 *
 * 畸形输入一律跳过（这是外部数据），`isFree` 照实透传 —— 上游没写就保持未知，
 * 与 `model.list` 端点「缺失即不推导」的口径一致。
 */
export function readModelList(value: unknown): ChannelModelInfo[] {
  const models = (value as { models?: unknown } | undefined)?.models
  if (!Array.isArray(models)) return []

  const out: ChannelModelInfo[] = []
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id.length === 0) continue

    const label = splitModelLabel(record.name ?? id)
    const declaredFree = record.isFree === true
    // 免费的**唯一判据是消耗权重为 0**：上游的 `isFree` 只在没有倍率标注时
    // 等义为权重 0；一旦展示名里写了 `x2`，就以权重为准（权重与标记冲突时
    // 权重优先），否则会把按量计费的模型标成免费。
    const weight = label.weight ?? (declaredFree ? 0 : undefined)
    out.push({
      id,
      name: label.name,
      free: weight === 0,
      disabled: record.disabled === true,
      dead: record.dead === true,
      ...(weight === undefined ? {} : { weight }),
      ...(label.baseWeight === undefined ? {} : { baseWeight: label.baseWeight }),
      // 模态同样「缺失即未知」，不推导。
      ...(typeof record.supportsImage === 'boolean' ? { supportsImage: record.supportsImage } : {}),
      // `model.list` 目前不带窗口；两种拼写都认，为的是同一份归一化代码也能吃
      // `/v1/models` 视图（见 `attachContextWindows`）。非正整数一律当没说。
      ...positiveInt(record.context_window ?? record.contextWindow) !== undefined
        ? { contextWindow: positiveInt(record.context_window ?? record.contextWindow) }
        : {},
      // 输出上限同窗口口径：只认上游明说的数，缺失保持未知。
      ...positiveInt(
        record.max_output_tokens ?? record.maxOutputTokens ?? record.max_completion_tokens,
      ) !== undefined
        ? {
            maxOutputTokens: positiveInt(
              record.max_output_tokens ?? record.maxOutputTokens ?? record.max_completion_tokens,
            ),
          }
        : {},
    })
  }
  return out
}

/**
 * Read the catalogue origin the pack reports alongside `models`.
 *
 * Anything outside the known union is treated as **absent** (normal upstream
 * path): a typo in a future pack must not make the UI warn about a fallback
 * that did not happen.
 */
export function readModelListSource(value: unknown): ChannelModelSource | undefined {
  const source = (value as { source?: unknown } | undefined)?.source
  return source === 'upstream' || source === 'official-cache' || source === 'static-fallback'
    ? source
    : undefined
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

/**
 * 把 `/v1/models` 视图里的 `context_window` 合并进 `model.list` 目录。
 *
 * ## 为什么要两个源
 *
 * `model.list` 是唯一知道**倍率**与 `disabled`/`dead` 的地方，但它不带上下文窗口；
 * `bridge.models()`（OpenAI 形状）反过来带 `context_window` 却没有倍率。少任何一边
 * 都会瞎：只用前者，`auto` 路由会把所有渠道看成 64K 装不下（实测 TRAE 单请求
 * 503K 且 0 错误），只用后者则会把按量计费模型显示成免费。
 *
 * ## 匹配口径
 *
 * 渠道内部 id 形如 `<channel>/<model>`，视图里也可能是同样形态或已剥前缀，所以
 * 同时按「原样 id」与「去掉 `<channel>/` 后的裸 id」两把钥匙找，命中即取。
 * 视图缺某个模型（未启用、被裁剪）时该条**保持未知**，不回落默认值。
 *
 * 返回新数组，绝不原地改入参。
 */
export function attachContextWindows(
  models: readonly ChannelModelInfo[],
  view: readonly Record<string, unknown>[],
): ChannelModelInfo[] {
  const limits = new Map<string, { contextWindow?: number; maxOutputTokens?: number }>()
  const register = (key: string, value: { contextWindow?: number; maxOutputTokens?: number }): void => {
    const existing = limits.get(key) ?? {}
    limits.set(key, {
      ...(value.contextWindow === undefined ? {} : { contextWindow: value.contextWindow }),
      ...(value.maxOutputTokens === undefined ? {} : { maxOutputTokens: value.maxOutputTokens }),
      ...existing,
    })
  }
  for (const entry of view) {
    if (typeof entry !== 'object' || entry === null) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const contextWindow = positiveInt(entry.context_window ?? entry.contextWindow)
    const maxOutputTokens = positiveInt(
      entry.max_output_tokens ?? entry.maxOutputTokens ?? entry.max_completion_tokens,
    )
    if (id.length === 0 || (contextWindow === undefined && maxOutputTokens === undefined)) continue
    const value = {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    }
    register(id, value)
    const slash = id.indexOf('/')
    if (slash > 0) register(id.slice(slash + 1), value)
  }
  if (limits.size === 0) return [...models]

  // `model.list` 给的是**裸 id**，而视图建表时同时登记了「完整 id」与「剥掉
  // `<channel>/` 的裸 id」，所以这里一次查得到；若目录条目本身已带前缀也能命中。
  return models.map(model => {
    const found = limits.get(model.id)
    if (found === undefined) return { ...model }
    return {
      ...model,
      ...(found.contextWindow === undefined ? {} : { contextWindow: found.contextWindow }),
      ...(found.maxOutputTokens === undefined ? {} : { maxOutputTokens: found.maxOutputTokens }),
    }
  })
}

/**
 * 目录条目 → `auto` 路由用的能力标注。
 *
 * 只写目录**明确说了**的字段：`supportsImage` 缺失表示渠道没给模态信息，
 * 不能写成 `no`；倍率缺失同理。没有任何已知字段时返回 `undefined`，调用方据此
 * 不写记录（保持未知）。
 *
 * `free` 有两个方向，但都必须是**证据**而不是默认值：
 * - `· 免费` 标签 / 上游 `isFree: true` → `free: true`；
 * - 明确的正倍率（`· x1.5`、`x0.2→x0.1`）→ `free: false`：按倍率扣积分就不可能
 *   同时是免费模型，这是从渠道自己的报价读出来的，不是「没标注折成 false」；
 * - 倍率缺失（trae / minimax 这类不报倍率的渠道）→ 两个都不写，保持未知。
 */
export function capabilityHintOf(model: ChannelModelInfo): ModelCapabilityHint | undefined {
  const hint: ModelCapabilityHint = {}
  if (model.supportsImage !== undefined) hint.vision = model.supportsImage ? 'yes' : 'no'
  if (model.weight !== undefined) hint.weight = model.weight
  if (model.free) hint.free = true
  else if (model.weight !== undefined && model.weight > 0) hint.free = false
  // 窗口只在渠道包明确说了时才写。写成 0 或猜一个值，会让 `auto` 在长上下文请求上
  // 把这条渠道直接判成「装不下」而排除掉（`autoRouting.ts` 拿 `contextTokens` 硬过滤）。
  if (model.contextWindow !== undefined) hint.contextTokens = model.contextWindow
  // 输出上限同一个口径：只写明说的数。缺失不写，路由据此不罚。
  if (model.maxOutputTokens !== undefined) hint.maxOutputTokens = model.maxOutputTokens
  return Object.keys(hint).length > 0 ? hint : undefined
}

/**
 * 把模型名补成渠道 Worker 要求的 `<channel>/<model>` 形状。
 *
 * ## 为什么需要它（2026-11-01 192.168.85.131 实测 8 笔 400）
 *
 * 目录里可能留着**旧写法**的行：展示名是 `opencode/big-pickle`，`actualModelId`
 * 却是**裸** `big-pickle`（改名之前，展示名本身就是 `<channel>/<id>`，映射值只留
 * 了 id）。`channelPack/worker.ts` 的请求前校验按**第一个 `/`** 切出渠道 id 与模型
 * id，裸 id 直接 400 `模型 ID 无效：big-pickle` —— 于是一条明明还在
 * `/v1/models` 里广告的名字，每次请求都在自己进程里被拒掉，而且 400 不参与换家，
 * `auto` 撞上它就整场失败。
 *
 * 宿主手里**一直**有那条渠道的 id（provider 记录），只是转发时把它丢了。这里补回来。
 *
 * 规则（顺序即优先级）：
 * - 已经带**本渠道**前缀 → 原样（多数请求走这一格，不做任何字符串手术）；
 * - 裸名（无 `/`）→ 补 `<channelId>/`；
 * - 带的是**别家**前缀（`other/x`）→ 原样返回：那是用户自己写的映射，改它等于
 *   替他改意图；真要出错也该由那条映射的归属来解释，不在这里悄悄换掉目标。
 */
export function qualifyChannelModel(channelId: string, model: string): string {
  const trimmed = model.trim()
  if (trimmed.length === 0) return trimmed
  const slash = trimmed.indexOf('/')
  if (slash < 0) return `${channelId}/${trimmed}`
  if (trimmed.slice(0, slash) === channelId) return trimmed
  return trimmed
}
