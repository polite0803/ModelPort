# MiniMax（CN）：自动前缀缓存（implicit caching）

> 取证日期：2026-11-08 ｜ 来源：<https://platform.minimax.cn/docs/api-reference/text-prompt-caching>
> 条目：`src/main/providers/aggregate/registry.ts`（`id: minimax-cn`，`wire: anthropic-messages`）

## 官方页面的原文要点

- **自动缓存**："自动识别重复的上下文内容，无需更改接口调用方式"。页面给的 Anthropic 与 OpenAI 两个示例都不带 `cache_control`。
- 生效门槛："缓存适用于包含 512 个及以上的输入 token 数量的 API 调用"。
- 价格：命中按优惠价计费（"缓存命中 Token：按优惠价格计费"），页面没有给出统一倍率；示例里 `MiniMax-M3.1-Flash` 的缓存读 0.10 元/百万、新输入 1.00 元/百万，约 **0.1 倍**，但原文补了一句"取值以按量计费价格页为准"。
- 支持模型："MiniMax-M3.1-Flash、MiniMax-M3"。

## 该页**没有**回答的

- 缓存 TTL / 生命周期没有任何数字。
- 缓存作用域（按 key、账号还是全局）未写明。
- 缓存读价的正式倍率没有规则化表述（0.1 来自示例推算）。

## 真机读数（2026-11-08 08:49，Anthropic 路由直连）

每轮独立 nonce 的全新前缀，避免复用前一次实验的缓存：

| 轮 | 前缀 | `cache_control` | input | `cache_creation_input_tokens` | `cache_read_input_tokens` |
|---|---|---|---|---|---|
| A1 | 全新 A | 有 | 3539 | **0** | 0 |
| A2 | A 第二次 | 有 | 211 | 0 | 3328 |
| B1 | 全新 B | 无 | 3411 | 0 | 128（部分） |
| B2 | B 第二次 | **无** | 1 | 0 | **3538** |
| B3 | B 第三次 | 有 | 1 | 0 | **3538** |

结论：**隐式前缀缓存，`cache_control` 是空操作**。

1. 全新前缀带断点首发（A1）的创建量是 0——显式语义下这里必须 > 0。
2. 全新前缀不带断点，第二次就整段命中（B2）。
3. 同一前缀加不加断点读数完全一致（B2 vs B3）。

所以**不要**按《Anthropic 主动缓存》那篇文档的示例把它当 explicit 端点：那篇文档只证明"这么写能跑通"，证明不了"断点被计费"。实测才是这条能力的证据。

## 模型清单的真机事实

`GET /v1/models` 仍然列出 9 个 id，但两条 wire（`/anthropic/v1/messages` 与 `/v1/chat/completions`）实测只有 `MiniMax-M3` 与 `MiniMax-M3.1-Flash` 返回 200；`MiniMax-M2.1` / `M2.5` / `M2.7`（含 `-highspeed`）/ `M2` 全部 `404 (2069) no longer available`。

`/v1/models` 在这个供应商上**不能**用来判断路由能力；条目已按实测裁剪为 2 个模型。

## ModelPort 的取值（`AggregateEntry.promptCache`）

| 字段 | 值 | 理由 |
|---|---|---|
| `mode` | `implicit-prefix` | 真机三条对照证明与断点无关，属于自动前缀缓存 |
| `readDiscount` | `0.1` | 官方示例推算（0.10 / 1.00）；正式倍率页未复核 |
| `acceptsPromptCacheKey` | `false` | 页面未声明该参数；不向请求体加未知字段 |
| `minCacheableTokens` | 不填字段 | 512 是官方门槛，但该字段在代码里只被「显式断点」路径消费，隐式模式不读，写上去会误导 |
| `ttlMinutes` | 不填 | 官方没有给 TTL |

## 对实现的约束

1. **不注入 `cache_control`**：wire 虽然是 `anthropic-messages`，但这条端点的缓存是隐式的；`applyCacheBreakpoints` 只对 `explicit-breakpoints` 生效，正好不会碰它。
2. **不改写前缀**：live-zone 压缩按 `cacheFirst` 默认跳过（`isCacheSensitive`：0.1 ≤ 0.2）。
3. **账号/模型亲和**：`mode` 已知后 `autoRouting` 的缓存亲和对其生效，同一会话尽量不换账号、不换模型（M3 与 M3.1-Flash 是两个缓存域）。
4. 低于 512 input token 的请求本来就不会有缓存，压缩判断不需要为它让路。

