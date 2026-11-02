# 方案：把 Headroom 的 token 节约机制移植进 ModelPort

> 状态：**P0 + P1 + P5 已实现并验证**（2026-10-29），P1 已补齐嵌套 JSON 形状。
> **P4 已先落地其观测前提**：跨轮重复度统计（纯观测，不改写任何字节）。P2（日志/搜索）尚未开始；P4 的去重本体仍未实现，是否值得做由该统计决定。
> 归属声明见 `NOTICE-compression.md`。
> 参考实现：`https://github.com/headroomlabs-ai/headroom`（Apache-2.0）。下文所有 `path:line` 引用均指该仓库 `main` 分支（2026-10-29 快照）。需要复核时按需重新浅克隆，勿把副本留在本仓库内：
> `git clone --depth 1 https://github.com/headroomlabs-ai/headroom.git <仓库外路径>`
> 结论先行：**可移植，但必须自研 TypeScript 实现**；只移植「无需 ML、无需 Python」的那一半，并且**只压缩 live zone**。

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| 能不能直接 `npm i headroom-ai` 就能用？ | **不能**。`sdk/typescript/src/compress.ts` 只是 HTTP 客户端，第 60 行 `client.compress(...)` 把活儿丢给 Python 代理。本应用是分发给终端用户的 Electron 应用，不能假设装了 Python。 |
| 最值得移植的是什么？ | **① JSON 统计压缩（SmartCrusher）**，60–95%；**② 日志/搜索/diff 行压缩**；**③ CCR 可逆存储**；**④ live-zone 缓存安全规则**（不是压缩算法，但是让前三者安全的前提）；**⑤ 输出侧 verbosity 抑制**。 |
| 最大的技术风险是什么？ | **打破上游 prompt 前缀缓存**。压缩历史 = 缓存全部 miss，省下的 token 变成多花的钱。Headroom 的解法是「只压最新一轮的字节」，这也是本方案第一硬约束。 |
| 落地位置 | `src/main/proxy/forwarder.ts` 的 `forwardChatCompletion()`，与现有 `contextManagement` 同一层、**在 `transformRequestForPromptToolUse` 之前**。 |
| 默认值 | **关闭**。Headroom 自己的 Rust 代理也默认关闭（`config.rs:362-370`，`CompressionMode::Off`）。按供应商/模型白名单开启。 |
| 工作量 | P0–P5 六阶段，纯 TS 约 3.5k–4.5k 行 + 测试；P1 单独上线即可拿到绝大部分收益。 |

---

## 1. Headroom 到底做了什么（源码级结论）

### 1.1 五层结构

```
请求
 ├─ ① 只选 live zone（唯一可改的字节区间）
 ├─ ② ContentRouter：判断内容类型 → 选压缩器
 │     JSON  → SmartCrusher（统计选行）
 │     日志  → LogCompressor（分级 → 选行，不是 RLE 折叠）
 │     搜索  → SearchCompressor（按文件折叠）
 │     diff  → DiffCompressor（hunk 级）
 │     代码  → CodeCompressor（tree-sitter AST，本方案不移植）
 │     散文  → Kompress-v2-base（HF 模型，本方案不移植）
 │     HTML  → HTMLExtractor（trafilatura，本方案不移植）
 └─ ③ CCR：原文存本地，模型可按 hash 取回 → 让"有损"变安全
    ④ CacheAligner / volatile 检测：只观测不修改
    ⑤ 输出侧 verbosity：在 system prompt **末尾**追加短语，省的是 completion token
```

真正产出收益的是 ②，但让 ② 敢开的是 ① 和 ③。

### 1.2 关键默认值（可直接抄）

**SmartCrusher**（`crates/headroom-core/src/transforms/smart_crusher/config.rs:136-161`）

| 参数 | 值 | 含义 |
|---|---:|---|
| `min_items_to_analyze` | 5 | 少于 5 行不分析 |
| `min_tokens_to_crush` | 200 | 少于 200 token 不压 |
| `variance_threshold` | 2.0 | 离群判据 = 偏离**样本**均值 > 2σ（不是 IQR、不是 MAD） |
| `max_items_after_crush` | 15 | 保留行上限（但关键行溢出时可超出，见下） |
| `first_fraction` / `last_fraction` | 0.3 / 0.15 | **只对纯量数组生效**，对象数组不适用 |
| `dedup_identical_items` | true | 内容完全相同的先去重 |
| `preserve_change_points` | true | 保留变点 ±1 行 |
| `lossless_min_savings_ratio` | 0.15 | 无损路径达不到 15% 就让位给有损 |

> ⚠️ **5 个配置项是死代码**：`uniqueness_threshold`、`similarity_threshold`、`include_summaries`、
> `use_feedback_hints`、`toin_confidence_threshold` 在 Rust 里从未被读取（只出现在 config 与测试）。
> 移植时**不要**一并抄过来，避免造出「调了没用」的开关。

**可压性裁决 `analyze_crushability`**（`analyzer.rs:580-644`）——比「长度够就压」重要得多，决定「该不该压」：

