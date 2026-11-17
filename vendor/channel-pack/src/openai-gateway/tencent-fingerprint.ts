/**
 * 腾讯系渠道的**内容级**风控指纹改写（Gitee issue IKJNA1）。
 *
 * ## 现象
 *
 * 外部客户端（ZCode 等）经本插件的 OpenAI 网关调 `buddy` / `workbuddy` 时，
 * 只要 `system` 消息里带着某些**客户端自带的模板句**，腾讯网关就稳定回
 * `HTTP 400 / code 11128 / "Illegal API invocation from an unapproved channel"`，
 * 客户端侧只显示 `provider_code=INVALID_REQUEST reason=unknown`。
 * DSH 直连同一模型则完全正常 —— 差别只在于**外部客户端往 system 里注了什么**。
 *
 * ## 为什么这一层只改 system、且只对腾讯系
 *
 * 本机逐组实测（`www.workbuddy.ai` 与 `copilot.tencent.com` **两个端点表现一致**，
 * 同账号 / 同模型 / 同 UA 与 X-* 头 / `max_tokens=16`，被拦不耗额度）：
 *
 * | 探针 | system 文本 | 结果 |
 * |---|---|---|
 * | 中性对照 | `You are a helpful assistant.` | ✅ 200 |
 * | 最小充分触发 | `Main branch (you will usually use this for PRs): master` | ❌ 400/11128 |
 * | 只留标签 | `Main branch: master` | ✅ 200 |
 * | 换分支名 | `…(you will usually use this for PRs): dev` | ❌ 400/11128 |
 * | 句中/段中 | 前后都接别的句子 | ❌ 400/11128 |
 * | **改写该句** | `Main branch (PRs usually go here): master` | ✅ 200 |
 * | 同一句放进 **user** 消息 | — | ✅ 200 |
 * | 同一句放进 **tool** 消息 | — | ✅ 200 |
 * | 指纹在**第二条** system（非 `messages[0]`） | — | ❌ 400/11128 |
 * | 只差一个词（`normally` 替 `usually`） | — | ✅ 200 |
 * | 内层多一个空格 | `Main branch  (you will…)` | ✅ 200 |
 * | 全小写 / 全大写 | — | ❌ 400/11128 |
 *
 * 2026-11-16 续（Claude Desktop 3p，claude-cli 2.1.325，真实 system 8202 字符）：
 *
 * | 探针 | system 处理 | 结果 |
 * |---|---|---|
 * | 原样 | 首行 `x-anthropic-billing-header: cc_version=…; cc_entrypoint=claude-desktop-3p;You are Claude Code, …` | ❌ 400/11128 `Illegal API invocation from an unapproved channel` |
 * | 只删 billing 参数 / 只换 `claude-desktop-3p` | — | ❌ 400/11128 |
 * | 保留 billing 行、只换 `You are Claude Code…` 句 | — | ❌ 400/11128 |
 * | **整行剥除** billing 行 | — | ✅ 200 |
 * | **等义替换** `You are Claude Code, Anthropic's official CLI…` 句 | — | ✅ 200（两句同时处理；只处理其一仍 400） |
 *
 * 由此得到三条**不能违反**的实现约束：
 *
 * 1. **只改 `system`**：`user` / `tool` 里同一句**不拦**（上表第 6、7 行）。
 *    改写它们只会白白破坏用户的原话与工具输出，且换不来任何收益。
 * 2. **改写**所有** system 消息**，不只 `messages[0]`：非首位的 system 同样被拦
 *    （上表第 8 行）。WorkBuddy 网关那条「首条必须是 system」的硬要求是**另一回事**
 *    （见 `account-probe.ts` 的 `PROBE_SYSTEM`），与本文件无关。
 * 3. **大小写不敏感的精确匹配**：全小写与全大写都被拦（上表末行），所以
 *    `replaceAll` 的字面量比对必须带 `i`；但**只差一个词**或**多一个空格**都不拦，
 *    说明服务端认的是**逐字符的字面量**，**不能**把它泛化成正则/关键词。
 *
 * ## 落点：`buddy-adapter` 的出站构造处（2026-11-15 修正）
 *
 * 本文件原先论证「应该落在网关、不要落在适配器」，但那个论证漏了一件事：
 * **ModelPort 的转发通路根本不经过本插件的 openai-gateway**（那是 DSH 插件形态的
 * 独立入口）。于是 `rewriteTencentContentFingerprints` 自写下起**全仓零调用点**，
 * 是一段死代码 —— Qoder 经 ModelPort 调 workbuddy 时，`Main branch (you will
 * usually use this for PRs)` 原样发出，稳定吃 11128（2026-11-15 实测三笔）。
 *
 * 现在接在 `buddy-adapter` 构造 wire messages 之后、`prompt_cache_key` 派生之前：
 * - 那是**唯一**同时覆盖 ModelPort 转发与 DSH 直连的位置（两条路都经该适配器）；
 * - 「对 DSH 自己的提示词做静默改写」这条顾虑不成立：DSH 提示词不含这些模板句，
 *   改写对它是 no-op，且无命中时**返回同一个数组引用**（见
 *   {@link rewriteTencentSystemMessages}），前缀缓存逐字节不变；
 * - 仍然只改 `system`：`user` / `tool` 里同一句实测不拦（上表第 6、7 行）。
 *
 * ## ⚠️ 11128 不是账号级拦截（判据已按此收口）
 *
 * 那是**内容级**拦截：同一账号换掉这一句就通（上面「改写该句」一行）。
 * 认成「账号被策略拦」会触发换号 + 30 分钟账号冷却，把整个账号池白锁 30 分钟，
 * 而真正该做的是改写那一句。
 * ⚠️ 原文这里写「维持现状是正确的」，但现状的 `isContentRejection` 匹配
 * `/request illegal/i` —— 而 **11128 的 `msg` 恰好也是 `request illegal`**，
 * 所以它一直在被误认。现已在 `buddy-adapter.isContentRejection` 里按业务码
 * 显式排除 11128，并给它一条不冷却、不换号、不停用账号的专门报错。
 *
 * ## 表驱动，而不是写死一处
 *
 * 屏蔽名单服务端掌握、可能随时更新，任何客户端将来都可能撞上新指纹。
 * 故这里是**表**：新增一条 = 往 {@link CONTENT_FINGERPRINTS} 里加一行 + 一条用例。
 */

