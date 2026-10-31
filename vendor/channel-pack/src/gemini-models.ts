/**
 * Antigravity 的 `/v1internal:fetchAvailableModels` 响应解析与档位归并。
 *
 * ## 为什么要拉远端目录
 *
 * 本仓此前把 gemini 的模型目录**写死成一行** `gemini-3.8-flash`（`GEMINI_FALLBACK_MODELS`），
 * 决定于 2026-10-03「静态表，不拉远端目录」。那个决定在 2026-06-18 停服之后不再成立：
 *
 * - 免费档与 Pro / Ultra 档**能看到的模型不同**，而且 2026-11-02 起免费档还要再下线几档 ——
 *   目录是**按账号档位变**的，写死一行必然对一部分账号漏报、对另一部分账号虚报；
 * - 虚报的代价正是本仓最怕的那一类：用户选中一个该账号打不到的 id，上游回 404，
 *   而 404 在旧实现里归 `SERVER`（白跑一轮换端点 + 换号）。
 *
 * `fetchAvailableModels` 是上游**按当前凭据**回答的准入表，所以它同时解决漏报与虚报。
 * 静态表退为**拉不到时的兜底**，不再是唯一事实来源。
 *
 * ## 响应形态（第三方实现的取值口径）
 *
 * ```json
 * { "models": {
 *     "gemini-3.8-flash-high":   { "displayName": "…", "maxTokens": 1048576, "maxOutputTokens": 65536 },
 *     "gemini-3.8-flash-medium": { … }
 * } }
 * ```
 *
 * ⚠️ `models` 是**以模型 id 为键的对象**，不是数组 —— 按数组读会得到空目录，
 * 而空目录在 `applyChannel` 里会把整条渠道关掉。
 *
 * ## 档位归并（与面板的 efforts 下拉框对齐）
 *
 * 上游把每个档位列成**独立条目**（`…-high` / `…-medium` / `…-low` / `…-tiered`），
 * 而本仓的目录形态是「一个模型 + 一组可选档位」。所以按剥掉档位后缀的**族名**归并：
 * 一个族一条，`effortOptions` = 该族实际出现的档位（顺序按传入的档位表固定，
 * 不按上游返回顺序，否则每次同步下拉框顺序都会漂）。
 *
 * ⚠️ **档位表由调用方传入**（`gemini.ts` 的 `GEMINI_EFFORT_IDS`）：本模块零导入，
 * 所以能被 `node --test` 直接 `import()`（`gemini.ts` 导入 `@deepseek-ai/dsh-llm`，
 * vendor 文件在测试里不能直接导入）。写第二份档位表就是两个事实来源 ——
 * 剥后缀与拼后缀必须同源，否则「测一下被限流的档位」会被误拒。
 *
 * ## 过滤规则的取舍
 *
 * 只滤掉**内部/预览**条目（`chat_<数字>`、`tab_*` 前缀 —— 第三方实现也滤这两类）。
 * 不滤 `gemini-2.5-*` 这类旧型号：那是他们 UI 的清理选择，不是上游说「该账号打不到」。
 * 上游既然按凭据回答，**把答案删掉就是替上游做决定**；真打不到会拿到有出处的 404，
 * 而不是被我们静默藏起来。
 *
 * ⚠️ 归并后一条都不剩 ⇒ 返回 `[]`，调用方必须回落到静态表（见 `gemini-adapter.ts`），
 * 不能让一次响应形状意外把渠道关掉。
 */

/** 一条远端条目（未经归并）。 */
export interface GeminiRemoteModel {
  id: string
  displayName: string
  /** 上游 `maxTokens` —— 上下文窗口。 */
  contextWindow?: number
  /** 上游 `maxOutputTokens` —— 输出上限。 */
  maxOutputTokens?: number
}

/** 归并后的目录条目（与 `gemini.ts` 的 `GeminiModelEntry` 同形，故调用方可直接替换静态表）。 */
export interface GeminiCatalogEntry {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  supportsImage: boolean
  effortOptions?: readonly string[]
  defaultEffort?: string
}

/** 内部/预览条目的形状（这两类第三方实现也滤）。 */
function isInternalModelId(id: string): boolean {
  return /^chat_\d+$/.test(id) || id.startsWith('tab_')
}

/** 正整数才收；0 / 负数 / NaN / 非数字 ⇒ `undefined`（**不编造**）。 */
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * 解析 `fetchAvailableModels` 响应。
 *
 * @param payload - 已 `JSON.parse` 的响应体。
 * @returns 远端条目数组；形状不认识时返回 `[]`（调用方回落静态表）。
 */