| 条件（按序命中即返回） | 裁决 | 置信度 | 语义 |
|---|---|---:|---|
| 非 id 字段唯一度 < 0.1 且存在 id 字段 | 压 | 0.85 | 重复内容 + id |
| 最大唯一度 < 0.3 | 压 | 0.90 | 低唯一度，抽样安全 |
| 有 id 且唯一度 > 0.8 且无任何信号 | **跳过** | 0.85 | 纯唯一实体，每行都重要 |
| 唯一度 > 0.8 但存在信号（错误/离群/变点） | 压 | 0.70 | 唯一实体但有锚点 |
| 无任何信号 | **跳过** | 0.60 | 中等唯一度且无锚点 |
| 其余 | 压 | 0.50 | 中等唯一度且有信号 |

这两条「跳过」是质量保护：一张「每个元素都不同、也没有任何异常标记」的实体列表（比如用户名单），压了就必然丢信息。**本方案必须实现这张表，否则 P1 会在真实流量上翻车。**

**内容类型字节阈值**（`crates/headroom-core/src/transforms/live_zone.rs:171-199`）

| 类型 | 阈值 | 类型 | 阈值 |
|---|---:|---|---:|
| JSON 数组 | 512 B | 源码 | 2048 B |
| 构建/日志 | 512 B | 纯文本 | 5120 B |
| 搜索结果 | 512 B | HTML | 512 B（不压） |
| git diff | 512 B | 表格 | 512 B（无损） |

**采纳门禁**（分散在 `content_router.py`、`compression_units.py`、`compression_batches.py`）

| 门禁 | 默认 | 出处 |
|---|---:|---|
| 单条消息最小 token | 50 | `content_router.py:6069` |
| 单块最小字符 | 500 | `content_router.py:2240` |
| 单单元最小字节 | 512 | `compression_units.py:41` |
| **必须严格变小** | — | 压缩后 token ≥ 原 token → `rejected_not_smaller` |
| 无损→有损需额外收益 | 0.05 | `content_router.py:2501` |
| 单请求压缩超时 | 30 s | `HEADROOM_COMPRESSION_TIMEOUT_SECONDS` |
| 熔断（超时债务隔离） | 池子的一半 | `server.py:1366-1371` |

**缓存成本模型**（`headroom/transforms/compression_policy.py:61-69`）

- 缓存写 = 1.25×（5 分钟档）/ 2.0×（1 小时档），缓存读 = 0.1×
- `net_mutation_gain = dT·(w + r·(R−1)) − P_alive·(w−r)·(S + dT)`
- 盈亏平衡读次数 `R = ((w−r)/r)·(S/dT) = 11.5·S/dT`

> 这条公式是本方案「只压 live zone」的**经济学证明**，不是口味问题：当下游还有 `S` 个 token 的已缓存后缀时，改动上游 `dT` 个 token 需要该前缀被重读约 `11.5·S/dT` 次才回本。历史越长，动历史越亏。

### 1.3 「只压 live zone」的确切规则（最关键）

OpenAI Chat Completions 形状（`live_zone_openai.rs:14-17` + `live_zone.rs:2238-2493`）：

```
可压缩 = 最新一条 role:"tool" 的字符串 content  ∪  最新一条 role:"user" 的文本
冻结   = 更早的所有 tool/user 消息、全部 assistant、全部 system
永不读写 = tools / tool_choice（改它们会打掉 tool-schema 缓存）
n > 1  → 直接跳过压缩
```

Anthropic 形状多一个「地板」：`frozen_message_count = 1 + 最后一个带 cache_control 的消息下标`（`cache_control.rs:132`）。

还有一条实现纪律：**字节区间替换，不重新序列化**（`live_zone.rs:1551-1567`）。定位块的字节范围，把替换串 splice 进原 buffer，区间外的字节逐字拷贝——这是「前缀字节完全相同」的唯一保证方式。

### 1.4 有损如何变安全（CCR）

原文按内容哈希存本地，压缩文本里留标记。**标记形状按内容形态分三种，不要混用**（`crusher.rs:606-622`、`:1161-1174`）：

| 形态 | 输出 | 出处 |
|---|---|---|
| **对象数组**丢行 | 末尾追加一个**哨兵对象** `{"_ccr_dropped":"<<ccr:{12位hex} {N}_rows_offloaded>>"}` | `crusher.rs:987-1005` |
| **纯量数组**丢项 | 末尾追加一个**字符串** `"… {N} more items <<ccr:{hex} {N}_items_offloaded>>"` | `crusher.rs:1161-1174` |
| 单块（日志/搜索/diff） | 见 §4 P2 各自的 `[N … compressed to M. Retrieve …: hash={24位}]` | 各压缩器 |

> 注意：`config.rs:9-11` 的注释仍写着「SCHEMA-PRESERVING: no wrappers, no metadata keys」——**这句话对丢行路径已经过时**。
> 对象数组的哨兵会破坏「同构记录数组」形状，下游必须过滤。本方案也必须在 `ccr/markers.ts` 里实现对应的
> `isCcrSentinel` / `stripCcrSentinel`，否则二次压缩会把哨兵当成数据行再压一遍（Headroom 踩过这个坑，
> 见 `content_router.py:145-158`）。

哈希算法：`sha256(规范化数组 JSON)` 取前 6 字节 → 12 位十六进制（`crusher.rs:1270-1279`）。单块压缩器用的是 md5[:24]，两者不一致，移植时**按压缩器分别对齐**，别统一。

需要时模型调 `headroom_retrieve(hash)`，代理拦截该工具调用、回填原文、继续对话（`headroom/ccr/tool_injection.py`）。