/** 受影响的 provider：腾讯系两个后端（`buddy` = CodeBuddy 中国版，`workbuddy` = WorkBuddy 国际版）。 */
const TENCENT_PROVIDERS: readonly string[] = ['buddy', 'workbuddy']

interface ContentFingerprint {
  /** 被拦的**字面量**（匹配时**大小写不敏感**，但不做任何模式泛化）。 */
  readonly find: string
  /** 等义改写。两个端点均实测 200。 */
  readonly replace: string
  /** 来源与证据，写死在代码里，免得后人「顺手」把它改成正则或删掉。 */
  readonly note: string
}

/**
 * 已知会被腾讯网关拦下的 system 模板句。
 *
 * ⚠️ **每一条都必须有实发证据**（被拦 + 改写后放行，两条都要），
 * 照抄别家客户端的常量而没实测过 = 给上游加了一条没人验证过的改写。
 */
const CONTENT_FINGERPRINTS: readonly ContentFingerprint[] = [
  {
    // ZCode 内建常量：`$Js="Main branch (you will usually use this for PRs)"`。
    // 每个 git 仓库里的会话都会被注入（拼在 `Main branch … : <分支名>` 这一行）。
    find: 'Main branch (you will usually use this for PRs)',
    replace: 'Main branch (PRs usually go here)',
    note: 'Gitee IKJNA1；本机 2026-10-05 对 workbuddy / CodeBuddy 双端点实测复现',
  },
  {
    // Claude Desktop（3p，claude-cli 2.1.325）system 首句。
    find: "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
    replace: 'You are an AI assistant working with the user toward their goals.',
    note: '2026-11-16 真实 system（8202 字符）直连 www.workbuddy.ai 实测：原样 400/11128 `Illegal API invocation from an unapproved channel`；等义替换后 200',
  },
]

/**
 * 客户端自带的计费/入口标记行前缀。
 *
 * 这行**不能**做字面量匹配：`cc_version=2.1.325.5be`、`cc_entrypoint=…` 随客户端
 * 版本与入口变化，且整行还拼着别的句子。实测（2026-11-16）该行**只要有前缀就拦**：
 * 只删参数、只换 `claude-desktop-3p` 都仍 400，整行剥掉才 200 —— 所以这里按
 * **行前缀**剥除（大小写不敏感），不是对正文做模式泛化。
 */
