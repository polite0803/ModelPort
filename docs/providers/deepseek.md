# DeepSeek：上下文缓存（context caching）

> 取证日期：2026-11-08 ｜ 来源：<https://api-docs.deepseek.com/guides/kv_cache>
> 条目：`src/main/providers/aggregate/registry.ts`（`id: deepseek`，`wire: openai-chat`）

## 官方页面的原文要点

- 缓存对所有用户默认开启："enabled by default for all users"。
- 缓存单位是独立、完整的单元；后续请求只有在**完整匹配**某个缓存前缀单元时才会命中："A subsequent request can hit the cache if it fully matches a cache prefix unit."
- 命中与未命中分别通过 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 上报。
- 缓存会在 "within a few hours to a few days" 内被清除。

## 该页**没有**回答的

- 缓存作用域（按 API key、组织还是全局）没有写明。
- 最小缓存单位 / 最小可缓存长度没有写明（旧资料里的 64 token 未在本页复核）。
- 缓存读价格没有在本页给出。

## 本仓可核对的旁证

- 缓存命中字段的解析已存在：`src/main/proxy/quota/usage.ts`（`prompt_tokens_details.cached_tokens` 与平铺的 `prompt_cache_hit_tokens` 两种写法都认）。
- 定价 sidecar（`src/shared/aggregatePricing.ts`）里 DeepSeek 官方条目的读价/输入价：
  - `deepseek-v4-flash`：`cacheRead 0.003` / `input 0.15` ≈ **0.02**；
  - `deepseek-v4-pro`：`cacheRead 0.022` / `input 0.66` ≈ **0.033**。
  这是"压缩 vs 缓存"账里 `c` 的来源，不是官方缓存文档给出的。

## ModelPort 的取值（`AggregateEntry.promptCache`）

| 字段 | 值 | 理由 |
|---|---|---|
| `mode` | `implicit-prefix` | 官方明确自动缓存，不需要 `cache_control` |
| `readDiscount` | `0.02` | 按 flash 的最优折扣除；pro 略高。用于压缩净收益门 |
| `acceptsPromptCacheKey` | `false` | 官方未声明该参数；不向请求体加未知字段 |
| `ttlMinutes` | 不填 | 官方只给"几小时到几天"的范围，不写猜测值 |

## 对实现的约束

1. **不注入 `cache_control`** —— 那是 Anthropic 的形状，DeepSeek 自动缓存。
2. **不改写前缀**：live-zone 压缩默认"缓存优先"跳过（见 `resolveCompressionConfig`），因为下一轮客户端会把原文重新送来。
3. **账号/模型亲和**：同一会话尽量落在同一个 `(provider, account, model)`。官方 TTL 是"几小时到几天"，`autoRouting.cacheAffinityMinutes` 取 **60 分钟**（在文档下界之内），等真机读数再调。
4. `deepseek-chat` 与 `deepseek-reasoner` 是不同模型（不同缓存域），同一会话不得在两者之间轮换。

## 验收读数（P1 仪表盘按模型行）

用真实 key 跑 3 轮带工具结果的会话，记录第 2/3 轮的 `prompt_cache_hit_tokens / prompt_tokens`：

- (a) 现状（压缩开、亲和 30 分钟）；
- (b) 仅缓存优先（压缩关）；
- (c) 缓存优先 + 亲和窗口。

判据：`b ≥ a` 且 `c ≥ b`；同时记录 `upstreamPrompt` 与 `savedTokens`，不能只报命中率。
