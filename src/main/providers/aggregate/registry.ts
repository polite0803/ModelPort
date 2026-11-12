import type { AggregateEntry } from '../../../shared/aggregate'

/**
 * Aggregated provider catalogue, transcribed from the reference registry
 * (76 entries / 502 models, v2.7.2). Three entries are deliberately absent:
 * `openai` and `github_copilot` (browser-login account channels, the class
 * that was retired) and `fleetrelay_t1` (responses-only relay). `openai_api`
 * stays and is served over the chat wire.
 *
 * `kilo` is declared with authKind 'none': its free pool answers anonymously.
 * `vertex` / `vertex-partner` need Google ADC, which this app cannot produce,
 * so they are listed as 'unsupported' rather than pretending a key works.
 *
 * Seven model rows were dropped on 2026-10-29 because upstream no longer serves
 * them (each checked against the vendor's own documentation, not a reseller
 * listing): `anthropic`'s `claude-sonnet-4-20250514` and `claude-opus-4-20250514`
 * ("All requests to these models on the Claude API will now return an error"),
 * its `claude-3-5-sonnet-20241022` (retired 2025-10-28), and `xai`'s
 * `grok-4-fast-reasoning` / `grok-code-fast-1` / `grok-3` (retired 2026-05-15 -
 * their slugs still resolve and silently redirect to `grok-4.3`) plus the bare
 * `grok-4`, which is no longer in the live model list. Do not re-add them when
 * re-transcribing the source registry.
 *
 * One whole entry was withdrawn on 2026-10-29: `mistral_codestral`
 * (`https://codestral.mistral.ai/v1`). Mistral's own 3.2 MB full-text docs never
 * mention that host, and its only model (`codestral-latest`) is already covered
 * by the `mistral` entry. Do not re-add it either.
 *
 * `agnes` points at the China host (`https://api.agnes-ai.cn/v1`) rather than
 * the international `apihub.agnes-ai.com` one: the CN wiki is the vendor's own
 * documentation and declares that base URL, `agnes-2.0-flash` is marked 已废弃
 * there, and the served models are `agnes-3.0-flash` / `agnes-2.5-flash`
 * (`agnes-3.0-pro` is still 即将上线, so it is not listed).
 *
 * Five entries were ported from the freellmpool catalogue (0xzr/freellmpool,
 * MIT) on 2026-10-30 after deduping against this registry — the other 18 of
 * its 23 provider groups were already covered here. Pollinations and OVHcloud
 * answer keyless (authKind 'none', autoProvision: true): startup creates their
 * records enabled and merges the upstream model list. Requesty, Aion Labs and
 * ModelScope need a user key and stay unprovisioned until saved. Their static
 * baselines carry only the rows freellmpool marks enabled+auto; the disabled
 * and pin-only rows stay out (noted per entry) and discovery can still merge
 * them later. Base URLs and keyless model lists were verified live that day.
 *
 * Ten domestic entries were added on 2026-11-03: Baichuan, Alibaba Cloud Bailian
 * (pay-as-you-go and Token Plan), SiliconFlow China, iFlytek Spark, StepFun
 * (pay-as-you-go and Step Plan), Volcengine Ark (platform and Agent Plan) and
 * Yi. A vendor's pay-as-you-go endpoint and its subscription endpoint are always
 * separate entries: the vendors isolate the API key and base URL per billing
 * channel, and mixing them either returns 401/403 or silently bills the payg
 * account.
 *
 * Nine domestic subscription-plan entries were added on 2026-11-12, each with the
 * base URL read verbatim from the vendor's own page (the receipt is
 * `docs/data/free-quota-research/g12-cn-plans-2026-11-12.json`): Alibaba Bailian
 * Coding Plan, Tencent Coding Plan and Token Plan, Baidu Qianfan Coding Plan and
 * Token Plan, iFlytek Astron Coding Plan and Token Plan, JD Cloud JoyBuilder
 * Coding Plan and Token Plan. Same rule as above: a plan is its own entry, never
 * a demo of the pay-as-you-go host. Three of them ship an empty or near-empty
 * model baseline on purpose - Tencent Token Plan publishes its ids only in the
 * console, and iFlytek/Tencent ship a single "latest" auto-routing id - because
 * inventing slugs would turn "unknown" into a wrong answer.
 *
 * Three endpoints were added on 2026-11-10 after probing them without a key:
 * PPIO (`/openai/chat/completions` answered 403 INVALID_API_KEY and
 * `/openai/models` answered 200 with 67 chat rows, base URL taken verbatim from
 * the vendor's own integration guide), Huawei ModelArts Studio (`/v1/chat/completions`
 * answered 400 ModelArts.81002 "Failed to get the authorization header") and
 * Infini-AI (`/maas/v1/chat/completions` answered 401 "Not login"). The last two
 * ship an **empty baseline on purpose**: their catalogue needs a key, so the ids
 * arrive through `modelsUrl` once the user saves one; inventing slugs would only
 * ship rows that 404. Their free allowance is a signup promotion, not a permanent
 * free pool, so all three stay `category: 'apikey'`.
 *
 * GitHub Models was considered and left out: `models.github.ai` answers a
 * text/plain "OK" placeholder to every path from this host (root, `/catalog/models`
 * and even an unauthenticated chat POST), so its catalogue could not be
 * transcribed, and its terms restrict the free tier to prototyping anyway.
 *
 * Nous Research Portal was added on 2026-11-12 as a **key-only** entry with an
 * empty baseline. Its anonymous free tier is not reachable from this app: both
 * `POST portal.nousresearch.com/api/anonymous/{create,token}` answered 403
 * (the mint endpoints require the upstream deployment secret
 * `x-anonymous-api-secret`, which only the first-party Hermes binaries carry),
 * and the welcome-trial host serves a single model (`nous/welcome`) whose
 * entitlement is claimed by the desktop's own local backend, not by a gateway.
 * `inference-api.nousresearch.com/v1/models` does answer 200, but it is a proxy
 * over OpenRouter: a chat POST naming one of its ids returns 400 "Unknown
 * model", so that list cannot be used as a callable baseline. Slugs therefore
 * arrive through `modelsUrl` only once a real key is saved.
 *
 * The array now carries 93 entries / 580 models.
 */