### 1.5 输出侧节约（省的是 completion token）

在 system prompt **末尾**追加一个带哨兵的定长块（`output_verbosity_policy.py`）：

```
<headroom_output_shaping>
Skip preamble and postamble. …
</headroom_output_shaping>
```

放在**末尾**是为了不打断已有 `cache_control` 断点；哨兵保证可幂等替换。三档累进（1=不写前言后语；2=不复述代码/工具输出；3=只给结论、最小编辑）。默认关闭（`HEADROOM_OUTPUT_SHAPER=1` 开启）。

### 1.6 许可证

Apache-2.0 + `NOTICE`（1.6 KB）。移植属于衍生作品：**必须在仓库内保留 NOTICE 与本方案出处说明**，并在文件头标注来源与许可证。不构成障碍，但要做。

---

## 2. 移植可行性判定

### 2.1 能移植 / 不能移植

| Headroom 组件 | 依赖 | 本方案 |
|---|---|---|
| live-zone 选择器、字节区间替换 | 纯逻辑 | ✅ **必移植**（P0） |
| ContentRouter 检测级联 | 正则 | ✅ 移植（P0） |
| SmartCrusher（统计选行） | 纯算法 | ✅ **主收益**（P1） |
| Log / Search / Diff 压缩 | 纯算法 | ✅ 移植（P2） |
| CCR 存储 + 标记 + 检索 | 纯逻辑 | ✅ 移植（P3） |
| 跨轮去重、read 生命周期 | 纯逻辑 | ⚠️ 可选（P4） |
| CodeCompressor | tree-sitter | ❌ 不移植（Node 侧原生依赖，Electron 打包成本高） |
| Kompress-v2-base | HF / ONNX 模型 | ❌ 不移植（几百 MB 权重 + Electron 分发不现实） |
| HTMLExtractor | `trafilatura`（Python） | ❌ 不移植（只保留 HTML 识别） |
| CacheAligner / volatile 检测 | — | 🟡 只做「只读告警」 |
| verbosity steering | 纯文本 | ✅ 移植（P5） |

> 放弃 ML 两条腿的代价要讲清楚：Headroom 头部指标（JSON 60–95%、日志 5–50×）**不依赖模型**，`Kompress` 只影响散文。散文本来「压缩收益很低」（README「Limitations」原话）。所以放弃 ML 丢的是长尾，不是主菜。

### 2.2 必须自研的理由

1. TS SDK 是 HTTP 客户端，不是实现（`sdk/typescript/src/compress.ts:60`）。
2. 随包分发 Python 运行时（PyInstaller sidecar）会让安装包 +80–150 MB，且三层平台各要一份，与本项目「Electron 单包」的定位冲突。
3. 算法主体是纯函数式文本处理，TS 重写成本可控（见 §7）。

### 2.3 与本项目现有能力的关系

| 现有 | 关系 |
|---|---|
| `proxy/services/contextManagementService.ts` | **互补**。它删消息（丢历史），本方案改内容（保历史）。长期看压缩到位后可以下调裁剪强度。 |
| `proxy/utils/messageRoles.ts` | 压缩必须在其**之后**（角色归一化会改结构）。 |
| `proxy/toolCalling/*` + `transformRequestForPromptToolUse` | 压缩必须在其**之前**，否则托管层注入的工具标记会被当成普通文本压坏。 |
| `proxy/parameterPolicy.ts` | 无关（它管请求参数，不管 messages）。 |
| `proxy/quota/usage.ts::estimateTokens` | 复用并升级：`chars/4` → 按内容类型分档（见 §3.4）。 |
| `proxy/autoRouter.ts` 的 `conversationKey` | 压缩会改内容 → 必须在**路由决策之后**压缩，否则粘性键漂移。 |

---

## 3. 总体设计

### 3.1 唯一注入点

```
routes/chat.ts                     ← 校验、normalizeMessageRoles
  └─ autoRouter.select()           ← 路由决策（用未压缩内容算 conversationKey）
       └─ forwardChatCompletion()  ← ✅ 在这里压缩
            ├─ stripUnsupportedForBuiltin
            ├─ applyModelParameters
            ├─ [NEW] compression.apply()        ← 与 contextManagement 并列
            ├─ contextManagement（现有，可选）
            └─ doForward()
                 └─ transformRequestForPromptToolUse  ← 此时托管标记才注入，安全
```

选这里的原因：

- `forwardChatCompletion` 是 auto / 跨家链 / 普通三条路径**共同的**入口（`chat.ts:356/384/414`、`completions.ts:176/209`），一处覆盖全部。
- 它在 `doForward` 之前，因此对 `providerForwarders` 里的专用转发器（opencode、账号渠道）同样生效。
- 它在路由之后，粘性键不受影响。
- 它在托管层注入之前，工具标记不会被压。

> 细节：`forwardChainCompletion` 会按候选逐个调 `forwardChatCompletion`。用 `Object.defineProperty(request, COMPRESSED, {value:true})`（不可枚举，与现有 `signal` 同法）做幂等标记，避免同一请求被压多次、也避免第二次把 CCR 标记当源文本再压。

### 3.2 模块结构