export function parseGeminiAvailableModels(payload: unknown): GeminiRemoteModel[] {
  if (typeof payload !== 'object' || payload === null) return []
  const models = (payload as { models?: unknown }).models
  if (typeof models !== 'object' || models === null || Array.isArray(models)) return []

  const out: GeminiRemoteModel[] = []
  for (const [rawId, raw] of Object.entries(models as Record<string, unknown>)) {
    const id = rawId.trim()
    if (id === '' || isInternalModelId(id)) continue
    const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : ''
    const contextWindow = positiveInt(record.maxTokens)
    const maxOutputTokens = positiveInt(record.maxOutputTokens)
    out.push({
      id,
      displayName: displayName === '' ? id : displayName,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    })
  }
  return out
}

/**
 * 剥掉档位后缀，得族名。
 *
 * 档位表**必传**（同一份 `GEMINI_EFFORT_IDS`），只剥已知档位：未来出现一个真名恰好
 * 以档位词结尾的模型时，这里会误剥 —— 与 `gemini.ts::geminiCanonicalModelId` 同一
 * 已知限制，两处必须同步改。
 */
export function geminiModelFamily(id: string, tiers: readonly string[]): string {
  for (const tier of tiers) {
    if (id.endsWith(`-${tier}`)) return id.slice(0, id.length - tier.length - 1)
  }
  return id
}

/**
 * 归并成目录条目（一个族一条）。
 *
 * @param remote - {@link parseGeminiAvailableModels} 的结果。
 * @param tiers - 档位后缀表（传 `GEMINI_EFFORT_IDS`），同时决定 efforts 的展示顺序。
 * @param supportsImage - 上游不报模态，图片支持由调用方按族名给（默认 `false`：
 *   **不把未知当支持**，误报图片能力会让上游直接拒图）。
 * @param defaultContextWindow - 上游没给窗口时的兜底；不给就留 `0`（= 未知）。
 */
export function collapseGeminiTiers(
  remote: readonly GeminiRemoteModel[],
  tiers: readonly string[],
  options: {
    supportsImage?: (family: string) => boolean
    defaultContextWindow?: number
  } = {},
): GeminiCatalogEntry[] {
  const supportsImageFor = options.supportsImage ?? (() => false)
  const groups = new Map<string, { tiers: string[]; sample: GeminiRemoteModel }>()

  for (const model of remote) {
    const family = geminiModelFamily(model.id, tiers)
    const tier = model.id === family ? undefined : model.id.slice(family.length + 1)
    const hit = groups.get(family)
    if (hit === undefined) {
      groups.set(family, { tiers: tier === undefined ? [] : [tier], sample: model })
      continue
    }
    if (tier !== undefined && !hit.tiers.includes(tier)) hit.tiers.push(tier)
    // 窗口取同族里**最大**的那个：同族各档位上游本是同一个数，取最大值只在上游真的
    // 给出不同值时才会放宽，不会因为返回顺序而忽大忽小。
    if ((model.contextWindow ?? 0) > (hit.sample.contextWindow ?? 0)) hit.sample = model
  }

  const out: GeminiCatalogEntry[] = []
  for (const [family, group] of groups) {
    // 档位顺序跟传入的档位表走，不跟上游返回顺序走。
    const efforts = tiers.filter((tier) => group.tiers.includes(tier))
    out.push({
      id: family,
      name: group.sample.displayName,
      contextWindow: group.sample.contextWindow ?? options.defaultContextWindow ?? 0,
      maxTokens: group.sample.maxOutputTokens ?? 0,
      supportsImage: supportsImageFor(family),
      // ⚠️ 只有上游**列出了带档位的条目**时才声明 efforts：裸 id 一条时给 `undefined`，
      // 空数组会让面板出现一个点不开的空下拉框（与 `geminiReasoningInfo` 同口径）。
      ...(efforts.length === 0 ? {} : { effortOptions: efforts }),
      // 默认档：上游列了 medium 就用 medium，否则取列出的第一个。
      ...(efforts.length === 0
        ? {}
        : { defaultEffort: efforts.includes('medium') ? 'medium' : efforts[0] }),
    })
  }
  return out
}

/**
 * 目录里可路由的族名集合 —— `geminiModelSpec` 的准入表。
 *
 * ⚠️ 这是「严格校验」与「动态目录」的接缝：旧版校验的是常量 `gemini-3.8-flash`，
 * 换成这里之后，目录说该账号有哪些族，校验就认哪些族；目录拉不到时调用方传静态表，
 * 行为与今天逐字一致。
 */
export function geminiCatalogFamilies(entries: readonly GeminiCatalogEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.id))
}
