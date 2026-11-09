import { u as useTranslation, N as useToast, r as reactExports, j as jsxRuntimeExports, B as Button, V as KeyRound, W as Wifi, b as Settings2, A as Dialog, G as DialogContent, H as DialogHeader, I as DialogTitle, J as DialogDescription, K as DialogFooter } from "./index-Dmiad-IP.js";
import { P as PageHeader } from "./PageHeader-Uo_aLgRN.js";
import { C as CatalogScopeBatchButton, T as Tags } from "./CatalogScopeBatchButton-CyDc-H3J.js";
import { M as ModelAnnotationDialog } from "./ModelAnnotationDialog-D1MW0Y2K.js";
import { a as aggregateCostOf, b as aggregateCostCounts } from "./aggregateCost-B41jA_HQ.js";
import { B as Badge } from "./badge-CrPFCp-Q.js";
import { C as Card, c as CardContent, a as CardHeader, b as CardTitle } from "./card-CJejDjrN.js";
import { S as Switch, L as Label, I as Input } from "./label-BqQAqSEG.js";
import { T as Trash2, S as Select, d as SelectTrigger, e as SelectValue, f as SelectContent, g as SelectItem, h as ChevronDown } from "./select-DfPABgRe.js";
import { T as Textarea } from "./textarea-EvAre4Ih.js";
import { L as LoaderCircle } from "./loader-circle-nOv8zGof.js";
import { S as ShieldCheck } from "./shield-check-B8lc84eC.js";
import { P as Plus } from "./plus-CRYwvOZy.js";
import { C as ChartColumn } from "./chart-column-BORE439i.js";
import { C as Coins } from "./coins-B2YPUoKF.js";
import { S as Search, C as ChevronRight } from "./search-FGE6QrPq.js";
import { R as RefreshCw } from "./refresh-cw-BZLwpUhy.js";
import "./chevron-left-DjwtYoGs.js";
const CREDIT_SNAPSHOT_TTL_MS = 15 * 6e4;
function creditSnapshotLive(snapshot, nowMs = Date.now()) {
  if (!snapshot) return false;
  const at = Date.parse(snapshot.asOf);
  if (Number.isNaN(at)) return false;
  const age = nowMs - at;
  return age >= 0 && age <= CREDIT_SNAPSHOT_TTL_MS;
}
const AGGREGATE_TERMS_WARNINGS = [
  {
    entryId: "opencode_zen",
    scope: "free-tier-models",
    quote: "Free-tier chat models require OpenCode; use paid models or Go from other clients.",
    docUrl: "https://opencode.ai/docs/zen",
    asOf: "2026-10-29"
  },
  {
    entryId: "qwencloud_coding",
    scope: "all-requests",
    quote: "This plan is for interactive use in programming tools such as Claude Code, Qoder, Qoder CN, and OpenClaw. Do not use the plan's API key for automated scripts, application backends, or other non-interactive scenarios. Using the API key outside the permitted scope is a violation that may result in subscription suspension or API key revocation.",
    docUrl: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
    asOf: "2026-10-29"
  },
  {
    entryId: "glm-cn",
    scope: "all-requests",
    quote: "套餐仅限在官方支持的指定工具与产品环境中使用。在除规定工具外调用 API，不可享用 Coding 套餐的额度。",
    docUrl: "https://docs.bigmodel.cn/cn/coding-plan/overview",
    asOf: "2026-10-29"
  }
];
const WARNINGS_BY_ENTRY = new Map(AGGREGATE_TERMS_WARNINGS.map((w) => [w.entryId, w]));
function getTermsWarning(entryId) {
  return WARNINGS_BY_ENTRY.get(entryId);
}
const AGGREGATE_QUOTA = {
  "agnes": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: `The catalogue was switched to the vendor's China host (https://api.agnes-ai.cn/v1, declared in the CN wiki wiki.agnes-ai.cn). https://api.agnes-ai.cn/v1/models answers 401 without a key, so reachability is confirmed but no quota headers were read. The CN wiki documents model capabilities, pricing (agnes-3.0-flash: ¥0.35 / million input tokens, ¥1.00 / million output tokens, currently ¥0) and a 512K context window, but publishes NO RPM/RPD/TPM/TPD/monthly token caps. The older international notes still apply to the brand: https://agnes-ai.com/ loaded, its terms/pricing pages 404, and a 7M tokens/day cap and 15 req/min rate exist on the public web only via NaraRouter (router.bynara.id), not Agnes - so nothing is recorded. Do not assume a free quota from the "free to get started" wording.`
  },
  "aion": {
    source: "undocumented",
    docUrl: "https://aionlabs.ai/",
    asOf: "2026-11-03",
    officialNote: "目录 notes 记录过免卡档 15 请求/分钟、20,000 token/日，但那是 freellmpool 的转述而非本次抓到的官方正文；按本仓规则不把转述数字写进 quota，故全 null。"
  },
  "alibaba_cloud": {
    source: "undocumented",
    docUrl: "https://www.alibabacloud.com/help/en/model-studio/rate-limit",
    asOf: "2026-10-29",
    perModel: [{ modelId: "qwen3.5-plus", rpm: 15e3, tpm: 5e6 }, { modelId: "MiniMax-M2.5", rpm: 500, tpm: 1e6 }, { modelId: "kimi-k2.5" }, { modelId: "glm-5" }, { modelId: "glm-4.7" }, { modelId: "qwen3-coder-next" }, { modelId: "qwen3-coder-plus" }],
    officialNote: "主体确认：baseUrl https://dashscope-intl.aliyuncs.com/compatible-mode/v1 = Model Studio 新加坡（国际）地域，故取 www.alibabacloud.com/help/en/model-studio/* 那份（国际站英文文档），不取 help.aliyun.com 的北京地域表。限流是「按主账号维度、模型独立」的 RPM/TPM 帽，属付费 Key 的默认限额（同页说明：充值不改变默认 RPM/TPM，免费额度与付费调用使用同一套基础设施、生成速度相同；可申请 30 天临时提额）。本条目 models[] 中只有 qwen3.5-plus 与 MiniMax-M2.5 在 Singapore/International 表里读到明确行，其余 5 个无行 → null，不套用相邻模型值。免费池：new-free-quota 页给的是「每模型独立、典型 1,000,000 tokens、有效期 90 天、仅新加坡地域、按账号共享」，还有一条「2,000 calls per day」属于另一类接口口径；由于它是 90 天一次性额度而非「月度」帽，且原句用 typically（非精确值），monthlyTokens 保持 null 不折算。页面另说明部分模型（如 qwen3.8-max、qwen3.8-flash）改为按百炼月消费档位的「动态限流（新）」，无固定数字可登记。"
  },
  "anthropic": {
    source: "documented",
    rpm: 1e3,
    tpm: 2e6,
    docUrl: "https://platform.claude.com/docs/en/api/rate-limits",
    asOf: "2026-10-29",
    officialNote: '带代理重试成功，但成功方式特殊：docs.anthropic.com、platform.claude.com、docs.claude.com 的每一个页面（含 /en/api/rate-limits、/en/api/rate-limits.md、站点根）都 307/200 落到 claude.com/app-unavailable-in-region —— 本机代理 http://127.0.0.1:7890 的出口 IP 是 155.117.84.36（ipinfo.io: city=Hong Kong, country=HK），而 HK 正是 Anthropic 不支持的地区，所以「带代理」并没有绕开区域拦截，是代理出口本身落在了被封地区。唯一未被区域网关拦截的官方路由是整站文档导出文件 https://platform.claude.com/llms-full.txt（47,371,269 字节，HTTP 200，正文完整），上面所有数字都逐字读自该文件；其内嵌的页面元数据块写明 `title: Rate limits` / `url: https://platform.claude.com/docs/en/api/rate-limits`，即引用页就是这一页。 quota 取的是 Start tier（新组织默认档）的标准值：rpm=1000、tpm=2000000（官方把输入/输出分成两个指标，这里 tpm 记 ITPM，OTPM=400000 只写进 evidence，不做相加，因为官方从未给过合并 TPM）。rpd/tpd/monthlyTokens 官方完全没有：Anthropic 的月度上限是「花费」而不是 token，即 Start $500 USD / Build $1,000 USD / Scale $200,000 USD 的 monthly spend cap，且 "Once you reach your tier\'s spend cap, API usage pauses until 00:00 UTC on the first day of the next month"。contextWindow 为 null：本次抓到的正文里没有一处把上下文窗口写成数字（官方写的是模型档位名，不是 token 上限）。 perModel 留空、freeModelIds 留空的理由（重要，直接影响本条目可用性）：我们目录里的三个 id 全部已被官方下线，且限速表里根本没有对应行—— 1) `claude-sonnet-4-20250514` 与 `claude-opus-4-20250514`："We\'ve retired the Claude Sonnet 4 model (`claude-sonnet-4-20250514`) and the Claude Opus 4 model (`claude-opus-4-20250514`). All requests to these models on the Claude API will now return an error."（deprecation 通知 2026-04-14，API 退役 2026-06-15；退役表两行均写 `Retired | April 14, 2026 | June 15, 2026`）。 2) `claude-3-5-sonnet-20241022`："These models were retired October 28, 2025."，退役表行 `| October 28, 2025 | claude-3-5-sonnet-20241022 | claude-sonnet-5-5 |`。 官方现行表里的档位名（我们目录都没有，故不写进 perModel/freeModelIds）：Claude Fable 5.x、Claude Opus 5.5、Claude Opus 5、Claude Opus 4.x（=Opus 4.8/4.7/4.6/4.5 合并桶）、Claude Sonnet 5.5、Claude Sonnet 5、Claude Sonnet 4.x（=Sonnet 4.6/4.5 合并桶）、Claude Haiku 5.5、Claude Haiku 4.5、Claude Haiku 3.5。注意脚注 3："Sonnet 4.x rate limit is a total limit that applies to combined traffic across Sonnet 4.6 and Sonnet 4.5" —— 这个 4.x 桶不含已退役的 Sonnet 4 (20250514)，所以不能把 1000 RPM 直接挂到我们的 id 上，只能作为条目档位默认值。 两个容易踩的口径问题一并记下：(a) 官方把 ITPM 定义为「只有未缓存输入计数」——"For most Claude models, only uncached input tokens count toward your ITPM rate limits" / "`cache_read_input_tokens` ... Do NOT count toward ITPM"，所以 2,000,000 ITPM 的实际吞吐高于字面；Haiku 3.5 是例外（脚注 4）。(b) RPM 可能被按秒强制——"a rate of 60 requests per minute (RPM) might be enforced as 1 request per second"，对本项目做并发代理有直接影响。另：Anthropic 的文档里没有任何免费档/免费模型，API 侧只有付费 tier；转售相关的段落（"If you operate a platform or gateway, or resell API access, the requests you send for your end customers arrive under your organization"）是要求平台方传 user profile 以便按终端客户隔离封禁，属于允许转售并给出合规做法，不是禁止条款。真正的使用政策/商业条款页本次没抓到（同一区域网关）。'
  },
  "azure_openai": {
    source: "undocumented",
    docUrl: "https://learn.microsoft.com/en-us/azure/ai-services/openai/quotas-limits",
    asOf: "2026-10-29",
    officialNote: "主体确认：registry 里 baseUrl=null（必须用户提供 AZURE_OPENAI_BASE_URL + deployment 名），models=[]。官方配额页**正文可读且数字很多**，但口径是「模型版本 × 部署类型 × 配额层级」三维矩阵，不是单个供应商帽：页面上按 Tier 0–6 分标签、每个模型版本在每个部署类型（GlobalStandard / DataZoneStandard / Standard / Flex 等）各一行 RPM+TPM，例如 gpt-4.1 在 GlobalStandard 行是 1,000 RPM / 1,000,000 TPM，同一模型在 DataZoneStandard 行是 300 RPM / 300,000 TPM；另有换算规则句「use 10 RPM per 1,000 TPM」（部分版本 1 RPM per 1,000 TPM）。因为本 entry 既没有模型清单也没有确定的 deployment/SKU，选任何一行当 provider 帽都是猜，所以 quota 全 null、perModel 留空，source 记 undocumented（含义是「本 entry 无可登记口径」，不是「官方没写」）。要落地必须先让用户填 deployment 对应的模型与层级，再按该行写入。RPD/TPD/月度 token：Azure OpenAI 不按日/月计，配额单位只有 RPM 与 TPM，故这三列对 azure 恒为 null。contextWindow：本页不公布上下文长度，需按模型页另取。警示：该页全部数字的前提是**已付费订阅**（Azure OpenAI 无免费档），且默认配额会按订阅与区域被调整，真实值应以「Microsoft.CognitiveServices/quotaTiers」接口或门户查询为准（页内给出 GET …/quotaTiers/default 的调用方式）。"
  },
  "baichuan": {
    source: "undocumented",
    docUrl: "https://platform.baichuan-ai.com/docs/api",
    asOf: "2026-11-03",
    officialNote: "入口、鉴权头与模型 id 逐字取自官方 API 文档（platform.baichuan-ai.com/docs/api，2026-11-03 抓到）。官方价格页按千 tokens 人民币计价，但没有公布 RPM/RPD/TPM/TPD 或月度 token 帽，因此 quota 全为 null、source=undocumented；不把人民币单价折算成美元或倍率。目录只收当前通用对话 id，未收 Baichuan2-Turbo 等旧版本。"
  },
  "baidu": {
    source: "documented",
    rpm: 60,
    docUrl: "https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j",
    asOf: "2026-10-29",
    perModel: [{ modelId: "deepseek-v4-pro", rpm: 60, tpm: 1e6, contextWindow: 1e6 }, { modelId: "glm-5.2", rpm: 60, tpm: 1e6, contextWindow: 1e6 }, { modelId: "glm-5.1", rpm: 60, tpm: 25e4, contextWindow: 198e3 }, { modelId: "kimi-k2.6", rpm: 60, tpm: 25e4, contextWindow: 256e3 }, { modelId: "qwen3.5-397b-a17b", rpm: 60, tpm: 25e4, contextWindow: 256e3 }, { modelId: "qwen3.5-27b", rpm: 60, tpm: 25e4, contextWindow: 256e3 }, { modelId: "deepseek-v4-flash" }],
    officialNote: "主体确认：baseUrl https://qianfan.baidubce.com/v2 = 百度千帆 v2 OpenAI 兼容端点（website qianfan.baidubce.com，docs cloud.baidu.com/doc/qianfan）。所登记的 RPM/TPM 来自官方「模型列表」表的「默认流控」列，该列是**预置服务按量后付费的默认限流**（不是免费档），故 scope=keyed-account；7 行的 RPM 全为 60，故 provider 级 rpm=60，TPM 逐模型不同（1000000 / 250000），只落在 perModel，provider 级 tpm 留 null。官方**没有**公布 RPD/TPD（每日/每小时请求与 token 帽），一律 null。免费池确实存在但口径不匹配：https://cloud.baidu.com/doc/qianfan/s/Imi2rpirg 写的是自 2025-10-24 起自动开通时**一次性**发放「100万 tokens / 有效期 3 个月」，既不是月度池也不是 RPM，因此 monthlyTokens 留 null；且发放清单（ERNIE-4.5-Turbo 系列 / ERNIE-X1-Turbo / DeepSeek-R1 / DeepSeek-V3-250324 / DeepSeek-V3.1 / Kimi-K2-Instruct / Qwen3-235B-A22B-Instruct-2507 / Qwen3-Coder / bge-*）里**没有**本目录任何一个 model 参数，故 freeModelIds 为空——不要把那 100 万算到这些模型头上。另两处与目录不符：kimi-k2.6 官方标注「即将下线」；deepseek-v4-flash 只有 deepseek-v4-flash-0731 一个接入点。TPM/RPM 配额可通过「配额管理 / QPS叠加包」付费扩容（cloud.baidu.com/doc/qianfan/s/Gmh4su5tz、Gmi5wd4fm）。"
  },
  "bailian": {
    source: "undocumented",
    docUrl: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
    asOf: "2026-11-03",
    officialNote: "主体确认：中国站百炼的 OpenAI 兼容线；目录 baseUrl 用官方长期保留的 https://dashscope.aliyuncs.com/compatible-mode/v1，控制台若给 WorkspaceId 专属域名可用 baseUrl 覆盖。官方限流/额度在控制台按账号与模型档位展示，本次可读文档页没有逐模型 RPM/TPM 数字，故 quota 全 null。与 alibaba_cloud（新加坡国际站）是两个计费域，Key 不可混用。模型 id 取自百炼模型列表与 Token Plan 支持表，按量与套餐的可用集合以控制台为准。"
  },
  "bailian_token_plan": {
    source: "undocumented",
    docUrl: "https://help.aliyun.com/zh/model-studio/token-plan-overview",
    asOf: "2026-11-03",
    officialNote: "Token Plan 的额度单位是 Credits，不是 token，按本仓规则不折算、不登记进 quota，故 source=undocumented。专属 Key 以 sk-sp- 开头，且与按量付费（sk-）、Coding Plan（sk-ws-）三套凭证完全隔离；Base URL 填错会导致 401/403 或走按量计费。官方支持表里同时列了图像/视频/语音模型，目录只收文本模型 id。"
  },
  "bazaarlink": {
    source: "documented",
    rpm: 10,
    docUrl: "https://bazaarlink.ai/pricing",
    asOf: "2026-10-29",
    perModel: [{ modelId: "auto:free", rpm: 10 }],
    officialNote: 'Only the per-minute request rate is published: the free plan (入門版, 免費) is 10 req/min, the paid 商業版 is 100 req/min and 企業版 is unlimited. No RPD, TPM, TPD, monthly token pool or context window appears anywhere on bazaarlink.ai or bazaarlink.ai/api/v1/docs (the docs page exposes only the OpenAI-compatible model catalogue, where auto:free is listed at 0/0 pricing with no limits), so those fields stay null. The rpm=10 is an account-wide plan rate, not specific to the auto:free slug. ToS note: https://bazaarlink.ai/terms - "未經 BazaarLink 事先書面同意，您不得將本服務之全部或一部轉售、經銷、轉租或以其他商業方式再散布予第三方。" (no reselling/distribution to third parties without prior written consent).'
  },
  "bedrock": {
    source: "undocumented",
    docUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-mantle.html",
    asOf: "2026-10-29",
    officialNote: "主体确认：baseUrl https://bedrock-mantle.us-east-1.api.aws/v1 = AWS Bedrock 的 bedrock-mantle OpenAI 兼容端点（Key 走 AWS_BEARER_TOKEN_BEDROCK）。官方正文可读且明确了两件事：(1) 该端点**不设 RPM**，只按「每模型每分钟输入 token」与「每模型每分钟输出 token」两条配额限流（原句见 evidence），请求还会按「输入 token + max_tokens」预估预扣（超配额直接 429）；(2) 具体数值**文档里一个都没有**——「Quota values vary by model, account, and AWS Region」，只能在 Service Quotas 控制台按账号查看。所以 tpm 只能留 null（连是输入帽还是输出帽都不确定），rpm 不是「0/无限」而是「官方声明不适用」。免费层：https://aws.amazon.com/free/ 只把 Amazon Bedrock 列进「Available on both plans」的产品清单，https://aws.amazon.com/bedrock/pricing/ 正文抓到的 Free 行是 Sensitive information filters (regular expression) 与 Word filters 两项功能免费，**没有**任何面向模型的免费 token 额度表述；bedrock 定价页的按量单价之外未见免费池数字，故 monthlyTokens 与 freeModelIds 留空——如实标注：官方没有可引用的 Bedrock 免费推理额度数字。文档侧栏另有 quotas-runtime 端点页（同一口径，token 帽、控制台取值），区域端点列表在 inference-responses-api.md#bedrock-mantle-supported。Key/模型可用性按区域隔离（registry notes 已写），跨区换 baseUrl 后配额是另一套。"
  },
  "byteplus": {
    source: "undocumented",
    docUrl: "https://docs.byteplus.com/en/docs/BytePlusModelArk/153863",
    asOf: "2026-10-29",
    officialNote: "主体确认：baseUrl https://ark.ap-southeast.bytepluses.com/api/coding/v3 = BytePlus ModelArk（火山方舟国际站，新加坡区域）编程端点，registry category=free-tier。URL 试了但读不到正文：docs.byteplus.com 整站是 SPA，返回的 HTML 首行即「You need to enable JavaScript to run this app」，正文不在响应里；llms.txt（/en/docs/BytePlusModelArk/llms.txt 与 /llms.txt）也返回同一个 app shell；/api/docs/detail?docId=153863 与 …/153863.md 同样只是 shell，没有可读文档正文；www.byteplus.com/en/product/modelark 产品页抓到的 33KB 里也没有任何 free/credit/rate-limit 句子。因此 RPM/RPD/TPM/TPD/monthlyTokens/contextWindow 全 null。registry 现有的「Free credits for new accounts (9router notice)」是上游目录的转述，**不是**官方正文，本轮未能证实也无法证伪，故不据此登记任何数字。模型 id 写法（seed-2-0-pro-260328 / seed-2-0-code-preview-260328 / kimi-k2-thinking-251104 / glm-4-7-251222 / gpt-oss-120b-250805）带日期后缀，与官方 ModelArk 控制台命名一致与否需在登录后核对；本应用侧 authKind=apiKey，可保存 Key，但额度只能等实际 429 响应头回传后按 learned 档补齐。"
  },
  "cerebras": {
    source: "documented",
    rpm: 5,
    tpm: 3e4,
    tpd: 1e6,
    contextWindow: 65e3,
    docUrl: "https://inference-docs.cerebras.ai/support/rate-limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "gpt-oss-120b", rpm: 5, tpm: 3e4, tpd: 1e6, contextWindow: 65e3 }],
    officialNote: "主体确认：baseUrl https://api.cerebras.ai/v1（website cerebras.ai，docs inference-docs.cerebras.ai，页面 dateModified 2026-10-07）。登记的数字取自官方「Limits by Tier」的 **Free Trial** 标签页：gpt-oss-120b 行 RPM 5 / Uncached TPM 30K / Total TPM 90K / TPH 1M / TPD 1M——tpm 取的是 uncached 30K（主帽），total 90K 与 TPH 1M 只在此记录，字段表里没有对应列。**两家官方页互相矛盾**，必须留着出处：模型页 /models/openai-oss.md 写「Free tier rate limits: 30 requests/min, 60k input tokens/min, 1M tokens/day」，比限速页高 6 倍/2 倍，本轮无法判定哪个是当前生效值（限速页自己也说「overview of general limits…具体以 Cloud Console 的 Limits 页为准」），已按「档位表格优先」登记 5/30K/1M，并把 30/60K 原句保留在 evidence。RPD 官方**未公布**（Free Trial 表只有 RPM/TPM/TPH/TPD 轴，无 RPD 列）→ null。contextWindow 65000 取 free 档（付费档 131072）。最重要的口径警示：所谓 Free Trial **不是永久免费层**——官方 FAQ 原话「Is there a permanently free tier? No.」，它是注册后加验证支付方式送 $5 额度、30 天过期，用尽即停；「If you skip adding a payment method at sign-up, Playground and API access remain inactive until you do」。因此把 cerebras 当「免费池」用是不准确的，它是限时限额试用（scope 记 free-tier 仅因该档位数字是免费档，实际需绑卡）。目录侧风险：Free Trial 表只列 gpt-oss-120b 与 qwen-3.8-27b 两行，本 entry 其余 5 个 id（zai-glm-4.7、llama-3.3-70b、llama-4-scout-17b-16e-instruct、qwen-3-235b-a22b-instruct-2507、qwen-3-32b）已不在当前免费档表格中（部分只存在于 Dedicated Inference），不给它们填任何数字；另有限速页脚注 qwen-3.8-27b 的 total TPM 被临时从 450K 提到 750K，属付费档信息，与本目录无关。"
  },
  "cheaperinference": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: "Homepage https://cheaperinference.com/ contains no rate-limit numbers. Paths tried but unreadable: https://cheaperinference.com/pricing (404), https://cheaperinference.com/docs (404), https://docs.cheaperinference.com/ (fetch failed), https://cheaperinference.com/terms (404), https://cheaperinference.com/legal (404), https://cheaperinference.com/about (404). No ToS page could be read, so the resale / competing-service position is unknown rather than absent. Single shipped model gpt-5.4-mini has no published RPM/RPD/TPM/TPD/context figures; nothing recorded."
  },
  "chutes": {
    source: "undocumented",
    docUrl: "https://chutes.ai/docs",
    asOf: "2026-10-29",
    officialNote: "官方 docs 只描述按 token 的 pay-as-you-go 定价与 credits（'Chutes is a decentralized, serverless inference platform for open-source AI models.'），未公布任何 RPM/RPD/TPM/TPD 数字。网传 '每天 200 次免费调用/模型' 与 '2000/day' 均来自中文博客/第三方聚合，非官方正文，未采信。故全 null、undocumented。"
  },
  "cline_pass": {
    source: "undocumented",
    docUrl: "https://docs.cline.bot/getting-started/clinepass",
    asOf: "2026-10-29",
    officialNote: `registry: category apikey / authKind apiKey / baseUrl https://api.cline.bot/api/v1 / authUrl https://app.cline.bot / modelsUrl https://api.cline.bot/api/v1/ai/cline/recommended-models / 11 models 全部带 cline-pass/ 前缀 / 无 freeModelsHint。官方 ClinePass 页**只声明有三个限额窗口（5 小时滚动 / 自然周 / 自然月），没有公布任何一个具体数字**，也没有 per-model 上限表或上下文数字，所以六个字段全 null、记 undocumented。$9.99/月与 '2-5x the API rate limits' 只是倍率描述，不是可录入的绝对帽；倍率的分母（standard api rate）官方也未给数字。ClinePass 是订阅制（不是免费池），且页面把它描述为 "completely optional"。另记：页面还写明该订阅衡量的是 usage（按 underlying per-1M-token 价格折算），即限额单位实际是折算金额/token，不是请求数。**未发现"只能从 Cline 客户端使用"类条款**，但目录里这些 id（cline-pass/...）本身来自推荐模型接口，需密钥与订阅。`
  },
  "cloudflare": {
    source: "undocumented",
    docUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    asOf: "2026-10-29",
    officialNote: "官方免费额度单位是 Neurons/天（GPU 算力计量单位），不是 token，也不是固定 RPM/RPD。官方 pricing 正文：免费分配 '10,000 Neurons per day'，每日 00:00 UTC 重置；超出部分 $0.011 / 1,000 Neurons（Workers Free 与 Paid 均含此免费额度）。官方 pricing 页未公布 Neuron↔token 的统一换算表（仅个别模型页给出 neurons per 1M input tokens，如 gpt-oss 类），故按要求把原单位记入 notes、quota 各字段填 null，不自行折算。"
  },
  "cohere": {
    source: "documented",
    rpm: 20,
    docUrl: "https://docs.cohere.com/docs/rate-limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "command-r-plus-08-2024", rpm: 20, contextWindow: 128e3 }, { modelId: "command-r-08-2024", rpm: 20, contextWindow: 128e3 }, { modelId: "command-a-03-2025", rpm: 20, contextWindow: 256e3 }, { modelId: "command-a-plus-05-2026", rpm: 20, contextWindow: 128e3 }],
    officialNote: '口径：rate-limits 页表格列名是 Trial rate limit / Production rate limit，两个档都公布，按要求取免费档（Trial）= 20 req/min，付费档同表是 500 req/min（Command A+ / A Reasoning / A Translate / A Vision 的付费档写的是 Contact sales@cohere.com，不是数字）。表头单位是 "expressed in requests per minute"，所以 rpm 可直接取；官方没有公布 TPM/TPD/RPD，只有月度请求数帽："Trial keys (and prod keys on newer Chat model variants) are limited to 1,000 API calls a month."（是调用次数、不是 token 数，故 monthlyTokens 保持 null，不要当 token 预算用）。contextWindow 取自各模型自己的官方模型页（正文完整抓到），模型页上的 "Model ID" 与 registry 的四个 id 逐一对上。同一页还说明 Embed 2,000 inputs/min、Rerank 10 req/min（Trial）等非 Chat 端点，与 Chat 帽不同。ToS 相关：docs.cohere.com/docs/going-live 正文要求升级生产 Key 前必须确认条款 —— "You must acknowledge Cohere’s SaaS agreement and terms of service"，并且涉敏感用途时 "your production key may be rate limited the same as a trial key until our safety team reaches out and manually approves your use case"。页面同时标注 "This page is for version v2 API (default)"，v1 另有限流页。'
  },
  "deepinfra": {
    source: "undocumented",
    docUrl: "https://docs.deepinfra.com/account/rate-limits",
    asOf: "2026-10-29",
    officialNote: "官方 rate-limits 页给出的唯一数值口径是并发而非 RPM/TPM/token：默认 '200 concurrent requests per model'（本 schema 无并发字段，故 rpm/rpd/tpm/tpd 全 null）。category apikey 付费、按 token 计费；博客提到的 '$5 free credits' 非限速正文。无 RPM/TPM/RPD/TPD/monthlyTokens/contextWindow 官方数字 → 记 undocumented（数字仅并发，单位不符）。"
  },
  "deepseek": {
    source: "documented",
    contextWindow: 1e6,
    docUrl: "https://api-docs.deepseek.com/quick_start/rate_limit",
    asOf: "2026-10-29",
    perModel: [{ modelId: "deepseek-v4-pro", contextWindow: 1e6 }, { modelId: "deepseek-v4.1-flash", contextWindow: 1e6 }, { modelId: "deepseek-chat" }, { modelId: "deepseek-reasoner" }],
    officialNote: '正文完整抓到（api-docs.deepseek.com/quick_start/rate_limit 与 /quick_start/pricing）。官方唯一的帽是并发（不是 RPM/TPM/RPD/TPD），所以这四个字段留 null，把数字写在 evidence/notes 里："A request counts as one concurrent connection from the time it is sent until the model response is complete"、"Concurrency limits are calculated at the account level, regardless of which API Key is used"、"when the concurrency limit is exceeded, you will receive an HTTP 429 error code"，并按 user_id 细分："the concurrency limit for deepseek-flash is 2500, and for deepseek-v4-pro it is 500"。扩容免费："There is no additional cost for capacity expansion." contextWindow=1M 取自定价页表头 CONTEXT LENGTH | 1M（两个模型列合并单元格），MAX OUTPUT 为 MAXIMUM: 384K。名称对应：官方现行可调用 id 是 deepseek-flash（正文注明由 DeepSeek-V4.1-Flash-1017 承载）与 deepseek-v4-pro；registry 的 deepseek-v4.1-flash 我按官方那句命名说明对应到 flash 一档，属可核对的转述而非新增数字。legacy 名 deepseek-v4-flash / deepseek-v4-flash-vision-exp 官方已注明 "the corresponding models have been retired; their requests are served by DeepSeek-V4.1-Flash-1017 and billed at the Flash price"；deepseek-chat / deepseek-reasoner 与 deepseek-v4-pro-max / -none 在当前官方限流页与定价页上都不再出现，故这些行全 null。免费池：官方没有任何免费档（按 token 计费 + 账户并发帽），freeModelIds 留空。'
  },
  "experiential": {
    source: "documented",
    rpm: 10,
    tpm: 25e4,
    tpd: 1e6,
    docUrl: "https://www.experientiallabs.ai/pricing",
    asOf: "2026-10-29",
    officialNote: `registry: id experiential / name 'Experiential Labs' / category apikey / authKind apiKey / baseUrl https://api.experientiallabs.ai/v1 / website https://www.experientiallabs.ai/ / authUrl https://platform.experientiallabs.ai/settings/api-keys / models 只有 [union-alpha] / 无 freeModelsHint。官方 https://platform.experientiallabs.ai/docs 标题 'Overview · Experiential'，无限速数字；数字只出现在官方 pricing 页。录入的三个值（rpm 10 / tpm 250000 / tpd 1000000）全部来自上面那句原话，单位就是 requests/min 与 tokens/min、tokens/day。**重要口径警告**：官方原句把这套免费帽点名给 "DeepSeek, Luna and Clef" 三个模型族，并没有点名我们目录里唯一的 union-alpha，所以这三值只能按"账号级免费层共享帽"理解，UI 若把它直接标成 union-alpha 的上限就是在猜；perModel 因此留空。同一页正文还出现过 "Up to 240 requests/min" 与表格 10/min 并存的自相矛盾表述，未采用的 240 不予录入。contextWindow 官方 pricing 页只写 'Context windows up to 1M tokens'（泛指上限、未分模型），不录入。免费层声明 'No general credits'。`
  },
  "featherless": {
    source: "undocumented",
    docUrl: "https://featherless.ai/blog/llm-api-pricing-comparison-2026-complete-guide-inference-costs",
    asOf: "2026-10-29",
    officialNote: "registry: category apikey / authKind apiKey / baseUrl https://api.featherless.ai/v1 / authUrl https://featherless.ai/account/api-keys / modelsUrl https://api.featherless.ai/v1/models / 8 models（deepseek-ai/DeepSeek-V4-Pro、deepseek-ai/DeepSeek-V4-Flash、zai-org/GLM-5.2、zai-org/GLM-5.1、moonshotai/Kimi-K2.7-Code、moonshotai/Kimi-K2.6、moonshotai/Kimi-K2.5、Qwen/Qwen3-32B）/ 无 freeModelsHint。官方限速的**单位是并发请求数（concurrent requests），不是每分钟/每天请求，也不是 token**：Basic 2 并发（限 15B 以内模型）/ Premium 4 并发 / Scale 8+ 并发，token 口径官方写 'unlimited tokens'。因为这些数字无法填进 rpm/rpd/tpm/tpd/monthlyTokens/contextWindow 任何一个字段，六个字段全部 null，原单位与数字只写进本 notes 与 evidence。取数出处限定在 featherless.ai 自己域名下的官方页面；https://featherless.ai/pricing 与 https://featherless.ai/docs 只返回脚本与样式、读不到正文（URL 试了但读不到），docs.featherless.ai 抓取直接 fetch failed。**该数字出自官方站点的定价对比博客（标注 Last Updated: March 4, 2026），不是独立 rate-limit 文档页，时效性弱于专页，使用前应复核。** 没有面向匿名免费池的官方限速。"
  },
  "fireworks": {
    source: "undocumented",
    docUrl: "https://docs.fireworks.ai/serverless/rate-limits",
    asOf: "2026-10-29",
    officialNote: '正文完整抓到，但数字口径与 quota 字段对不上，所以刻意全部留 null：官方 Serverless 限流只有 TPM 三个维度（Total Prompt TPM = 输入 tokens/min 含缓存、Uncached Prompt TPM、Generated TPM = 输出 tokens/min），不公布 RPM/RPD/TPD；而且帽是「每账户每模型自适应」的，不是单一账户值。原文基线上限表（按模型总参数量分档）：Small(<800B) 216M / 54M / 2.16M；Medium(800B–<1.6T) 43.2M / 10.8M / 432k；Large(≥1.6T) 21.6M / 5.4M / 216k，并注明 "Fast, Priority, and US-only variants of a model share the same tier and ceilings as the base model. Models without a known parameter count use Large ceilings."。自适应规则："If your recent one-minute usage is above 50% of your current limit, the limit increases by 25%, and no more than once every 15 minutes, until it reaches your base ceiling."，且上限随消费档走（"A higher account Spending Tier correlates with higher upper bound rate limits; enterprise accounts get higher upper bounds automatically"），表里的数值是 Tier 3+ 才可达的最大基线，低档更低。官方点名的 Small 档模型（DeepSeek V4.1 Flash、GLM 5.3、MiniMax M3、OpenAI GPT OSS 120B 等）与 registry 的三个 id（accounts/fireworks/models/deepseek-v3p1、llama-v3p3-70b-instruct、qwen3-235b-a22b）无一重合，把这三家归到哪一档需要额外知道参数量，属记忆推断，因此不做 perModel 填数，也不换算成 quota.tpm。免费池：页面上没有免费档概念（只有 Spending Tier 与 Priority tier 升级），故 freeModelIds 为空。'
  },
  "gemini": {
    source: "undocumented",
    docUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
    asOf: "2026-10-29",
    officialNote: "本 entry 是 registry 里 category=free-tier 的 Google AI Studio Key 通道（authUrl aistudio.google.com/apikey，baseUrl generativelanguage.googleapis.com/v1beta/openai）。官方限速页正文完整可读（Last updated 2026-10-26 UTC），但**这一版页面里已经没有免费档的 RPM/TPM/RPD 逐模型表**：该节只写「限额取决于用量层级等因素，请到 AI Studio 查看」「每个模型变体的 RPM 明细见 AI Studio Rate Limit 页」。页面上带数字的只有两类：(a) 消费型限速 Free = N/A，Tier 1/2/3 = $10 / $50 / $200 每 10 分钟滚动窗口（单位是美元，不是请求或 token，不能进 quota）；(b) Batch API 的入队 token 帽（Tier 1 按模型 3,000,000 / 5,000,000 / 10,000,000，Batch 并发作业 100、输入文件 2GB、文件存储 20GB），这属于批处理通道，与本应用的实时 chat 线不同轴，故也不登记。层级门槛本身是可读的（Free=Active project or free trial；Tier 1=绑定有效计费账号，上限 $250；Tier 2=$100+3 天；Tier 3=$1,000+30 天），可用来解释「为什么必须看到 AI Studio 才知道帽值」。模型详情页（/gemini-api/docs/models）也没有逐模型上下文窗口表格，只在两款模型的宣传语里出现「1M context window」，无法可靠映射到本目录 11 个 id，故 contextWindow 留 null。搜索引格里流传的「免费档 15 RPM / 1M TPM / 1,500 RPD」全部来自第三方博客与论坛转述，按裁定不录入。取证说明：ai.google.dev 在本机直连 curl 返回 000（连接被重置），改经本地代理抓官方页面；未向 generativelanguage.googleapis.com 发过任何请求。"
  },
  "glm": {
    source: "undocumented",
    docUrl: "https://docs.z.ai/guides/llm/glm-5.3.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "glm-5.3", contextWindow: 1e6 }],
    officialNote: "主体确认：baseUrl https://api.z.ai/api/anthropic/v1 仍是 Z.ai 国际站端点（authUrl 写的是 open.bigmodel.cn，但端点主体是 z.ai），因此用 docs.z.ai 那份文档，不用中文站。Anthropic-wire 路由没有任何独立限速文档：docs.z.ai/api-reference/rate-limit.md 重定向到登录控制台（z.ai/manage-apikey/rate-limits，JS 壳无正文），未读到数字 → rpm/rpd/tpm/tpd/monthlyTokens 全 null。唯一登记值是同主体模型页的 GLM-5.3 上下文 1M。"
  },
  "glm-cn": {
    source: "undocumented",
    docUrl: "https://docs.bigmodel.cn/cn/guide/start/model-overview.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "glm-5.3", contextWindow: 1e6 }, { modelId: "glm-5.2", contextWindow: 1e6 }, { modelId: "glm-5.1", contextWindow: 2e5 }, { modelId: "glm-5", contextWindow: 2e5 }, { modelId: "glm-4.7", contextWindow: 2e5 }, { modelId: "glm-4.6", contextWindow: 2e5 }, { modelId: "glm-4.5-air", contextWindow: 128e3 }],
    officialNote: "主体确认：baseUrl https://open.bigmodel.cn/api/coding/paas/v4 = 智谱中文站（website open.bigmodel.cn），全部取 docs.bigmodel.cn 那份文档，不用 docs.z.ai。限速官方页 https://docs.bigmodel.cn/cn/api/rate-limit.md 正文只有机制描述，明确把数值推到控制台页：「可通过 [速率限制](https://bigmodel.cn/usercenter/proj-mgmt/rate-limits) 查看您的账户目前各模型可调用的速率」「不同套餐用户，默认可用的模型并发上限不同」——该控制台页需登录，抓不到正文，且平台按「并发数」而非 RPM/TPM 管控，故 rpm/rpd/tpm/tpd/monthlyTokens 全 null（有页面但无公开数字）。Coding Plan 页 https://docs.bigmodel.cn/cn/coding-plan/overview 公布的是积分：「套餐同时设有每 5 小时和每周额度上限」Lite 2,000/10,000、Pro 12,000/60,000、Max 28,000/140,000，单位「积分」，非请求/token 帽 → 不登记进 quota。freeModelIds 是官方定价页标注「免费」的 Flash SKU，其中 glm-4.7-flash / glm-4.5-flash / glm-4.7-flashx 不在本条目 models[] 内（本条目没有任何 Flash 行），仅作主体事实记录。ToS 警示（逐字）：「套餐仅限在官方支持的指定工具与产品环境中使用。在除规定工具外调用 API，不可享用 Coding 套餐的额度。」——本条目端点正是 coding 端点，用它做通用代理不符合该条。"
  },
  "groq": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: '带代理仍取不到，且这次把拦截性质确认了：不是 Cloudflare 非浏览器拦截，是 Groq 边缘直接对出口 IP 返 403 JSON。用 -x http://127.0.0.1:7890 并另配 Chrome 131 / Safari 17.4 两种 UA、Accept 头逐一试过，记录原始返回：https://console.groq.com/docs/rate-limits → **403**，正文 33 字节 `{"error":{"message":"Forbidden"}}`；https://console.groq.com/docs/rate-limits.md → 403 同 33 字节；https://console.groq.com/docs/models → 403；https://console.groq.com/docs/limits → 403；https://console.groq.com/docs/api-reference/chat → 403；https://console.groq.com/llms.txt → 403（33 字节）；整个 https://groq.com/docs → 403（同一 33 字节 JSON）。可见 console.groq.com 的文档子树对本机代理出口（ipinfo.io: 155.117.84.36, city/country = Hong Kong / HK）是**整片 403**，与路径、UA、是否 .md 无关。 公开营销站这条线也认真走过，结论是「页面无数字」：https://groq.com/docs/rate-limits → 404（31,306 字节的站点 404 外壳）；https://groq.com/pricing → **200，55,004 字节**，但剥标签后正文只有 947 字符，全是公司宣传语（"Groq is the premier neocloud for fast inference"…），限速/RPM/TPM/free/tier 关键词 grep 0 命中，说明该页数字由前端渲染、服务端 HTML 里没有；https://groq.com/llms.txt → 404；https://groq.com/sitemap.xml → 200，7,306 字节，逐条筛过全部 URL，**没有任何 docs/limit/rate 类页面**，只有 newsroom 与 blog 的 PR 文；https://support.groq.com/ → 200 但只是 Contact 页，站内无 rate limit 文章链接。 因此按铁律全部留 null、perModel 与 freeModelIds 留空、source=undocumented：官方公开文档既取不到、可达页面也不含数字，Groq 的 per-model RPM/TPM 具体数值只在登录后的 Console（console.groq.com/docs/rate-limits 及账户限速页）里。我们目录的四个 id（`llama-3.3-70b-versatile`、`meta-llama/llama-4-maverick-17b-128e-instruct`、`qwen/qwen3-32b`、`openai/gpt-oss-120b`）没有任何官方正文可核对，连上下文窗口都无法登记。 补充两点供上层：(1) 换到 Groq 支持地区且未被边缘 403 的出口，或用真实浏览器，才可能取到；(2) 顺带取到了 Groq 的服务条款 https://groq.com/terms-of-use（200，105,129 字节，剥标签正文 19,977 字符），里面有一条禁止转售表述，见逐字短句："You agree not to copy, modify, or create a derivative work of, sell, resell, sublicense, transfer, or distribute any content on the Websites, in whole or in part." —— 注意其约束对象是 "content on the Websites"（网站内容），不是 API 调用额度的转售，作为聚合代理项目要不要据此收敛 Groq 渠道请上层裁定；另有一条爬取禁令 "In connection with your use of the Websites you will not engage in or use any data mining, robots, crawling, scraping, or data gathering or extraction methods"，与本任务只读文档不请求 API 的做法不冲突。'
  },
  "huggingface": {
    source: "undocumented",
    docUrl: "https://huggingface.co/docs/inference-providers",
    asOf: "2026-10-29",
    officialNote: "registry 用的是 router.huggingface.co（Inference Providers 聚合路由），其配额按月度推理 credits（付费/PRO）与底层各 provider 限速计，官方并未对免费层公布单一 RPM/TPM/RPD 数字。官方 Hub 限速页 huggingface.co/docs/hub/rate-limits 只覆盖 Hub API / resolvers / pages 三类（按 5 分钟窗口），不覆盖 Inference 推理，且本会话 WebFetch 连续 'fetch failed' 读不到正文。各家第三方整理的 '30 RPM'/'$0.10 monthly credits' 均非官方正文，未采信。故全 null、undocumented。"
  },
  "hyperbolic": {
    source: "undocumented",
    docUrl: "https://hyperbolic.xyz/pricing",
    asOf: "2026-10-29",
    officialNote: "官方仅有按 token 的价目与注册试用 credits 说明，未公布 RPM/RPD/TPM/TPD 数字。试抓 https://hyperbolic.xyz/pricing（301 跳到 www.hyperbolic.ai/pricing）返回 404，读不到正文；检索到的 '$25 free trial credits'、'200 req/m' 等来自第三方聚合仓库/博客，非官方正文，未采信。全 null、undocumented。"
  },
  "kilo": {
    source: "undocumented",
    docUrl: "https://kilo.ai/docs/getting-started/rate-limits-and-costs",
    asOf: "2026-10-29",
    officialNote: `registry: category free-tier / authKind none（匿名可用）/ baseUrl https://api.kilo.ai/api/gateway / modelsUrl .../gateway/models / 4 models 全部即 freeModelsHint：kilo-auto/free、nvidia/nemotron-3-super-120b-a12b:free、nvidia/nemotron-3-ultra-550b-a55b:free、kwaipilot/kat-coder-pro-v2.5:free。官方 rate-limits 页给出的唯一数字限速是 **"200 requests per hour per IP"（窗口是每小时、按 IP 计，既不是 RPM 也不是 RPD）**，所以 rpm/rpd 一律留 null，原句与原单位写在 evidence/notes；不做 200/60≈3.3 RPM 的换算，因为小时窗换算成分钟窗会谎报突发能力。付费模型官方写 'No gateway limits; upstream provider limits apply'，即没有 Kilo 自己的帽。Auto Free / BYOK 在 Kilo 侧 $0。**ToS 取证结果：Kilo 官方两页（rate-limits-and-costs、getting-started/using-kilo-for-free、docs/gateway）都没有"免费模型只能从 Kilo 自家客户端内使用"这类条款**；相反的两条约束是 (1) Auto Free 可能路由到会记录 prompt/output 的上游，勿提交个人或机密数据；(2) NVIDIA 免费端点属试用口径（'Trial use only - do not submit personal or confidential data'，并同意 NVIDIA API Trial Terms of Service），对应我们目录里那两个 nvidia/...:free。免费池存在，除 200 req/hr/IP 之外官方不公布其它数字（其它 :free 模型只说"受上游限速"）。`
  },
  "kimchi": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: 'Official pages https://kimchi.dev and https://kimchi.dev/pricing loaded but contain no rate-limit numbers (explicitly reported as "NO RATE LIMIT NUMBERS ON THIS PAGE"). Docs path guesses that failed: https://docs.kimchi.dev/ (fetch failed), https://kimchi.dev/docs/ (404). https://app.kimchi.dev/terms loaded and contains NO resale / competing-service clause. The catalogue classifies kimchi as free-tier with 8 models but the site publishes no RPM/RPD/TPM/TPD/monthly/context figures, so nothing was recorded; freeModelIds is empty because no model is officially labelled free.'
  },
  "kimi": {
    source: "undocumented",
    docUrl: "https://platform.kimi.com/docs/pricing/chat",
    asOf: "2026-10-29",
    perModel: [{ modelId: "kimi-k2.5", contextWindow: 262144 }],
    officialNote: "主体确认：baseUrl https://api.moonshot.ai/v1 = Moonshot 国际站；其官方限速页 https://platform.moonshot.ai/docs/pricing/limits 301 跳到 https://platform.kimi.ai/docs/pricing/limits，该页正文只写「Rate limits are applied based on each account's cumulative recharge amount」「Vouchers do not count towards the cumulative recharge total」，Tier 表格在抓到的源码里是空表（前端渲染），/docs/pricing/limits.md 变体同样是空表结构 → 国际站本体的 rpm/tpm/tpd/并发数字读不到，全部 null。中文站 platform.moonshot.cn/docs/pricing/limits 301 → platform.kimi.com/docs/pricing/limits，抓取结果亦为「The table body is empty in the provided page source」。搜索索引里流传的 Tier0 ¥0/并发1/RPM 3/TPM 500,000/TPD 1,500,000 属第三方转述且彼此矛盾（并发一处写 15、一处写 50），按要求不采信、不凭记忆填。唯一登记到的数字是同主体 pricing/chat 页的 K2 系列上下文 262,144 tokens（本条目模型 kimi-k2.5 属 K2 系列；该句是系列级表述，非单模型行）。注意：Moonshot 的限速在用户/账户级而非 Key 级，且「目前我们在所有模型中共享速率限制」（platform.kimi.com/docs/introduction，该页只有机制定义、无数字），单 Key 多用户共用会互相挤占。"
  },
  "kimi_code": {
    source: "undocumented",
    docUrl: "https://platform.kimi.com/docs/pricing/chat",
    asOf: "2026-10-29",
    perModel: [{ modelId: "kimi-k3", contextWindow: 1048576 }, { modelId: "k3", contextWindow: 1048576 }, { modelId: "kimi-k2.7-code", contextWindow: 262144 }, { modelId: "kimi-k2.7-code-highspeed", contextWindow: 262144 }, { modelId: "kimi-k2.6", contextWindow: 262144 }, { modelId: "kimi-k2.5", contextWindow: 262144 }, { modelId: "kimi-k2.5-thinking", contextWindow: 262144 }],
    officialNote: "主体确认：baseUrl https://api.kimi.com/coding/v1 = Kimi Code 订阅（www.kimi.com/code），与 platform.kimi.com 同主体，用 kimi.com 那份文档。官方订阅文档 https://www.kimi.com/code/docs/kimi-code/membership 与 https://www.kimi.com/help/kimi-code/benefits 只描述窗口机制：「每 5 小时的滚动频率窗口」「每 7 天自动刷新，未用完不累积」「所有登录设备和 API Key 共享同一套配额」，并明确要求到 Kimi Code 控制台看剩余额度与频限——正文没有任何 RPM/TPM/TPD/并发数字 → quota 全 null。另抓 https://www.kimi.ai/zh-hans/help/kimi-code/membership-guide，抓到的是「仅提及 frequency limits，未给数值」。搜索索引里那份「每 5 小时约 300–1,200 次请求、最高 30 路并发」在我直接抓取的同页读不到，故不登记。上下文数字来自同主体 pricing/chat 页，且是「系列级」表述（K3 系列 / K2 系列），kimi-for-coding、kimi-for-coding-highspeed、kimi-latest 无法从官方正文判定属哪个系列 → 其 contextWindow 留 null。"
  },
  "lightning": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: "Lightning AI is a real vendor (https://lightning.ai/), and its Model APIs gateway is the baseUrl here (https://lightning.ai/api/v1), but no official rate-limit page could be read. Paths tried: the catalogue's own authUrl https://lightning.ai/lightning-ai/model-apis/models (404), https://lightning.ai/docs/community-cloud/pages/get-started/model-apis (404), https://www.lightning.ai/docs/open-source/model-apis (404), https://lightning.ai/pricing (404), https://lightning.ai/legal (404), https://lightning.ai/legal/terms-of-use (404), https://lightning.ai/privacy (404), https://lightning.ai/security (404), https://lightning.ai/changelog (404), https://lightning.ai/docs (fetch failed), https://lightning.ai/api-inference (fetch failed), https://lightning.ai (fetch failed). Because no body with numbers was obtained, all fields are null and the entry is undocumented - NOT because Lightning publishes nothing, but because it could not be read from this environment. Terms of use not located, so the resale position is unknown."
  },
  "llamacpp": {
    source: "undocumented",
    docUrl: "https://github.com/ggml-org/llama.cpp",
    asOf: "2026-10-29",
    officialNote: "本机运行时，无上游额度。registry: category local / authKind none / baseUrl http://localhost:8080/v1（baseUrlOverrideEnv LLAMACPP_BASE_URL）/ models 为空。llama.cpp server 是用户自己起的进程，只有并发/上下文这类本地参数，没有账号额度，官方不存在限速数字可登记，六个字段 null、source undocumented、local true。UI 不得为它显示额度上限或做额度预检。"
  },
  "llm7": {
    source: "undocumented",
    docUrl: "https://llm7.io/",
    asOf: "2026-10-29",
    officialNote: "registry: category apikey / authKind apiKey / baseUrl https://api.llm7.io/v1 / website https://llm7.io/ / authUrl https://dash.llm7.io/ / 8 models (gpt-5.5, claude-opus-5, deepseek-v4-flash, grok-4.5, kimi-k3, default, fast, pro)，无 freeModelsHint。官方取证结果：https://llm7.io/ 抓到正文但没有任何限速/额度数字；https://llm7.io/docs 返回 404；docs.llm7.io 可读但不含任何限速、RPM/RPD、TPM/TPD、月度 token 或上下文数字。搜索引擎给出的 '30 RPM (120 with token)' 全部来自第三方清单（awesome-free-llm-apis、OmniRoute、cnblogs 转载），按裁定不采信、不录入。全部字段留 null。"
  },
  "lmstudio": {
    source: "undocumented",
    docUrl: "https://lmstudio.ai/",
    asOf: "2026-10-29",
    officialNote: "本机运行时，无上游额度。registry: category local / authKind none / baseUrl http://localhost:1234/v1（baseUrlOverrideEnv LM_STUDIO_BASE_URL）/ models 为空（模型表由本机已加载的模型决定）。没有云端账号，官方不存在限速数字可登记，六个字段 null、source undocumented、local true。UI 不得为它显示额度上限或做额度预检。"
  },
  "minimax": {
    source: "documented",
    rpm: 200,
    tpm: 1e7,
    docUrl: "https://platform.minimax.io/docs/guides/rate-limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "MiniMax-M3", rpm: 200, tpm: 1e7 }, { modelId: "MiniMax-M2.7" }, { modelId: "MiniMax-M2.5" }, { modelId: "MiniMax-M2.1" }],
    officialNote: "主体确认：baseUrl https://api.minimax.io/v1 = MiniMax 国际站（website www.minimax.io，authUrl platform.minimax.io），用 platform.minimax.io 那份英文文档。该页 LLM 表在三次独立抓取中都只给出一行数值：MiniMax-M3.1-Flash / MiniMax-M3 = 200 RPM / 10,000,000 TPM，且英文页没有免费/充值分档标签（同页仅语音转写标注 'available to paid accounts only and is not accessible on the free tier'），故 scope 记 keyed-account、不臆断它是免费档还是充值档；对照中文主体页（见 minimax-cn 条目）同样数值出现在「充值用户」行。RPM/TPM 之外该页未公布任何每日(RPD/TPD)、月度 token 或上下文数字 → 相应字段 null；本目录其余 3 个模型（M2.7/M2.5/M2.1）官方表内没有行，也不借用 M3 的值。"
  },
  "minimax-cn": {
    source: "documented",
    rpm: 20,
    tpm: 1e6,
    docUrl: "https://platform.minimax.cn/docs/guides/rate-limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "MiniMax-M3", rpm: 20, tpm: 1e6 }, { modelId: "MiniMax-M2.7" }, { modelId: "MiniMax-M2.5" }, { modelId: "MiniMax-M2.1" }],
    officialNote: "主体确认：baseUrl https://api.minimaxi.com/anthropic/v1 = MiniMax mainland（website www.minimaxi.com，authUrl platform.minimaxi.com）。platform.minimaxi.com/docs/guides/rate-limits 302 → https://platform.minimax.cn/docs/guides/rate-limits，抓到的就是这份中文站正文（数字在该页真实读到，非记忆值）。两档都公布，按要求取免费档：免费用户 20 RPM / 1,000,000 TPM，充值用户 200 RPM / 10,000,000 TPM（后者记在此 notes）。该页只有 RPM/TPM 两个维度，没有 RPD/TPD/月度 token/上下文数字 → 相应字段 null。限速按主账号+子账号合并计算，代理层把多用户共享一个 Key 时实际是把大家的用量并进同一个 20 RPM 桶。M2.7/M2.5/M2.1 官方表无行，不套用 M3 值。"
  },
  "mistral": {
    source: "undocumented",
    docUrl: "https://docs.mistral.ai/admin/billing-usage/usage-limits.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "mistral-large-latest", contextWindow: 256e3 }, { modelId: "mistral-medium-latest", contextWindow: 256e3 }, { modelId: "codestral-latest", contextWindow: 128e3 }, { modelId: "devstral-small-latest", contextWindow: 256e3 }],
    officialNote: 'docs.mistral.ai 带代理完全可读（先确认 https://docs.mistral.ai/ 200，再从 https://docs.mistral.ai/llms.txt 找到 .md 原文，并抓了 https://docs.mistral.ai/llms-full.txt 全文 3,239,421 字节做穷举）。结论是「页面无数字」而不是「取不到」：官方把限速的**维度**写得很清楚（Requests per second + Tokens per minute，按模型列、按 Workspace 共享），但**数值一个都没公布**，三处入口全部指向登录后的 Admin Panel（admin.mistral.ai/plateforme/limits）。在 llms-full.txt 全文里 grep rate limit|requests per second|tokens per minute|RPM|TPM 共 30 余处命中，逐条看过，没有任何一处带具体数字；Free mode 只写 "Usage and rate limits apply" 而不给额度；mistral.ai/pricing 抓到了 200/411,230 字节但剥标签后正文仅 913 字符（前端渲染，无计划额度表），故没有可用的每月免费额度数字，monthlyTokens 留 null。 quota 六项全 null（没有 RPM/TPM/RPD/TPD/月度 token 数字；context window 各模型不同，不能塞进条目级字段），因此按判据 source=undocumented —— 但这不代表一无所获：perModel 里四个 id 的 contextWindow 都是从官方正文逐字读到的真实数字（256k/256k/128k/256k，写成 token 数）。 两点必须提醒下游：(1) `devstral-small-latest` 在官方表里状态是 **Deprecated**，公告 2026-02-27、退役 2026-03-31，早于本次 asOf 2026-10-29，即这个 id 现在大概率已经打不通，官方给的替代是 Mistral Medium 3.5。(2) 官方 `docs.mistral.ai/models.md` 的现行模型总表里**没有任何 `-latest` 写法**（grep `-latest` 命中 0 次），表里用的是带日期的名字（`mistral-large-2512`、`codestral-2508`、`mistral-medium-3-5`、`labs-devstral-small-2512`）；`-latest` 别名只在 Vibe CLI 的模型清单页和「Model naming convention」一节出现。别名规则本身也带警告："Using an alias may expose you to silent updates in model behavior and pricing." 我们目录用 `-latest`，意味着模型会随官方换代静默漂移，上下文窗口也不能当常量用。 registry 里该条目注为「La Plateforme keys; embedding id omitted」。关于禁止转售/仅评估用途：在整份 llms-full.txt 里 grep resell|resale|prohibit|not permitted|competitive benchmark 只命中 FAQ 的错误码文（"429: Too many requests - You have exceeded the rate limit for your subscription tier"）和音频参数的 "Extra inputs are not permitted"，**没有任何禁止代理/禁止转售/仅限评估的条款**。'
  },
  "modelscope": {
    source: "undocumented",
    docUrl: "https://modelscope.cn/docs/model-service/API-Inference/intro",
    asOf: "2026-11-03",
    officialNote: "ModelScope API-Inference，目录 baseUrl 为 https://api-inference.modelscope.cn/v1。目录 notes 里引用的每日调用次数是 freellmpool 的转述，本次没有抓到官方逐字数字；quota 全 null，避免把转述当官方口径。"
  },
  "morph": {
    source: "undocumented",
    docUrl: "https://docs.morphllm.com/",
    asOf: "2026-10-29",
    officialNote: 'registry: category apikey / authKind apiKey / baseUrl https://api.morphllm.com/v1 / website https://morphllm.com / 6 models（morph-v3-large, morph-v3-fast, morph-qwen35-397b, morph-minimax27-230b, morph-qwen36-27b, morph-dsv4flash），无 freeModelsHint。官方 https://docs.morphllm.com/ 读到了正文与全部导航（含 quickstart、endpoints.md、dedicated-endpoints.md、pricing 链接），但没有任何 rate limit / RPM / RPD / TPM / 并发数字；https://docs.morphllm.com/api-reference/rate-limits 返回 404；https://docs.morphllm.com/endpoints.md 有端点格式但没有模型规格或限速表。https://www.morphllm.com/pricing 两次抓取都返回 HTTP 429 Too Many Requests，URL 试了但读不到正文。docs 索引里出现的 "1M" 上下文只挂在 docs 列出的模型名上（与我们的 6 个 id 无法逐一精确对应），按"不用别家/不确定值补"的规则不录入 contextWindow。'
  },
  "nararoute": {
    source: "documented",
    rpm: 15,
    tpd: 7e6,
    docUrl: "https://router.bynara.id/",
    asOf: "2026-10-29",
    perModel: [{ modelId: "kimi-k3-free", rpm: 15, tpd: 7e6 }],
    officialNote: 'Numbers come from the Free plan row (Rp 0) of the plan table on https://router.bynara.id/. Paid plans shown for context, NOT recorded: Freemium (Rp 5K/day) 25M/day + 50 req/min; FreeMium Max (Rp 10K/day) 60M/day + 60 req/min; GPT Fams (Rp 20K/day) 25M/day + 50 req/min; FreeMium Ultra (Rp 30K/day) 200M/day + 60 req/min. The published caps are daily TOKEN caps (tpd) and per-minute REQUEST rates (rpm); the site publishes no requests-per-day, TPM or context-window figure, so those stay null. The registry entry id is nararoute / website router.bynara.id while the page brands itself "NaraRouter" - same host, name variant. ToS note: https://router.bynara.id/terms section 7 states "You may not ... resell raw access to NaraRouter without authorization."'
  },
  "nebius": {
    source: "undocumented",
    docUrl: "https://docs.nebius.com/studio/inference/rate-limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "meta-llama/Llama-3.3-70B-Instruct", rpm: 1200, tpm: 3e6 }],
    officialNote: "category apikey（付费 keyed 账户，无免费额度），故 scope=keyed-account，登记的是官方默认 per-model 上限。官方 rate-limits 表（tokens per minute / requests per minute）：Llama-3.3-70B base 3,000,000 TPM / 1,200 RPM（fast flavor 2,000,000 TPM / 1,200 RPM）。另一模型 Qwen/Qwen3-30B-A3B 未出现在官方表中，故其值 null、不填。取证说明：本会话 WebFetch 抓该页时被 307 重定向到 docs.tokenfactory.nebius.com 根，子路径 404、读不到实时正文；上述数字取自该官方页面在检索索引中返回的正文表格原句，属官方口径而非记忆。若需逐字复核请以实时页面为准。"
  },
  "novita": {
    source: "undocumented",
    docUrl: "https://novita.ai/docs",
    asOf: "2026-10-29",
    officialNote: "category apikey（付费按 token 计费）。试抓 https://novita.ai/docs/api-reference/rate-limits 被 307 跳到 docs.novita.ai 后 404，且检索未找到官方公布 RPM/TPM 正文；官方口径是配额需经控制台/工单查询，非文档固定数字。无任何官方限速正文 → 全 null、undocumented。"
  },
  "nvidia_nim": {
    source: "undocumented",
    docUrl: "https://docs.nvidia.com/nim/cosmos/1.0.0/EULA.html",
    asOf: "2026-10-29",
    officialNote: "免费层是试用口径（category free-tier，registry notes: 'Free access for NVIDIA Developer Program members (prototyping and testing)'）。官方从未公布具体 RPM/TPM 数字——社区/论坛普遍报告约 40 RPM，但这是论坛与第三方转述、非官方文档正文，故所有 quota 字段填 null。官方 ToS 警示（试用的服务受 NVIDIA API Trial Terms of Service 约束；开发者计划软件的许可）docs.nvidia.com EULA §1.2.6 原句：'have a personal use license to exercise only the grant in Section 1.1.1 above for Software that is part of this program ... solely for internal evaluation, development or test non-production purposes. Software offered as part of the developer program is not for use, distribution or deployment in production.' 即仅限评估/开发/测试、禁止生产部署。另：model card 正文均写 'This trial service is governed by the NVIDIA API Trial Terms of Service.' 与 'Evaluation' 标注，佐证试用/评估口径。试抓 https://www.nvidia.com/en-us/agreements/enterprise-software/(api-trial|nvidia-api-trial)-terms-of-service/ 与 build.nvidia.com 内联条款均 404/JS 未渲染，读不到 Trial ToS 正文，故限速数字维持 null。"
  },
  "ollama": {
    source: "undocumented",
    docUrl: "https://ollama.com/",
    asOf: "2026-10-29",
    officialNote: "本机运行时，无上游额度。registry: category local / authKind none / baseUrl http://localhost:11434/v1（baseUrlOverrideEnv OLLAMA_BASE_URL）/ models 为空（模型表由本机已 pull 的模型决定）。没有云端账号，官方不存在任何限速数字可登记，六个字段 null、source undocumented、local true。UI 不得为它显示任何额度上限，也不该发额度预检请求。"
  },
  "ollama_cloud": {
    source: "undocumented",
    docUrl: "https://ollama.com/pricing",
    asOf: "2026-10-29",
    officialNote: 'registry: category free-tier / authKind apiKey / baseUrl https://ollama.com/v1 / authUrl https://ollama.com/settings/keys / modelsUrl https://ollama.com/api/tags / 9 models（gpt-oss:120b、kimi-k2.5、glm-5、minimax-m2.5、glm-4.7-flash、qwen3.5、minimax-m3、deepseek-v4.1-flash:cloud、qwen3-coder:480b）/ 无 freeModelsHint。**官方限速单位有两种，都不是 token：(1) 并发请求数 concurrent requests（Pay as you go 3、Pro 3、Max 10、Team 10，超出后排队而非报错）；(2) 每月"usage credits"美元额度（Pro $60、Max $300、Team $1,000 共享，不结转）**，官方页面把云用量描述为按 plan 的并发与额度限制。因为这两种单位都填不进 rpm/rpd/tpm/tpd/monthlyTokens/contextWindow，六个字段全部 null，原单位数字只写在 evidence/notes；source 记 documented（官方确有数字，只是单位不同）。会话时长方面：registry notes 里的 "light usage, one cloud model at a time" 与第三方流传的"每 5 小时会话限额 + 每 7 天周限额"来自 9router / 第三方清单，**官方 https://ollama.com/pricing 与 https://docs.ollama.com/cloud 今天的正文里都没有 5 小时/7 天字样**，docs.ollama.com 的文档索引里也只有 cloud、cloud-usage、pricing 相关页、没有独立 limits 页，故会话时长上限不录入。另记一条容易误读的：官方 docs 的 cloud-usage 接口页写 "Rate limits allow 10 requests per minute"，那是**查询用量统计这个接口自身**的限速，不是推理端点的帽，不能当 ollama_cloud 的 rpm 用。ollama.com/turbo 抓取返回 303 无法读正文（URL 试了但读不到）。'
  },
  "open_router": {
    source: "documented",
    rpm: 20,
    rpd: 50,
    docUrl: "https://openrouter.ai/docs/api-reference/limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "openrouter/free", rpm: 20, rpd: 50 }],
    officialNote: `CONDITION on the recorded numbers: rpm=20 and rpd=50 hold only for an account whose ALL-TIME purchased credits are below the 10-credit threshold (the higher ceiling is granted starting one credit below it, per the docs). Once >=10 credits are purchased, rpm stays 20 but the daily cap becomes 1000/day; the tier is chosen by all-time credits purchased, independently of current balance, so it never falls back. Pages actually read for OpenRouter: /docs/api-reference/limits (title 'Limits'; it also states OpenRouter enforces Credit limits, Budget limits and Rate limits) and /docs/faq (:free variant definition + both daily caps). NO official figure was found for TPM, TPD, a monthly token pool, or a context window - the docs give no token-per-minute number for :free models and the context length of the openrouter/free router is only published on the JS-rendered model page (https://openrouter.ai/openrouter/free), which returned no readable numbers; the 200K/1M figures circulating in third-party posts were NOT used. The catalogue carries only the router slug openrouter/free, but the :free rate limits apply to every model variant whose ID ends in :free, so the numbers above are pool-wide, not per-slug. Per the FAQ the free endpoints additionally require the privacy settings that allow free endpoints which train on request data / publish prompts. ToS note: https://openrouter.ai/terms section 7.4 forbids accessing the Service "for purposes of reselling API access to Models or otherwise developing a competing service" - relevant because this app ships OpenRouter as a routed aggregate entry.`
  },
  "openai_api": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: '带代理仍然取不到，且这次失败原因已定位清楚：不是「页面无数字」，是 OpenAI 全站文档在 CDN 层要 JS 挑战。带 -x http://127.0.0.1:7890 逐个试过并记录状态码：https://platform.openai.com/docs/guides/rate-limits → 301 到 https://developers.openai.com/api/docs/guides/rate-limits → HTTP 403，59 字节正文 `Forbidden Forbidden hkg1::tw4nn-1793215339581-b854a9465017`（hkg1 = 香港 PoP，与本机代理出口 city=Hong Kong 一致）；https://developers.openai.com/api/docs/guides/rate-limits（带 Chrome/131 完整 UA）→ 403，同样 59 字节；https://developers.openai.com/llms.txt → 403；https://platform.openai.com/docs/guides/rate-limits.md → 403；https://platform.openai.com/docs/api-reference/rate-limits → 403，10,067 字节，剥标签后正文只剩 "Enable JavaScript and cookies to continue"；https://help.openai.com/en/articles/5955610-rate-limits → 403（同样的 JS 挑战页）；https://help.openai.com/en/articles/8230684-understanding-rate-limits-for-chatgpt-and-api-platform → 403。curl -I 复核响应头确认 301 的 location 就是 developers.openai.com，即官方文档已整站迁到该域名，迁过去的唯一障碍是边缘 JS 挑战，普通 curl 无论走不走代理都过不去（走代理只是把挑战从国内 DNS 失败换成了 HK PoP 的 403）。 因此本次没有任何逐字数字可登记：RPM/RPD/TPM/TPD/月度 token/context window 全部 null，perModel 与 freeModelIds 留空。registry 的 22 个 id（gpt-5.5、gpt-5.4、gpt-5.4-mini、gpt-5.4-nano、gpt-5.2、gpt-5.1、gpt-5、gpt-5-mini、gpt-5-nano、gpt-4o、gpt-4o-mini、gpt-4-turbo、gpt-4.1、gpt-4.1-mini、gpt-4.1-nano、o3、o3-mini、o3-pro、o4-mini、o1、o1-mini、gpt-5.6-sol）没有任何一份官方正文可核对，按铁律不用记忆、不用第三方转载表补。下一步若要取到，只有两条路：用真正会执行 JS 的浏览器（本任务禁用 WebFetch 且它不走代理），或把代理换成 OpenAI 支持地区且能通过挑战的出口。另注：本条目在 registry 里是 authKind apiKey / wire openai-chat，与 Anthropic 一样属付费 keyed 档，官方从未给出免费档数字这一事实本身就是结论。'
  },
  "opencode_go": {
    source: "undocumented",
    docUrl: "https://opencode.ai/docs/go/",
    asOf: "2026-10-29",
    perModel: [{ modelId: "glm-5.3-flash" }, { modelId: "glm-5.3" }, { modelId: "glm-5.2" }, { modelId: "kimi-k3" }, { modelId: "kimi-k2.7-code" }, { modelId: "longcat-2.0" }, { modelId: "mimo-v2.5" }, { modelId: "mimo-v2.5-pro" }, { modelId: "minimax-m3" }, { modelId: "qwen3.8-max" }, { modelId: "qwen3.8-flash" }, { modelId: "qwen3.7-plus" }, { modelId: "deepseek-v4-pro" }, { modelId: "hy4-preview" }, { modelId: "hy3" }, { modelId: "gpt-5.6-luna" }, { modelId: "muse-spark-1.3-contributor" }, { modelId: "muse-spark-1.2-contributor" }],
    officialNote: `registry: category apikey / authKind apiKey / baseUrl https://opencode.ai/zen/go/v1 / website https://opencode.ai/go / notes 'OpenCode Go subscription ($5/mo per the 9router notice)' / 28 models / 无 freeModelsHint。**官方限速单位是 requests per 5 hours / per week / per month，三个都不是 rpm 也不是 rpd**（5 小时窗≠分钟窗、周窗≠日窗，且官方自己给的换算口径是 5-hour=月帽的 20%、weekly=50%），所以六个 quota 字段全部 null，每家模型的原表数字逐条写进 perModel[].evidence，只登记模型名能与 registry id **逐字对应**的 18 条。其余 10 个 registry id 不在官方表上，宁缺毋录：deepseek-flash、kimi-k2.6、deepseek-v4-flash（官方表只有 DeepSeek V4.1 Flash，不是同一 id）、deepseek-v4-flash-vision-exp、minimax-m2.7、minimax-m2.5（官方 Deprecated 表列 MiniMax M2.5 August 5, 2026）、qwen3.7-max、qwen3.6-plus、grok-4.6（官方表是 Grok 4.7/4.6 之分类另议，未逐字命中即不录）。官方另有一张 Go Plus 表（数字更高，如 GLM-5.3-Flash 18,960/47,370/94,740），本次只录 Go 基础档；scope 记 mixed：Go 是订阅制，但官方把 Beam Free 与 Iceman Contributor Free 标为 Unlimited。**ToS（OpenCode 系关键条款，来自 Zen 页）**："Free-tier chat models require OpenCode; use paid models or Go from other clients." —— Go 明确允许其它客户端（"designed for OpenCode and other coding agents"），受影响的只是 Zen 的免费档；Go 的限速声明按模型发布，未见"仅限 OpenCode 客户端"字样。免费模型 id 官方名（Beam Free / Iceman Contributor Free）在 registry 中不存在对应 id，故 freeModelIds 为空。`
  },
  "opencode_zen": {
    source: "undocumented",
    docUrl: "https://opencode.ai/docs/zen",
    asOf: "2026-10-29",
    officialNote: `registry: category free-tier / authKind apiKey / baseUrl https://opencode.ai/zen/v1 / website https://opencode.ai/zen / 75 models，freeModelsHint 9 条。官方 Zen（Console）页把免费模型的价格全表写成 "Free / Free / Free"，并按条注明 'free on OpenCode for a limited time'，**没有任何 RPM/RPD/TPM/TPD/月度 token 或上下文数字**，所以六个字段全 null、记 undocumented（免费池存在但官方不公布数字）。**必须原句记录的 ToS（OpenCode 系关键条款）**："Free-tier chat models require OpenCode; use paid models or Go from other clients." —— 即免费档聊天模型只能在 OpenCode 客户端内使用，从 ModelPort 这类第三方代理调用违反该条款；ModelPort 走 https://opencode.ai/zen/v1 属于"other client"。另记：NVIDIA 免费端点（nemotron-*-free）是试用口径、会被记录用于安全与产品改进、需同意 NVIDIA API Trial Terms of Service；Big Pickle / Flint 40B Free / MiMo-V2.6-Flash Free 在免费期内收集的数据可能被用于改进模型；Beam Free 不用于训练但保留 30 天，并且**在地区列表中排除中国大陆**（Angola/Belarus/Cambodia/China/Cuba/… 不可用）。freeModelIds 只列"官方点名 free 且我们目录里确实存在该 id"的 5 条：big-pickle、jev-1.13-free、mimo-v2.6-flash-free、nemotron-3-ultra-free、nemotron-3.5-lightning-free；官方当前页面上的 glm-5.3-flash-free、deepseek-v4.1-flash-free、beam-free、flint-40b-free、nemotron-3.5-super-vl-free 不在我们的模型列表里，而 registry freeModelsHint 中的 deepseek-v4-flash-free、mimo-v2.5-free、ling-3.0-flash-fin-free、muse-spark-1.2/1.3-contributor-free 在今天的官方 Zen 页已不再以该 id 出现（官方另有 DeepSeek V4 Flash 于 October 26, 2026 弃用的 Deprecated models 表），故不录入。可在 OpenCode 中用 OPENCODE_DISABLE_FREE_MODELS=1 隐藏免费模型。`
  },
  "opper": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: "https://opper.ai/ loaded and shows no rate-limit numbers; https://platform.opper.ai/docs/api-reference and https://docs.opper.ai/ both 404; https://platform.opper.ai (the authUrl in the catalogue) did not yield a rate-limit page. https://platform.opper.ai/terms loaded and contains NO resale / competing-service clause. The single shipped model (claude-sonnet-4-6) is a paid model with no published RPM/RPD/TPM/TPD/context figures, so nothing was recorded."
  },
  "orcarouter": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: 'Site https://www.orcarouter.ai/ loaded and states only "Zero markup on all tokens." for the free tier - NO rate-limit numbers on the page (explicitly reported as "NO RATE LIMIT NUMBERS ON THIS PAGE"). Terms pages tried but unreadable: https://www.orcarouter.ai/terms (404), https://www.orcarouter.ai/terms-of-service (404), https://www.orcarouter.ai/legal/terms (fetch failed), so the resale / competing-service position could not be established. No /pricing or docs page with RPM/RPD/TPM/TPD figures was found. The -free slug implies a free pool but no official figure exists; nothing recorded.'
  },
  "ovh": {
    source: "undocumented",
    docUrl: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/",
    asOf: "2026-11-03",
    officialNote: "OVHcloud 的 Kepler 匿名推理端点（authKind=none、autoProvision），目录 baseUrl 为 https://oai.endpoints.kepler.ai.cloud.ovh.net/v1。本次没有读到官方逐字公布的 RPM/TPM 数字，quota 全 null。上游停用或仅 pin 可用的模型行不进基线。"
  },
  "perplexity": {
    source: "undocumented",
    docUrl: "https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers.md",
    asOf: "2026-10-29",
    officialNote: 'docs.perplexity.ai 带代理完全可读（先 200 拿到 https://docs.perplexity.ai/llms.txt 索引，再抓 rate-limits-usage-tiers.md 13,894 字节、pricing.md、faq.md、router/models.md、migrate-from-sonar/overview.md 全文）。判成 undocumented 的原因是**口径不匹配，不是没数字**：官方那张带完整数字的表全部挂在 **Agent API**（`POST /v1/agent` / `/v1/responses`）、**Search API**（50 query units/s）和 **Embeddings API**（Tier 0 85 QPS）上；而我们 registry 这个条目是 baseUrl https://api.perplexity.ai + wire openai-chat + 模型 `sonar-pro` / `sonar`，即 **Sonar Chat Completions（/v1/chat/completions）** 这条路径。限速页对 Sonar/chat completions 一个数字都没给，整页只写 "Orchestrator API requests are rate limited"（无数字）并把数值留给上面三个 API。把 Tier 0 的 1 QPS / 5,000,000 TPM 抄进本条目 quota 会是错标——那些限额明确只作用于 /v1/agent 的调用面，故 quota 六项全部保持 null，逐字数字留在 evidence 里供上层裁量。 Sonar 在官方文档里已被降级为 legacy：docs.perplexity.ai 现行 llms.txt 索引里 **没有任何 Sonar 模型页**，只有 "Migrate from Sonar to the Agent API"、"How to migrate from Sonar"、"Agent API vs Sonar benchmarks" 三篇迁移文档；FAQ 写 "Legacy Sonar models apply SafeSearch to web results by default"；迁移页给出替代关系 "Sonar | `fast`"、"Sonar Pro | `fast`"。router/models.md（Orchestrator 模型总表，2,805 字节）里 grep sonar 0 命中。也就是说我们这两个 id 既拿不到限速，也拿不到上下文窗口，因此 perModel 与 freeModelIds 留空、contextWindow null（官方正文里没有任何一处把 token 上限或上下文窗口写成对应 sonar 的数字，绝不臆造）。 可以确定的一点：Perplexity 没有免费档可言，Tier 0 的定义就是 "$0 | New accounts, limited access"，且 "Tiers are based on **cumulative purchases** across your account lifetime, not current balance"，要超过 Tier 5 得填 typeform 申请。禁代理/禁转售/仅评估条款：在 rate-limits、pricing、faq、migrate-from-sonar 四篇正文里 grep resell|prohibit|not permitted|benchmark|evaluat 无任何禁止性表述（唯一 benchmark 命中是官方自己的评测页标题）。'
  },
  "pollinations": {
    source: "undocumented",
    docUrl: "https://github.com/pollinations/pollinations",
    asOf: "2026-11-03",
    officialNote: "免 Key 的匿名层（authKind=none、autoProvision），目录 baseUrl 为 https://text.pollinations.ai/openai。本次没有读到官方逐字公布的 RPM/TPM 数字，故 quota 全 null；不把社区转述的限速写进旁表。"
  },
  "poolside": {
    source: "undocumented",
    docUrl: "https://docs.poolside.ai/",
    asOf: "2026-10-29",
    officialNote: '有页面但无数字：docs.poolside.ai 正文可完整抓取（首页 338KB、llms.txt 索引 17KB、llms-full.txt 全量 674KB 都取到了），索引里没有任何 rate limit / quota / pricing 页面；在 llms-full.txt 全文里 grep "requests per minute"、"tokens per minute"、"rate limit"、"429" 只命中第三方网关 Bifrost 的自建部署文档（"Use Bifrost as an OpenAI-compatible gateway in front of Poolside model inference when you need centralized routing, virtual keys, budgets, rate limits..." 与 Virtual Keys 页面可 "Optionally set token and request limits with reset periods" —— 那是用户自己给虚拟 Key 设的帽，不是 Poolside 对账户公布的帽），"429" 出现 0 次。结论：官方文档未公布 poolside/laguna-s-2.1、poolside/laguna-xs-2.1 的速率或月度额度，全部 null。'
  },
  "qiniu": {
    source: "documented",
    tpd: 1e8,
    contextWindow: 1e6,
    docUrl: "https://www.qiniu.com/ai/free-models/conatus-2026",
    asOf: "2026-10-29",
    perModel: [{ modelId: "qiniu/conatus-free", tpd: 1e8, contextWindow: 1e6 }],
    officialNote: "主体确认：baseUrl https://api.qnaigc.com/v1 是七牛云 AI 大模型推理 Token API 的 OpenAI 兼容端点（官方实时推理文档 developer.qiniu.com/aitokenapi/13379 给出同一 BaseURL 与 /v1/chat/completions、/v1/messages）。活动页给出的每日额度按「输入 Token + 输出 Token」计量（命中缓存的输入也计入），故记为 tpd；这是**活动期**额度而非长期免费档：活动 2026-10-24~2026-11-30，结束后停止调用、不转付费模型，故 activity 到期后本条目应撤下。已认证用户默认 1 亿/日，单笔充值>100 元且到账后 10 亿/日（多笔不累计），额度按账号发放、同账号全部 API Key 共享、每日 00:00（北京时间）重置不结转。官方页面同时写明「本模型仅支持消耗活动每日免费 Token 额度」「不自动切换其他收费模型」，因此不能视为可付费续用。contextWindow 与 128K 最大输出取自活动页的能力标签，与模型 ID qiniu/conatus-free 一一对应；该模型是七牛在活动期对外唯一展示的「融合模型」标识。"
  },
  "qwencloud": {
    source: "undocumented",
    docUrl: "https://www.alibabacloud.com/help/en/model-studio/token-plan-overview",
    asOf: "2026-10-29",
    officialNote: "主体确认：baseUrl https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 = Model Studio Token Plan 的新加坡订阅端点（website qwencloud.com / home.qwencloud.com）。官方页 Token Plan 概述存在（alibabacloud.com/help/en/model-studio/token-plan-overview 与 help.aliyun.com/zh/model-studio/token-plan-overview；直连 www.alibabacloud.com/help/en/model-studio/token-plan 返回 404 页，正文无数字）。该页公布的额度全部是 Credits 订阅口径（抓到「个人版 Lite/Essential/Standard/Pro 按月 Credits 限额」与「并发 Agent 1-2 … 6-8」这类档位表述），而且中英文两版数值口径不一致（一版 11,500/25,500/45,000/180,000 Credits 每月，另一版 2,500/5,625/10,000/40,000 Credits 每 7 天）——我无法确认哪一份对应新加坡端点，且 Credits 不等于 token/RPM/TPM，因此不登记任何数字，quota 全 null、source 记 undocumented。官方同时说明套餐 Key 只认套餐端点（用错 Base URL 会 401），限速由平台按并发/请求率动态分配。qwencloud.com / home.qwencloud.com 自身只有产品页与控制台（登录墙），没有可读的限速正文。"
  },
  "qwencloud_coding": {
    source: "undocumented",
    docUrl: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
    asOf: "2026-10-29",
    officialNote: `主体确认：baseUrl https://coding-intl.dashscope.aliyuncs.com/v1 = Model Studio Coding Plan 国际端点。官方页存在且读到数字，但那些数字是「每 5 小时 / 每周 / 每月请求上限」（6,000 / 45,000 / 90,000 requests），既不是 RPM、也不是 RPD/TPM/TPD/月度 token，无法在不折算的前提下填进 quota 字段 → 按规则 quota 全 null，source 记 undocumented（有页面、无可登记口径的数字），原句保留在 evidence 里供后续人工裁定。速率维度官方只写「对并发请求数与请求率做动态技术限制」，FAQ 的报错文案也是 'dynamically allocated limit'，没有任何固定 RPM。同页支持的模型列表为 qwen3.7-plus、qwen3.6-plus、kimi-k2.5、glm-5、MiniMax-M2.5、qwen3.5-plus，与本条目 models[] 部分重合（qwen3-coder-next/plus 不在官方列表内）。ToS 警示（逐字，对本仓尤其相关）："This plan is for interactive use in programming tools ... Do not use the plan's API key for automated scripts, application backends, or other non-interactive scenarios." —— 把该 Key 放进 OpenAI 兼容代理对外服务与该条直接冲突。`
  },
  "requesty": {
    source: "undocumented",
    docUrl: "https://requesty.ai/",
    asOf: "2026-11-03",
    officialNote: "Requesty 路由端点，目录 baseUrl 为 https://router.requesty.ai/v1，需要用户 Key。本次没有读到官方逐字公布的 RPM/TPM 数字，quota 全 null。"
  },
  "sambanova": {
    source: "documented",
    rpm: 20,
    rpd: 20,
    tpd: 2e5,
    contextWindow: 128e3,
    docUrl: "https://docs.sambanova.ai/docs/en/models/rate-limits",
    asOf: "2026-10-29",
    perModel: [{ modelId: "Meta-Llama-3.3-70B-Instruct", rpm: 20, rpd: 20, tpd: 2e5, contextWindow: 128e3 }],
    officialNote: "主体确认：baseUrl https://api.sambanova.ai/v1（website sambanova.ai，authUrl cloud.sambanova.ai/apis）。官方限速页正文完整可读，Free Tier 表逐模型给 RPM/RPD/TPD：Production 组 DeepSeek-V3.1 / Meta-Llama-3.3-70B-Instruct / gpt-oss-120b 均为 20 / 20 / 200000，Preview 组 DeepSeek-V3.2 / gemma-4-31B-it 也是 20 / 20 / 200000——本目录只有 Meta-Llama-3.3-70B-Instruct 命中，故 provider 级取该组的 20/20/200000 并在 perModel 落同值。TPM：官方限速轴只有 RPM、RPD、TPD（Free tier only）三条，**没有每分钟 token 帽** → tpm 留 null（不是猜，是官方未设该轴）。付费档一并记录以便对照：Developer Tier 同模型 240 RPM / 48,000 RPD，账户级 20M tokens/day across all models，层级判定条件是「账号是否绑定支付方式」。contextWindow 128000 取自官方 /models/sambacloud-models 表（128k tokens）。计量口径：限速在每次响应里回传（x-ratelimit-limit-requests / -requests-day / -reset*），属本应用 learned 档能自动校验的家之一。警示：官方把模型分 Production / Preview，Preview「仅供评估与开发者试验、不得用于生产、可能随时下架」——本目录暂无 Preview 模型，若后续补 DeepSeek-V3.2 / gemma-4-31B-it 需带这条限制；另外 SambaStack（私有部署）的限速「可选、由管理员按用户组设置」，与云端数字无关。"
  },
  "scaleway": {
    source: "undocumented",
    docUrl: "https://www.scaleway.com/en/docs/generative-apis/",
    asOf: "2026-10-29",
    officialNote: "category apikey（SCW secret key 付费），无免费额度。官方 Generative APIs 文档与 Organization quotas 页只讲 IAM 权限、max_completion_tokens 上限、按量计费，未公布 RPM/RPD/TPM/TPD 限速数字（troubleshooting 页仅提到 416 max_completion_tokens 等）。故全 null、undocumented。"
  },
  "sensenova": {
    source: "undocumented",
    docUrl: "https://platform.sensenova.cn/token-plan",
    asOf: "2026-10-29",
    officialNote: "主体确认：baseUrl https://token.sensenova.cn/v1 与 models.dev 的 sensenova 条目一致（该目录把它标为 SenseNova (China)），OpenAI 兼容路径为 /chat/completions。官方 token-plan 页为登录态前端应用，未读到可逐字引用的正文，因此不录入任何 RPM/RPD/TPM/TPD/月度 token/上下文数字，全部 null。公开清单（smzdm 2026-10-29 汇总）转述的免费档是**积分**而非 token：公测积分池 12 万积分/5 小时、120 万/周，7 款免费模型；按本仓库规则「不是 token 的单位不折算」，这些数字不能写进 quota，故 source=undocumented。registry 的 6 个模型 id 取自 models.dev 的 sensenova 目录（baseUrl 相同），不是官方模型表；同步失败时 models.dev 本身也是回退源，故不把它们当作官方名单。dropParams 的依据是社区接入文档（mimo2codex 的 sensenova 预置：response_format / tools[].function.strict / tool_choice:auto / enable_thinking 会被网关拒绝，多条 system 与 assistant content:null 未明示），未在官方正文中逐条核验，属于防御性剥离而非官方要求。"
  },
  "siliconflow": {
    source: "undocumented",
    docUrl: "https://docs.siliconflow.com/cn/faqs/misc_rate",
    asOf: "2026-10-29",
    officialNote: "官方限速 FAQ 明确存在免费模型且其限速为定值，但正文不列具体数字（逐模型值在'模型广场/模型详情页'动态显示）：'所有免费模型的 Rate Limits 是固定的。'（英文 docs 对应 free-model Rate Limits are fixed）；rate-limit-and-upgradation 页只定义 RPM/RPH/RPD/TPM/TPD/IPM/IPD 七种指标、不公布免费档数值。第三方整理的 'RPM=1000-10000 / TPM=50000-5000000'、'新用户 ¥16/$1 credits' 非官方正文，未采信。故全 null、undocumented。"
  },
  "siliconflow_cn": {
    source: "undocumented",
    docUrl: "https://docs.siliconflow.com/quickstart/models",
    asOf: "2026-11-03",
    officialNote: "中国站与 api.siliconflow.com 是两套站点和 Key；目录把两者分成 siliconflow / siliconflow_cn。官方模型列表实时变化，限速按账号档位在控制台展示，可读文档没有逐模型 RPM/TPM 数字，quota 全 null。基线模型 id 沿用 models.dev 已登记的同一开源模型命名，syncModels 可再并入上游返回的清单。"
  },
  "spark": {
    source: "undocumented",
    docUrl: "https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html",
    asOf: "2026-11-03",
    officialNote: "Base URL 与 model 取值（lite / generalv3 / pro-128k / 4.0Ultra）逐字取自官方 HTTP 文档。Max 版本套餐公告将于 2026-03-10 下线、后端升级为 Ultra，故目录不再登记 generalv3.5 / max-32k。官方按版本独立计量 tokens，但没有公布可登记的 RPM/TPM 帽，quota 全 null；Lite 有免费额度，但本次没有拿到逐字免费模型清单，因而不写 freeModelIds。"
  },
  "stepfun": {
    source: "undocumented",
    docUrl: "https://platform.stepfun.com/docs/zh/api-reference/chat/messages-create",
    asOf: "2026-11-03",
    officialNote: "中国站 api.stepfun.com 与国际站 api.stepfun.ai 分开，目录只登记中国站。可读官方页没有逐模型 RPM/TPM 数字，quota 全 null。模型 id（step-5-preview / step-3.7-flash / step-3.5-flash / step-3.5-flash-2603）取自官方 Step Plan 支持模型表；按量端点可用集合以控制台为准。"
  },
  "stepfun_step_plan": {
    source: "undocumented",
    docUrl: "https://platform.stepfun.com/docs/zh/step-plan/overview",
    asOf: "2026-11-03",
    officialNote: "额度单位是 Credit，不是 token，按本仓规则不折算进 quota，故 source=undocumented。Step Plan 使用专属 /step_plan 前缀，与按量端点 /v1 分开；目录只登记 OpenAI 兼容线。支持模型表：Step 5 Preview、Step 3.7 Flash、Step 3.5 Flash、Step 3.5 Flash 2603，目录只收文本模型。"
  },
  "tencent": {
    source: "undocumented",
    docUrl: "https://cloud.tencent.com/document/product/1729/97731",
    asOf: "2026-10-29",
    officialNote: "主体确认：baseUrl https://api.hunyuan.cloud.tencent.com/v1 = 腾讯云混元生文 OpenAI 兼容端点（website cloud.tencent.com/product/hunyuan）。一个数字都进不了 quota：官方唯一可读的请求类限制是**并发数 5 路**（https://cloud.tencent.com/document/product/1729/105701 对话接口正文），既不是 RPM 也不是 RPD，字段表里没有对应列，只在此记录；官方没有任何 RPM/RPD/TPM/TPD 正文数字（限流类页面 https://cloud.tencent.com/document/product/1729/105526 已被重定向到无关的 WeData 文档，读不到混元限速内容）。免费池存在但不覆盖本目录：「混元生文计费概述」的一次性免费资源包清单是 Hunyuan-a13b / Hunyuan-role-latest / Hunyuan-translation / Hunyuan-translation-lite / Tencent HY Vision 1.5 Instruct / Hunyuan-turbos-vision / Hunyuan-t1-vision / Hunyuan-turbos-vision-video / Hunyuan-embedding，**不含 hunyuan-turbos-latest 与 hunyuan-t1-latest**，所以 freeModelIds 空、monthlyTokens 空（且它是 1 年有效期的一次性包，不是月度额）。警示（官方原话）：「为进一步提升大模型服务体验，腾讯混元大模型相关功能将逐步迁移至 TokenHub。迁移后，原平台将不再新增模型能力，并停止支持新购模型服务。」——本目录这两条模型属于正在被迁走的旧平台，新接入应改走 TokenHub（product/1823）。另：免费/付费资源包耗尽后**不会**自动转后付费，未开通后付费会出现计费异常提示。"
  },
  "together": {
    source: "undocumented",
    docUrl: "https://docs.together.ai/docs/serverless/rate-limits.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "zai-org/GLM-5.2", contextWindow: 1048575 }],
    officialNote: 'docs.together.ai 带代理完全可读；上一轮猜的 docs.together.ai/docs/limits 确实不对，正确路径是从 https://docs.together.ai/llms.txt 索引里找到的 https://docs.together.ai/docs/serverless/rate-limits.md（另试 /docs/rate-limits.md 与 /docs/pricing.md 均 200，内容是同一页）。这是「页面无数字」的典型：整篇限速页 **一个 RPM/RPD/TPM/TPD/QPS 数值都没有**，通篇只说 best-effort、429/503 怎么处理、要保障就去买 provisioned throughput；serverless/overview.md 的 "## Rate limits" 一节同样只有定性描述。官方还明确说模型特定上限是临时施加的自定义值，不给公开表。因此六项 quota 全 null、source=undocumented。 唯一读到的真实数字是模型目录里的上下文窗口：https://docs.together.ai/docs/serverless/models.md（18,076 字节）的 Chat models 表有 `Context length` 一列，我们五个 id 中只有 `zai-org/GLM-5.2` 命中（1048575），已写进 perModel 并附整行逐字原文；因为它只是 5 个模型里的 1 个，不适合升格为条目级 quota.contextWindow，故该字段留 null。 另外四个 id 在现行官方目录里已经查不到，按规则不写进 perModel/freeModelIds，此处列出核对结果供上层判断：`meta-llama/Llama-3.3-70B-Instruct-Turbo`、`deepseek-ai/DeepSeek-R1`、`Qwen/Qwen3-235B-A22B`、`meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8` 在 models.md 全文 grep 均 0 命中（该表现行条目是 deepseek-ai/DeepSeek-V4-Pro-0813 1048576、deepseek-ai/DeepSeek-V4.1-Flash 1000000、meta-models/Muse-Spark-Open-816B-A42B 1048576、moonshotai/Kimi-K3 1048576 等新代次），即我们目录里这四条是已下架的老模型 id，路由到 Together 很可能直接失败。registry 注释「the FCC profile lists models at /models with context_length」说的正是这一列，但它属于 /models API 响应，按铁律不向 api.together.ai 发请求，数值一律取文档表。 禁代理/禁转售/仅评估条款：在 rate-limits.md、overview.md、pricing.md、models.md、fine-tuning/supported-models.md 里 grep resell|prohibit|not permitted|evaluation only 无禁止性表述（Enterprise/Scale 合同段只谈买断的上限保留）。'
  },
  "tokenrouter": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: "No official rate-limit or quota numbers found. URLs tried but body not readable: https://www.tokenrouter.com/ (fetch failed), https://www.tokenrouter.com/pricing (timeout), https://docs.tokenrouter.ai/ (fetch failed), https://docs.tokenrouter.com/ (fetch failed). https://www.tokenrouter.com/terms loaded but contains no resale / competing-service clause and no quota numbers. The catalogue marks moonshotai/kimi-k3-free and z-ai/glm-5.3-free as free slugs, but the site publishes no RPM/RPD/TPM/TPD/monthly/context numbers, so nothing was recorded. Do NOT substitute OpenRouter's or ZenMux's numbers - unverified upstream."
  },
  "venice": {
    source: "documented",
    rpd: 25,
    docUrl: "https://venice.ai/legal/tos",
    asOf: "2026-10-29",
    officialNote: "Venice 有 Free Account（免费档）。官方 ToS 正文给出 Free Account 每日 25 条 text prompts（记入 rpd=25，单位是 prompts/day）。另有未登录演示界面 'fifteen (15) text prompts per day'。API 层的 per-minute / per-token 限速页 docs.venice.ai/api-reference/rate-limiting（及 llms-full.txt）在本会话 WebFetch 连续 'fetch failed'，读不到正文，故 rpm/tpm/tpd/monthlyTokens 全 null。ToS 亦写 'Services are subject to the Venice Usage Limits for Free Accounts' 并把细目指向 API 文档；25/day 为平台免费账户口径。"
  },
  "vercel": {
    source: "undocumented",
    docUrl: "https://vercel.com/docs/ai-gateway/rate-limits",
    asOf: "2026-10-29",
    officialNote: "官方明确不公布固定数字：Rate Limits 页正文 'Limits can change, so this page describes behavior rather than fixed numbers.'，且 'AI Gateway does not rate limit paid-tier requests. The free tier applies lower per-model limits'。免费层只有按月 credits（pricing 页 'Every Vercel team account includes $5 of free usage per month'，单位是美元而非 token），故 monthlyTokens 记 null、把 $5/月写入此 notes。无官方 RPM/TPM/token/context 数字 → undocumented。"
  },
  "vertex": {
    source: "undocumented",
    docUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/quotas",
    asOf: "2026-10-29",
    officialNote: "本应用无法认证（authKind='unsupported'，需要 Google ADC / service account，ModelPort 产不出该凭据），数值仅供参考。取证可达性说明：直连 ai.google.dev / cloud.google.com 在本机网络下 curl 返回 000（DNS 能解析、连接被重置），经本地代理 127.0.0.1:7890 才抓到官方正文——记录方式仍是读官方文档，未对任何 provider API 端点发请求。官方配额页正文可读，但**对话类模型没有任何可登记数字**：页面上带数值的只有 Embedding（gemini-embedding 100,000 RPM / 100,000,000 TPM，gemini-embedding-2 60,000 / 200,000,000）与多模态输入聚合帽（image 34,000,000、video 192,000,000、audio 11,000,000、document 1,200,000 per minute per base model and resolution），这些都不是本目录 5 个 Gemini 模型的 RPM/RPD/TPM；generateContent 的请求帽在文档里只出现为**指标名**（global_generate_content_requests_per_minute_per_project_per_base_model），值要按项目在控制台「Quotas and System Limits」查看并可申请上调。因此 quota 全 null、perModel 留空、source=undocumented（含义：官方未公布本 entry 模型的数字）。免费层：Vertex AI 属 Google Cloud 计费体系，本 entry 无免费档口径；目录里也没有免费标记（category=apikey、无 freeModelsHint）。另需注意：本 entry 的 id（gemini-3.1-pro-preview 等）是 OpenAI 兼容端点的写法，与配额维度里的 base_model 名称（剥掉 -preview 的基座名）不完全一致，按 base_model 查帽时要先归一化。"
  },
  "vertex-partner": {
    source: "undocumented",
    docUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models",
    asOf: "2026-10-29",
    officialNote: "本应用无法认证（authKind='unsupported'，需 Google ADC / 服务账号），数值仅供参考。主体确认：页面标题即「Gemini Enterprise Agent Platform partner models for MaaS」，与本 entry 的 MaaS 模型 id（deepseek-ai/deepseek-v3.2-maas、qwen/qwen3-next-80b-a3b-{thinking,instruct}-maas、zai-org/glm-5-maas）同源。官方只公布**配额指标名**，一个值都没给：输入/输出 tokens per minute per base model、requests per minute per project per base model，分 US / EU 多区域独立配额，数值只能在 Google Cloud 控制台查看与申请上调（evidence 原句）。所以 quota/perModel 全 null、source=undocumented。另有两条会影响未来取数：(1) global 端点与 regional 端点的配额与能力**可以不同**，本 entry 的 baseUrl 模板用的是 {location}，用户填 global 时帽就不是同一套；(2) 具体帽值按第三方模型页逐模型公布（「view the related third-party model page」），本目录的 -maas 后缀 id 与那些页的模型名不完全一致，需要逐个模型页取证——官方 MaaS 指南（/gemini-enterprise-agent-platform/models/maas/call-open-model-apis、…/models/maas/deepseek）抓到的是流程正文，同样没有数字。免费层：无（partner 模型按 token 计费，且需要 Google Cloud 计费账号）。"
  },
  "volcengine_ark_agent_plan": {
    source: "undocumented",
    docUrl: "https://www.volcengine.com/docs/82379/2374459",
    asOf: "2026-11-03",
    officialNote: "Agent Plan 是订阅制，额度按套餐扣减；官方没有在可读页面给出可登记的 RPM/TPM 数字，quota 全 null。Base URL 与 Key 是 Agent Plan 专属，与平台按量 / Coding Plan 隔离。ark-code-latest 由控制台切换实际模型；Kimi K3 只在 Medium 及以上档位提供，故不进基线。"
  },
  "volcengine_ark_platform": {
    source: "undocumented",
    docUrl: "https://www.volcengine.com/docs/82379/1159177",
    asOf: "2026-11-03",
    officialNote: "平台按量端点 /api/v3 与 Coding Plan（/api/coding/v3）、Agent Plan（/api/plan/v3）是三条计费通路，Key 和 Base URL 不可混用。模型生命周期取自官方产品更新公告与 Coding Plan 功能发布公告（2026-11-03 抓到）：GLM-5.1 / DeepSeek-V3.2 已于 2026-06-30 下线，所以不登记。官方没有在可读页面公布逐模型 RPM/TPM 数字，quota 全 null；模型 id 的大小写以控制台为准，syncModels 可并入实际清单。"
  },
  "volcengine-ark": {
    source: "undocumented",
    docUrl: "https://www.volcengine.com/docs/82379/1799865",
    asOf: "2026-10-29",
    officialNote: "主体确认：baseUrl https://ark.cn-beijing.volces.com/api/coding/v3 = 火山方舟（字节跳动，中国站）编程端点，authUrl console.volcengine.com/ark。URL 试了但读不到正文：www.volcengine.com/docs/82379/* 与 docs.volcengine.com（301 目标）都是前端渲染的 SPA 外壳，curl 拿到的 434KB 里只有导航 DOM、没有模型表格正文；官方 markdown 导出（…/1799865.md）与 llms.txt 都在响应里给出登录跳转 redirectURI=%2F%2Fdocs.volcengine.com%2Fdocs%2Fark%2F1799865.md%3Flang%3Dzh，即需登录才能取；文档 OpenAPI 直取（/api/doc/detail、www.volcengine.com/api/docs/detail）返回 404 或「未授权访问 UnauthorizedAccess」。因此 RPM/RPD/TPM/TPD/月度 token/contextWindow 全部 null，不猜。搜索引擎给出的「Doubao-Seed 默认 RPM 500 / TPM 1000000」「Agent Plan 共享池 QPS 20、5 小时 10 万次」等数字全部来自 www.volcengine.com/article/* 这类社区/SEO 文章（正文自称转述官方但页面不是文档本体），按裁定不录入。目录侧另有风险：本 entry 的 9 个 id（Doubao-Seed-2.0-Code/pro/lite、Doubao-Seed-Code、DeepSeek-V4-Flash/Pro、GLM-5.1、MiniMax-M2.7、Kimi-K2.6）与中文站模型名写法（豆包/方舟版本号后缀）不一致，实际 model 参数需以控制台为准。"
  },
  "wafer": {
    source: "undocumented",
    docUrl: "https://www.wafer.ai/",
    asOf: "2026-10-29",
    officialNote: "registry: category apikey / authKind apiKey / baseUrl https://pass.wafer.ai/v1 / website https://www.wafer.ai/ / authUrl https://www.wafer.ai/pass / 1 model（DeepSeek-V4-Pro），无 freeModelsHint。官方取证结果：https://www.wafer.ai/pass 返回 404（registry 里的 authUrl 已经失效）；https://www.wafer.ai/ 抓到正文但没有任何 Pass 价格、限速、额度、token 或上下文数字，也没有指向 docs / pricing / FAQ 的链接；站内搜索 wafer.ai 的 pass 限速文档无官方结果。找不到官方限速页，按裁定不猜，全部 null + undocumented。"
  },
  "wandb": {
    source: "undocumented",
    docUrl: "https://docs.wandb.ai/weave/guides/integrations/inference",
    asOf: "2026-10-29",
    officialNote: "registry: category apikey / authKind apiKey / baseUrl https://api.inference.wandb.ai/v1 / website https://wandb.ai/site/inference/ / 1 model（openai/gpt-oss-20b）。docs.wandb.ai/inference 301 跳到 docs.coreweave.com/inference（CoreWeave 接管 W&B Inference，仍是官方文档站），该页没有任何限速数字。官方 'Usage information and limits' 页只给两种东西：(1) 并发限速存在但未公布数值（只有 429 文案），(2) 默认消费上限是按美元计的 $100/month（Free）/ $6,000/month（Pro）/ $700,000/year（Enterprise）—— 单位是美元消费额，不是 rpm/rpd/tpm/tpd/月度 token，也不是我们的 quota 能表达的字段，所以全部填 null；上面两条原句留在 evidence 里供 UI 显示出处。因为六个数字字段一个都填不出来，按裁定记 undocumented。另记一条 ToS：Inference 服务只在支持的地域可访问。"
  },
  "xai": {
    source: "documented",
    tpm: 5e7,
    docUrl: "https://docs.x.ai/developers/rate-limits.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "grok-4.6", tpm: 5e7, contextWindow: 5e5 }, { modelId: "grok-4.5", tpm: 5e7, contextWindow: 5e5 }],
    officialNote: '上一轮只看到搜索摘要、数值表被截断，这次取全了：docs.x.ai 带代理 200，先取 https://docs.x.ai/llms.txt（26,271 字节）定位到官方 markdown 原文 https://docs.x.ai/developers/rate-limits.md（6,153 字节，完整含全部数值表），再取 https://docs.x.ai/developers/models.md（4,843 字节，含 Context 列）。docs.x.ai/docs/overview 那页本身是 507,680 字节的 JS 外壳、剥标签后仅 6,749 字符且只有导航文字，所以数字不在 overview 里，而在 .md 原文里。 单位口径（务必按此解读，别当成 RPM）：官方只给 **RPS 和 TPM** 两个维度，没有 RPM/RPD/TPD/月度 token。rpm 留 null 的原因是我抓到的正文里没有逐字的 RPM 数字，只有一句换算线索 "Your per-second limit is derived from your per-minute request budget (RPM / 48, with a minimum of 2)" —— 据此反推 grok-4.6/4.5 的 T0 约为 150×48=7200 RPM，但这是推导值而非原文数字，按铁律不写进 rpm 字段，只在此说明，RPS 原值 150(T0)/172/208/312/500 已附在 perModel.evidence。 tpm=50000000 取的是 **Tier 0（$0，默认档）** 的 50M，官方原文 "| Tier 0 | $0 (default) |" 说明任何未花钱的 key 都在 T0，所以这一档才是本项目关心的「裸 key」上限；T1..T4 的 53M/60M/74M/100M 一并记在 evidence。 perModel 只收了官方限速表中真实存在的两个 id。其余四个我们目录里的 id 都不在现行表里，按规则不写进 perModel/freeModelIds，改为在此列出官方核对结果： 1) `grok-4-fast-reasoning`、`grok-code-fast-1`、`grok-3` 已于 2026-05-15 退役，但官方说 slug 仍可解析并被重定向："After **May 15, 2026 at 12:00 PM PT**, requests to the retired model slugs above will automatically redirect to `grok-4.3`. The slugs themselves continue to resolve, so you do not need to change your code to avoid breakage." 重定向表逐行：`grok-4-fast-reasoning` → `grok-4.3` with `low` reasoning effort；`grok-3` → `grok-4.3` with `none` reasoning effort；`grok-code-fast-1` → `grok-build-0.1`。故它们的实际上限是 `grok-4.3` 行（T0: 37 RPS / T0: 10M TPM，上下文 1M）和 `grok-build-0.1` 行（T0: 37 RPS / T0: 10M TPM，上下文 256k）。没有把这些数字直接登记到退役 slug 上，是因为那是经由重定向链路间接生效的第二层推导，请上层裁定是否采用。 2) 裸 `grok-4` 在本次抓到的三份官方正文（rate-limits.md、models.md、may-15-retirement.md）里 **0 次命中**（grep 命中的 `/grok-4` 都是 `/grok-4.7` 的前缀），即官方从未记载这个 slug。 3) 计费口径要留意："If you continue sending requests to a deprecated slug after May 15, please be aware that you will be billed at `grok-4.3` pricing of **$1.25 per 1M input tokens and $2.50 per 1M output tokens** rather than the rates of the original model." 官方现行表里的完整 id 名单（我们目录缺的都在这里）：grok-4.7、grok-4.6、grok-4.5、grok-4.3、grok-4.20-0309-reasoning、grok-4.20-0309-non-reasoning、grok-build-0.1、grok-4.20-multi-agent-0309，以及 Imagine 图像/视频与 Voice & Audio 各组。限速适用范围官方写明："Rate limit tiers apply to text, embedding, and voice models. For increases to Imagine API limits, contact sales@x.ai." 免费额度：没有任何免费模型或免费 token，T0 只是「$0 累计消费」的默认档，仍需充值才能用；提额途径是 "Spend more" / "Request an increase"（Console 提交）/ "Contact sales"。禁代理/禁转售/仅评估条款：rate-limits.md、models.md、overview 三份正文里 grep resell|prohibit|not permitted|evaluation 0 命中。'
  },
  "xiaomi-tokenplan": {
    source: "undocumented",
    docUrl: "https://mimo.mi.com/docs/zh-CN/api/guidance/rate-limit",
    asOf: "2026-10-29",
    officialNote: "主体确认与纠偏：registry 里的 website/authUrl https://mimo.xiaomi.com 只是 MiMo 的宣传/博客站（页面上只有 Web Demo / API Access / Gallery / Paper 入口，没有任何限速正文）；官方开发者文档在**另一个域名** https://mimo.mi.com/docs/…（端点域名 api.xiaomimimo.com / token-plan-{cn,sgp,ams}.xiaomimimo.com）。官方限速页（docUrl，2026-10-23 更新）确实给出了数字：mimo-v2.6-pro 与 mimo-v2.6-flash 最大 RPM 100、最大 TPM 10M，上下文窗口 1M、最大输出 128K；但本目录的 5 个 id（mimo-v2.5-pro、mimo-v2.5-pro-claude、mimo-v2.5、mimo-v2-pro、mimo-v2-omni）**一个都不在表里**，且 mimo-v2.5-pro / mimo-v2.5 官方已于 2026-10-21 10:00 下线，所以这些 RPM/TPM 不能按到他家模型上——rpm/tpm/contextWindow 全 null，perModel 留空。更关键的是这 100 RPM / 10M TPM 是**按量付费开放平台**口径（sk- Key），不是本 entry 的 Token Plan：Token Plan（tp-/ttp- Key）官方只按订阅档位公布「每月固定额度 41 亿 / 110 亿 / 380 亿 / 820 亿 Credits」（Lite/Standard/Pro/Max，年度包 492 亿/1320 亿/4560 亿/9840 亿），单位是 Credits（页面只说「采用 Token 折算机制」，未给折算比例），既不是 token 也不是 RPM → monthlyTokens 留 null，档位取决于用户买哪一档。警示：官方明确 API Key（sk-）与 Token Plan Key（tp-/ttp-）互不通用；Token Plan 是固定订阅套餐额度，把订阅 Key 当通用 API 中转使用不符合其订阅用途（本 entry 的 registry notes 也写了「keys start with tp- and are cluster-specific」）。"
  },
  "xkiro": {
    source: "documented",
    tpd: 5e5,
    docUrl: "https://xkiro.com/",
    asOf: "2026-10-29",
    perModel: [{ modelId: "qwen/qwen3.7-flash:free", tpd: 5e5 }],
    officialNote: `tpd=500000 is a per-ACCOUNT daily token allowance shared by all free models, not a per-model cap; it rises to 1,000,000/day only after the user verifies on Telegram, so that higher number is conditional and was not recorded. No official RPM/RPD/TPM/monthly/context-window figure is published on xkiro.com - the site's marketing page only gives the free token allowance; https://xkiro.com/pricing returned 404, so the paid-tier figures seen on other paths were not used. The catalogue lists one :free slug, but the official page says 45 models are free, so freeModelIds is deliberately limited to what this repo actually ships. ToS note: https://xkiro.com/terms prohibits you to "Resell or redistribute the service without written permission."`
  },
  "yi": {
    source: "undocumented",
    docUrl: "https://platform.lingyiwanwu.com/docs",
    asOf: "2026-11-03",
    officialNote: "Base URL、鉴权头与当前模型 id 逐字取自官方快速上手指南（2026-11-03 抓到）。官方没有公布可登记的 RPM/TPM 帽，quota 全 null。两个模型都由智能路由承载，实际后端可能落到 DeepSeek / Qwen 等模型；这一点写在 registry notes，避免用户把它当成固定后端。"
  },
  "zai": {
    source: "undocumented",
    docUrl: "https://docs.z.ai/guides/llm/glm-5.3.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "glm-5.3", contextWindow: 1e6 }],
    officialNote: "主体确认：baseUrl https://api.z.ai/api/coding/paas/v4 = Z.ai 国际站（Singapore 主体，website z.ai，docs.z.ai）。官方限速页 https://docs.z.ai/api-reference/rate-limit.md 以 307 重定向到 https://z.ai/manage-apikey/rate-limits，该页抓到的是「CSS-heavy JavaScript app shell，未登录不显示任何数字」，因此 rpm/rpd/tpm/tpd/monthlyTokens 全部 null（有页面、无数值可读）。Coding Plan 官方订阅页 https://docs.z.ai/devpack/teamplan.md 只给积分制额度：Standard 15,000/66,000（每 5 小时/每周）、Premium 35,000/155,000，并发 Standard 1-2、Premium 2+；单位是 credits（积分），不是请求/token 帽，故不登记进 quota，只在此记录。contextWindow 取自 docs.z.ai 模型页（该页无任何限速句子）。警示：docs.z.ai 与 docs.bigmodel.cn 的 Coding Plan 条款均把套餐限定在官方支持的编程工具内使用（见 glm-cn 条目的原句），把 Coding Plan Key 当通用 API 中转并不在文档许可范围内。"
  },
  "zai_api": {
    source: "undocumented",
    docUrl: "https://docs.z.ai/guides/llm/glm-5.3.md",
    asOf: "2026-10-29",
    perModel: [{ modelId: "glm-5.3", contextWindow: 1e6 }, { modelId: "glm-4.7-flash" }],
    officialNote: "主体确认：baseUrl https://api.z.ai/api/paas/v4（按量付费通用端点，同属 Z.ai 国际站）。用的是国际站 docs.z.ai 那份：https://docs.z.ai/guides/overview/pricing 只公布单价与免费 Flash SKU（GLM-4.7-Flash Free、GLM-4.5-Flash Free），无 RPM/TPM/上下文数字；本条目 models[] 里只有 glm-4.7-flash 落在免费 SKU，故 freeModelIds 只登记它（glm-4.5-flash 不在本目录）。限速页 docs.z.ai/api-reference/rate-limit.md → 307 跳转 z.ai/manage-apikey/rate-limits（登录态 JS 壳，读不到正文数字），所以 rpm/rpd/tpm/tpd/monthlyTokens 全 null；唯一可登记的是 GLM-5.3 的 1M 上下文。"
  },
  "zenmux": {
    source: "undocumented",
    asOf: "2026-10-29",
    officialNote: `Site https://zenmux.ai/ is unreachable from this environment - every attempt returned a network-level "fetch failed" (never an error page): https://zenmux.ai/, https://zenmux.ai/docs, https://zenmux.ai/terms, https://zenmux.ai/legal, https://zenmux.ai/docs/platform/rate-limits.html. Only indexed official page reachable indirectly is https://zenmux.ai/docs/zh/best-practices/hermes-agent.html, which discusses 429 handling qualitatively ("检查套餐配额：订阅套餐有请求频率限制") but publishes NO number. Since no numeric limit could be read from the body, all quota fields are null. The registry's pay-as-you-go authUrl (https://zenmux.ai/platform/pay-as-you-go) could not be read. Do not borrow DeepSeek's official concurrency limits (api-docs.deepseek.com: deepseek-flash 2500 / deepseek-v4-pro 500 concurrent) - that is a different vendor.`
  }
};
const WINDOW_OF_METRIC = {
  rpm: "minute",
  tpm: "minute",
  rpd: "day",
  tpd: "day",
  monthlyTokens: "month"
};
const METRICS = ["monthlyTokens", "rpd", "tpd", "rpm", "tpm"];
function isFreePool(entry) {
  return entry.category === "free-tier" || entry.authKind === "none" || (entry.freeModelsHint?.length ?? 0) > 0;
}
function quotaViewOf(entry, options) {
  const free = isFreePool(entry);
  const quota = AGGREGATE_QUOTA[entry.id];
  if (entry.authKind === "apiKey" && !options.hasApiKey) {
    return { state: "needs-key", isFreePool: free, asOf: quota?.asOf, docUrl: quota?.docUrl };
  }
  const usage = options.usage;
  if (usage && quota) {
    for (const metric of METRICS) {
      const limit = quota[metric];
      if (typeof limit === "number" && limit > 0 && usage[metric] >= limit) {
        return {
          state: "exhausted",
          isFreePool: free,
          exhaustedMetric: metric,
          used: usage[metric],
          limit,
          asOf: quota.asOf,
          docUrl: quota.docUrl,
          contextWindow: quota.contextWindow,
          officialNote: quota.officialNote
        };
      }
    }
  }
  if (quota?.source === "documented") {
    return {
      state: "documented",
      isFreePool: free,
      asOf: quota.asOf,
      docUrl: quota.docUrl,
      contextWindow: quota.contextWindow,
      officialNote: quota.officialNote
    };
  }
  if (quota) {
    return {
      state: "undocumented",
      isFreePool: free,
      asOf: quota.asOf,
      docUrl: quota.docUrl,
      officialNote: quota.officialNote
    };
  }
  return { state: "absent", isFreePool: free };
}
function quotaRows(entryId, usage) {
  const quota = AGGREGATE_QUOTA[entryId];
  if (!quota) return [];
  const rows = [];
  for (const metric of METRICS) {
    const limit = quota[metric];
    if (typeof limit === "number" && limit > 0) {
      rows.push({ metric, limit, used: usage?.[metric] ?? 0, window: WINDOW_OF_METRIC[metric] });
    }
  }
  return rows;
}
function categoryLabelKey(category) {
  if (category === "free-tier") return "aggregate.category.freeTier";
  if (category === "apikey") return "aggregate.category.apikey";
  return "aggregate.category.local";
}
function draftOfParams(params) {
  const { temperature, max_tokens, top_p, ...rest } = params ?? {};
  const asText = (value) => value === void 0 || value === null ? "" : String(value);
  return {
    temperature: asText(temperature),
    maxTokens: asText(max_tokens),
    topP: asText(top_p),
    extraJson: Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : ""
  };
}
function parseParamDraft(draft) {
  const params = {};
  const numericFields = [
    ["temperature", draft.temperature],
    ["max_tokens", draft.maxTokens],
    ["top_p", draft.topP]
  ];
  for (const [key, raw] of numericFields) {
    const text = raw.trim();
    if (!text) continue;
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    params[key] = value;
  }
  const extra = draft.extraJson.trim();
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      Object.assign(params, parsed);
    } catch {
      return null;
    }
  }
  return params;
}
function paramSummary(params) {
  if (!params) return "";
  return Object.entries(params).map(([key, value]) => `${key}=${String(value)}`).join(", ");
}
function groupOfModel(id) {
  const index = id.search(/[\-_:.]/);
  return index === -1 ? id : id.slice(0, index);
}
function costBadgeOf(cost, t) {
  if (cost.class === "free") {
    if (cost.evidence === "official") {
      return {
        label: t("aggregate.manage.models.costFreeOfficial"),
        className: "text-success",
        title: t("aggregate.manage.models.costFreeOfficialHint")
      };
    }
    if (cost.evidence === "catalogue") {
      return {
        label: t("aggregate.manage.models.costFreeCatalogue"),
        className: "text-success",
        title: t("aggregate.manage.models.costFreeCatalogueHint")
      };
    }
    return {
      label: t("aggregate.manage.models.costFreeThirdParty"),
      className: "text-success",
      title: t("aggregate.manage.models.costFreeThirdPartyHint")
    };
  }
  if (cost.class === "included") {
    return {
      label: t("aggregate.manage.models.costIncluded"),
      className: "text-primary",
      title: t("aggregate.manage.models.costIncludedHint")
    };
  }
  if (cost.class === "priced") {
    const price = cost.price;
    return {
      label: t("aggregate.manage.models.costPriced"),
      className: "text-warning",
      // 标价是绝对值，不是倍率；把它写成倍率会让读者按错误的量级比较
      title: price ? `${t("aggregate.manage.models.costPricedHint")}
${t("aggregate.manage.models.costPriceLabel", {
        input: price.input,
        output: price.output
      })}` : t("aggregate.manage.models.costPricedHint")
    };
  }
  return {
    label: t("aggregate.manage.models.costUnknown"),
    className: "text-muted-foreground",
    title: t("aggregate.manage.models.costUnknownHint")
  };
}
const NUMERIC_PARAM_FIELDS = [
  { key: "temperature", label: "temperature" },
  { key: "maxTokens", label: "max_tokens" },
  { key: "topP", label: "top_p" }
];
function AggregateDetailPanel(props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const {
    entry,
    state,
    quotaUsage,
    detail,
    loading,
    reasonText,
    onRefresh,
    onApplyDetail,
    onRemove
  } = props;
  const [enabling, setEnabling] = reactExports.useState(false);
  const unsupported = entry.authKind === "unsupported";
  const wireLabel = entry.wire === "anthropic-messages" ? t("aggregate.manage.wireAnthropic") : t("aggregate.manage.wireChat");
  const termsWarning = getTermsWarning(entry.id);
  const handleToggleEnabled = async (enabled) => {
    setEnabling(true);
    const result = await window.electronAPI.aggregate.setEnabled(entry.id, enabled);
    setEnabling(false);
    if (!result.success) {
      toast({ title: t("common.error"), description: reasonText(result.reason), variant: "destructive" });
      return;
    }
    await onRefresh();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 items-start gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-base font-semibold uppercase", children: entry.name.slice(0, 1) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "truncate text-xl font-semibold", children: entry.name }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", children: t(categoryLabelKey(entry.category)) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "secondary", children: wireLabel }),
            state.configured && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: state.enabled ? "default" : "outline", children: state.enabled ? t("aggregate.active") : t("aggregate.disabled") })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "mt-0.5 truncate text-sm text-muted-foreground", children: [
            entry.id,
            entry.notes ? ` · ${entry.notes}` : ""
          ] })
        ] })
      ] }),
      state.configured && !unsupported && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 text-sm text-muted-foreground", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("aggregate.dialog.enabled") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              checked: state.enabled,
              disabled: enabling,
              onCheckedChange: (enabled) => void handleToggleEnabled(enabled)
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "ghost", size: "sm", className: "text-destructive", onClick: () => void onRemove(), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "mr-1.5 h-4 w-4" }),
          t("aggregate.manage.remove")
        ] })
      ] })
    ] }),
    unsupported && /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "py-4 text-sm text-muted-foreground", children: t("aggregate.unsupported") }) }),
    termsWarning && /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { className: "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-1 py-3 text-xs text-amber-800 dark:text-amber-300", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: termsWarning.scope === "free-tier-models" ? t("aggregate.termsWarningFreeOnly") : t("aggregate.termsWarningAll") }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "italic", children: [
        '"',
        termsWarning.quote,
        '"'
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "underline",
          onClick: () => window.electronAPI?.app?.openExternal?.(termsWarning.docUrl),
          children: t("aggregate.termsWarningSource", { date: termsWarning.asOf })
        }
      )
    ] }) }),
    loading && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 py-8 text-sm text-muted-foreground", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
      t("common.loading")
    ] }),
    !loading && !unsupported && !state.configured && /* @__PURE__ */ jsxRuntimeExports.jsx(SetupPanel, { entry, reasonText, onRefresh }),
    !loading && !unsupported && state.configured && detail && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        KeysCard,
        {
          entry,
          keys: detail.keys,
          reasonText,
          onApplyDetail,
          onRefresh
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        EndpointCard,
        {
          entry,
          state,
          reasonText,
          onRefresh
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        QuotaCard,
        {
          entry,
          hasApiKey: state.hasApiKey,
          usage: quotaUsage,
          credit: detail.credit,
          onRefresh
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        ModelsCard,
        {
          entry,
          models: detail.models,
          reasonText,
          onApplyDetail,
          onRefresh
        }
      )
    ] })
  ] });
}
function SetupPanel(props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { entry, reasonText, onRefresh } = props;
  const [baseUrl, setBaseUrl] = reactExports.useState(entry.baseUrl ?? "");
  const [apiKeys, setApiKeys] = reactExports.useState("");
  const [models, setModels] = reactExports.useState(entry.models.map((model) => model.id).join("\n"));
  const [saving, setSaving] = reactExports.useState(false);
  const handleSave = async () => {
    setSaving(true);
    const result = await window.electronAPI.aggregate.save({
      id: entry.id,
      baseUrl: baseUrl.trim() || void 0,
      apiKeys: apiKeys.split(/[\n,]/).map((key) => key.trim()).filter(Boolean),
      models: models.split(/[\n,]/).map((model) => model.trim()).filter(Boolean),
      enabled: true
    });
    setSaving(false);
    if (!result.success) {
      toast({ title: t("common.error"), description: reasonText(result.reason), variant: "destructive" });
      return;
    }
    toast({ title: t("aggregate.result.saved", { name: entry.name }) });
    await onRefresh();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { className: "pb-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { className: "text-base", children: t("aggregate.manage.setup.title") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.notConfiguredHint") })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "setup-base-url", children: t("aggregate.dialog.baseUrl") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Input,
          {
            id: "setup-base-url",
            className: "font-mono text-xs",
            value: baseUrl,
            placeholder: t("aggregate.dialog.baseUrlHint"),
            onChange: (event) => setBaseUrl(event.target.value)
          }
        )
      ] }),
      entry.authKind === "apiKey" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "setup-api-keys", children: t("aggregate.dialog.apiKeys") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Textarea,
          {
            id: "setup-api-keys",
            rows: 2,
            className: "font-mono text-xs",
            placeholder: t("aggregate.dialog.apiKeyPlaceholder"),
            value: apiKeys,
            onChange: (event) => setApiKeys(event.target.value)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.dialog.apiKeysHint") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "setup-models", children: t("aggregate.dialog.models") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Textarea,
          {
            id: "setup-models",
            rows: 4,
            className: "font-mono text-xs",
            value: models,
            onChange: (event) => setModels(event.target.value)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.setup.modelsHint") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex justify-end", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { onClick: () => void handleSave(), disabled: saving, children: [
        saving && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-2 h-4 w-4 animate-spin" }),
        t("aggregate.manage.setup.submit")
      ] }) })
    ] })
  ] });
}
function KeysCard(props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { entry, keys, reasonText, onApplyDetail, onRefresh } = props;
  const [newKey, setNewKey] = reactExports.useState("");
  const [adding, setAdding] = reactExports.useState(false);
  const [busyId, setBusyId] = reactExports.useState(null);
  if (entry.authKind !== "apiKey") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "pb-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { className: "text-base", children: t("aggregate.manage.keys.title") }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "text-sm text-muted-foreground", children: t("aggregate.manage.keys.keyless") })
    ] });
  }
  const handleAdd = async () => {
    const key = newKey.trim();
    if (!key) return;
    setAdding(true);
    const result = await window.electronAPI.aggregate.addKey(entry.id, key);
    setAdding(false);
    if (!result.success) {
      toast({
        title: t("common.error"),
        description: result.message ?? t("aggregate.manage.keys.rejected", { message: reasonText(result.reason) }),
        variant: "destructive"
      });
      return;
    }
    setNewKey("");
    if (result.detail) onApplyDetail(result.detail);
    toast({ title: t("aggregate.manage.keys.added") });
    await onRefresh();
  };
  const settle = async (result, okTitle) => {
    if (!result.success) {
      toast({
        title: t("common.error"),
        description: result.message ?? reasonText(result.reason),
        variant: "destructive"
      });
      return false;
    }
    if (result.detail) onApplyDetail(result.detail);
    toast({ title: okTitle });
    return true;
  };
  const handleValidate = async (key) => {
    setBusyId(key.id);
    const result = await window.electronAPI.aggregate.validateKey(entry.id, key.id);
    setBusyId(null);
    await settle(result, t("aggregate.manage.keys.valid"));
    await onRefresh();
  };
  const handleToggle = async (key, enabled) => {
    setBusyId(key.id);
    const result = await window.electronAPI.aggregate.setKeyEnabled(key.id, enabled);
    setBusyId(null);
    await settle(result, t("aggregate.manage.toast.saved"));
    await onRefresh();
  };
  const handleDelete = async (key) => {
    setBusyId(key.id);
    const result = await window.electronAPI.aggregate.removeKey(key.id);
    setBusyId(null);
    await settle(result, t("aggregate.manage.toast.removed"));
    await onRefresh();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { className: "flex-row items-center justify-between pb-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2 text-base", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(KeyRound, { className: "h-4 w-4" }),
        t("aggregate.manage.keys.title")
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.keyCount", { count: keys.length }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-3", children: [
      keys.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("aggregate.manage.keys.empty") }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-1.5", children: keys.map((key) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(KeyRound, { className: "h-4 w-4 shrink-0 text-muted-foreground" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-xs", children: key.maskedKey }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: key.status === "active" ? "default" : key.status === "error" ? "destructive" : "outline", children: key.status === "active" ? t("common.enabled") : key.status === "error" ? t("aggregate.manage.keys.statusError") : t("common.disabled") }),
        key.errorMessage && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "max-w-[16rem] truncate text-[11px] text-destructive", title: key.errorMessage, children: key.errorMessage }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-auto text-[11px] text-muted-foreground", children: key.lastUsed ? t("aggregate.manage.keys.lastUsed", { time: new Date(key.lastUsed).toLocaleString() }) : new Date(key.createdAt).toLocaleDateString() }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Button,
          {
            variant: "ghost",
            size: "sm",
            className: "h-7 px-2",
            title: t("aggregate.manage.keys.validate"),
            disabled: busyId === key.id,
            onClick: () => void handleValidate(key),
            children: busyId === key.id ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3.5 w-3.5 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, { className: "h-3.5 w-3.5" })
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Switch,
          {
            checked: key.status === "active",
            disabled: busyId === key.id,
            onCheckedChange: (enabled) => void handleToggle(key, enabled)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Button,
          {
            variant: "ghost",
            size: "sm",
            className: "h-7 px-2 text-destructive",
            title: t("aggregate.manage.keys.delete"),
            disabled: busyId === key.id,
            onClick: () => void handleDelete(key),
            children: /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "h-3.5 w-3.5" })
          }
        )
      ] }, key.id)) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Input,
            {
              className: "font-mono text-xs",
              type: "password",
              placeholder: t("aggregate.manage.keys.placeholder"),
              value: newKey,
              disabled: adding,
              onChange: (event) => setNewKey(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAdd();
                }
              }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { onClick: () => void handleAdd(), disabled: adding || !newKey.trim(), children: [
            adding ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Plus, { className: "mr-1.5 h-4 w-4" }),
            t("aggregate.manage.keys.add")
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.keys.hint") })
      ] })
    ] })
  ] });
}
function EndpointCard(props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { entry, state, reasonText, onRefresh } = props;
  const [baseUrl, setBaseUrl] = reactExports.useState(state.baseUrl ?? "");
  const [saving, setSaving] = reactExports.useState(false);
  reactExports.useEffect(() => {
    setBaseUrl(state.baseUrl ?? "");
  }, [state.baseUrl]);
  const changed = (state.baseUrl ?? "") !== baseUrl.trim();
  const invalid = Boolean(baseUrl.trim()) && !/^https?:\/\//i.test(baseUrl.trim());
  const canReset = Boolean(entry.baseUrl) && (state.baseUrl ?? "") !== entry.baseUrl;
  const handleSave = async () => {
    if (invalid) {
      toast({ title: t("common.error"), description: t("aggregate.manage.endpoint.invalid"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const result = await window.electronAPI.aggregate.save({ id: entry.id, baseUrl: baseUrl.trim() || void 0, enabled: state.enabled });
    setSaving(false);
    if (!result.success) {
      toast({ title: t("common.error"), description: reasonText(result.reason), variant: "destructive" });
      return;
    }
    toast({ title: t("aggregate.manage.endpoint.saved") });
    await onRefresh();
  };
  const handleReset = async () => {
    if (!entry.baseUrl) return;
    setBaseUrl(entry.baseUrl);
    setSaving(true);
    const result = await window.electronAPI.aggregate.save({ id: entry.id, baseUrl: entry.baseUrl, enabled: state.enabled });
    setSaving(false);
    if (!result.success) {
      toast({ title: t("common.error"), description: reasonText(result.reason), variant: "destructive" });
      return;
    }
    await onRefresh();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "pb-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { className: "text-base", children: t("aggregate.manage.endpoint.title") }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Input,
          {
            className: "min-w-[16rem] flex-1 font-mono text-xs",
            value: baseUrl,
            onChange: (event) => setBaseUrl(event.target.value)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { onClick: () => void handleSave(), disabled: saving || !changed || invalid, children: [
          saving ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : null,
          t("aggregate.manage.endpoint.save")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => void handleReset(), disabled: saving || !canReset, children: t("aggregate.manage.endpoint.reset") })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-muted-foreground", children: [
        t("aggregate.manage.endpoint.chatPath"),
        ":",
        " ",
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono", children: [
          (state.baseUrl ?? "").replace(/\/+$/, ""),
          entry.wire === "anthropic-messages" ? "/messages" : "/chat/completions"
        ] })
      ] })
    ] })
  ] });
}
function CreditReadingLine(props) {
  const { t } = useTranslation();
  const { reading } = props;
  if (!reading.ok) {
    const labelKey = reading.reason === "http-status" ? "aggregate.manage.credit.failHttpStatus" : reading.reason === "not-json" ? "aggregate.manage.credit.failNotJson" : reading.reason === "network" ? "aggregate.manage.credit.failNetwork" : "aggregate.manage.credit.failShape";
    return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-destructive", title: reading.detail, children: t("aggregate.manage.credit.failDetail", { label: t(labelKey), detail: reading.detail }) });
  }
  if (reading.unlimited) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("aggregate.manage.credit.unlimited") });
  }
  if (typeof reading.remaining !== "number") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t("aggregate.manage.credit.limitOnly", { limit: reading.limit ?? 0, unit: reading.unit }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono", children: typeof reading.limit === "number" ? t("aggregate.manage.credit.remainingWithLimit", {
    remaining: reading.remaining,
    limit: reading.limit,
    unit: reading.unit
  }) : t("aggregate.manage.credit.remaining", { remaining: reading.remaining, unit: reading.unit }) });
}
function creditTimeOf(asOf) {
  const at = Date.parse(asOf);
  return Number.isNaN(at) ? asOf : new Date(at).toLocaleString();
}
function QuotaCard(props) {
  const { t } = useTranslation();
  const { entry, hasApiKey, usage, credit, onRefresh } = props;
  const [probing, setProbing] = reactExports.useState(false);
  const [probe, setProbe] = reactExports.useState(null);
  const view = quotaViewOf(entry, { hasApiKey, usage });
  const rows = quotaRows(entry.id, usage);
  const stateTone = view.state === "exhausted" ? "border-transparent bg-destructive text-destructive-foreground" : view.state === "documented" ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300" : view.state === "undocumented" ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400" : "text-muted-foreground";
  const probeDeclaration = entry.quotaProbe;
  const handleQueryCredits = async () => {
    setProbing(true);
    try {
      setProbe(await window.electronAPI.aggregate.queryCredits(entry.id));
      await onRefresh();
    } finally {
      setProbing(false);
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { className: "flex-row items-center justify-between pb-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2 text-base", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ChartColumn, { className: "h-4 w-4" }),
        t("aggregate.manage.quota.title")
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
        view.isFreePool && /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", children: t("aggregate.quotaFreePool") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: stateTone, children: t(`aggregate.quota.${view.state}`) })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-2", children: [
      view.state === "exhausted" && view.exhaustedMetric && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-destructive", children: t("aggregate.quotaUsage", {
        metric: t(`aggregate.metric.${view.exhaustedMetric}`),
        used: view.used ?? 0,
        limit: view.limit ?? 0,
        window: t(`aggregate.window.${WINDOW_OF_METRIC[view.exhaustedMetric]}`)
      }) }),
      view.state === "needs-key" && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("aggregate.manage.quota.notKeyed") }),
      rows.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-1", children: rows.map((row) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between rounded-md border px-3 py-1.5 text-xs", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t(`aggregate.metric.${row.metric}`) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono", children: [
          row.used,
          "/",
          row.limit
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: t(`aggregate.window.${WINDOW_OF_METRIC[row.metric]}`) })
      ] }, row.metric)) }),
      rows.length === 0 && view.state !== "needs-key" && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: t("aggregate.manage.quota.none") }),
      view.officialNote && /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-muted-foreground", title: view.officialNote, children: [
        t("aggregate.quotaScopeNote"),
        view.officialNote
      ] }),
      (view.asOf || view.docUrl) && /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-[11px] text-muted-foreground", children: [
        view.asOf ? t("aggregate.quotaSource", { date: view.asOf }) : "",
        view.docUrl && /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            className: "ml-1 underline",
            onClick: () => window.electronAPI?.app?.openExternal?.(view.docUrl),
            children: view.docUrl
          }
        )
      ] }),
      probeDeclaration && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1.5 border-t pt-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs font-medium text-muted-foreground", children: t("aggregate.manage.credit.title") }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              variant: "outline",
              size: "sm",
              disabled: !hasApiKey || probing,
              title: hasApiKey ? t("aggregate.manage.credit.hint", { path: probeDeclaration.path }) : t("aggregate.manage.credit.needsKey"),
              onClick: () => void handleQueryCredits(),
              children: [
                probing ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Coins, { className: "mr-1.5 h-4 w-4" }),
                probing ? t("aggregate.manage.credit.querying") : t("aggregate.manage.credit.query")
              ]
            }
          )
        ] }),
        !hasApiKey && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.credit.needsKey") }),
        probe?.rows.map((row) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 text-xs", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate", title: row.keyName, children: t("aggregate.manage.credit.perKey", { name: row.keyName, maskedKey: row.maskedKey }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CreditReadingLine, { reading: row.reading })
        ] }, row.keyId)),
        probe && probe.skipped > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-amber-700 dark:text-amber-400", children: t("aggregate.manage.credit.skippedKeys", { n: probe.skipped }) }),
        probe?.failure && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-destructive", children: t(`aggregate.manage.credit.failure.${probe.failure}`) }),
        (() => {
          const shown = probe?.snapshot ?? credit;
          if (!shown) {
            return probe ? null : /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.credit.never") });
          }
          const fresh = creditSnapshotLive(shown);
          if (!shown.ok) {
            return /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.credit.lastFail", {
              time: creditTimeOf(shown.asOf),
              detail: t(`aggregate.manage.credit.reason.${shown.reason ?? "network"}`)
            }) });
          }
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-0.5", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 text-xs", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono", children: shown.unlimited ? t("aggregate.manage.credit.unlimited") : typeof shown.limit === "number" ? t("aggregate.manage.credit.remainingWithLimit", {
                remaining: shown.remaining ?? 0,
                limit: shown.limit,
                unit: shown.unit
              }) : t("aggregate.manage.credit.remaining", { remaining: shown.remaining ?? 0, unit: shown.unit }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: t("aggregate.manage.credit.at", { time: creditTimeOf(shown.asOf) }) })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: fresh ? "text-[11px] text-muted-foreground" : "text-[11px] text-amber-700 dark:text-amber-400", children: fresh ? t("aggregate.manage.credit.orderingOn", { minutes: Math.round(CREDIT_SNAPSHOT_TTL_MS / 6e4) }) : t("aggregate.manage.credit.orderingOff", { minutes: Math.round(CREDIT_SNAPSHOT_TTL_MS / 6e4) }) })
          ] });
        })(),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-[11px] text-muted-foreground", title: probeDeclaration.docUrl, children: [
          t("aggregate.manage.credit.endpoint", { path: probeDeclaration.path, doc: probeDeclaration.docUrl }),
          ` ${t("aggregate.quotaSource", { date: probeDeclaration.asOf })}`
        ] })
      ] })
    ] })
  ] });
}
function ModelsCard(props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { entry, models, reasonText, onApplyDetail, onRefresh } = props;
  const [search, setSearch] = reactExports.useState("");
  const [collapsed, setCollapsed] = reactExports.useState({});
  const [busyModel, setBusyModel] = reactExports.useState(null);
  const [busyGroup, setBusyGroup] = reactExports.useState(null);
  const [syncing, setSyncing] = reactExports.useState(false);
  const [testingAll, setTestingAll] = reactExports.useState(false);
  const [testResults, setTestResults] = reactExports.useState({});
  const [paramModel, setParamModel] = reactExports.useState(null);
  const [paramDraft, setParamDraft] = reactExports.useState(null);
  const [annotateModel, setAnnotateModel] = reactExports.useState(null);
  const [addOpen, setAddOpen] = reactExports.useState(false);
  const [newModelId, setNewModelId] = reactExports.useState("");
  const [adding, setAdding] = reactExports.useState(false);
  const [costFilter, setCostFilter] = reactExports.useState("all");
  const servedCount = models.filter((model) => model.served).length;
  const rows = reactExports.useMemo(
    () => models.map((model) => ({
      model,
      cost: model.cost ?? aggregateCostOf({
        entryId: entry.id,
        modelId: model.id,
        ...entry.freeModelsHint ? { freeModelsHint: entry.freeModelsHint } : {}
      })
    })),
    [models, entry.id, entry.freeModelsHint]
  );
  const costCounts = reactExports.useMemo(
    () => aggregateCostCounts(rows.map((row) => row.cost)),
    [rows]
  );
  const filtered = reactExports.useMemo(() => {
    const byCost = costFilter === "all" ? rows : rows.filter((row) => row.cost.class === costFilter);
    const needle = search.trim().toLowerCase();
    if (!needle) return byCost;
    return byCost.filter(
      (row) => row.model.id.toLowerCase().includes(needle) || row.model.displayName.toLowerCase().includes(needle)
    );
  }, [rows, search, costFilter]);
  const groups = reactExports.useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const row of filtered) {
      const group = groupOfModel(row.model.id);
      const list = map.get(group) ?? [];
      list.push(row);
      map.set(group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);
  const settle = async (result, okTitle) => {
    if (!result.success) {
      toast({
        title: t("common.error"),
        description: result.message ?? reasonText(result.reason),
        variant: "destructive"
      });
      return false;
    }
    if (result.detail) onApplyDetail(result.detail);
    if (okTitle) toast({ title: okTitle });
    return true;
  };
  const handleSync = async () => {
    setSyncing(true);
    const result = await window.electronAPI.aggregate.syncModels(entry.id);
    setSyncing(false);
    if (!result.success) {
      toast({ title: t("common.error"), description: reasonText(result.reason), variant: "destructive" });
      return;
    }
    if (result.modelSource === "models.dev") {
      toast({
        title: t("aggregate.manage.toast.synced", {
          fetched: result.fetchedCount ?? 0,
          added: result.addedCount ?? 0,
          total: result.modelCount ?? 0
        }),
        description: t("aggregate.manage.toast.syncedFromModelsDev")
      });
    } else if ((result.addedCount ?? 0) === 0) {
      toast({ title: t("aggregate.manage.toast.syncedNoChange") });
    } else {
      toast({
        title: t("aggregate.manage.toast.synced", {
          fetched: result.fetchedCount ?? 0,
          added: result.addedCount ?? 0,
          total: result.modelCount ?? 0
        })
      });
    }
    await onRefresh();
  };
  const handleToggleModel = async (model, enabled) => {
    setBusyModel(model.id);
    const result = await window.electronAPI.aggregate.setModelEnabled(entry.id, model.id, enabled);
    setBusyModel(null);
    await settle(result);
    await onRefresh();
  };
  const handleDeleteModel = async (model) => {
    if (!window.confirm(t("aggregate.manage.models.delete"))) return;
    setBusyModel(model.id);
    const result = await window.electronAPI.aggregate.removeModel(entry.id, model.id);
    setBusyModel(null);
    const ok = await settle(result);
    if (ok) toast({ title: t("aggregate.manage.toast.modelRemoved", { model: model.id }) });
    await onRefresh();
  };
  const handleTestModel = async (model) => {
    setBusyModel(model.id);
    const result = await window.electronAPI.aggregate.testModel(entry.id, model.id);
    setBusyModel(null);
    setTestResults((prev) => ({ ...prev, [model.id]: result }));
  };
  const handleTestAll = async () => {
    if (filtered.length === 0) return;
    setTestingAll(true);
    toast({ title: t("aggregate.manage.toast.testing", { count: filtered.length }) });
    const next = { ...testResults };
    let ok = 0;
    let failed = 0;
    for (const row of filtered) {
      setBusyModel(row.model.id);
      const result = await window.electronAPI.aggregate.testModel(entry.id, row.model.id);
      next[row.model.id] = result;
      if (result.success) ok += 1;
      else failed += 1;
    }
    setBusyModel(null);
    setTestingAll(false);
    setTestResults(next);
    toast({ title: t("aggregate.manage.toast.tested", { ok, failed }) });
  };
  const handleGroupToggle = async (groupRows) => {
    const allServed = groupRows.every((row) => row.model.served);
    const enable = !allServed;
    setBusyGroup(groupOfModel(groupRows[0].model.id));
    for (const row of groupRows) {
      const result = await window.electronAPI.aggregate.setModelEnabled(entry.id, row.model.id, enable);
      if (result.success && result.detail) onApplyDetail(result.detail);
    }
    setBusyGroup(null);
    await onRefresh();
  };
  const openParams = (model) => {
    setParamModel(model.id);
    setParamDraft(draftOfParams(model.params));
  };
  const closeParams = () => {
    setParamModel(null);
    setParamDraft(null);
  };
  const applyParams = async () => {
    if (!paramModel || !paramDraft) return;
    const parsed = parseParamDraft(paramDraft);
    if (!parsed) {
      toast({ title: t("common.error"), description: t("aggregate.dialog.paramsInvalid"), variant: "destructive" });
      return;
    }
    const result = await window.electronAPI.aggregate.setModelParams(entry.id, paramModel, parsed);
    if (!await settle(result, t("aggregate.manage.toast.saved"))) return;
    await onRefresh();
    closeParams();
  };
  const clearParams = async () => {
    if (!paramModel) return;
    const result = await window.electronAPI.aggregate.setModelParams(entry.id, paramModel, {});
    if (!await settle(result, t("aggregate.manage.toast.saved"))) return;
    await onRefresh();
    closeParams();
  };
  const handleAddModel = async () => {
    const id = newModelId.trim();
    if (!id) return;
    setAdding(true);
    const result = await window.electronAPI.aggregate.addModel(entry.id, id);
    setAdding(false);
    if (!await settle(result, t("aggregate.manage.toast.saved"))) return;
    setNewModelId("");
    setAddOpen(false);
    await onRefresh();
  };
  const allCollapsed = groups.length > 0 && groups.every(([group]) => collapsed[group]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardHeader, { className: "space-y-3 pb-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2 text-base", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Wifi, { className: "h-4 w-4" }),
          t("aggregate.manage.models.title")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-muted-foreground", children: t("aggregate.manage.models.count", { total: models.length, served: servedCount }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative min-w-[12rem] flex-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Search, { className: "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Input,
            {
              className: "pl-9",
              value: search,
              placeholder: t("aggregate.manage.models.search"),
              onChange: (event) => setSearch(event.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: costFilter, onValueChange: (value) => setCostFilter(value), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { className: "w-[10rem]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "all", children: t("aggregate.manage.models.costFilterAll") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "free", children: t("aggregate.manage.models.costFree") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "included", children: t("aggregate.manage.models.costIncluded") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "priced", children: t("aggregate.manage.models.costPriced") }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "unknown", children: t("aggregate.manage.models.costUnknown") })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", disabled: syncing, onClick: () => void handleSync(), title: t("aggregate.manage.models.syncHint"), children: [
          syncing ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "mr-1.5 h-4 w-4" }),
          t("aggregate.manage.models.sync")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", onClick: () => setAddOpen(true), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Plus, { className: "mr-1.5 h-4 w-4" }),
          t("aggregate.manage.models.add")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", disabled: testingAll || filtered.length === 0, onClick: () => void handleTestAll(), children: [
          testingAll ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldCheck, { className: "mr-1.5 h-4 w-4" }),
          testingAll ? t("aggregate.manage.models.testing") : t("aggregate.manage.models.testAll")
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          CatalogScopeBatchButton,
          {
            providerId: entry.id,
            scopeLabel: entry.name,
            onFinished: () => void onRefresh()
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Button,
          {
            variant: "ghost",
            size: "sm",
            onClick: () => setCollapsed((next) => {
              const map = { ...next };
              for (const [group] of groups) map[group] = !allCollapsed;
              return map;
            }),
            children: allCollapsed ? t("aggregate.manage.models.expandAll") : t("aggregate.manage.models.collapseAll")
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] text-muted-foreground", children: t("aggregate.manage.models.costSummary", {
        free: costCounts.free,
        included: costCounts.included,
        priced: costCounts.priced,
        unknown: costCounts.unknown
      }) }),
      filtered.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "py-6 text-center text-sm text-muted-foreground", children: t("aggregate.manage.models.empty") }),
      groups.map(([group, groupRows]) => {
        const expanded = !collapsed[group];
        const groupServed = groupRows.filter((row) => row.model.served).length;
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-lg border", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 border-b bg-muted/30 px-2 py-1.5", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "flex min-w-0 flex-1 items-center gap-1.5 text-left",
                onClick: () => setCollapsed((prev) => ({ ...prev, [group]: !prev[group] })),
                children: [
                  expanded ? /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronDown, { className: "h-3.5 w-3.5" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronRight, { className: "h-3.5 w-3.5" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate text-sm font-medium", children: group }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[11px] text-muted-foreground", children: [
                    groupServed,
                    "/",
                    groupRows.length
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                className: "h-6 px-2 text-[11px]",
                title: t("aggregate.manage.models.groupToggle"),
                disabled: busyGroup === group,
                onClick: () => void handleGroupToggle(groupRows),
                children: busyGroup === group ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3 w-3 animate-spin" }) : t("common.enabled")
              }
            )
          ] }),
          expanded && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "divide-y", children: groupRows.map((row) => {
            const model = row.model;
            const result = testResults[model.id];
            const summary = paramSummary(model.params);
            const cost = costBadgeOf(row.cost, t);
            return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2 px-2 py-1.5 hover:bg-muted/20", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-1.5", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate font-mono text-xs", title: model.displayName, children: model.id }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Badge, { variant: "outline", className: "px-1 py-0 text-[10px]", children: model.source === "fetched" ? t("aggregate.manage.models.sourceFetched") : model.source === "custom" ? t("aggregate.manage.models.sourceCustom") : t("aggregate.manage.models.sourceBuiltin") }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    Badge,
                    {
                      variant: "outline",
                      className: `px-1 py-0 text-[10px] ${cost.className}`,
                      title: cost.title,
                      children: cost.label
                    }
                  )
                ] }),
                summary && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate font-mono text-[11px] text-muted-foreground", title: summary, children: summary })
              ] }),
              result && /* @__PURE__ */ jsxRuntimeExports.jsx(
                "span",
                {
                  className: result.success ? "text-[11px] text-emerald-600 dark:text-emerald-400" : "max-w-[12rem] truncate text-[11px] text-destructive",
                  title: result.detail ?? "",
                  children: result.success ? t("aggregate.manage.models.testOk", { latency: result.latencyMs ?? 0 }) : t("aggregate.manage.models.testFailed")
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "ghost",
                  size: "sm",
                  className: "h-7 px-2",
                  title: t("aggregate.manage.models.test"),
                  disabled: busyModel === model.id,
                  onClick: () => void handleTestModel(model),
                  children: busyModel === model.id ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-3.5 w-3.5 animate-spin" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Wifi, { className: "h-3.5 w-3.5" })
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "ghost",
                  size: "sm",
                  className: "h-7 px-2",
                  title: t("aggregate.dialog.paramsEdit"),
                  onClick: () => openParams(model),
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Settings2, { className: "h-3.5 w-3.5" })
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "ghost",
                  size: "sm",
                  className: "h-7 px-2",
                  title: `${t("aggregate.manage.models.annotate")} · ${t("aggregate.manage.models.annotateHint")}`,
                  onClick: () => setAnnotateModel(model),
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Tags, { className: "h-3.5 w-3.5" })
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Switch,
                {
                  checked: model.served,
                  disabled: busyModel === model.id,
                  onCheckedChange: (enabled) => void handleToggleModel(model, enabled)
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  variant: "ghost",
                  size: "sm",
                  className: "h-7 px-2 text-destructive",
                  title: t("aggregate.manage.models.delete"),
                  disabled: busyModel === model.id || models.length <= 1,
                  onClick: () => void handleDeleteModel(model),
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Trash2, { className: "h-3.5 w-3.5" })
                }
              )
            ] }, model.displayName);
          }) })
        ] }, group);
      })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: addOpen, onOpenChange: setAddOpen, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-md", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("aggregate.manage.modelAdd.title") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("aggregate.manage.modelAdd.hint", { prefix: entry.id }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1.5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { htmlFor: "add-model-id", children: t("aggregate.manage.modelAdd.id") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          Input,
          {
            id: "add-model-id",
            className: "font-mono text-xs",
            value: newModelId,
            placeholder: t("aggregate.manage.modelAdd.placeholder"),
            onChange: (event) => setNewModelId(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleAddModel();
              }
            }
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => setAddOpen(false), children: t("common.cancel") }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { onClick: () => void handleAddModel(), disabled: adding || !newModelId.trim(), children: [
          adding && /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "mr-1.5 h-4 w-4 animate-spin" }),
          t("aggregate.manage.modelAdd.submit")
        ] })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Dialog, { open: paramModel !== null, onOpenChange: (open) => {
      if (!open) closeParams();
    }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogContent, { className: "max-w-lg", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogHeader, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogTitle, { children: t("aggregate.manage.modelParams.title", { model: paramModel ?? "" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(DialogDescription, { children: t("aggregate.manage.modelParams.hint") })
      ] }),
      paramDraft && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid grid-cols-3 gap-2", children: NUMERIC_PARAM_FIELDS.map((field) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "font-mono text-[11px]", children: field.label }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Input,
            {
              className: "h-8 font-mono text-xs",
              value: paramDraft[field.key],
              onChange: (event) => setParamDraft({ ...paramDraft, [field.key]: event.target.value })
            }
          )
        ] }, field.key)) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Label, { className: "text-[11px]", children: t("aggregate.dialog.paramsExtra") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Textarea,
            {
              rows: 3,
              className: "font-mono text-xs",
              placeholder: '{"seed": 42, "top_k": 50}',
              value: paramDraft.extraJson,
              onChange: (event) => setParamDraft({ ...paramDraft, extraJson: event.target.value })
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(DialogFooter, { className: "justify-between", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "ghost", className: "text-destructive", onClick: () => void clearParams(), children: t("aggregate.dialog.paramsClear") }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: closeParams, children: t("common.cancel") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: () => void applyParams(), children: t("aggregate.dialog.paramsApply") })
        ] })
      ] })
    ] }) }),
    annotateModel && /* @__PURE__ */ jsxRuntimeExports.jsx(
      ModelAnnotationDialog,
      {
        providerId: entry.id,
        displayName: annotateModel.displayName,
        modelLabel: annotateModel.id,
        onClose: () => setAnnotateModel(null),
        onChanged: () => void onRefresh()
      }
    )
  ] });
}
const EMPTY_STATE = (entry) => ({
  configured: false,
  enabled: false,
  hasApiKey: false,
  apiKeyCount: 0,
  baseUrl: entry.baseUrl,
  modelCount: entry.models.length
});
function Aggregate() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [entries, setEntries] = reactExports.useState([]);
  const [states, setStates] = reactExports.useState({});
  const [quotaUsage, setQuotaUsage] = reactExports.useState({});
  const [loading, setLoading] = reactExports.useState(true);
  const [search, setSearch] = reactExports.useState("");
  const [category, setCategory] = reactExports.useState("all");
  const [selectedId, setSelectedId] = reactExports.useState(null);
  const [detail, setDetail] = reactExports.useState(null);
  const [detailLoading, setDetailLoading] = reactExports.useState(false);
  const [busyId, setBusyId] = reactExports.useState(null);
  const selectedRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const refresh = reactExports.useCallback(async () => {
    const result = await window.electronAPI.aggregate.list();
    setEntries(result.entries);
    setStates(result.states);
    setQuotaUsage(result.quotaUsage ?? {});
    setLoading(false);
    const id = selectedRef.current;
    if (id && result.entries.some((entry) => entry.id === id)) {
      const fresh = await window.electronAPI.aggregate.detail(id);
      setDetail(fresh);
    }
  }, []);
  reactExports.useEffect(() => {
    void refresh();
  }, [refresh]);
  reactExports.useEffect(() => {
    if (loading) return;
    if (selectedId && entries.some((entry) => entry.id === selectedId)) return;
    const initial = entries.find((entry) => states[entry.id]?.configured) ?? entries[0];
    setSelectedId(initial?.id ?? null);
  }, [loading, entries, states, selectedId]);
  reactExports.useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void window.electronAPI.aggregate.detail(selectedId).then((result) => {
      if (!cancelled) setDetail(result);
    }).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);
  const reasonText = reactExports.useCallback(
    (reason) => {
      if (!reason) return t("aggregate.reasons.unknown");
      const key = `aggregate.reasons.${reason}`;
      const translated = t(key);
      return translated === key ? reason : translated;
    },
    [t]
  );
  const filtered = reactExports.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!needle) return true;
      if (entry.id.toLowerCase().includes(needle)) return true;
      if (entry.name.toLowerCase().includes(needle)) return true;
      return entry.models.some((model) => model.id.toLowerCase().includes(needle));
    });
  }, [entries, search, category]);
  const groups = reactExports.useMemo(() => {
    const enabled = [];
    const disabled = [];
    const available = [];
    for (const entry of filtered) {
      const state = states[entry.id];
      if (!state?.configured) available.push(entry);
      else if (state.enabled) enabled.push(entry);
      else disabled.push(entry);
    }
    return [
      { key: "enabled", label: t("aggregate.manage.sectionEnabled"), entries: enabled },
      { key: "disabled", label: t("aggregate.manage.sectionDisabled"), entries: disabled },
      { key: "available", label: t("aggregate.manage.sectionAvailable"), entries: available }
    ].filter((group) => group.entries.length > 0);
  }, [filtered, states, t]);
  const handleToggle = async (entry, enabled) => {
    setBusyId(entry.id);
    const result = await window.electronAPI.aggregate.setEnabled(entry.id, enabled);
    setBusyId(null);
    if (!result.success) {
      toast({ title: t("common.error"), description: reasonText(result.reason), variant: "destructive" });
      return;
    }
    await refresh();
  };
  const handleRemove = async (entry) => {
    if (!window.confirm(t("aggregate.deleteConfirm", { name: entry.name }))) return;
    await window.electronAPI.aggregate.remove(entry.id);
    toast({ title: t("aggregate.result.removed", { name: entry.name }) });
    const next = entries.find((other) => other.id !== entry.id && states[other.id]?.configured) ?? entries.find((other) => other.id !== entry.id);
    setSelectedId(next?.id ?? null);
    await refresh();
  };
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const selectedState = selected ? states[selected.id] ?? EMPTY_STATE(selected) : null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      PageHeader,
      {
        title: t("aggregate.title"),
        description: t("aggregate.description"),
        actions: /* @__PURE__ */ jsxRuntimeExports.jsxs(Button, { variant: "outline", onClick: () => void refresh(), disabled: loading, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: `mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}` }),
          t("common.refresh")
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "space-y-3 lg:sticky lg:top-0", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-2 p-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Search, { className: "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Input,
              {
                value: search,
                onChange: (event) => setSearch(event.target.value),
                placeholder: t("aggregate.manage.search"),
                className: "pl-9"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(Select, { value: category, onValueChange: (value) => setCategory(value), children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(SelectTrigger, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(SelectValue, {}) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(SelectContent, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "all", children: t("aggregate.allCategories") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "apikey", children: t("aggregate.category.apikey") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "free-tier", children: t("aggregate.category.freeTier") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(SelectItem, { value: "local", children: t("aggregate.category.local") })
            ] })
          ] })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "max-h-[calc(100vh-16rem)] overflow-y-auto p-2", children: [
          loading && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
            t("common.loading")
          ] }),
          !loading && groups.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "py-8 text-center text-sm text-muted-foreground", children: t("aggregate.manage.noMatch") }),
          !loading && groups.map((group) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-2 last:mb-0", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", children: [
              group.label,
              " · ",
              group.entries.length
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-0.5", children: group.entries.map((entry) => {
              const state = states[entry.id] ?? EMPTY_STATE(entry);
              const active = entry.id === selectedId;
              return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "div",
                {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => setSelectedId(entry.id),
                  onKeyDown: (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(entry.id);
                    }
                  },
                  className: `flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${active ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"}`,
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase", children: entry.name.slice(0, 1) }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 flex-1", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate text-sm font-medium", children: entry.name }),
                        state.configured && /* @__PURE__ */ jsxRuntimeExports.jsx(
                          "span",
                          {
                            className: `h-1.5 w-1.5 shrink-0 rounded-full ${state.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`
                          }
                        )
                      ] }),
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "truncate text-[11px] text-muted-foreground", children: [
                        state.configured ? t("aggregate.manage.modelCount", { count: state.modelCount }) : t("aggregate.notConfigured"),
                        entry.authKind === "apiKey" && state.apiKeyCount > 0 ? ` · ${t("aggregate.manage.keyCount", { count: state.apiKeyCount })}` : ""
                      ] })
                    ] }),
                    state.configured && /* @__PURE__ */ jsxRuntimeExports.jsx(
                      Switch,
                      {
                        checked: state.enabled,
                        disabled: busyId === entry.id,
                        onClick: (event) => event.stopPropagation(),
                        onCheckedChange: (enabled) => void handleToggle(entry, enabled)
                      }
                    )
                  ]
                },
                entry.id
              );
            }) })
          ] }, group.key))
        ] }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("main", { className: "min-w-0", children: selected && selectedState ? /* @__PURE__ */ jsxRuntimeExports.jsx(
        AggregateDetailPanel,
        {
          entry: selected,
          state: selectedState,
          quotaUsage: quotaUsage[selected.id],
          detail,
          loading: detailLoading,
          reasonText,
          onRefresh: refresh,
          onApplyDetail: setDetail,
          onRemove: () => handleRemove(selected)
        }
      ) : /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "py-16 text-center text-sm text-muted-foreground", children: t("aggregate.manage.noMatch") }) }) })
    ] })
  ] });
}
export {
  Aggregate
};