```
src/main/proxy/compression/
├── index.ts                 # 门面：applyCompression(request, ctx) → {request, report}
├── liveZone.ts              # 选 live zone；字节区间替换
├── detector.ts              # 内容类型级联（正则，移植 content_detector.py）
├── estimator.ts             # 内容感知 token 估算（复用/升级 quota/usage）
├── policy.ts                # 门禁：字节阈值、最小 token、严格变小、收益比、超时
├── ccr/
│   ├── store.ts             # ~/.modelport/ccr/ 内容寻址存储 + TTL + LRU
│   └── markers.ts           # 标记生成/解析（与 Headroom 格式对齐）
├── compressors/
│   ├── smartCrusher.ts      # P1：JSON 统计选行
│   ├── logCompressor.ts     # P2
│   ├── searchCompressor.ts  # P2
│   └── diffCompressor.ts    # P2
├── signals/
│   ├── errorKeywords.ts     # 错误关���词与分级
│   └── adaptiveSizer.ts     # Kneedle 拐点选 K
└── outputSteering.ts        # P5：verbosity 注入
```

### 3.3 单次请求的数据流

```
messages ──► liveZone.pick()
               │ 得到 {msgIndex, contentPaths} 或 ∅
               ▼
          for each 可压字段:
            detector.detect(text)
               │ JSON_ARRAY | BUILD_OUTPUT | SEARCH | DIFF
               │ CODE | PLAIN | HTML | TABULAR   ← 后四类只识别、不压（放行）
               ▼
            bytes >= threshold[type] ?
               ▼
            compressor.compress(text) ──► {text', tokensBefore, tokensAfter, ccrHash?}
               ▼
            policy.accept()  ← 严格变小 + 收益比 + 超时
               ▼
        字节区间替换（区间外逐字拷贝）
               ▼
            写回 messages
```

> HTML / 源码 / 散文 / 表格四类在本方案里**只识别、不压缩**：HTML 抽取依赖 `trafilatura`（Python 库）、源码压缩依赖 tree-sitter、散文压缩依赖 ML 模型，三者都不移植（见 §2.1）。识别它们的目的仅是**避免误判**——例如把 HTML 当纯文本交给行压缩器。这是本方案与 Headroom 的既定能力差距，要在 UI 文案里写清。

### 3.4 配置模型（`src/shared/types.ts`）

沿用现有 `autoRouting` / `contextManagement` 的风格，`AppConfig` 增加一个**具名**字段（现在 `contextManagement?: unknown` 是历史债，不要跟着抄）：

```ts
export interface CompressionConfig {
  enabled: boolean                    // 默认 false（总开关）
  /** 允许压缩的供应商 id；空数组 + enabled = 全部允许 */
  providerAllowlist: string[]
  /** 按内容类型的开关，默认全开 */
  types: {
    json: boolean
    log: boolean
    search: boolean
    diff: boolean
  }
  /** 压缩力度：影响 adaptiveSizer 的 bias（1.5 / 1.0 / 0.7） */
  aggressiveness: 'conservative' | 'moderate' | 'aggressive'
  /** 保留行上限，对应 max_items_after_crush */
  maxKeptItems: number                // 默认 15
  /** 低于该 token 数的消息整体跳过 */
  minMessageTokens: number            // 默认 50
  /** 压缩后必须比原来小多少才采纳（0.1 = 至少省 10%） */
  minSavingsRatio: number             // 默认 0.10
  /** CCR：原文保留时长与容量上限 */
  ccr: {
    enabled: boolean                  // 默认 true
    ttlMinutes: number                // 默认 30
    maxEntries: number                // 默认 500
    maxBytes: number                  // 默认 64 MiB
    /** 是否注入取回工具（会影响工具调用面，默认关闭，见 §6.2） */
    injectRetrievalTool: boolean      // 默认 false
  }
  /** 遇到不认识的形状时是否放行（永远 true，安全侧默认） */
  failOpen: true
}
```

`requestLogConfig` 侧新增（与 `auto?` 同风格）：

```ts
/** 本请求的压缩记录；未压缩时不出现 */
compression?: {
  applied: string[]                   // ['json', 'log']
  tokensBefore: number
  tokensAfter: number
  saved: number
  ratio: number
  ccrHashes?: string[]
  skipped?: string                    // 未压缩原因：'no_live_zone' | 'below_threshold' | 'not_smaller' | 'disabled_for_provider'
}
```

响应头（沿用 `X-ModelPort-*` 约定，便于客户端观测，不打日志也能看）：

```
X-ModelPort-Compression: json,log
X-ModelPort-Compression-Saved: 18342
X-ModelPort-Compression-Ratio: 0.57
```

### 3.5 五条硬不变量

违反任何一条，宁可整条请求不压（fail-open）：

1. **前缀不变**：只动 live zone；区间外字节逐一相等。上线前用「压缩前后 sha256 前缀相等」断言测试。
2. **永不改 `tools` / `tool_choice` / `assistant.tool_calls[].function.arguments`**。
3. **工具对原子性**：压缩一条 `tool` 结果不得与其成对的 assistant tool_call 失去对应（call_id 必须原样保留）。
4. **严格变小才采纳**：估算后 token 数不严格下降即回滚。
5. **失败不外溢**：任一压缩器抛错只回滚该块，绝不 500；整体异常按原样转发。

---

## 4. 分阶段实施

### P0 — 骨架与安全护栏（无可见收益，先立规矩）