## 缓存键的粒度：完整消息序列（2026-11-08 09:30 补测）

直连同一端点做了两组对照，结果推翻了"任意 token 前缀都能命中"的直觉：

| 组 | 改动 | 第 1 次 | 第 2 次 |
|---|---|---|---|
| N | 同一条 user message，只把末尾 `Answer A.` 换成 `Answer B.` | read 0（全新） | 同体重复 read 3840；换回 A 后 read 3840 |
| R | messages 逐轮追加（首条消息字节不变） | R1 read 0 | R2 read 3840 / R3 read 3840 |

结论：MiniMax 的隐式缓存按**完整消息**做前缀键，**不是**同一条消息内部的任意字节前缀。

- N3（`Answer B.`）与 N1 共享约 3840 token 的公共前缀，但读数是 **0**——公共前缀不跨 message 内容变化生效。
- N4/N5/N6 说明缓存里可同时留住多条不同尾部的条目（换回 A 仍命中，10 秒后仍命中）。
- R 组才是真实多轮形状：历史消息不变、只在末尾追加，命中稳定。

对 ModelPort 的直接含义：

1. `cacheFirst` 跳过压缩的正当性依赖"**不改写历史消息内容**"这一前提；任何 live-zone 压缩都会让被改写的那条消息及其之后整段缓存失效，对这类端点比 DeepSeek 更伤（DeepSeek 按 token 前缀，压缩尾部仍能吃到前半段）。
2. 同一会话内一次"重写历史"（压缩、修剪非尾部消息）会把缓存从改写点起全部作废，所以 P3-A 的 90.9% 门要加上这条失效代价一起算，不能只看单请求省幅。

## 网关侧验收（2026-11-08 09:35，WSL 网关 v1.7.9）

配置：`minimax-cn` 聚合供应商已启用，1 把 Key，单一账号（`2cc7f9ff-…`）；`promptCaching.enabled=true`、`compression.enabled=true`、`cacheFirst=true`。夹具是一条约 4,000 token 的 user 消息，随后按真实多轮形状逐轮追加 assistant/user，轮间隔 2 秒，`temperature=0`：

| 轮 | 消息数 | prompt | `cached_tokens` | 延迟 |
|---|---|---|---|---|
| 1 | 1 | 3988 | 128 | 5118 ms |
| 2 | 3 | 4005 | **未上报（null）** | 2077 ms |
| 3 | 5 | 4022 | **3840（95.5%）** | 947 ms |
| 4 | 7 | 4039 | **3840（95.1%）** | 1002 ms |
| 5 | 9 | 4056 | **3840（94.7%）** | 1281 ms |

三条读数各自有用：

- **命中是活的**：第 3 轮起稳定 3840 token（30×128 的块对齐值），延迟从 5.1 s 降到 1 s 量级。
- **第 2 轮上游干脆不返回 `prompt_tokens_details`**：这正是"未上报必须显示 `-`、不能在分母里当 0%"的现成样本（`cacheReadReportedRequests`）。
- **网关不改写请求体**：直连先写、网关同文读 3840/3989；网关先写、直连同文读 3986/3987，两个方向都整段命中。

另记一条存量数据的事实：该供应商记录里的 `supportedModels` 仍是添加时的 9 个 id（含 7 个在此路由 404 的 M2.x）。这**不是**待修项——模型管理面板里的停用开关写的是 `excludedModels`，它才是"在服务"的唯一权威（`modelServing.applyServed`），已把这 7 个移出所有路由候选池与点名请求；`modelMappings.disabled` 是别名账，与目录模型无关。按当前代码只有**新添加**的条目会用裁剪后的 2 个模型，已有记录不会被回写，也不需要回写。

## 未取证

- 国际站条目 `minimax`（`wire: openai-chat`）**未验证**：本次的 key 在国际站返回 401 `invalid api key`，其模型清单里的 M2.x 是否仍然可用没有读数。
- TTL、缓存作用域、正式缓存读倍率。
- 缓存写入的传播延迟：本轮第 2 轮未命中、第 3 轮命中，无法区分"上游按请求异步建缓存"与"网关侧第二条请求恰好赶上建好之前"。
- P3 的压缩/缓存竞价读数（需要按日桶累计 7 天）。