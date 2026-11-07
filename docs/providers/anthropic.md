# Anthropic：显式 prompt caching

> 取证日期：2026-11-08 ｜ 条目：`src/main/providers/aggregate/registry.ts`（`id: anthropic`，`wire: anthropic-messages`）

## 取证状态（必须先读）

本机访问 `platform.claude.com/docs/.../prompt-caching` 被区域网关 **307** 重定向到 `app-unavailable-in-region`，无法逐段复核。本仓既有的可用证据是官方全文导出 `https://platform.claude.com/llms-full.txt`（2026-10-30 抓取，47MB；本机 WebFetch 因体积超限无法重取）。

因此下表数值是**既有实现与官方文档的已知值**，但**尚未在本机逐段复核**；P0 的真机验收（`cache_read_input_tokens > 0`）是唯一可以把它从"待证"变成"已验证"的步骤。

## 能力表取值

| 字段 | 值 | 说明 |
|---|---|---|
| `mode` | `explicit-breakpoints` | Anthropic 不做自动缓存，必须放 `cache_control` |
| `maxBreakpoints` | `4` | 官方上限 |
| `readDiscount` | `0.1` | 缓存读约为普通输入的 10% |
| `writeMultiplier` | `0.25` | 5 分钟档写价约 1.25x；1 小时档另按 1.0 附加 |
| `minCacheableTokens` | `1024` | 低于该长度不加断点；Haiku 家族可能更高 |
| `acceptsPromptCacheKey` | `false` | 走 `cache_control`，不走 OpenAI 的 key |
| `ttlMinutes` | `5` | 默认 5 分钟档 |

## 适配器落点与断点位置

`src/main/proxy/adapters/anthropic.ts::applyCacheBreakpoints`：

1. 工具表最后一个定义；
2. `system` 最后一个文本块（字符串会被转成块数组）；
3. **上一轮**最后一条消息的最后一个内容块（`messages.length >= 3` 才加）。

当前轮末尾**默认不加**：它每轮都是写、下一轮才能读，收益依赖多轮，先由 P1 的真实读数决定。所有断点只加 `cache_control` 元数据，不改任何文本。

## 待办

- 用真实 Anthropic key 跑 3 轮，确认第 2/3 轮出现 `cache_read_input_tokens > 0`，第 2 轮出现 `cache_creation_input_tokens`。
- z.ai `/api/anthropic` 与 minimax-cn 的 `promptCache` 仍为 `unknown`，未注入断点；等真机读数后再填。