**内容**

- 建 `compression/` 目录、`index.ts` 门面、配置字段与 IPC、设置页占位。
- `detector.ts`：移植 `content_detector.py:182-261` 的级联顺序与置信度门槛——
  JSON(0) → diff(≥0.7) → HTML(≥0.7) → git status → search(≥0.6) → log(≥0.5) → tabular(≥0.6) → config(≥0.6) → code(≥0.5) → fixed-width → plain。
- `estimator.ts`：升级 `estimateTokens` 为分档估算（4.0 通用 / 3.5 代码 / 3.2 JSON / 1.5 CJK，来自 `tokenizers/estimator.py`）。
- `liveZone.ts`：OpenAI 形状的 live zone 选择 + 字节区间替换 + 前缀 sha256 断言。
- `policy.ts`：阈值表 + 严格变小 + 超时（默认 300 ms，本机纯 CPU 足够）+ fail-open。

**验收**

- [ ] 压缩关闭时，`data` 请求体与改造前**逐字节相同**（有对照测试）。
- [ ] live zone 之外的字节 sha256 完全不变（properties 测试，参考 `tests/live_zone_arm_properties.rs`）。
- [ ] 任意压缩器抛错 → 请求正常成功，日志有 warn。
- [ ] `n > 1`、无 messages、非 JSON body → 一律跳过。

### P1 — JSON 统计压缩（主收益，60–95%）

**算法（移植 `smart_crusher/{analyzer,outliers,planning,orchestration,anchor_selector}.rs`）**

**前置门**（顺序不能变）：是合法 JSON 数组 → `length ≥ 5` → 估算 token **严格 > 200** → 过 `analyzeCrushability()`（见 §1.2）→ `length > 预算 K`（否则本来就不用压）。

