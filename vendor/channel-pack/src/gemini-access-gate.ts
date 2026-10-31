/**
 * Gemini（Cloud Code / Code Assist）线路的**确定性闸门**判据与可读文案。
 *
 * ## 要解决的问题
 *
 * 上游对「这条线本来就不该再打」的三种情形，回的都是 HTTP 4xx + 一段裸 JSON。旧实现
 * 把 403/404 一律归成 `SERVER`（`gemini-adapter.ts::classifyFailure` 的刻意口径），
 * 把 400 归成 `INVALID_REQUEST`，于是**确定性**失败要先付一轮换端点 + 最多两轮换号
 * 的代价（`endpointFirst` → `rotatable`），再把上游那坨 JSON 原样端给用户：
 * 用户看到的是「连接不上」，读不出「账号不在这条产品线里」还是「出口地区不受支持」。
 *
 * ## 三种闸门（判据互不重叠，按此顺序判）
 *
 * | 闸门 | 触发 | 上游报文形态（出处见各判据函数） |
 * |---|---|---|
 * | `lane_retired` | 个人版/AI Pro/Ultra 这条线**已停服** | `This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products.` |
 * | `location_unsupported` | 出口 IP 在国家/地区清单外 | `400 FAILED_PRECONDITION` `User location is not supported for the API use.` **以及** `403 PERMISSION_DENIED` + `reason: UNSUPPORTED_LOCATION` |
 * | `entitlement` | 账号没有 Code Assist 许可/档位 | `403` + `SUBSCRIPTION_REQUIRED`（`error_number: 1001`）`You do not have a valid license of this product.` |
 *
 * ⚠️ **地区闸门有两种状态码**（2026-11-01 取证修正）：只认 400 的话，以 403 下发的
 * 地区闸门会掉进 `entitlement`，文案让用户去「要许可」，而真正要改的是代理出口。
 * 同理，个人版资格句 `not eligible for Gemini Code Assist for individuals because it
 * is not currently available in your location` 病因是地区，必须归 `location_unsupported`
 * —— 这就是地区判据排在最前的原因。
 *
 * ## ⚠️ 三条必须守住的口径
 *
 * 1. **只有措辞命中才算闸门**。裸 403 不走 `entitlement`：403 也可能是 scope/令牌
 *    问题，那条路必须留着适配器原有的「续期 → 换号」自愈，否则单号令牌故障会把整个
 *    池判死。所以 `entitlement` 要求 403 **且**带许可类关键词。
 * 2. **判据只喂错误体**（`!response.ok` 的正文、`loadCodeAssist` 的失败正文），
 *    永不喂模型回答：`no longer supported` 这类短语出现在正常回答里完全可能。
 * 3. **命中的代价是「立刻失败」**，因此漏判只是多跑一轮自愈（与旧行为相同），
 *    误判却会让一次本可自愈的失败直接终结 —— 取**窄**判据。
 */

/** 三条闸门中命中的那一条。 */
export type GeminiAccessGate = 'lane_retired' | 'location_unsupported' | 'entitlement'

/** Google 停服个人版这条线的生效日（官方弃用页）。 */
export const GEMINI_INDIVIDUAL_SUNSET_DATE = '2026-06-18'

/**
 * 客户端/线路已被上游拒绝。
 *
 * 有出处的原文（Gemini CLI issue #28062 的登录失败日志、以及多篇 2026-07 复现指南的错误对照表）：
 *
 * ```
 * This client is no longer supported for Gemini Code Assist for individuals.
 * To continue using Gemini, please migrate to the Antigravity suite of products.
 * ```
 *
 * 官方弃用页的措辞是「will **stop serving requests** for Gemini Code Assist for
 * individuals」，所以两条都要认。不认裸的 `not supported`（那是地区闸门与模型准入
 * 都会用的措辞，会让三条判据互相吞）。
 */
function looksLikeRetiredLane(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /client\s+is\s+no\s+longer\s+supported/i.test(lower) ||
    /migrate\s+to\s+the\s+antigravity\s+suite/i.test(lower) ||
    /no\s+longer\s+serving\s+requests/i.test(lower) ||
    /stopped\s+serving\s+requests/i.test(lower)
  )
}

/**
 * 出口地区不受支持。
 *
 * **两种状态码都要认**（这是 2026-11-01 取证修正的点：旧判据只认 400，那么以 403
 * 下发的地区闸门会被 `entitlement` 吃掉，文案会说「去要许可」，而真正要改的是出口）：
 *
 * - `400 FAILED_PRECONDITION`：`User location is not supported for the API use.`
 *   （第三方实现隔离实测：同一凭据换出口即 400↔200）
 * - `403 PERMISSION_DENIED` + `reason: UNSUPPORTED_LOCATION`（antigravity-cli #1268）
 * - 个人版资格句（antigravity-cli #1016）：`Your current account is not eligible for
 *   Gemini Code Assist for individuals because it is not currently available in your
 *   location.` —— 它同时带「资格」与「地区」两种措辞，**病因是地区**，所以必须落到本闸门。
 */