export const AGGREGATE_REGISTRY: AggregateEntry[] = [
  {
    "id": "agnes",
    "name": "Agnes CN",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.agnes-ai.cn/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "agnes-3.0-flash",
        "name": "Agnes 3.0 Flash"
      },
      {
        "id": "agnes-2.5-flash",
        "name": "Agnes 2.5 Flash"
      }
    ],
    "authUrl": "https://platform.agnes-ai.cn/",
    "envVar": "AGNES_API_KEY",
    "notes": "Reasoning arrives as think tags on this route (FCC profile).",
    "website": "https://agnes-ai.cn/"
  },
  {
    "id": "alibaba_cloud",
    "name": "Alibaba Cloud",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen3-coder-plus",
        "name": "Qwen3 Coder Plus"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      }
    ],
    "authUrl": "https://www.alibabacloud.com/help/en/model-studio/get-api-key",
    "envVar": "ALIBABA_CLOUD_API_KEY",
    "baseUrlOverrideEnv": "ALIBABA_CLOUD_BASE_URL",
    "notes": "DashScope international compatible-mode endpoint (9router alims-intl, same base URL as FCC).",
    "website": "https://www.alibabacloud.com/en/product/modelstudio"
  },
  {
    "id": "anthropic",
    "name": "Anthropic",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.anthropic.com/v1",
    "wire": "anthropic-messages",
    "models": [],
    "authUrl": "https://platform.claude.com/settings/keys",
    "envVar": "ANTHROPIC_API_KEY",
    "notes": "Native Anthropic Messages passthrough (FCC marks it native_messages_passthrough). Its three transcribed models were retired upstream (the API answers them with an error), so the list is empty by design - add the current ids by hand or via discovery.",
    "promptCache": {
      "mode": "explicit-breakpoints",
      "maxBreakpoints": 4,
      "readDiscount": 0.1,
      "writeMultiplier": 0.25,
      "minCacheableTokens": 1024,
      "acceptsPromptCacheKey": false,
      "ttlMinutes": 5,
      "evidence": {
        "docUrl": "https://platform.claude.com/llms-full.txt",
        "asOf": "2026-10-30"
      }
    },
    "website": "https://www.anthropic.com/"
  },
  {
    "id": "azure_openai",
    "name": "Azure OpenAI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": null,
    "wire": "openai-chat",
    "models": [],
    "authUrl": "https://ai.azure.com/",
    "envVar": "AZURE_OPENAI_API_KEY",
    "baseUrlOverrideEnv": "AZURE_OPENAI_BASE_URL",
    "notes": "No default endpoint: AZURE_OPENAI_BASE_URL and the deployment name are required (FCC required_settings_attrs).",
    "website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service/"
  },
  {
    "id": "baidu",
    "name": "Baidu Qianfan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://qianfan.baidubce.com/v2",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "qwen3.5-397b-a17b",
        "name": "Qwen 3.5 397B A17B"
      },
      {
        "id": "qwen3.5-27b",
        "name": "Qwen 3.5 27B"
      }
    ],
    "authUrl": "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    "envVar": "BAIDU_API_KEY",
    "modelsUrl": "https://qianfan.baidubce.com/v2/models",
    "notes": "Baidu Qianfan v2 OpenAI-compatible endpoint.",
    "website": "https://qianfan.baidubce.com"
  },
  {
    "id": "bedrock",
    "name": "Amazon Bedrock",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://bedrock-mantle.us-east-1.api.aws/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "openai.gpt-oss-120b",
        "name": "GPT-OSS 120B (Bedrock)"
      }
    ],
    "authUrl": "https://console.aws.amazon.com/bedrock/",
    "envVar": "AWS_BEARER_TOKEN_BEDROCK",
    "baseUrlOverrideEnv": "BEDROCK_BASE_URL",
    "notes": "Bedrock Mantle OpenAI-compatible endpoint; the base URL stays configurable because keys and model availability are region-scoped (FCC).",
    "website": "https://aws.amazon.com/bedrock/"
  },
  {
    "id": "cerebras",
    "name": "Cerebras",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.cerebras.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gpt-oss-120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "zai-glm-4.7",
        "name": "ZAI GLM 4.7"
      },
      {
        "id": "llama-3.3-70b",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "llama-4-scout-17b-16e-instruct",
        "name": "Llama 4 Scout"
      },
      {
        "id": "qwen-3-235b-a22b-instruct-2507",
        "name": "Qwen3 235B A22B"
      },
      {
        "id": "qwen-3-32b",
        "name": "Qwen3 32B"
      }
    ],
    "authUrl": "https://cloud.cerebras.ai",
    "envVar": "CEREBRAS_API_KEY",
    "modelsUrl": "https://api.cerebras.ai/v1/models",
    "notes": "max_tokens is sent as max_completion_tokens (FCC profile).",
    "website": "https://www.cerebras.ai/"
  },
  {
    "id": "cheaperinference",
    "name": "Cheaper Inference",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.cheaperinference.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      }
    ],
    "authUrl": "https://cheaperinference.com/signup",
    "envVar": "CHEAPER_INFERENCE_API_KEY",
    "notes": "Listing is filtered to streaming text models (FCC profile).",
    "website": "https://cheaperinference.com/"
  },
  {
    "id": "chutes",
    "name": "Chutes",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://llm.chutes.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "Qwen/Qwen3-32B-TEE",
        "name": "Qwen3 32B TEE"
      }
    ],
    "authUrl": "https://chutes.ai/docs/getting-started/authentication",
    "envVar": "CHUTES_API_KEY",
    "modelsUrl": "https://llm.chutes.ai/v1/models",
    "notes": "FCC lists only text-in/text-out models that advertise tool support.",
    "website": "https://chutes.ai/"
  },
  {
    "id": "cline_pass",
    "name": "ClinePass",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.cline.bot/api/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "cline-pass/glm-5.2",
        "name": "GLM-5.2 (ClinePass)"
      },
      {
        "id": "cline-pass/kimi-k2.7-code",
        "name": "Kimi K2.7 Code (ClinePass)"
      },
      {
        "id": "cline-pass/kimi-k2.6",
        "name": "Kimi K2.6 (ClinePass)"
      },
      {
        "id": "cline-pass/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro (ClinePass)"
      },
      {
        "id": "cline-pass/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash (ClinePass)"
      },
      {
        "id": "cline-pass/mimo-v2.5",
        "name": "MiMo-V2.5 (ClinePass)"
      },
      {
        "id": "cline-pass/mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro (ClinePass)"
      },
      {
        "id": "cline-pass/minimax-m3",
        "name": "MiniMax M3 (ClinePass)"
      },
      {
        "id": "cline-pass/qwen3.7-max",
        "name": "Qwen3.7 Max (ClinePass)"
      },
      {
        "id": "cline-pass/qwen3.7-plus",
        "name": "Qwen3.7 Plus (ClinePass)"
      },
      {
        "id": "cline-pass/kimi-k3",
        "name": "Kimi K3 (ClinePass)"
      }
    ],
    "authUrl": "https://app.cline.bot",
    "envVar": "CLINE_API_KEY",
    "modelsUrl": "https://api.cline.bot/api/v1/ai/cline/recommended-models",
    "notes": "ClinePass subscription key; FCC lists it from /ai/cline/recommended-models.",
    "website": "https://cline.bot/"
  },
  {
    "id": "cohere",
    "name": "Cohere",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.cohere.ai/compatibility/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "command-r-plus-08-2024",
        "name": "Command R+ (Aug 2024)"
      },
      {
        "id": "command-r-08-2024",
        "name": "Command R (Aug 2024)"
      },
      {
        "id": "command-a-03-2025",
        "name": "Command A (Mar 2025)"
      },
      {
        "id": "command-a-plus-05-2026",
        "name": "Command A Plus"
      }
    ],
    "authUrl": "https://dashboard.cohere.com/api-keys",
    "envVar": "COHERE_API_KEY",
    "modelsUrl": "https://api.cohere.ai/v1/models",
    "notes": "Compatibility layer at /compatibility/v1; several body keys are stripped (FCC profile).",
    "website": "https://cohere.com/"
  },
  {
    "id": "deepinfra",
    "name": "DeepInfra",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.deepinfra.com/v1/openai",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash"
      }
    ],
    "authUrl": "https://deepinfra.com/dash/api_keys",
    "envVar": "DEEPINFRA_API_KEY",
    "modelsUrl": "https://api.deepinfra.com/models/list",
    "notes": "FCC reads DeepInfra’s own /models/list shape (model_name / reported_type).",
    "website": "https://deepinfra.com/"
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.deepseek.com",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-pro-max",
        "name": "DeepSeek V4 Pro Max"
      },
      {
        "id": "deepseek-v4-pro-none",
        "name": "DeepSeek V4 Pro No Thinking"
      },
      {
        "id": "deepseek-v4.1-flash",
        "name": "DeepSeek V4.1 Flash"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4-flash-vision-exp",
        "name": "DeepSeek V4 Flash Vision (Exp)"
      },
      {
        "id": "deepseek-chat",
        "name": "DeepSeek V3.2 Chat"
      },
      {
        "id": "deepseek-reasoner",
        "name": "DeepSeek V3.2 Reasoner"
      }
    ],
    "authUrl": "https://platform.deepseek.com/api_keys",
    "envVar": "DEEPSEEK_API_KEY",
    "modelsUrl": "https://api.deepseek.com/models",
    "notes": "Cache usage is reported on this endpoint (FCC).",
    "promptCache": {
      "mode": "implicit-prefix",
      "readDiscount": 0.02,
      "acceptsPromptCacheKey": false,
      "evidence": {
        "docUrl": "https://api-docs.deepseek.com/guides/kv_cache",
        "asOf": "2026-11-08"
      }
    },
    "website": "https://www.deepseek.com/"
  },
  {
    "id": "experiential",
    "name": "Experiential Labs",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.experientiallabs.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "union-alpha",
        "name": "Union Alpha"
      }
    ],
    "authUrl": "https://platform.experientiallabs.ai/settings/api-keys",
    "envVar": "EXPLABS_API_KEY",
    "notes": "Experiential Labs gateway.",
    "website": "https://www.experientiallabs.ai/"
  },
  {
    "id": "featherless",
    "name": "Featherless AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.featherless.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "zai-org/GLM-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "moonshotai/Kimi-K2.7-Code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "Qwen/Qwen3-32B",
        "name": "Qwen3 32B"
      }
    ],
    "authUrl": "https://featherless.ai/account/api-keys",
    "envVar": "FEATHERLESS_API_KEY",
    "modelsUrl": "https://api.featherless.ai/v1/models",
    "notes": "FCC asks for tool_use + available_on_current_plan rows; pagination is numbered.",
    "website": "https://featherless.ai/"
  },
  {
    "id": "fireworks",
    "name": "Fireworks",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "accounts/fireworks/models/deepseek-v3p1",
        "name": "DeepSeek V3.1"
      },
      {
        "id": "accounts/fireworks/models/llama-v3p3-70b-instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "accounts/fireworks/models/qwen3-235b-a22b",
        "name": "Qwen3 235B"
      }
    ],
    "authUrl": "https://fireworks.ai/account/api-keys",
    "envVar": "FIREWORKS_API_KEY",
    "modelsUrl": "https://api.fireworks.ai/inference/v1/models",
    "notes": "Embedding id omitted; model ids are account-scoped paths.",
    "website": "https://fireworks.ai/"
  },
  {
    "id": "glm",
    "name": "Z.ai (Anthropic wire)",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.z.ai/api/anthropic/v1",
    "wire": "anthropic-messages",
    "models": [
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM 5 Turbo"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "glm-4.6v",
        "name": "GLM 4.6V (Vision)"
      }
    ],
    "authUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "envVar": "ZAI_API_KEY",
    "notes": "Z.ai Anthropic-compatible route (Claude Code style); the same ZAI_API_KEY as the zai/zai_api records. Key URL as declared in the 9router glm registry.",
    "website": "https://z.ai"
  },
  {
    "id": "glm-cn",
    "name": "Zhipu GLM (CN)",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "wire": "openai-chat",
    "models": [
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM 5 Turbo"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "glm-4.7",
        "name": "GLM-4.7"
      },
      {
        "id": "glm-4.6v",
        "name": "GLM 4.6V (Vision)"
      },
      {
        "id": "glm-4.6",
        "name": "GLM-4.6"
      },
      {
        "id": "glm-4.5-air",
        "name": "GLM-4.5-Air"
      }
    ],
    "authUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "envVar": "ZHIPU_API_KEY",
    "notes": "Zhipu open-platform coding endpoint (mainland China), distinct from the z.ai international records.",
    "website": "https://open.bigmodel.cn"
  },
  {
    "id": "groq",
    "name": "Groq",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.groq.com/openai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "meta-llama/llama-4-maverick-17b-128e-instruct",
        "name": "Llama 4 Maverick"
      },
      {
        "id": "qwen/qwen3-32b",
        "name": "Qwen3 32B"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT-OSS 120B"
      }
    ],
    "authUrl": "https://console.groq.com/keys",
    "envVar": "GROQ_API_KEY",
    "modelsUrl": "https://api.groq.com/openai/v1/models",
    "notes": "OpenAI-compatible endpoint; audio ids from the same registry listing are omitted (chat catalog).",
    "website": "https://groq.com/"
  },
  {
    "id": "huggingface",
    "name": "Hugging Face",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://router.huggingface.co/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct:fastest",
        "name": "Qwen3 Coder 480B A35B"
      }
    ],
    "authUrl": "https://huggingface.co/settings/tokens",
    "envVar": "HUGGINGFACE_API_KEY",
    "notes": "Inference Providers router; FCC resolves the context window from the live provider consensus.",
    "website": "https://huggingface.co/"
  },
  {
    "id": "hyperbolic",
    "name": "Hyperbolic AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.hyperbolic.xyz/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "Qwen/QwQ-32B",
        "name": "QwQ 32B"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3",
        "name": "DeepSeek V3"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "meta-llama/Llama-3.2-3B-Instruct",
        "name": "Llama 3.2 3B"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen 2.5 72B"
      },
      {
        "id": "Qwen/Qwen2.5-Coder-32B-Instruct",
        "name": "Qwen 2.5 Coder 32B"
      },
      {
        "id": "NousResearch/Hermes-3-Llama-3.1-70B",
        "name": "Hermes 3 70B"
      }
    ],
    "authUrl": "https://app.hyperbolic.xyz/settings",
    "envVar": "HYPERBOLIC_API_KEY",
    "modelsUrl": "https://api.hyperbolic.xyz/v1/models",
    "notes": "OpenAI-compatible chat completions; 9router registry declares the key URL.",
    "website": "https://hyperbolic.xyz"
  },
  {
    "id": "kimi",
    "name": "Kimi",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.moonshot.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      }
    ],
    "authUrl": "https://platform.moonshot.cn/console/api-keys",
    "envVar": "KIMI_API_KEY",
    "notes": "Moonshot platform key; caller extra_body is rejected on this route (FCC profile).",
    "website": "https://www.kimi.com/"
  },
  {
    "id": "kimi_code",
    "name": "Kimi Code",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.kimi.com/coding/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "k3",
        "name": "Kimi K3 (Code)"
      },
      {
        "id": "kimi-for-coding",
        "name": "Kimi for Coding"
      },
      {
        "id": "kimi-for-coding-highspeed",
        "name": "Kimi for Coding Highspeed"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.7-code-highspeed",
        "name": "Kimi K2.7 Code Highspeed"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "kimi-k2.5-thinking",
        "name": "Kimi K2.5 Thinking"
      },
      {
        "id": "kimi-latest",
        "name": "Kimi Latest"
      }
    ],
    "authUrl": "https://www.kimi.com/code/console",
    "envVar": "KIMI_CODE_API_KEY",
    "notes": "Kimi Code subscription; ids from the 9router kimi registry (same host, api.kimi.com/coding/v1).",
    "website": "https://www.kimi.com/code"
  },
  {
    "id": "lightning",
    "name": "Lightning AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://lightning.ai/api/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "lightning-ai/Qwen3.8-27B",
        "name": "Qwen3.8 27B"
      }
    ],
    "authUrl": "https://lightning.ai/lightning-ai/model-apis/models",
    "envVar": "LIGHTNING_API_KEY",
    "notes": "Lightning AI Model APIs gateway.",
    "website": "https://lightning.ai/"
  },
  {
    "id": "llm7",
    "name": "LLM7.io",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.llm7.io/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5 (LLM7)"
      },
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5 (LLM7)"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash (LLM7)"
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5 (LLM7)"
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3 (LLM7)"
      },
      {
        "id": "default",
        "name": "LLM7 Default"
      },
      {
        "id": "fast",
        "name": "LLM7 Fast"
      },
      {
        "id": "pro",
        "name": "LLM7 Pro"
      }
    ],
    "authUrl": "https://dash.llm7.io/",
    "envVar": "LLM7_API_KEY",
    "modelsUrl": "https://api.llm7.io/v1/models",
    "notes": "FCC also pins the default/fast/pro aliases; the listing is filtered to streaming tool models.",
    "website": "https://llm7.io/"
  },
  {
    "id": "minimax",
    "name": "MiniMax",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.minimax.io/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax M3"
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "MiniMax-M2.1",
        "name": "MiniMax M2.1"
      }
    ],
    "authUrl": "https://platform.minimax.io/user-center/basic-information/interface-key",
    "envVar": "MINIMAX_API_KEY",
    "notes": "Reasoning is split out of the text stream (FCC profile); speech/image ids omitted.",
    "website": "https://www.minimax.io/"
  },
  {
    "id": "minimax-cn",
    "name": "MiniMax (CN)",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.minimaxi.com/anthropic/v1",
    "wire": "anthropic-messages",
    "models": [
      {
        "id": "MiniMax-M3.1-Flash",
        "name": "MiniMax M3.1 Flash"
      },
      {
        "id": "MiniMax-M3",
        "name": "MiniMax M3"
      }
    ],
    "authUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "envVar": "MINIMAX_CN_API_KEY",
    "headers": {
      "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    },
    "notes": "MiniMax mainland endpoint speaking the Anthropic Messages wire; caching is automatic (no cache_control) and only the M3 family is live - M2.x answers 404 (2069) on this route. Speech ids omitted; the anthropic-beta header is declared by the 9router registry.",
    "promptCache": {
      "mode": "implicit-prefix",
      "readDiscount": 0.1,
      "acceptsPromptCacheKey": false,
      "evidence": {
        "docUrl": "https://platform.minimax.cn/docs/api-reference/text-prompt-caching",
        "asOf": "2026-11-08"
      }
    },
    "website": "https://www.minimaxi.com"
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.mistral.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "mistral-large-latest",
        "name": "Mistral Large 3"
      },
      {
        "id": "codestral-latest",
        "name": "Codestral"
      },
      {
        "id": "mistral-medium-latest",
        "name": "Mistral Medium 3"
      },
      {
        "id": "devstral-small-latest",
        "name": "Devstral Small"
      }
    ],
    "authUrl": "https://console.mistral.ai/",
    "envVar": "MISTRAL_API_KEY",
    "modelsUrl": "https://api.mistral.ai/v1/models",
    "notes": "La Plateforme keys; embedding id omitted.",
    "website": "https://mistral.ai/"
  },
  {
    "id": "morph",
    "name": "Morph LLM",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.morphllm.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "morph-v3-large",
        "name": "Morph v3 Large"
      },
      {
        "id": "morph-v3-fast",
        "name": "Morph v3 Fast"
      },
      {
        "id": "morph-qwen35-397b",
        "name": "Qwen 3.5 397B (Morph)"
      },
      {
        "id": "morph-minimax27-230b",
        "name": "MiniMax M2.7 (Morph)"
      },
      {
        "id": "morph-qwen36-27b",
        "name": "Qwen 3.6 27B (Morph)"
      },
      {
        "id": "morph-dsv4flash",
        "name": "DeepSeek V4 Flash (Morph)"
      }
    ],
    "authUrl": "https://morphllm.com",
    "envVar": "MORPH_API_KEY",
    "modelsUrl": "https://api.morphllm.com/v1/models",
    "notes": "Fast apply/edit models for coding agents.",
    "website": "https://morphllm.com"
  },
  {
    "id": "nararoute",
    "name": "NaraRoute",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://router.bynara.id/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "kimi-k3-free",
        "name": "Kimi K3 (free)"
      }
    ],
    "authUrl": "https://router.bynara.id/keys",
    "envVar": "NARAROUTE_API_KEY",
    "notes": "Multi-vendor gateway; reasoning is surfaced as a boolean in the listing (FCC profile).",
    "website": "https://router.bynara.id/",
    "freeModelsHint": [
      "kimi-k3-free"
    ]
  },
  {
    "id": "nebius",
    "name": "Nebius Token Factory",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.tokenfactory.nebius.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B Instruct"
      },
      {
        "id": "Qwen/Qwen3-30B-A3B",
        "name": "Qwen3 30B A3B"
      }
    ],
    "authUrl": "https://tokenfactory.nebius.com/project/api-keys",
    "envVar": "NEBIUS_API_KEY",
    "modelsUrl": "https://api.tokenfactory.nebius.com/v1/models?verbose=true",
    "notes": "Embedding id omitted; FCC requires architecture.modality=text->text in the listing.",
    "website": "https://tokenfactory.nebius.com/"
  },
  {
    "id": "novita",
    "name": "Novita AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.novita.ai/openai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek/deepseek-v4-flash-0731",
        "name": "DeepSeek V4 Flash 0731"
      }
    ],
    "authUrl": "https://novita.ai/settings/key-management",
    "envVar": "NOVITA_API_KEY",
    "notes": "FCC README example id.",
    "website": "https://novita.ai/"
  },
  {
    "id": "openai_api",
    "name": "OpenAI API",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.openai.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano"
      },
      {
        "id": "gpt-5.2",
        "name": "GPT-5.2"
      },
      {
        "id": "gpt-5.1",
        "name": "GPT-5.1"
      },
      {
        "id": "gpt-5",
        "name": "GPT-5"
      },
      {
        "id": "gpt-5-mini",
        "name": "GPT-5 Mini"
      },
      {
        "id": "gpt-5-nano",
        "name": "GPT-5 Nano"
      },
      {
        "id": "gpt-4o",
        "name": "GPT-4o"
      },
      {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini"
      },
      {
        "id": "gpt-4-turbo",
        "name": "GPT-4 Turbo"
      },
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1"
      },
      {
        "id": "gpt-4.1-mini",
        "name": "GPT-4.1 Mini"
      },
      {
        "id": "gpt-4.1-nano",
        "name": "GPT-4.1 Nano"
      },
      {
        "id": "o3",
        "name": "O3"
      },
      {
        "id": "o3-mini",
        "name": "O3 Mini"
      },
      {
        "id": "o3-pro",
        "name": "O3 Pro"
      },
      {
        "id": "o4-mini",
        "name": "O4 Mini"
      },
      {
        "id": "o1",
        "name": "O1"
      },
      {
        "id": "o1-mini",
        "name": "O1 Mini"
      },
      {
        "id": "gpt-5.6-sol",
        "name": "GPT-5.6 Sol"
      }
    ],
    "authUrl": "https://platform.openai.com/api-keys",
    "envVar": "OPENAI_API_KEY",
    "notes": "Platform API key; FCC drives this route over the Responses API. Non-chat ids (embeddings, speech, images) are omitted.",
    "website": "https://platform.openai.com/"
  },
  {
    "id": "opencode_go",
    "name": "OpenCode Go",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-flash",
        "name": "DeepSeek V4.1 Flash"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4-flash-vision-exp",
        "name": "DeepSeek V4 Flash Vision (Exp)"
      },
      {
        "id": "longcat-2.0",
        "name": "LongCat 2.0"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo V2.5"
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3.8-max",
        "name": "Qwen 3.8 Max"
      },
      {
        "id": "qwen3.8-flash",
        "name": "Qwen 3.8 Flash"
      },
      {
        "id": "qwen3.7-max",
        "name": "Qwen 3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen 3.7 Plus"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "hy4-preview",
        "name": "Hy4 Preview"
      },
      {
        "id": "hy3",
        "name": "Hy3"
      },
      {
        "id": "grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "gpt-5.6-luna",
        "name": "GPT 5.6 Luna"
      },
      {
        "id": "muse-spark-1.2-contributor",
        "name": "Muse Spark 1.2 Contributor"
      },
      {
        "id": "muse-spark-1.3-contributor",
        "name": "Muse Spark 1.3 Contributor"
      }
    ],
    "authUrl": "https://opencode.ai/auth",
    "envVar": "OPENCODE_API_KEY",
    "notes": "OpenCode Go subscription ($5/mo per the 9router notice).",
    "website": "https://opencode.ai/go"
  },
  {
    "id": "opper",
    "name": "Opper",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.opper.ai/v3/compat",
    "wire": "openai-chat",
    "models": [
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      }
    ],
    "authUrl": "https://platform.opper.ai/",
    "envVar": "OPPER_API_KEY",
    "notes": "Opper gateway (v3/compat base).",
    "website": "https://opper.ai/"
  },
  {
    "id": "orcarouter",
    "name": "OrcaRouter",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.orcarouter.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek/deepseek-v4-flash-free",
        "name": "DeepSeek V4 Flash (free)"
      }
    ],
    "authUrl": "https://www.orcarouter.ai/console",
    "envVar": "ORCAROUTER_API_KEY",
    "notes": "Multi-provider gateway with a free slug.",
    "website": "https://www.orcarouter.ai/",
    "freeModelsHint": [
      "deepseek/deepseek-v4-flash-free"
    ]
  },
  {
    "id": "perplexity",
    "name": "Perplexity",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.perplexity.ai",
    "wire": "openai-chat",
    "models": [
      {
        "id": "sonar-pro",
        "name": "Sonar Pro"
      },
      {
        "id": "sonar",
        "name": "Sonar"
      }
    ],
    "authUrl": "https://www.perplexity.ai/settings/api",
    "envVar": "PERPLEXITY_API_KEY",
    "modelsUrl": "https://api.perplexity.ai/models",
    "notes": "Search-augmented Sonar chat models.",
    "website": "https://www.perplexity.ai"
  },
  {
    "id": "poolside",
    "name": "Poolside AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://inference.poolside.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "poolside/laguna-s-2.1",
        "name": "Laguna S 2.1"
      },
      {
        "id": "poolside/laguna-xs-2.1",
        "name": "Laguna XS 2.1"
      }
    ],
    "authUrl": "https://platform.poolside.ai/",
    "envVar": "POOLSIDE_API_KEY",
    "modelsUrl": "https://inference.poolside.ai/v1/models",
    "notes": "Poolside platform key.",
    "website": "https://poolside.ai/"
  },
  {
    "id": "qiniu",
    "name": "Qiniu Conatus",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.qnaigc.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "qiniu/conatus-free",
        "name": "Conatus Free"
      }
    ],
    "authUrl": "https://developer.qiniu.com/aitokenapi/12884/how-to-get-api-key",
    "envVar": "QINIU_API_KEY",
    "modelsUrl": "https://api.qnaigc.com/v1/models",
    "notes": "Conatus 限时免费融合模型（2026-10-24~11-30）：实名认证用户每日 1 亿 Token，单笔充值>100 元升至 10 亿/日；仅消耗活动免费额度、不支持按量付费，活动结束后停止调用。兼容 OpenAI 与 Anthropic 协议。",
    "website": "https://www.qiniu.com/ai/free-models/conatus-2026"
  },
  {
    "id": "qwencloud",
    "name": "QwenCloud Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "qwen3.8-max-preview",
        "name": "Qwen3.8 Max Preview"
      },
      {
        "id": "qwen3.7-max",
        "name": "Qwen3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus"
      },
      {
        "id": "qwen3.6-flash",
        "name": "Qwen3.6 Flash"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      }
    ],
    "authUrl": "https://home.qwencloud.com/api-keys",
    "envVar": "QWENCLOUD_API_KEY",
    "notes": "QwenCloud Token Plan endpoint (9router alitp-intl, same base URL as FCC).",
    "website": "https://qwencloud.com/"
  },
  {
    "id": "qwencloud_coding",
    "name": "QwenCloud Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://coding-intl.dashscope.aliyuncs.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen3-coder-plus",
        "name": "Qwen3 Coder Plus"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      }
    ],
    "authUrl": "https://home.qwencloud.com/api-keys",
    "envVar": "QWENCLOUD_CODING_API_KEY",
    "notes": "QwenCloud Coding Plan endpoint (9router alicode-intl, same base URL as FCC).",
    "website": "https://qwencloud.com/"
  },
  {
    "id": "sambanova",
    "name": "SambaNova",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.sambanova.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "Meta-Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B Instruct"
      }
    ],
    "authUrl": "https://cloud.sambanova.ai/apis",
    "envVar": "SAMBANOVA_API_KEY",
    "modelsUrl": "https://api.sambanova.ai/v1/models",
    "notes": "FCC README example id; the 9router registry keeps this provider hidden.",
    "website": "https://sambanova.ai/"
  },
  {
    "id": "sensenova",
    "name": "SenseNova Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://token.sensenova.cn/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4.1-flash",
        "name": "DeepSeek V4.1 Flash"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "sensenova-6.8-flash-lite",
        "name": "SenseNova 6.8 Flash Lite"
      }
    ],
    "authUrl": "https://platform.sensenova.cn/console/keys",
    "envVar": "SENSENOVA_API_KEY",
    "modelsUrl": "https://token.sensenova.cn/v1/models",
    "dropParams": ["response_format", "enable_thinking", "tool_choice=auto", "tools[].function.strict"],
    "notes": "商汤日日新 Token Plan 公测积分池（12 万积分/5 小时、120 万/周，非 token 额度，故额度旁表按 undocumented 处理）。请求 schema 比 OpenAI 严：官方参数表之外的字段一律拒收（response_format / tools[].function.strict / tool_choice:auto / enable_thinking 已在 dropParams 里剥离），校验失败的 message 常被网关替换成 'Errors in message queue response'。",
    "website": "https://platform.sensenova.cn/"
  },
  {
    "id": "scaleway",
    "name": "Scaleway",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.scaleway.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      }
    ],
    "authUrl": "https://console.scaleway.com/iam/api-keys",
    "envVar": "SCW_SECRET_KEY",
    "notes": "Scaleway Generative APIs; SCW secret key.",
    "website": "https://www.scaleway.com/"
  },
  {
    "id": "siliconflow",
    "name": "SiliconFlow",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.siliconflow.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.2",
        "name": "DeepSeek V3.2"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.2-Exp",
        "name": "DeepSeek V3.2 Exp"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1",
        "name": "DeepSeek V3.1"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1-Terminus",
        "name": "DeepSeek V3.1 Terminus"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "Qwen/Qwen3.5-397B-A17B",
        "name": "Qwen 3.5 397B A17B"
      },
      {
        "id": "Qwen/Qwen3.5-122B-A10B",
        "name": "Qwen 3.5 122B A10B"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "zai-org/GLM-5",
        "name": "GLM 5"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "inclusionAI/Ling-flash-2.0",
        "name": "Ling Flash 2.0"
      },
      {
        "id": "Qwen/Qwen3-32B",
        "name": "Qwen3 32B"
      }
    ],
    "authUrl": "https://cloud.siliconflow.com/account/ak",
    "envVar": "SILICONFLOW_API_KEY",
    "modelsUrl": "https://api.siliconflow.com/v1/models",
    // 2026-11-03 撤下 quotaProbe：官方 /user/info 已于 2026-08-14 停止服务（返回 HTTP 410
    // "This endpoint is deprecated and is no longer available"），官方公告要求移除调用
    // （https://docs.siliconflow.cn/cn/release-notes/overview），替代端点"后续将适时提供"——
    // 截至 2026-11-03 尚未上线。保留声明等于假装能查，每次探测必然 410；撤下后
    // queryCredits 走 no_probe 路径，界面如实显示「没有声明额度端点」。
    // 官方提供替代端点时再重新声明，届时 reader 的字段名以真机报文为准。
    "notes": "Chat ids from the 9router registry; listing is filtered with sub_type=chat.",
    "website": "https://siliconflow.com/"
  },
  {
    "id": "tencent",
    "name": "Tencent Hunyuan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "hunyuan-turbos-latest",
        "name": "Hunyuan TurboS Latest"
      },
      {
        "id": "hunyuan-t1-latest",
        "name": "Hunyuan T1 Latest"
      }
    ],
    "authUrl": "https://console.cloud.tencent.com/hunyuan/api-key",
    "envVar": "HUNYUAN_API_KEY",
    "modelsUrl": "https://api.hunyuan.cloud.tencent.com/v1/models",
    "notes": "Tencent Hunyuan OpenAI-compatible endpoint.",
    "website": "https://cloud.tencent.com/product/hunyuan"
  },
  {
    "id": "together",
    "name": "Together AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.together.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "name": "Llama 3.3 70B Turbo"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B",
        "name": "Qwen3 235B"
      },
      {
        "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "name": "Llama 4 Maverick"
      },
      {
        "id": "zai-org/GLM-5.2",
        "name": "GLM-5.2"
      }
    ],
    "authUrl": "https://api.together.ai/settings/api-keys",
    "envVar": "TOGETHER_API_KEY",
    "modelsUrl": "https://api.together.ai/v1/models",
    "notes": "Embedding ids omitted; the FCC profile lists models at /models with context_length.",
    "website": "https://www.together.ai/"
  },
  {
    "id": "tokenrouter",
    "name": "TokenRouter",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.tokenrouter.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "anthropic/claude-haiku-4.5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "anthropic/claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "anthropic/claude-opus-4.8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "anthropic/claude-opus-4.8-fast",
        "name": "Claude Opus 4.8 Fast"
      },
      {
        "id": "openai/gpt-5.4",
        "name": "Gpt 5.4"
      },
      {
        "id": "openai/gpt-5.4-mini",
        "name": "Gpt 5.4 Mini"
      },
      {
        "id": "openai/gpt-5.4-pro",
        "name": "Gpt 5.4 Pro"
      },
      {
        "id": "openai/gpt-5.5",
        "name": "Gpt 5.5"
      },
      {
        "id": "openai/gpt-5.6-sol",
        "name": "Gpt 5.6 Sol"
      },
      {
        "id": "google/gemini-3.5-flash",
        "name": "Gemini 3.5 Flash"
      },
      {
        "id": "google/gemini-3.6-flash",
        "name": "Gemini 3.6 Flash"
      },
      {
        "id": "deepseek/deepseek-v4-flash",
        "name": "Deepseek V4 Flash"
      },
      {
        "id": "deepseek/deepseek-v4-pro",
        "name": "Deepseek V4 Pro"
      },
      {
        "id": "qwen/qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen/qwen3.7-max",
        "name": "Qwen3.7 Max"
      },
      {
        "id": "qwen/qwen3.8-max",
        "name": "Qwen3.8 Max"
      },
      {
        "id": "moonshotai/kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "moonshotai/kimi-k3-free",
        "name": "Kimi K3 Free"
      },
      {
        "id": "z-ai/glm-5.3-free",
        "name": "Glm 5.3 Free"
      },
      {
        "id": "z-ai/glm-5.2",
        "name": "Glm 5.2"
      },
      {
        "id": "z-ai/glm-5-turbo",
        "name": "Glm 5 Turbo"
      },
      {
        "id": "x-ai/grok-4.5",
        "name": "Grok 4.5"
      }
    ],
    "authUrl": "https://www.tokenrouter.com/",
    "envVar": "TOKENROUTER_API_KEY",
    "modelsUrl": "https://api.tokenrouter.com/v1/models",
    "notes": "Multi-vendor gateway with free slugs.",
    "website": "https://www.tokenrouter.com/",
    "freeModelsHint": [
      "moonshotai/kimi-k3-free",
      "z-ai/glm-5.3-free"
    ]
  },
  {
    "id": "venice",
    "name": "Venice AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.venice.ai/api/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "venice-uncensored-1-2",
        "name": "Venice Uncensored 1.2"
      },
      {
        "id": "zai-org-glm-5",
        "name": "GLM-5"
      },
      {
        "id": "qwen3-235b-a22b-instruct-2507",
        "name": "Qwen3 235B A22B Instruct"
      },
      {
        "id": "qwen3-coder-480b-a35b-instruct-turbo",
        "name": "Qwen3 Coder 480B A35B Turbo"
      },
      {
        "id": "qwen3-vl-235b-a22b",
        "name": "Qwen3 VL 235B A22B"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "llama-3.3-70b",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "hermes-3-llama-3.1-405b",
        "name": "Hermes 3 Llama 3.1 405B"
      },
      {
        "id": "mistral-small-3-2-24b-instruct",
        "name": "Mistral Small 3.2 24B"
      }
    ],
    "authUrl": "https://venice.ai/settings/api",
    "envVar": "VENICE_API_KEY",
    "modelsUrl": "https://api.venice.ai/api/v1/models",
    "notes": "Private inference plus uncensored models (9router notice). Embedding and image ids omitted.",
    "website": "https://venice.ai"
  },
  {
    "id": "vercel",
    "name": "Vercel AI Gateway",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://ai-gateway.vercel.sh/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "openai/gpt-5.5",
        "name": "GPT-5.5 (Vercel)"
      }
    ],
    "authUrl": "https://vercel.com/docs/ai-gateway",
    "envVar": "AI_GATEWAY_API_KEY",
    "notes": "Vercel AI Gateway; models are vendor-namespaced.",
    "website": "https://vercel.com/ai-gateway"
  },
  {
    "id": "vertex",
    "name": "Google Vertex AI",
    "category": "apikey",
    "authKind": "unsupported",
    "baseUrl": "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro Preview"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite Preview"
      },
      {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview"
      },
      {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash"
      },
      {
        "id": "google/gemini-3.5-flash",
        "name": "Gemini 3.5 Flash (Vertex)"
      }
    ],
    "authUrl": "https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment",
    "notes": "ADC (no key): VERTEX_PROJECT_ID and VERTEX_LOCATION compose the endpoint (FCC providers/vertex/endpoint.py).",
    "website": "https://cloud.google.com/vertex-ai"
  },
  {
    "id": "vertex-partner",
    "name": "Vertex Partner Models",
    "category": "apikey",
    "authKind": "unsupported",
    "baseUrl": "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek-ai/deepseek-v3.2-maas",
        "name": "DeepSeek V3.2 (Vertex)"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-thinking-maas",
        "name": "Qwen3 Next 80B Thinking (Vertex)"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-instruct-maas",
        "name": "Qwen3 Next 80B Instruct (Vertex)"
      },
      {
        "id": "zai-org/glm-5-maas",
        "name": "GLM-5 (Vertex)"
      }
    ],
    "authUrl": "https://console.cloud.google.com/iam-admin/serviceaccounts",
    "notes": "Vertex MaaS partner models (9router model list); the OpenAI-compatible base is composed per project/location (FCC providers/vertex/endpoint.py).",
    "website": "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models"
  },
  {
    "id": "volcengine-ark",
    "name": "Volcengine Ark (Coding Plan)",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "wire": "openai-chat",
    "models": [
      {
        "id": "Doubao-Seed-2.1-turbo",
        "name": "Doubao-Seed-2.1-turbo"
      },
      {
        "id": "Doubao-Seed-2.0-Code",
        "name": "Doubao-Seed-2.0-Code"
      },
      {
        "id": "Doubao-Seed-2.0-pro",
        "name": "Doubao-Seed-2.0-pro"
      },
      {
        "id": "Doubao-Seed-2.0-lite",
        "name": "Doubao-Seed-2.0-lite"
      },
      {
        "id": "Doubao-Seed-Code",
        "name": "Doubao-Seed-Code"
      },
      {
        "id": "DeepSeek-V4-Flash",
        "name": "DeepSeek-V4-Flash"
      },
      {
        "id": "DeepSeek-V4-Pro",
        "name": "DeepSeek-V4-Pro"
      },
      {
        "id": "GLM-5.2",
        "name": "GLM-5.2"
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax-M2.7"
      },
      {
        "id": "MiniMax-M3",
        "name": "MiniMax-M3"
      },
      {
        "id": "Kimi-K2.6",
        "name": "Kimi-K2.6"
      },
      {
        "id": "Kimi-K2.7-Code",
        "name": "Kimi-K2.7-Code"
      }
    ],
    "authUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "envVar": "ARK_API_KEY",
    "notes": "ByteDance Volcengine coding-plan endpoint (CN). The plan key is isolated from the platform key and only spends Coding Plan allowance on this base URL; GLM-5.1 was retired upstream on 2026-06-30 and is not listed.",
    "website": "https://console.volcengine.com/ark"
  },
  {
    "id": "wafer",
    "name": "Wafer",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://pass.wafer.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro (Wafer)"
      }
    ],
    "authUrl": "https://www.wafer.ai/pass",
    "envVar": "WAFER_API_KEY",
    "notes": "Wafer pass endpoint.",
    "website": "https://www.wafer.ai/"
  },
  {
    "id": "wandb",
    "name": "W&B Inference",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.inference.wandb.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "openai/gpt-oss-20b",
        "name": "GPT-OSS 20B"
      }
    ],
    "authUrl": "https://wandb.ai/settings",
    "envVar": "WANDB_API_KEY",
    "notes": "W&B Serverless Inference; reasoning arrives as think tags (FCC profile).",
    "website": "https://wandb.ai/site/inference/"
  },
  {
    "id": "xai",
    "name": "xAI (Grok)",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.x.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5"
      }
    ],
    "authUrl": "https://console.x.ai/team/default/api-keys",
    "envVar": "XAI_API_KEY",
    "modelsUrl": "https://api.x.ai/v1/models",
    "notes": "Image and video ids from the same registry listing are omitted (chat catalog). grok-4-fast-reasoning, grok-code-fast-1 and grok-3 were retired on 2026-05-15 and their slugs now redirect to grok-4.3; the bare grok-4 left the live list. None of the four are exposed.",
    "website": "https://x.ai/"
  },
  {
    "id": "xiaomi-tokenplan",
    "name": "Xiaomi MiMo Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro"
      },
      {
        "id": "mimo-v2.5-pro-claude",
        "name": "MiMo V2.5 Pro (Claude Native)"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo V2.5"
      },
      {
        "id": "mimo-v2-pro",
        "name": "MiMo V2 Pro"
      },
      {
        "id": "mimo-v2-omni",
        "name": "MiMo V2 Omni"
      }
    ],
    "authUrl": "https://mimo.xiaomi.com",
    "envVar": "XIAOMI_MIMO_API_KEY",
    "notes": "Token Plan subscription (keys start with tp-) and are cluster-specific; TTS ids omitted (9router notice).",
    "website": "https://mimo.xiaomi.com"
  },
  {
    "id": "xkiro",
    "name": "xKiro",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.xkiro.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "qwen/qwen3.7-flash:free",
        "name": "Qwen3.7 Flash (free)"
      }
    ],
    "authUrl": "https://xkiro.com/dashboard/api/keys",
    "envVar": "XKIRO_API_KEY",
    "notes": "Multi-provider gateway; thinking is a capabilities.reasoning boolean in the listing (FCC profile).",
    "website": "https://xkiro.com/",
    "freeModelsHint": [
      "qwen/qwen3.7-flash:free"
    ]
  },
  {
    "id": "zai",
    "name": "Z.ai Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "wire": "openai-chat",
    "models": [
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM 5 Turbo"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "glm-4.6v",
        "name": "GLM 4.6V (Vision)"
      }
    ],
    "authUrl": "https://z.ai/manage-apikey/apikey-list",
    "envVar": "ZAI_API_KEY",
    "notes": "Z.ai coding-plan endpoint; caller extra_body is rejected (FCC profile). Ids are shared across Z.ai routes per the 9router glm registry.",
    "website": "https://z.ai/"
  },
  {
    "id": "zai_api",
    "name": "Z.ai API",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "wire": "openai-chat",
    "models": [
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM 5 Turbo"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "glm-4.6v",
        "name": "GLM 4.6V (Vision)"
      },
      {
        "id": "glm-4.7-flash",
        "name": "GLM 4.7 Flash"
      }
    ],
    "authUrl": "https://z.ai/manage-apikey/apikey-list",
    "envVar": "ZAI_API_KEY",
    "notes": "Z.ai pay-as-you-go endpoint; ids are shared across Z.ai routes per the 9router glm registry.",
    "website": "https://z.ai/"
  },
  {
    "id": "zenmux",
    "name": "ZenMux",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://zenmux.ai/api/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "deepseek/deepseek-v4-flash-free",
        "name": "DeepSeek V4 Flash (free)"
      }
    ],
    "authUrl": "https://zenmux.ai/platform/pay-as-you-go",
    "envVar": "ZENMUX_API_KEY",
    "notes": "max_tokens is sent as max_completion_tokens (FCC profile).",
    "website": "https://zenmux.ai/",
    "freeModelsHint": [
      "deepseek/deepseek-v4-flash-free"
    ]
  },
  {
    "id": "bazaarlink",
    "name": "BazaarLink",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://bazaarlink.ai/api/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "auto:free",
        "name": "Auto Free (Zero Cost)"
      },
      {
        "id": "claude-opus-4.7",
        "name": "Claude Opus 4.7"
      },
      {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "claude-haiku-4.5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano"
      },
      {
        "id": "grok-4.3",
        "name": "Grok 4.3"
      },
      {
        "id": "grok-4.20",
        "name": "Grok 4.20"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro"
      },
      {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo-V2.5"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super"
      }
    ],
    "authUrl": "https://bazaarlink.ai",
    "envVar": "BAZAARLINK_API_KEY",
    "modelsUrl": "https://bazaarlink.ai/api/v1/models",
    "notes": "Multi-vendor gateway with an auto:free slug; 9router lists it as free-tier.",
    "website": "https://bazaarlink.ai",
    "freeModelsHint": [
      "auto:free"
    ]
  },
  {
    "id": "byteplus",
    "name": "BytePlus Ark",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    "wire": "openai-chat",
    "models": [
      {
        "id": "seed-2-0-pro-260328",
        "name": "Seed 2.0 Pro"
      },
      {
        "id": "seed-2-0-code-preview-260328",
        "name": "Seed 2.0 Code Preview"
      },
      {
        "id": "seed-2-0-mini-260215",
        "name": "Seed 2.0 Mini"
      },
      {
        "id": "seed-2-0-lite-260228",
        "name": "Seed 2.0 Lite"
      },
      {
        "id": "kimi-k2-thinking-251104",
        "name": "Kimi K2 Thinking"
      },
      {
        "id": "glm-4-7-251222",
        "name": "GLM 4.7"
      },
      {
        "id": "gpt-oss-120b-250805",
        "name": "GPT-OSS-120B"
      }
    ],
    "authUrl": "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
    "envVar": "BYTEPLUS_API_KEY",
    "notes": "Free credits for new accounts (9router notice); Seed 2.0, Kimi K2 Thinking, GLM 4.7 and GPT-OSS-120B.",
    "website": "https://console.byteplus.com/ark"
  },
  {
    "id": "cloudflare",
    "name": "Cloudflare",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    "pathVars": [
      {
        "name": "account_id",
        "label": "Account ID",
        "helpText": "Cloudflare Dashboard → Workers AI 页右侧的 Account ID；API Token 需要 Workers AI 权限。官方 OpenAI 兼容地址就是 .../accounts/<account_id>/ai/v1"
      }
    ],
    "wire": "openai-chat",
    "models": [
      {
        "id": "@cf/meta/llama-3.2-1b-instruct",
        "name": "Llama 3.2 1B Instruct"
      },
      {
        "id": "@cf/meta/llama-3.2-3b-instruct",
        "name": "Llama 3.2 3B Instruct"
      },
      {
        "id": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
        "name": "Llama 3.1 8B Instruct FP8 Fast"
      },
      {
        "id": "@cf/meta/llama-3.1-8b-instruct-awq",
        "name": "Llama 3.1 8B Instruct AWQ"
      },
      {
        "id": "@cf/mistralai/mistral-small-3.1-24b-instruct",
        "name": "Mistral Small 3.1 24B Instruct"
      },
      {
        "id": "@cf/meta/llama-3.1-70b-instruct-fp8-fast",
        "name": "Llama 3.1 70B Instruct FP8 Fast"
      },
      {
        "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "name": "Llama 3.3 70B Instruct FP8 Fast"
      },
      {
        "id": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
        "name": "DeepSeek R1 Distill Qwen 32B"
      },
      {
        "id": "@cf/moonshotai/kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "@cf/moonshotai/kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "@cf/zai-org/glm-4.7-flash",
        "name": "GLM 4.7 Flash"
      },
      {
        "id": "@cf/qwen/qwq-32b",
        "name": "QwQ 32B"
      },
      {
        "id": "@cf/qwen/qwen2.5-coder-32b-instruct",
        "name": "Qwen 2.5 Coder 32B Instruct"
      }
    ],
    "authUrl": "https://dash.cloudflare.com/profile/api-tokens",
    "envVar": "CLOUDFLARE_API_TOKEN",
    "notes": "Account-scoped URL — the {account_id} segment is filled per key (Account ID field), not by editing the base URL; that is why the URL is written with a placeholder. Workers AI has a free allocation and 9router lists it as free-tier. Image ids omitted.",
    "website": "https://www.cloudflare.com/developer-platform/products/workers-ai/"
  },
  {
    "id": "gemini",
    "name": "Gemini",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash"
      },
      {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash"
      },
      {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash"
      },
      {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro Preview"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite Preview"
      },
      {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview"
      },
      {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro"
      },
      {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash"
      },
      {
        "id": "gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash Lite"
      },
      {
        "id": "gemma-4-31b-it",
        "name": "Gemma 4 31B IT"
      }
    ],
    "authUrl": "https://aistudio.google.com/apikey",
    "envVar": "GEMINI_API_KEY",
    "notes": "Google AI Studio key; 9router lists it as free-tier. FCC speaks the OpenAI-compatible layer at /v1beta/openai/.",
    "website": "https://ai.google.dev/"
  },
  {
    "id": "kilo",
    "name": "Kilo.ai",
    "category": "free-tier",
    "authKind": "none",
    "baseUrl": "https://api.kilo.ai/api/gateway",
    "wire": "openai-chat",
    "models": [
      {
        "id": "kilo-auto/free",
        "name": "Kilo Auto Free"
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b:free",
        "name": "Nemotron 3 Super 120B (Free)"
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "name": "Nemotron 3 Ultra 550B (Free)"
      },
      {
        "id": "kwaipilot/kat-coder-pro-v2.5:free",
        "name": "Kat Coder Pro v2.5 (Free)"
      }
    ],
    "authUrl": "https://app.kilo.ai",
    "envVar": "KILO_API_KEY",
    "modelsUrl": "https://api.kilo.ai/api/gateway/models",
    "notes": "Kilo gateway free pool; the plugin’s own Kilo channel reads the same host.",
    "website": "https://kilo.ai/",
    "freeModelsHint": [
      "kilo-auto/free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "kwaipilot/kat-coder-pro-v2.5:free"
    ]
  },
  {
    "id": "kimchi",
    "name": "Kimchi",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://llm.kimchi.dev/openai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "minimax-m3",
        "name": "MiniMax-M3"
      },
      {
        "id": "kimi-k2.7",
        "name": "Kimi-K2.7"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi-K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi-K2.5"
      },
      {
        "id": "nemotron-3-ultra-fp4",
        "name": "Nemotron 3 Ultra FP4"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax-M2.7"
      },
      {
        "id": "claude-opus-4-6",
        "name": "Claude Opus 4.6"
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      }
    ],
    "authUrl": "https://app.kimchi.dev",
    "envVar": "KIMCHI_API_KEY",
    "headers": {
      "user-agent": "kimchi/0.1.50"
    },
    "notes": "9router lists it as free-tier with oauth and apikey modes; the signup URL issues the credential. The user-agent is declared by the 9router registry.",
    "website": "https://kimchi.dev"
  },
  {
    "id": "nvidia_nim",
    "name": "NVIDIA NIM",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "minimaxai/minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimaxai/minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "z-ai/glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "deepseek-ai/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-ai/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "moonshotai/kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "name": "Nemotron 3 Ultra"
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super 120B"
      }
    ],
    "authUrl": "https://build.nvidia.com/settings/api-keys",
    "envVar": "NVIDIA_NIM_API_KEY",
    "modelsUrl": "https://integrate.api.nvidia.com/v1/models",
    "notes": "Free access for NVIDIA Developer Program members (prototyping and testing) per the 9router registry; FCC ships it as the default provider.",
    "website": "https://build.nvidia.com/"
  },
  {
    "id": "ollama_cloud",
    "name": "Ollama Cloud",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://ollama.com/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "gpt-oss:120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "glm-4.7-flash",
        "name": "GLM 4.7 Flash"
      },
      {
        "id": "qwen3.5",
        "name": "Qwen3.5"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "deepseek-v4.1-flash:cloud",
        "name": "DeepSeek V4.1 Flash"
      },
      {
        "id": "qwen3-coder:480b",
        "name": "Qwen3 Coder 480B"
      }
    ],
    "authUrl": "https://ollama.com/settings/keys",
    "envVar": "OLLAMA_API_KEY",
    "modelsUrl": "https://ollama.com/api/tags",
    "notes": "Free tier: light usage, one cloud model at a time (9router notice). Tags are not OpenAI ids but Ollama model names.",
    "website": "https://ollama.com/"
  },
  {
    "id": "open_router",
    "name": "OpenRouter",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://openrouter.ai/api/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "openrouter/free",
        "name": "OpenRouter Free Router"
      }
    ],
    "authUrl": "https://openrouter.ai/keys",
    "envVar": "OPENROUTER_API_KEY",
    // 账号级额度端点：baseUrl 是 `https://openrouter.ai/api/v1`，官方路径 `/api/v1/key`，
    // 所以相对路径是 `/key`。`data.limit` 为 null 表示这把 Key 没有花费上限（不是 0，也不是"还有很多"）。
    // docUrl 记的是**这份端点声明的转录来源**（PLAN §1 第 3 行），本轮没有真机报文核对过字段拼写。
    "quotaProbe": {
      "path": "/key",
      "reader": "openrouter-key",
      "docUrl": "https://github.com/tashfeenahmed/freellmapi",
      "asOf": "2026-10-29"
    },
    "notes": "Free tier: 27+ free models, no credit card, ~200 requests/day (9router registry).",
    "website": "https://openrouter.ai/",
    "freeModelsHint": [
      "openrouter/free"
    ]
  },
  {
    "id": "opencode_zen",
    "name": "OpenCode Zen",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://opencode.ai/zen/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "claude-fable-5",
        "name": "Claude Fable 5"
      },
      {
        "id": "claude-fable-5-1",
        "name": "Claude Fable 5.1"
      },
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5"
      },
      {
        "id": "claude-opus-4-8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "claude-opus-4-7",
        "name": "Claude Opus 4.7"
      },
      {
        "id": "claude-opus-4-6",
        "name": "Claude Opus 4.6"
      },
      {
        "id": "claude-opus-4-5",
        "name": "Claude Opus 4.5"
      },
      {
        "id": "claude-sonnet-5",
        "name": "Claude Sonnet 5"
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "claude-sonnet-4-5",
        "name": "Claude Sonnet 4.5"
      },
      {
        "id": "claude-sonnet-4",
        "name": "Claude Sonnet 4"
      },
      {
        "id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash"
      },
      {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash"
      },
      {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash"
      },
      {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite"
      },
      {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash"
      },
      {
        "id": "gemini-3.1-pro",
        "name": "Gemini 3.1 Pro"
      },
      {
        "id": "gemini-3-flash",
        "name": "Gemini 3 Flash"
      },
      {
        "id": "gpt-6-astra",
        "name": "GPT 6 Astra"
      },
      {
        "id": "gpt-5.6-sol",
        "name": "GPT 5.6 Sol"
      },
      {
        "id": "gpt-5.6-terra",
        "name": "GPT 5.6 Terra"
      },
      {
        "id": "gpt-5.6-luna",
        "name": "GPT 5.6 Luna"
      },
      {
        "id": "gpt-5.5",
        "name": "GPT 5.5"
      },
      {
        "id": "gpt-5.5-pro",
        "name": "GPT 5.5 Pro"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT 5.4"
      },
      {
        "id": "gpt-5.4-pro",
        "name": "GPT 5.4 Pro"
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT 5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT 5.4 Nano"
      },
      {
        "id": "gpt-5.3-codex-spark",
        "name": "GPT 5.3 Codex Spark"
      },
      {
        "id": "gpt-5.3-codex",
        "name": "GPT 5.3 Codex"
      },
      {
        "id": "gpt-5.2",
        "name": "GPT 5.2"
      },
      {
        "id": "gpt-5.2-codex",
        "name": "GPT 5.2 Codex"
      },
      {
        "id": "gpt-5.1",
        "name": "GPT 5.1"
      },
      {
        "id": "gpt-5.1-codex-max",
        "name": "GPT 5.1 Codex Max"
      },
      {
        "id": "gpt-5.1-codex",
        "name": "GPT 5.1 Codex"
      },
      {
        "id": "gpt-5.1-codex-mini",
        "name": "GPT 5.1 Codex Mini"
      },
      {
        "id": "gpt-5",
        "name": "GPT 5"
      },
      {
        "id": "gpt-5-codex",
        "name": "GPT 5 Codex"
      },
      {
        "id": "gpt-5-nano",
        "name": "GPT 5 Nano"
      },
      {
        "id": "grok-build-0.1",
        "name": "Grok Build 0.1"
      },
      {
        "id": "grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5"
      },
      {
        "id": "muse-spark-1.3",
        "name": "Muse Spark 1.3"
      },
      {
        "id": "muse-spark-1.2",
        "name": "Muse Spark 1.2"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "qwen3.5-plus",
        "name": "Qwen 3.5 Plus"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4-flash-vision-exp",
        "name": "DeepSeek V4 Flash Vision Exp"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "big-pickle",
        "name": "Big Pickle"
      },
      {
        "id": "union-alpha",
        "name": "Union Alpha"
      },
      {
        "id": "deepseek-v4-flash-free",
        "name": "DeepSeek V4 Flash Free"
      },
      {
        "id": "mimo-v2.6-flash-free",
        "name": "MiMo V2.6 Flash Free"
      },
      {
        "id": "mimo-v2.5-free",
        "name": "MiMo V2.5 Free"
      },
      {
        "id": "ling-3.0-flash-fin-free",
        "name": "Ling 3.0 Flash Fin Free"
      },
      {
        "id": "nemotron-3-ultra-free",
        "name": "Nemotron 3 Ultra Free"
      },
      {
        "id": "nemotron-3.5-lightning-free",
        "name": "Nemotron 3.5 Lightning Free"
      },
      {
        "id": "muse-spark-1.3-contributor-free",
        "name": "Muse Spark 1.3 Contributor Free"
      },
      {
        "id": "muse-spark-1.2-contributor-free",
        "name": "Muse Spark 1.2 Contributor Free"
      },
      {
        "id": "jev-1.13",
        "name": "Jev 1.13"
      },
      {
        "id": "jev-1.13-free",
        "name": "Jev 1.13 Free"
      }
    ],
    "authUrl": "https://opencode.ai/auth",
    "envVar": "OPENCODE_API_KEY",
    "notes": "PAYG key with free models on the fast lane (9router notice); FCC dispatches each catalog route over chat or responses.",
    "website": "https://opencode.ai/zen",
    "freeModelsHint": [
      "deepseek-v4-flash-free",
      "mimo-v2.6-flash-free",
      "mimo-v2.5-free",
      "ling-3.0-flash-fin-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "muse-spark-1.3-contributor-free",
      "muse-spark-1.2-contributor-free",
      "jev-1.13-free"
    ]
  },
  {
    "id": "pollinations",
    "name": "Pollinations",
    "category": "free-tier",
    "authKind": "none",
    "baseUrl": "https://text.pollinations.ai/openai",
    "wire": "openai-chat",
    "models": [
      {
        "id": "openai-fast",
        "name": "OpenAI Fast (GPT-OSS 20B)"
      }
    ],
    "modelsUrl": "https://text.pollinations.ai/openai/models",
    "notes": "Keyless anonymous tier over the OpenAI-compatible /openai endpoint (freellmpool port, checked live 2026-10-30: the anonymous listing serves openai-fast, GPT-OSS 20B relayed via OVH, with tool calls). The openai/gpt-oss/ovh-reasoning aliases resolve to the same backend, so they stay out of the baseline to keep one route per backend; discovery merges whatever the listing currently reports.",
    "website": "https://pollinations.ai/",
    "freeModelsHint": ["openai-fast"],
    "autoProvision": true
  },
  {
    "id": "ovh",
    "name": "OVHcloud AI Endpoints",
    "category": "free-tier",
    "authKind": "none",
    "baseUrl": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    "wire": "openai-chat",
    "dropParams": ["prompt_cache_key", "user"],
    "models": [
      {
        "id": "Meta-Llama-3_3-70B-Instruct",
        "name": "Meta Llama 3.3 70B Instruct"
      },
      {
        "id": "Qwen3.5-397B-A17B",
        "name": "Qwen3.5 397B A17B"
      },
      {
        "id": "gpt-oss-120b",
        "name": "GPT-OSS 120B"
      },
      {
        "id": "Mistral-Small-3.2-24B-Instruct-2506",
        "name": "Mistral Small 3.2 24B Instruct"
      },
      {
        "id": "Mistral-Nemo-Instruct-2407",
        "name": "Mistral Nemo Instruct 2407"
      },
      {
        "id": "Qwen3.6-27B",
        "name": "Qwen3.6 27B"
      },
      {
        "id": "Qwen3.5-9B",
        "name": "Qwen3.5 9B"
      },
      {
        "id": "Qwen2.5-VL-72B-Instruct",
        "name": "Qwen2.5 VL 72B Instruct"
      },
      {
        "id": "Mistral-7B-Instruct-v0.3",
        "name": "Mistral 7B Instruct v0.3"
      },
      {
        "id": "gpt-oss-20b",
        "name": "GPT-OSS 20B"
      },
      {
        "id": "Qwen3-Coder-30B-A3B-Instruct",
        "name": "Qwen3 Coder 30B A3B Instruct"
      }
    ],
    "notes": "OVHcloud AI Endpoints keyless anonymous tier, rate-limited per IP (freellmpool port; chat model list verified live 2026-10-30). Qwen3-32B and Llama-3.1-8B-Instruct are disabled upstream and Qwen3.8-27B is kept pin-only after slow canaries, so none of them is in the baseline. The request schema is stricter than OpenAI: fields outside the official parameter list are rejected with 400 (`feature '...' is not currently supported`), and prompt_cache_key (Codex) and user (Claude Desktop) have each hit it in the field, so dropParams strips both.",
    "website": "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/",
    "freeModelsHint": [
      "Meta-Llama-3_3-70B-Instruct",
      "Qwen3.5-397B-A17B",
      "gpt-oss-120b",
      "Mistral-Small-3.2-24B-Instruct-2506",
      "Mistral-Nemo-Instruct-2407",
      "Qwen3.6-27B",
      "Qwen3.5-9B",
      "Qwen2.5-VL-72B-Instruct",
      "Mistral-7B-Instruct-v0.3",
      "gpt-oss-20b",
      "Qwen3-Coder-30B-A3B-Instruct"
    ],
    "autoProvision": true
  },
  {
    "id": "requesty",
    "name": "Requesty",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://router.requesty.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "google/gemma-4-31b-it",
        "name": "Gemma 4 31B IT"
      },
      {
        "id": "nvidia/muse-glimmer-30b",
        "name": "Muse Glimmer 30B"
      },
      {
        "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "name": "Nemotron 3 Nano Omni 30B (Reasoning)"
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super 120B"
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "name": "Nemotron 3 Ultra 550B"
      }
    ],
    "authUrl": "https://app.requesty.ai/api-keys",
    "envVar": "REQUESTY_API_KEY",
    "notes": "Zero-priced routes only (freellmpool port, prices re-checked 2026-09-25): 200 requests/day per account across the free models, no card needed. Ids carry no :free suffix and can be repriced under the same id — keep no paid credit on the account or set a key spend limit. mistral/leanstral-1-5 and nemotron-3.5-lightning-30b-a3b are listed at zero price upstream but stayed disabled pending canaries, so they are not in the baseline.",
    "website": "https://www.requesty.ai/",
    "freeModelsHint": [
      "google/gemma-4-31b-it",
      "nvidia/muse-glimmer-30b",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3-ultra-550b-a55b"
    ]
  },
  {
    "id": "aion",
    "name": "Aion Labs",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://api.aionlabs.ai/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "aion-labs/aion-2.0",
        "name": "Aion 2.0"
      },
      {
        "id": "aion-labs/aion-3.0",
        "name": "Aion 3.0"
      },
      {
        "id": "aion-labs/aion-3.0-mini",
        "name": "Aion 3.0 Mini"
      },
      {
        "id": "aion-labs/aion-rp-llama-3.1-8b",
        "name": "Aion RP Llama 3.1 8B"
      }
    ],
    "authUrl": "https://api.aionlabs.ai",
    "envVar": "AION_API_KEY",
    "notes": "No-card free tier: 15 requests/minute and 20,000 tokens/day shared across Aion's priced models, renewing daily (freellmpool port, ids checked against the public /models endpoint 2026-07-16). aion-2.5 is disabled upstream, so it is not in the baseline.",
    "website": "https://aionlabs.ai/"
  },
  {
    "id": "modelscope",
    "name": "ModelScope API Inference",
    "category": "free-tier",
    "authKind": "apiKey",
    "baseUrl": "https://api-inference.modelscope.cn/v1",
    "wire": "openai-chat",
    "models": [
      {
        "id": "MiniMax/MiniMax-M3",
        "name": "MiniMax M3"
      },
      {
        "id": "Qwen/Qwen3.5-27B",
        "name": "Qwen3.5 27B"
      },
      {
        "id": "Qwen/Qwen3.5-35B-A3B",
        "name": "Qwen3.5 35B A3B"
      },
      {
        "id": "stepfun-ai/Step-3.7-Flash",
        "name": "Step 3.7 Flash"
      },
      {
        "id": "Tencent-Hunyuan/Hy3",
        "name": "Hunyuan Hy3"
      },
      {
        "id": "ZhipuAI/GLM-5.2",
        "name": "GLM 5.2"
      }
    ],
    "authUrl": "https://modelscope.cn/my/myaccesstoken",
    "envVar": "MODELSCOPE_API_KEY",
    "notes": "ModelScope (魔搭) API-Inference: 2,000 free calls/day total and up to 200 calls/day for one model; the free quota is dynamic with platform capacity (freellmpool port, official free-tier docs checked 2026-07-19). The key is the long-lived ModelScope access token. Domestic CN network friendly. deepseek-ai/DeepSeek-V4-Flash rows are disabled upstream and stay out of the baseline; discovery merges the rest.",
    "website": "https://www.modelscope.cn/",
    "freeModelsHint": [
      "MiniMax/MiniMax-M3",
      "Qwen/Qwen3.5-27B",
      "Qwen/Qwen3.5-35B-A3B",
      "stepfun-ai/Step-3.7-Flash",
      "Tencent-Hunyuan/Hy3",
      "ZhipuAI/GLM-5.2"
    ]
  },
  {
    "id": "llamacpp",
    "name": "LLaMA.cpp",
    "category": "local",
    "authKind": "none",
    "baseUrl": "http://localhost:8080/v1",
    "wire": "openai-chat",
    "models": [],
    "baseUrlOverrideEnv": "LLAMACPP_BASE_URL",
    "notes": "Local server; the model list is whatever the user has loaded, so the registry carries no ids.",
    "website": "https://github.com/ggml-org/llama.cpp"
  },
  {
    "id": "lmstudio",
    "name": "LM Studio",
    "category": "local",
    "authKind": "none",
    "baseUrl": "http://localhost:1234/v1",
    "wire": "openai-chat",
    "models": [],
    "baseUrlOverrideEnv": "LM_STUDIO_BASE_URL",
    "notes": "Local server; the model list is whatever the user has loaded, so the registry carries no ids.",
    "website": "https://lmstudio.ai/"
  },
  {
    "id": "ollama",
    "name": "Ollama",
    "category": "local",
    "authKind": "none",
    "baseUrl": "http://localhost:11434/v1",
    "wire": "openai-chat",
    "models": [],
    "baseUrlOverrideEnv": "OLLAMA_BASE_URL",
    "notes": "Local server; FCC normalizes the configured root to /v1, and the model list is whatever the user has pulled.",
    "website": "https://ollama.com/"
  },
  // 2026-11-03: 国内主站，以及订阅制 Token Plan / Agent Plan 的专属端点。
  // 套餐端点与按量端点的 Base URL、Key 完全隔离，必须各占一条，不能靠用户改 baseUrl 合并。
  {
    "id": "baichuan",
    "name": "Baichuan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.baichuan-ai.com/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "Baichuan4-Turbo", "name": "Baichuan4 Turbo" },
      { "id": "Baichuan4-Air", "name": "Baichuan4 Air" },
      { "id": "Baichuan4", "name": "Baichuan4" },
      { "id": "Baichuan3-Turbo-128k", "name": "Baichuan3 Turbo 128K" }
    ],
    "authUrl": "https://platform.baichuan-ai.com/",
    "envVar": "BAICHUAN_API_KEY",
    "notes": "Baichuan's OpenAI-compatible chat endpoint (platform.baichuan-ai.com/docs/api; ids checked 2026-11-03).",
    "website": "https://platform.baichuan-ai.com/"
  },
  {
    "id": "bailian",
    "name": "阿里云百炼",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "qwen3.8-max", "name": "Qwen3.8 Max" },
      { "id": "qwen3.8-flash", "name": "Qwen3.8 Flash" },
      { "id": "qwen3.7-max", "name": "Qwen3.7 Max" },
      { "id": "qwen3.7-plus", "name": "Qwen3.7 Plus" },
      { "id": "qwen3.6-flash", "name": "Qwen3.6 Flash" },
      { "id": "qwen3-coder-plus", "name": "Qwen3 Coder Plus" },
      { "id": "qwen3-coder-next", "name": "Qwen3 Coder Next" },
      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "glm-5.3", "name": "GLM 5.3" },
      { "id": "glm-5.2", "name": "GLM 5.2" },
      { "id": "MiniMax-M2.5", "name": "MiniMax M2.5" },
      { "id": "kimi-k2.5", "name": "Kimi K2.5" }
    ],
    "authUrl": "https://bailian.console.aliyun.com/",
    "envVar": "DASHSCOPE_API_KEY",
    "baseUrlOverrideEnv": "DASHSCOPE_BASE_URL",
    "notes": "阿里云百炼中国站按量付费 OpenAI 兼容端点（官方 compatibility-of-openai-with-dashscope）。北京地域的 WorkspaceId 专属域名可用 baseUrl 覆盖；与 alibaba_cloud（新加坡国际站）是两个计费域，不能混用 Key。",
    "website": "https://help.aliyun.com/zh/model-studio/"
  },
  {
    "id": "bailian_token_plan",
    "name": "阿里云百炼 Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "qwen3.8-max", "name": "Qwen3.8 Max" },
      { "id": "qwen3.8-flash", "name": "Qwen3.8 Flash" },
      { "id": "qwen3.7-max", "name": "Qwen3.7 Max" },
      { "id": "qwen3.7-plus", "name": "Qwen3.7 Plus" },
      { "id": "qwen3.6-flash", "name": "Qwen3.6 Flash" },
      { "id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash" },
      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "glm-5.3", "name": "GLM 5.3" },
      { "id": "glm-5.2", "name": "GLM 5.2" }
    ],
    "authUrl": "https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal",
    "envVar": "DASHSCOPE_TOKEN_PLAN_API_KEY",
    "notes": "阿里云百炼 Token Plan 专属端点：Key 以 sk-sp- 开头，只在该 Base URL 上抵扣订阅 Credits。官方另给 Anthropic 兼容地址 .../apps/anthropic；目录只登记 OpenAI 兼容线。与按量、Coding Plan 的 Key 互不相通。",
    "website": "https://help.aliyun.com/zh/model-studio/token-plan-overview"
  },
  {
    "id": "siliconflow_cn",
    "name": "硅基流动 (中国站)",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "deepseek-ai/DeepSeek-V4-Pro", "name": "DeepSeek V4 Pro" },
      { "id": "deepseek-ai/DeepSeek-V4-Flash", "name": "DeepSeek V4 Flash" },
      { "id": "deepseek-ai/DeepSeek-V3.2", "name": "DeepSeek V3.2" },
      { "id": "Qwen/Qwen3.5-397B-A17B", "name": "Qwen 3.5 397B A17B" },
      { "id": "Qwen/Qwen3.5-122B-A10B", "name": "Qwen 3.5 122B A10B" },
      { "id": "zai-org/GLM-5.1", "name": "GLM 5.1" },
      { "id": "zai-org/GLM-5", "name": "GLM 5" },
      { "id": "moonshotai/Kimi-K2.6", "name": "Kimi K2.6" },
      { "id": "MiniMaxAI/MiniMax-M2.5", "name": "MiniMax M2.5" }
    ],
    "authUrl": "https://cloud.siliconflow.cn/account/ak",
    "envVar": "SILICONFLOW_CN_API_KEY",
    "modelsUrl": "https://api.siliconflow.cn/v1/models",
    "notes": "SiliconFlow 中国站（api.siliconflow.cn）与 siliconflow（api.siliconflow.com）是两套站点和 Key；模型 id 沿用同一开源模型命名。",
    "website": "https://siliconflow.cn/"
  },
  {
    "id": "spark",
    "name": "讯飞星火",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://spark-api-open.xf-yun.com/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "4.0Ultra", "name": "Spark 4.0 Ultra" },
      { "id": "generalv3", "name": "Spark Pro" },
      { "id": "pro-128k", "name": "Spark Pro 128K" },
      { "id": "lite", "name": "Spark Lite" }
    ],
    "authUrl": "https://console.xfyun.cn/",
    "envVar": "SPARK_API_PASSWORD",
    "notes": "讯飞星火 OpenAI 兼容 HTTP 端点；model 字段直接填 domain 名。Max 版本套餐已于 2026-03-10 下线，故 max-32k / generalv3.5 不登记。",
    "website": "https://www.xfyun.cn/"
  },
  {
    "id": "stepfun",
    "name": "阶跃星辰 StepFun",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.stepfun.com/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "step-5-preview", "name": "Step 5 Preview" },
      { "id": "step-3.7-flash", "name": "Step 3.7 Flash" },
      { "id": "step-3.5-flash", "name": "Step 3.5 Flash" },
      { "id": "step-3.5-flash-2603", "name": "Step 3.5 Flash 2603" }
    ],
    "authUrl": "https://platform.stepfun.com/interface-key",
    "envVar": "STEPFUN_API_KEY",
    "notes": "阶跃星辰中国站（api.stepfun.com）；国际站 api.stepfun.ai 不登记。Step Plan 订阅走单独的 /step_plan/v1 前缀。",
    "website": "https://platform.stepfun.com/"
  },
  {
    "id": "stepfun_step_plan",
    "name": "阶跃星辰 Step Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.stepfun.com/step_plan/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "step-5-preview", "name": "Step 5 Preview" },
      { "id": "step-3.7-flash", "name": "Step 3.7 Flash" },
      { "id": "step-3.5-flash", "name": "Step 3.5 Flash" },
      { "id": "step-3.5-flash-2603", "name": "Step 3.5 Flash 2603" }
    ],
    "authUrl": "https://platform.stepfun.com/interface-key",
    "envVar": "STEPFUN_STEP_PLAN_API_KEY",
    "notes": "Step Plan 订阅端点：官方 overview 写明按月 Credit 额度、OpenAI 兼容 base 为 /step_plan/v1、Anthropic 兼容 base 为 /step_plan。目录只登记 OpenAI 兼容线。",
    "website": "https://platform.stepfun.com/docs/zh/step-plan/overview"
  },
  {
    "id": "volcengine_ark_platform",
    "name": "火山方舟（按量）",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "wire": "openai-chat",
    "models": [
      { "id": "doubao-seed-2.1-turbo", "name": "Doubao Seed 2.1 Turbo" },
      { "id": "doubao-seed-2.0-pro", "name": "Doubao Seed 2.0 Pro" },
      { "id": "doubao-seed-2.0-lite", "name": "Doubao Seed 2.0 Lite" },
      { "id": "doubao-seed-2.0-code", "name": "Doubao Seed 2.0 Code" },
      { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" },
      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "glm-5.2", "name": "GLM 5.2" },
      { "id": "kimi-k2.7-code", "name": "Kimi K2.7 Code" },
      { "id": "minimax-m3", "name": "MiniMax M3" }
    ],
    "authUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "envVar": "ARK_API_KEY",
    "notes": "火山方舟平台按量端点 /api/v3。它与 /api/coding/v3（volcengine-ark）和 /api/plan/v3（volcengine_ark_agent_plan）是三条计费通路，Key 与 Base URL 不可混用。",
    "website": "https://console.volcengine.com/ark"
  },
  {
    "id": "volcengine_ark_agent_plan",
    "name": "火山方舟 Agent Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/plan/v3",
    "wire": "openai-chat",
    "models": [
      { "id": "ark-code-latest", "name": "Ark Code Latest" },
      { "id": "doubao-seed-2.1-turbo", "name": "Doubao Seed 2.1 Turbo" },
      { "id": "doubao-seed-2.0-pro", "name": "Doubao Seed 2.0 Pro" },
      { "id": "doubao-seed-2.0-lite", "name": "Doubao Seed 2.0 Lite" },
      { "id": "doubao-seed-2.0-code", "name": "Doubao Seed 2.0 Code" },
      { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" },
      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "glm-5.2", "name": "GLM 5.2" },
      { "id": "kimi-k2.7-code", "name": "Kimi K2.7 Code" },
      { "id": "minimax-m3", "name": "MiniMax M3" }
    ],
    "authUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "envVar": "ARK_AGENT_PLAN_API_KEY",
    "notes": "Agent Plan 订阅端点：官方接入文档给出 OpenAI 协议 /api/plan/v3、Anthropic 协议 /api/plan，并要求使用 Agent Plan 专属 Key。ark-code-latest 由控制台切换实际模型；Kimi K3 只在 Medium 及以上档位提供，故不进基线。",
    "website": "https://www.volcengine.com/docs/82379/2374459"
  },
  {
    "id": "yi",
    "name": "零一万物 Yi",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.lingyiwanwu.com/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "yi-lightning", "name": "Yi Lightning" },
      { "id": "yi-vision-v2", "name": "Yi Vision V2" }
    ],
    "authUrl": "https://platform.lingyiwanwu.com/",
    "envVar": "YI_API_KEY",
    "notes": "零一万物 OpenAI 兼容端点。官方文档注明自 2025-08-07 起 Yi-Lightning / Yi-Vision-V2 由智能路由承载，可能落到 DeepSeek / Qwen 等后端。",
    "website": "https://platform.lingyiwanwu.com/docs"
  },
  {
    "id": "ppio",
    "name": "PPIO 派欧云",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.ppio.com/openai",
    "wire": "openai-chat",
    "models": [
      { "id": "deepseek/deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "deepseek/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash" },
      { "id": "qwen/qwen3.8-max", "name": "Qwen3.8 Max" },
      { "id": "qwen/qwen3.8-flash", "name": "Qwen3.8 Flash" },
      { "id": "zai-org/glm-5.3", "name": "GLM 5.3" },
      { "id": "zai-org/glm-5.3-flash", "name": "GLM 5.3 Flash" },
      { "id": "moonshotai/kimi-k3.1-pro", "name": "Kimi K3.1 Pro" },
      { "id": "moonshotai/kimi-k2.7-code", "name": "Kimi K2.7 Code" },
      { "id": "minimax/minimax-m3.1-flash", "name": "MiniMax M3.1 Flash" },
      { "id": "tencent/hy4", "name": "Tencent HY4" },
      { "id": "stepfun/step-5-preview", "name": "Step 5 Preview" },
      { "id": "xiaomimimo/mimo-v2.6-pro", "name": "MiMo V2.6 Pro" }
    ],
    "authUrl": "https://ppio.com/console",
    "envVar": "PPIO_API_KEY",
    "modelsUrl": "https://api.ppio.com/openai/models",
    "notes": "Base URL 逐字取自官方接入文档（ppio.com/docs/third-party/qode.md 写明 https://api.ppio.com/openai）。2026-11-10 无凭据实测：/openai/models 返回 67 条 chat 行，/openai/chat/completions 返回 403 INVALID_API_KEY（路径存在、只缺 Key）。新注册赠送 ¥50 代金券，属活动口径，不是永久免费池。",
    "website": "https://ppio.com/docs/home"
  },
  {
    "id": "huawei_maas",
    "name": "华为云 ModelArts Studio",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.modelarts-maas.com/v1",
    "wire": "openai-chat",
    "models": [],
    "authUrl": "https://console.huaweicloud.com/modelarts/",
    "envVar": "HUAWEI_MAAS_API_KEY",
    "modelsUrl": "https://api.modelarts-maas.com/v1/models",
    "notes": "华为云 ModelArts Studio 的 OpenAI 兼容入口。2026-11-10 无凭据实测 /v1/chat/completions 与 /v1/models 均返回 400 ModelArts.81002「Failed to get the authorization header」，证明路径存在、只缺 Authorization。基线模型清单故意留空：该平台的模型 id 随区域与已开通的模型授权变化，保存 Key 后用 modelsUrl 同步发现。新用户赠送额度属活动口径，不是永久免费。",
    "website": "https://www.huaweicloud.com/product/modelarts/studio.html"
  },
  {
    "id": "infini_ai",
    "name": "无问芯穹 Infini-AI",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://cloud.infini-ai.com/maas/v1",
    "wire": "openai-chat",
    "models": [],
    "authUrl": "https://cloud.infini-ai.com/",
    "envVar": "INFINI_API_KEY",
    "modelsUrl": "https://cloud.infini-ai.com/maas/v1/models",
    "notes": "无问芯穹 Infini-AI 的 OpenAI 兼容入口。2026-11-10 无凭据实测 /maas/v1/chat/completions 返回 401「Not login」、/maas/v1/models 返回 code 60000「Wrong Bearer Token or Token is nil」，证明路径存在、只缺 Bearer。基线留空，保存 Key 后由 modelsUrl 同步。注册赠送额度属活动口径。",
    "website": "https://cloud.infini-ai.com/"
  },
  {
    "id": "nous_portal",
    "name": "Nous Research Portal",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://inference-api.nousresearch.com/v1",
    "wire": "openai-chat",
    "models": [],
    "authUrl": "https://portal.nousresearch.com",
    "envVar": "NOUS_API_KEY",
    "modelsUrl": "https://inference-api.nousresearch.com/v1/models",
    "notes": "Nous Research 的 OpenAI 兼容推理入口。2026-11-12 无凭据实测：/v1/models 返回 200，但那份清单是 OpenRouter 代理来的，照它取一个 id 发 chat 会得到 400「Unknown model」，故不能当可调用基线；基线留空，保存 Key 后由 modelsUrl 同步。匿名免费档在本应用不可达：portal 的 /api/anonymous/create 与 /api/anonymous/token 均返回 403，铸造凭据需要上游部署密钥 x-anonymous-api-secret（只有官方 Hermes 二进制携带）；welcome 试用主机只有一个模型且由客户端本地后端申领，不经网关。",
    "website": "https://portal.nousresearch.com"
  },
  {
    "id": "bailian_coding_plan",
    "name": "阿里云百炼 Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "qwen3.7-plus", "name": "Qwen3.7 Plus" },
      { "id": "qwen3.6-plus", "name": "Qwen3.6 Plus" },
      { "id": "qwen3.5-plus", "name": "Qwen3.5 Plus" },
      { "id": "kimi-k2.5", "name": "Kimi K2.5" },
      { "id": "glm-5", "name": "GLM 5" },
      { "id": "MiniMax-M2.5", "name": "MiniMax M2.5" }
    ],
    "authUrl": "https://bailian.console.aliyun.com/",
    "envVar": "DASHSCOPE_CODING_PLAN_API_KEY",
    "notes": "阿里云百炼 Coding Plan 中国站订阅端点。官方 overview 逐字给出 OpenAI 兼容 base https://coding.dashscope.aliyuncs.com/v1 与 Anthropic 兼容 base .../apps/anthropic；目录只登记 OpenAI 兼容线。计量是请求次数不是 token（Pro：5 小时 6000 / 周 45000 / 月 90000，5 小时档滚动恢复）。它与 bailian_token_plan、按量付费是三条计费通路：Coding Plan 与 Token Plan 的 Key 都以 sk-sp- 开头，只能靠 Base URL 区分，混用会 401/403 或走错计费。",
    "website": "https://help.aliyun.com/zh/model-studio/coding-plan-overview"
  },
  {
    "id": "tencent_coding_plan",
    "name": "腾讯云 Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.lkeap.cloud.tencent.com/coding/v3",
    "wire": "openai-chat",
    "models": [
      { "id": "tc-code-latest", "name": "Tencent Code Latest (Auto)" }
    ],
    "authUrl": "https://console.cloud.tencent.com/",
    "envVar": "TENCENT_CODING_PLAN_API_KEY",
    "notes": "腾讯云 Coding Plan 订阅端点。官方概述逐字给出 OpenAI 兼容 https://api.lkeap.cloud.tencent.com/coding/v3 与 Anthropic 兼容 .../coding/anthropic，并写明套餐 Key（sk-sp-）与预付费/后付费 Key（sk-）及 Base URL 不互通。套餐模型由控制台动态更新，文档正文只给出 tc-code-latest（Auto，按算法自动选模型），故基线只登记它，不拿第三方列表里的展示名充 id。额度按请求次数：Lite 5 小时 1200 / 周 9000 / 月 18000，Pro 6000 / 45000 / 90000。",
    "website": "https://cloud.tencent.com/document/product/1823/130092"
  },
  {
    "id": "tencent_token_plan",
    "name": "腾讯云 Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://api.lkeap.cloud.tencent.com/plan/v3",
    "wire": "openai-chat",
    "models": [],
    "authUrl": "https://console.cloud.tencent.com/",
    "envVar": "TENCENT_TOKEN_PLAN_API_KEY",
    "notes": "腾讯云 Token Plan 个人版：通用 Token Plan 与 Hy Token Plan 共用同一把 Key 与同一个 Base URL，按传入的 model 自动落到对应套餐抵扣。官方套餐概览给出 OpenAI 兼容 .../plan/v3（完整路径 /plan/v3/chat/completions）与 Anthropic 兼容 .../plan/anthropic。可用模型 id 只公布在控制台模型列表页，文档正文没有逐字清单，故基线留空、不臆造 id。计量是套餐内 token（Lite 3500 万/订阅月）。",
    "website": "https://cloud.tencent.com/document/product/1823/130060"
  },
  {
    "id": "qianfan_coding_plan",
    "name": "百度千帆 Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://qianfan.baidubce.com/v2/coding",
    "wire": "openai-chat",
    "models": [
      { "id": "qianfan-code-latest", "name": "Qianfan Code Latest" },
      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "glm-5.1", "name": "GLM 5.1" }
    ],
    "authUrl": "https://console.bce.baidu.com/qianfan/",
    "envVar": "QIANFAN_CODING_PLAN_API_KEY",
    "notes": "千帆 Coding Plan 专属端点。官方文档写明 OpenAI 兼容 base .../v2/coding（完整路径 /v2/coding/chat/completions）、Anthropic 兼容 .../anthropic/coding，并注明 Coding Plan 专属 Key 只能用于该专属接口。model 可固定填 qianfan-code-latest，由订阅管理页选择实际模型（约一分钟生效）；也可直接指定文档列出的具体 id。这是与 baidu（qianfan.baidubce.com/v2 按量）不同的一条计费通路。",
    "website": "https://cloud.baidu.com/doc/qianfan/s/imlg0beiu"
  },
  {
    "id": "qianfan_token_plan",
    "name": "百度千帆 Token Plan 个人版",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://qianfan.baidubce.com/v2/tokenplan/personal",
    "wire": "openai-chat",
    "models": [
      { "id": "qianfan-code-latest", "name": "Qianfan Code Latest" },
      { "id": "ernie-5.5-flash-preview", "name": "ERNIE 5.5 Flash Preview" },
      { "id": "ernie-light-dt-1.0", "name": "ERNIE Light DT 1.0" },
      { "id": "deepseek-v4.1-flash-1017", "name": "DeepSeek V4.1 Flash 1017" },
      { "id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash" },
      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
      { "id": "glm-5.3", "name": "GLM 5.3" },
      { "id": "glm-5.3-flash", "name": "GLM 5.3 Flash" }
    ],
    "authUrl": "https://console.bce.baidu.com/qianfan/",
    "envVar": "QIANFAN_TOKEN_PLAN_API_KEY",
    "notes": "千帆 Token Plan 个人版专属端点。官方文档给出 OpenAI 兼容 .../v2/tokenplan/personal 与 Anthropic 兼容 .../anthropic/tokenplan/personal；误用通用千帆 Key 会返回 token_plan_person_api_key_required（Token Plan Person requires a dedicated API key）。基线取自文档模型表，标注「即将下线」的 deepseek-v4-pro-0813 / deepseek-v4-flash-0731 / glm-5.2 / glm-5.1 不登记。",
    "website": "https://cloud.baidu.com/doc/qianfan/s/Dmrabu8b6"
  },
  {
    "id": "xfyun_astron_coding_plan",
    "name": "讯飞星辰 Astron Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
    "wire": "openai-chat",
    "models": [
      { "id": "astron-code-latest", "name": "Astron Code Latest" }
    ],
    "authUrl": "https://maas.xfyun.cn/",
    "envVar": "XFYUN_ASTRON_CODING_PLAN_API_KEY",
    "notes": "讯飞星辰 MaaS 的 Astron Coding Plan 订阅网关。官方 CodingPlan 文档给出 OpenAI 协议 .../v2 与 Anthropic 协议 .../anthropic；maas-coding-api 与常规推理 maas-api 是两条通路，Key 不通用。统一 model id 为 astron-code-latest，实际底层模型在控制台切换（1–3 分钟生效），文档另列的 xop* 内部 id 不作为基线。额度按请求次数（5 小时 / 周 / 订阅月三层）。",
    "website": "https://www.xfyun.cn/doc/spark/CodingPlan.html"
  },
  {
    "id": "xfyun_astron_token_plan",
    "name": "讯飞星辰 Astron Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://maas-token-api.cn-huabei-1.xf-yun.com/v2",
    "wire": "openai-chat",
    "models": [
      { "id": "spark-x2.5", "name": "Spark X2.5" },
      { "id": "xsparkx2flash", "name": "Spark X2 Flash" },
      { "id": "xopglm52", "name": "GLM 5.2" },
      { "id": "xopglm51", "name": "GLM 5.1" },
      { "id": "xopglm5", "name": "GLM 5" },
      { "id": "xopdeepseekv4pro", "name": "DeepSeek V4 Pro" },
      { "id": "xopdeepseekv4flash", "name": "DeepSeek V4 Flash" },
      { "id": "xopdeepseekv32", "name": "DeepSeek V3.2" },
      { "id": "xopkimik26", "name": "Kimi K2.6" },
      { "id": "xopkimik25", "name": "Kimi K2.5" },
      { "id": "xminimaxm25", "name": "MiniMax M2.5" },
      { "id": "xopqwen35397b", "name": "Qwen3.5 397B" },
      { "id": "xopqwen36v35b", "name": "Qwen3.6 35B" },
      { "id": "xopqwen35v35b", "name": "Qwen3.5 35B" },
      { "id": "xop3qwencodernext", "name": "Qwen3 Coder Next" },
      { "id": "xopglmv47flash", "name": "GLM 4.7 Flash" }
    ],
    "authUrl": "https://maas.xfyun.cn/",
    "envVar": "XFYUN_ASTRON_TOKEN_PLAN_API_KEY",
    "notes": "讯飞星辰 Astron Token Plan 独立端点：官方 TokenPlan 文档明写 maas-token-api 与常规推理 maas-api 不同、不可混用，并给出 OpenAI 协议 .../v2 与 Anthropic 协议 .../anthropic。模型 id 逐字取自该文档；已下线的 xsparkx2agent / xsparkx2 不登记。额度以积分（Credits）计量，按输入/缓存/输出/思考四类 token 折积分再乘时段系数。",
    "website": "https://www.xfyun.cn/doc/spark/TokenPlan.html"
  },
  {
    "id": "jd_coding_plan",
    "name": "京东云 JoyBuilder Coding Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://modelservice.jdcloud.com/coding/openai/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "DeepSeek-V3.2", "name": "DeepSeek V3.2" },
      { "id": "GLM-5", "name": "GLM 5" },
      { "id": "GLM-4.7", "name": "GLM 4.7" },
      { "id": "MiniMax-M2.5", "name": "MiniMax M2.5" },
      { "id": "Kimi-K2.5", "name": "Kimi K2.5" },
      { "id": "Kimi-K2-Turbo", "name": "Kimi K2 Turbo" },
      { "id": "Qwen3-Coder", "name": "Qwen3 Coder" }
    ],
    "authUrl": "https://console.jdcloud.com/",
    "envVar": "JD_CODING_PLAN_API_KEY",
    "notes": "京东云 JoyBuilder Coding Plan 订阅端点。官方快速开始给出 OpenAI 兼容 https://modelservice.jdcloud.com/coding/openai/v1 与 Anthropic 兼容 .../coding/anthropic，并明确警告 https://modelservice.jdcloud.com/v1 是按量计费地址、填它会报错。模型以「Model Name」形式在工具配置里指定，故此处按名登记（区分大小写）。它与 jd_token_plan 的 Key、Base URL、额度三者均不共享。",
    "website": "https://docs.jdcloud.com/cn/jdaip/Quickstart"
  },
  {
    "id": "jd_token_plan",
    "name": "京东云 JoyBuilder Token Plan",
    "category": "apikey",
    "authKind": "apiKey",
    "baseUrl": "https://modelservice.jdcloud.com/tokenPlan/openai/v1",
    "wire": "openai-chat",
    "models": [
      { "id": "maas-token-latest", "name": "MAAS Token Latest" }
    ],
    "authUrl": "https://console.jdcloud.com/",
    "envVar": "JD_TOKEN_PLAN_API_KEY",
    "notes": "京东云 JoyBuilder TokenPlan 订阅端点。官方工具配置指南逐字给出 OpenAI https://modelservice.jdcloud.com/tokenPlan/openai/v1 与 Anthropic .../tokenPlan/anthropic（路径里的 P 是大写）。与按量付费的 API Key 不通用；官方明写 TokenPlan 兼容 OpenAI/Anthropic 协议且无工具限制，可接入 LangChain 等框架。计量是套餐内 Credits。",
    "website": "https://docs.jdcloud.com/cn/jdaip/tool-setup"
  },
]

const AGGREGATE_BY_ID = new Map(AGGREGATE_REGISTRY.map(entry => [entry.id, entry]))

export function getAggregateEntry(id: string): AggregateEntry | undefined {
  return AGGREGATE_BY_ID.get(id)
}

/** Display name of a catalogue model: `<providerId>/<modelId>`. */
export function aggregateModelName(entryId: string, modelId: string): string {
  return `${entryId}/${modelId}`
}

/** The header/prefix that carries this endpoint's key. */
export function aggregateAuthHeader(entry: AggregateEntry): { header: string; prefix: string } {
  if (entry.id === 'azure_openai') return { header: 'api-key', prefix: '' }
  if (entry.wire === 'anthropic-messages') return { header: 'x-api-key', prefix: '' }
  return { header: 'Authorization', prefix: 'Bearer ' }
}

export function aggregateChatPath(entry: AggregateEntry): string {
  if (entry.wire === 'anthropic-messages') return '/messages'
  if (entry.wire === 'openai-responses') return '/responses'
  return '/chat/completions'
}