1. **字段统计**：每个字段的出现率、唯一值基数（含 null 的 `str(v)` 口径）、数值的 min/max/mean/**样本**方差、字符串平均长度与 top-5 值。
2. **离群标记（必留）**：
   - 稀有字段：出现率 < 20% 的字段所在行（`outliers.rs:82-101`）；
   - 稀有状态值：字段基数 2–50、按频次降序取最小 K 使 top-K 覆盖 ≥ 80%、且 K ≤ 5 时，不在 top-K 的值所在行为离群（`outliers.rs:190-231`）；
   - 错误关键词：整行小写化后命中 **12 个**关键词 —— `error, exception, failed, failure, critical, fatal, crash, panic, abort, timeout, denied, rejected`（`error_keywords.rs`）。
3. **数值异常（必留）**：某数值字段 `|x − mean| > 2·σ` 的行（σ 是样本标准差 n−1）。
4. **变点（必留）**：窗口 5、值数 ≥ 10，`|mean(后5) − mean(前5)| > 2σ` 的下标，去重规则「与上一个变点相距 > 5」，保留 ±1 行。
5. **锚点（锚定首/中/尾）**：对象数组走 AnchorSelector —— 预算 `clamp(⌊maxKept × 0.25⌋, 3, 12)`（默认 3 槽），按前/中/后 `0.5 / 0.1 / 0.4` 分配；搜索类内容 `0.75 / 0.10 / 0.15`，日志类 `0.15 / 0.10 / 0.75`（`anchor_selector.rs:543-712`）。
   **纯量数组**才用 `first_fraction/last_fraction`：`k=15` 时 → 首 4 / 尾 2 / 中间 9（四舍六入五成双）。
6. **预算 K**：`adaptiveSizer.computeOptimalK()`
   - `n ≤ 8` → 全留；唯一项 ≤ 3 → 只留 `max(3, unique)`；
   - 否则按「唯一 bigram 累积覆盖率」画 Kneedle 拐点（偏离对角 < 0.05 视为无拐点）；
   - 无拐点 → `keepFraction = 0.3 + 0.7 × 多样性`；
   - `bias` 按力度取 1.5 / 1.0 / 0.7，`k = max(3, ⌊knee × bias⌋)`，再夹到 `maxKeptItems`（15）；
   - zlib 复核：若前 k 行的压缩率与全集偏差 > 0.15，`k += 20%`。
7. **去重**：内容哈希相同的行先折叠（保留下标最小的那条）。
8. **最终裁决 `prioritizeIndices`**（超预算时，顺序固定）：
   - 先全留「关键行」= 错误 ∪ 离群 ∪ 数值异常（**非协商**；关键行自己超预算时，结果允许超出 15 行——这是有意为之）；
   - 有余量补 first-3、last-2；
   - 再按升序补普通行；
   - 补位用**跨步抽样**（`step = ⌊候选数/(缺口+1)⌋`，外层错位起点）保证分散，而非取前 N。
9. **渲染**：
   - 保留行 = **原始对象、未修改、按下标升序**；
   - **对象数组**末尾追加哨兵对象 `{"_ccr_dropped":"<<ccr:{hash} {N}_rows_offloaded>>"}`；
   - **纯量数组**末尾追加字符串 `"… {N} more items <<ccr:{hash} {N}_items_offloaded>>"`；
   - 序列化用**紧凑**形式（`","` / `":"`，不转义非 ASCII），键序保持原样；
   - **不生成摘要、不加包装对象**。

**验收**

- [ ] 100 行含 3 行 error 的 JSON 数组：3 行 error 100% 保留。
- [ ] 数值字段里 1 个极端值（>2σ）保留。
- [ ] 全同质数组（100 行完全相同）→ 大面积压缩且不丢信息。
- [ ] 「每行都唯一且无信号」的实体列表（如用户名单）→ **不压缩**（`analyzeCrushability` 的 skip 分支）。
- [ ] 压缩后 `JSON.parse` 仍成功；对象数组用 `stripCcrSentinel` 过滤后仍是同构记录数组。
- [ ] 二次压缩不会把哨兵当数据行（哨兵检测生效）。
- [ ] 真实样本（GitHub issues、搜索结果、日志 JSONL）节省率 ≥ 55%；错误行保留率 100%。

### P2 — 行压缩：日志 / 搜索 / diff

> ⚠️ **先纠正一个直觉**：LogCompressor **不是**「把重复行折叠成 `(xN)`」。它是**行选择器**——挑出重要行原样保留，其余用一行省略说明带过。真正的 RLE（`... (repeated N times)`）在 Headroom 里属于另一条**无损**路径（`lossless_compaction.py`），本方案不移植。

**LogCompressor**（`log_compressor.rs`）

0. **短路**：输入 < 50 行 → 原样返回，不压。
1. 格式识别：pytest / npm / cargo / jest / make / generic（前 100 行按标记命中数定，平手为 generic）。
2. 逐行分级：ERROR / FAIL / WARN / INFO / DEBUG / TRACE / Unknown；标出栈帧行、汇总行。
3. 打分 = 级别基分（error/fail 1.0、warn 0.5、info/unknown 0.1、debug 0.05、trace 0.02）+ 栈帧 0.3 + 汇总 0.4，上限 1.0。
4. 选行：错误（首条 + 末条 + 按分，上限 10）、失败（同）、警告（去重后上限 5）、栈（最多 3 段，每段 ≤ 20 行）、**全部**汇总行；每条选中行带 ±3 行上下文；总量 `computeOptimalK(min_k = 10, max = 100)` 封顶。
5. 栈帧折叠：单段栈超 20 行时，保留消息/链头 + 前 3 帧 + 最多 5 个非运行时帧，丢弃段替换为 `      [... {N} frames collapsed]`（**6 个前导空格**）。
6. 警告去重**保守**：第一个 `:` 或 `=` 之前逐字保留，只把之后的尾部归一化（`\d+`→`N`、`0x…`→`ADDR`、`/…/`→`/PATH/`）。避免不同地址的两条崩溃被合成一条。
7. 输出：保留行**逐字、按原顺序**，末尾一行省略说明
   `[1200 lines omitted: 7 ERROR, 3 WARN]`（可选后缀 `; omitted: a.py::t1, b.py::t2, +2 more`，最多 5 个）。
8. 压缩比 < 0.5 且输入 ≥ 50 行 → 写 CCR，标记 `[N lines compressed to M{": …" 描述}. Retrieve more: hash=KEY]`。

**SearchCompressor**（`search_compressor.rs`）

1. 解析 `路径:行号:内容`（三级解析：冒号 / 破折号 / 宽松；必须处理 Windows 盘符 `C:\` 与含 `-` 的文件名）。
2. 按文件分组（`BTreeMap`，输出按**文件名字母序**而非得分序）。
3. 打分：上下文词 +0.3/个、错误 0.5 / 警告 0.4 / 重要 0.3、配置关键词 +0.4，上限 1.0。
4. 文件按总分截断（默认 15）；全局 `computeOptimalK(min_k = 5, max = 30)`。
5. 每文件保首/末，按分补位（每文件 ≤ 5），再按行号还原顺序。
6. 输出 `file:line:content` + `[... and N more matches in file]`。

> ⚠️ **这一步不是无损的**：每行会 `trim()`、空行丢弃、rg 的 `-` 上下文行被重写成 `:`、解析失败的行会**被静默丢弃**。因此 `search` 类型必须能整类关闭，且要在验收里明确「解析失败行数」计数不得为 0 而无人知晓。

**DiffCompressor**（`diff_compressor.rs`）

1. 输入 < 50 行 → 原样返回；无 `diff --git` 段 → 原样返回。
2. 文件数 > 20 → 按 `增删行数` 降序保留 20。
3. 每文件 hunk：首个 + 末个 + 中间得分最高，合计 ≤ 10，再按 hunk 头的起始行号排序。
4. hunk 内上下文裁剪：所有 `+`/`-` 行必须留，两侧各留 2 行上下文；`\` 开头的元数据行必留。
5. 输出 + 页脚 `[3 files changed, +42 -17 lines, 5 hunks omitted]`。

> ⚠️ **不要把这个结果当补丁用**：hunk 头 `@@ -a,b +c,d @@` 里的范围**不会**随裁剪重算，文件模式被硬写成 `100644`（丢掉 `100755`/符号链接），二进制行被压成 `Binary files differ`。它是**可读摘要**，不是可应用的 patch。对本项目而言这条很重要：若模型据此改文件会改错。因此 diff 类型默认**只对「读输出解释」的场景开**，且必须在实验记录里写明这一限制。

**验收**

- [ ] 10k 行 pytest 输出 → ≤ 100 行，全部 `FAILED`/`ERROR` 行与 `=== short test summary info ===` 汇总在场。
- [ ] 同一路径不同地址的两条崩溃不合并。
- [ ] grep 输出按文件折叠后，每个文件至少 1 条命中，总数 ≤ 30；解析失败行数被记录。
- [ ] diff 压缩后仍能被 `git apply --check` 识别为「不可应用」而不是「可应用但错误」——即我们**不**声称它是补丁。

### P3 — CCR 可逆（让有损真正安全）

- 存储：`~/.modelport/ccr/`，文件名 = 内容哈希，内容含原文 + 元数据（时间、类型、tokens）；TTL 30 min + 总量 64 MiB 的 LRU 淘汰；启动扫描孤儿文件。
- 标记：与 Headroom 格式**逐字一致**，但注意**哈希算法与长度随压缩器不同**：

| 来源 | 标记 | 哈希 |
|---|---|---|
| JSON 对象数组 | `{"_ccr_dropped":"<<ccr:{12hex} {N}_rows_offloaded>>"}` | sha256[:12] |
| JSON 纯量数组 | `"… {N} more items <<ccr:{12hex} {N}_items_offloaded>>"` | sha256[:12] |
| 日志 | `[N lines compressed to M{": …"}. Retrieve more: hash={24hex}]` | md5[:24] |
| 搜索 | `[N matches compressed to M. Retrieve more: hash={24hex}]` | md5[:24] |
| diff | `[N lines compressed to M. Retrieve full diff: hash={24hex}]` | md5[:24] |

  > 不要统一成一种：Headroom 里就是两套，混用会让「日后对照/复用取回工具」失效。实现上让每个压缩器自带 `markerFor(hash, ctx)`。

- 取回，两条路，**默认只开第一条**：
  1. **管理 API**：`GET /v1/management/compression/retrieve?hash=...`（走现有 `managementAuth`）。零侵入，人/agent 都能用。
  2. **工具注入**（`injectRetrievalTool: true` 才开）：往 `tools` 里加 `modelport_retrieve`，并拦截模型对它的调用、回填原文、续跑一轮。风险见 §6.2。

**验收**

- [ ] 标记里的 hash 能取回**逐字节相同**的原文。
- [ ] 压缩 100 次后 store 不超上限；重启后旧条目按 TTL 过期。
- [ ] store 写失败 → 该块不压缩（绝不留下指向空气的标记），参考 `read_lifecycle.py:491-497`。

### P4 — 缓存经济性与跨轮去重

- `volatile` 只读检测（ISO-8601 / UUIDv4 / `request_id|trace_id|session_id|correlation_id` 键），命中只 warn + 记日志，**不修改**。
- 成本门：当供应商支持前缀缓存（aggregate 走 OpenAI/DeepSeek/Anthropic wire）时，用 `net_mutation_gain > 0` 兜底判断是否值得动。live zone 规则已让它恒为真，这一层是防御性复核 + 可观测。
- 跨轮去重（可选，默认关）：`[↑{N}L same as msg {K}: {anchor}]`，仅折叠 **≥3 行且 ≥40 字符**的逐字重复区间，保留最早副本，指针只用绝对块序号。
- `read_lifecycle`（可选，默认关）：同一路径被后续 Edit/Write 修改过的旧 Read → 换成「已过期，请重读」标记 + CCR。测得的收益面很大，但它**必然改动历史字节**，与硬不变量 1 冲突——只能在「供应商无前缀缓存」（如 opencode）时开。

**验收**

- [ ] volatile 命中时请求体不变（只增日志）。
- [ ] 跨轮去重满足前缀单调性：`dedup(blocks[:k]) == dedup(full)[:k]`。

### P5 — 输出侧 verbosity（省 completion token）

- 在**最后一条** `system`（或 `developer`）消息 content 末尾追加定长块；无 system 则在最前面插一条。
- 哨兵 `<modelport_output_shaping>`，重复应用时整块替换 → 字节稳定，不破缓存。
- 三档文案**逐字固定**（改文案 = 破缓存，必须走版本号）。

**验收**

- [ ] 同一 level 连续应用 3 次，消息体字节不变。
- [ ] 追加位置在所有已有 system 内容之后（不打断已有缓存断点）。
- [ ] 关闭时请求体逐字节不变。

---

## 5. 上线顺序与开关

| 阶段 | 默认状态 | 建议暴露方式 |
|---|---|---|
| P0 | 内部编译、`enabled: false` | 不暴露 UI |
| P1 | 白名单灰度（先 `aggregate` 里非缓存敏感的家） | 设置页开关 + 每供应商开关 |
| P2 | 同 P1 | 类型子开关 |
| P3 | `ccr.enabled: true`（只开管理 API） | 高级设置 |
| P4 | 关 | 实验性，带警告文案 |
| P5 | 关 | 独立开关 + 档位选择 |

观测口径：请求日志 `compression` 字段 + `X-ModelPort-Compression-*` 响应头 + Dashboard 一张「Token 节约」卡（本期只做数字，不做 Headroom 式的置信区间）。

---

## 6. 风险与取舍

### 6.1 打掉上游前缀缓存（最高风险）

- 缓解：live zone 规则 + 区间外逐字节拷贝 + sha256 前缀断言测试 + `net_mutation_gain` 复核。
- 残余风险：某些聚合供应商的缓存实现未知（不遵循 OpenAI 语义）。**对策**：`providerAllowlist` 默认只放已知安全的几家，其余手动开。

### 6.2 工具注入改变请求形状

注入 `modelport_retrieve` 会给**每一个**请求加一个工具定义，可能影响：模型是否愿意调工具、`tool_choice` 语义、托管工具层与客户端解析（本项目 `toolCalling` 已有一套协议适配）。所以**默认不注入**，先用管理 API 取回。这是与 Headroom 的**有意分歧**（它默认注入），理由是本项目要兼容的客户端与供应商矩阵比它宽得多。

### 6.3 有损即不可逆（未开 CCR 时）

- 缓解：错误/离群/数值异常/首尾必留；`minSavingsRatio` 门槛；标记里带 hash 即使暂不提供取回，也保留了事后排障路径。

### 6.3.1 两类「比想象中更有损」的压缩器

- **Search**：`trim()` + 丢空行 + 把 rg 的 `-` 上下文行重写成 `:` + **静默丢弃解析失败的行**。必须在统计里暴露 `linesUnparsed`，否则用户永远不知道少了什么。
- **Diff**：hunk 头范围不重算、文件模式硬写成 `100644`、二进制行压成 `Binary files differ`。**产出是摘要不是补丁**。若模型据此改文件会改错——这在一个「给编码 agent 用」的代理里是真实事故面，所以 diff 类型默认不随总开关一起打开，需要单独显式启用。

### 6.4 与 contextManagement 叠加

两者都改 messages，顺序敏感：**先压缩、再裁剪**（先省内容，再决定要不要真的丢消息）。需要在配置里明确，并加一条集成测试。

### 6.5 估算误差

`chars/4` 在机器生成的紧凑 JSON 上会严重低估（Headroom 专门踩过：`content_router.py:161-172`）。必须用分档估算，且**所有收益数字都标注为估算**，与现有 `usage.source: 'estimated'` 口径一致，绝不写进响应体的真实 `usage`。

### 6.6 许可证与归属

新增 `NOTICE` 段落 + 每个移植文件头：

```
Portions derived from headroom (https://github.com/headroomlabs-ai/headroom),
Copyright headroomlabs-ai, Apache License 2.0.
```

---

## 7. 工作量估算

| 阶段 | 代码 | 测试 | 备注 |
|---|---:|---:|---|
| P0 骨架/检测/live zone/门禁 | ~900 | ~300 | 最需要打磨的是 live zone 与字节替换 |
| P1 SmartCrusher | ~800 | ~350 | 主收益 |
| P2 日志/搜索/diff | ~900 | ~350 | 三个独立压缩器，可并行 |
| P3 CCR + 管理 API | ~450 | ~200 | 存储层注意 Windows 路径与清理 |
| P4 经济性/去重 | ~500 | ~150 | 可选 |
| P5 verbosity | ~120 | ~60 | 最小 |
| UI + i18n | ~400 | — | 设置页一块 + 两个语言 |
| **合计** | **~4.1k** | **~1.4k** | 不含 CodeCompressor / ML |

关键路径：P0 → P1。**P1 落地即可交付 60–95% 的 JSON 收益**，建议作为第一个可发布里程碑。

---

## 8. 明确不做

- 不做 ML 文本压缩（Kompress / ONNX），不做 tree-sitter AST 代码压缩，不做 HTML 抽取（trafilatura）。
- **不做 diff 压缩**（评审决策 7）：产出不可当作补丁，风险高于收益。
- **不做无损表格编码（lossless compaction）**（评审决策 3）。
- 不做「跨 agent 共享记忆」「失败学习 `headroom learn`」「MCP server」——与本项目定位无关。
- 不做 `headroom wrap` 式的客户端改写（本应用本身就在客户端下游）。
- 不做整段历史重写来"多省一点"——那会打掉缓存，净亏。

> 被删掉的 diff 压缩原本还有个隐患：它的 hunk 头 `@@` 范围不随裁剪重算、文件模式硬写成 `100644`，
> 所以产出「看起来像补丁但不可应用」。在给编码 agent 用的代理里这种情况会让模型改错文件，
> 因此不做它本身就是收益（详见 §6.3.1）。

---

## 附：评审决策（已定稿 2026-10-29）

| # | 决策点 | 结论 | 对方案的影响 |
|---|---|---|---|
| 1 | 默认开关 | **接受 `enabled: false`** | 灰度上线，按供应商白名单手动开 |
| 2 | P3 取回方式 | **只做管理 API** | 不注入 `modelport_retrieve`，请求形状零变化；§6.2 风险消除 |
| 3 | P2.5 无损表格编码 | **不做** | 已从 §8 移除候选项 |
| 4 | UI 粒度 | **只做总开关 + 力度档位** | 不做「每供应商 × 每内容类型」矩阵；配置只留 `enabled` + `aggressiveness` |
| 5 | 压缩与裁剪先后 | **先压缩、再裁剪** | 固定顺序，用集成测试锁死（§6.4） |
| 6 | P2.5 二次评估 | 等 P1/P2 跑稳 | — |
| 7 | diff 类型独立开关 | **否** | **diff 压缩整体不做**：P2 只做日志 + 搜索 |

**最终范围**：P0（骨架/安全）→ P1（JSON）→ P2（日志 + 搜索）→ P3（CCR + 管理 API 取回）→ P4（可选）→ P5（verbosity）。