function looksLikeLocationUnsupported(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /user\s+location\s+is\s+not\s+supported/i.test(lower) ||
    /location\s+is\s+not\s+supported\s+for\s+the\s+api/i.test(lower) ||
    /unsupported[_\s]location/i.test(lower) ||
    /not\s+currently\s+available\s+in\s+your\s+location/i.test(lower) ||
    /unsupported[_\s]country[_\s]region[_\s]territory/i.test(lower) ||
    /country,?\s+region,?\s+or\s+territory\s+not\s+supported/i.test(lower)
  )
}

/**
 * 账号缺许可/套餐档位。
 *
 * 有出处的原文（antigravity-cli #1180 / #1115，2026-10-07 / 09-27）：
 *
 * ```
 * 403 PERMISSION_DENIED
 * reason: SUBSCRIPTION_REQUIRED, domain: cloudaicompanion.googleapis.com,
 * metadata.error_number: 1001
 * "You do not have a valid license of this product. Please contact your administrator."
 * ```
 *
 * 以及组织锁那句（2026-07 复现指南的对照表，早期变体见 gemini-cli #14934）：
 * `You must be a named user on your organization's Gemini Code Assist Standard
 * edition subscription …`
 *
 * ⚠️ 必须与 403 **并列**判定（文件头条款 1）：这些串在别处不会出现在错误通道里。
 * `quota` **不**在此列 —— 额度耗尽另有 `QUOTA_EXCEEDED` 通道，且它会按自然日/自然周
 * 重置（实测文案 `Resets in 167h39m40s`），与「档位不给用」是两种处置。
 */
function looksLikeEntitlementDenied(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /permission[_\s]denied/i.test(lower) ||
    /subscription[_\s]required/i.test(lower) ||
    /valid\s+license/i.test(lower) ||
    /named\s+user\b/i.test(lower) ||
    /code\s+assist\s+license/i.test(lower) ||
    /\bdoes\s+not\s+have\s+(?:the\s+)?(?:required\s+)?access\b/i.test(lower) ||
    /not\s+(?:eligible|authorized)\s+(?:to\s+use|for)\b/i.test(lower)
  )
}

/**
 * 这次失败是否是**确定性闸门**（应当立刻失败、不换端点也不换号）。
 *
 * @param status - 上游 HTTP 状态码。
 * @param text - 上游错误体原文（调用方保证：只在 `!response.ok` 时喂进来）。
 * @returns 命中的闸门；未命中返回 `undefined`（交回原有归类）。
 */
export function classifyGeminiAccessGate(status: number, text: string): GeminiAccessGate | undefined {
  if (text === '') return undefined
  if (looksLikeLocationUnsupported(text)) return 'location_unsupported'
  if (looksLikeRetiredLane(text)) return 'lane_retired'
  if (status === 403 && looksLikeEntitlementDenied(text)) return 'entitlement'
  return undefined
}

/** 闸门 → 用户可见文案（上游原文始终附在后面，便于对照取证）。 */
export function geminiAccessGateMessage(gate: GeminiAccessGate, text: string): string {
  const detail = text === '' ? '' : ` — ${text.slice(0, 300)}`
  switch (gate) {
    case 'location_unsupported':
      return (
        'gemini: 当前网络出口所在的国家/地区不受 Google 支持，这条线路无法调用' +
        `（需改用受支持地区的代理出口后重试）${detail}`
      )
    case 'lane_retired':
      return (
        `gemini: Google 自 ${GEMINI_INDIVIDUAL_SUNSET_DATE} 起停止为「Gemini Code Assist 个人版」` +
        '以及 Google AI Pro/Ultra 订阅处理这条线路的请求，客户端已不再受支持' +
        `（个人账号需改用 Antigravity，或持有 Code Assist Standard/Enterprise 许可）${detail}`
      )
    case 'entitlement':
      return (
        'gemini: 该账号没有 Gemini Code Assist 的可用许可/套餐档位，这条线路无法调用' +
        `（个人免费线已停服，需 Standard/Enterprise 许可）${detail}`
      )
  }
}

/**
 * 命中闸门后抛出的错误码。
 *
 * 三条都归 `PERMISSION_DENIED`：它与 `QUOTA_EXCEEDED` 同属**不可重试**集合，且
 * `openai-gateway` 的 `failureToOpenAiError` 会带着 `failure.status` 原样下发，
 * 客户端不会把确定性失败当可重试故障反复打。
 */
export const GEMINI_ACCESS_GATE_ERROR_CODE = 'PERMISSION_DENIED'