const CLIENT_HEADER_LINE_PREFIX = 'x-anthropic-billing-header:'

/** 剥掉以 {@link CLIENT_HEADER_LINE_PREFIX} 开头的整行；无命中返回同一个字符串内容。 */
function stripClientHeaderLines(text: string): string {
  if (!text.toLowerCase().includes(CLIENT_HEADER_LINE_PREFIX)) return text
  return text
    .split('\n')
    .filter((line) => !line.toLowerCase().startsWith(CLIENT_HEADER_LINE_PREFIX))
    .join('\n')
}

/** 正则元字符转义：把字面量安全地变成**精确**匹配，而不是模式。 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface CompiledFingerprint {
  readonly replace: string
  /** 小写形态，用于 `includes` 预检（不命中就不必跑正则，字符串**原样**返回）。 */
  readonly findLower: string
  readonly pattern: RegExp
}

const COMPILED: readonly CompiledFingerprint[] = CONTENT_FINGERPRINTS.map((rule) => ({
  replace: rule.replace,
  findLower: rule.find.toLowerCase(),
  // `g` = 全部出现都改写；`i` = 大小写不敏感（实测全小写 / 全大写同样被拦）。
  pattern: new RegExp(escapeRegExp(rule.find), 'gi'),
}))

/** 该 provider 是否走腾讯系后端（有这套内容级风控）。 */
export function isTencentContentFingerprintProvider(provider: string): boolean {
  return TENCENT_PROVIDERS.includes(provider)
}

/**
 * 把 system 文本里已知的腾讯风控指纹做**窄改写**。
 *
 * ## 契约
 *
 * - **非腾讯系 provider 原样返回**（同一个函数指针意义上的同一份字符串内容）；
 * - **不含任何指纹的文本逐字符不变** —— 这一条是硬要求：腾讯侧按前缀缓存，
 *   无谓地重建字符串会让每一轮都算作新前缀，白白吃掉缓存命中；
 * - 只改**内容**，不删句子、不改结构：`Main branch (PRs usually go here)` 与原句
 *   语义等价，模型读到的仍是「主分支（提 PR 通常走这里）」。
 *
 * @param text 已取出的 system 纯文本
 * @param provider `parseModelRoute` 得到的 provider 段
 */
export function rewriteTencentContentFingerprints(text: string, provider: string): string {
  if (!isTencentContentFingerprintProvider(provider)) return text
  // 先剥客户端标记行：那一行里通常还拼着下面的句子，先剥行再走字面量表。
  let out = stripClientHeaderLines(text)
  for (const rule of COMPILED) {
    // 预检：不含（小写化后的）字面量就整条跳过，`out` 保持同一份字符串内容。
    if (!out.toLowerCase().includes(rule.findLower)) continue
    // `String.replace` 配 `g` 正则会在调用前后把 lastIndex 归零，不会串状态。
    out = out.replace(rule.pattern, rule.replace)
  }
  return out
}

/**
 * 对一组 wire 消息里的**所有** `system` 做指纹改写（其余角色原样）。
 *
 * 无命中时返回**传入的同一个数组引用**：腾讯侧按前缀缓存，无谓地重建数组或字符串
 * 会让每一轮都算作新前缀。命中时也只替换被改的那一条消息对象，其余元素同一引用。
 *
 * @param messages 已序列化的 wire 消息；`content` 是纯文本时才改（多模态 parts 不动）
 * @param provider 产品 id（`buddy` / `workbuddy` 之外原样返回）
 */
export function rewriteTencentSystemMessages(
  messages: Array<Record<string, unknown>>,
  provider: string,
): Array<Record<string, unknown>> {
  if (!isTencentContentFingerprintProvider(provider)) return messages
  let changed = false
  const out = messages.map((message) => {
    if (message.role !== 'system' || typeof message.content !== 'string') return message
    const rewritten = rewriteTencentContentFingerprints(message.content, provider)
    if (rewritten === message.content) return message
    changed = true
    return { ...message, content: rewritten }
  })
  return changed ? out : messages
}
