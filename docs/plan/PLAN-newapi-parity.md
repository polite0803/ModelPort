# 与 new-api 的差异对照与修正 PLAN

- 状态：已实施（2026-11-02；A/B/C 全量落地）
- 对照对象：`QuantumNous/new-api`（main，2026-11-02 读取）
- 范围：网关入向 `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/completions` 的路由、协议、消息处理与错误语义
- 不在本批：计费/用户体系/管理后台/插件市场；new-api 的 Go 运行时整体移植

## 0. 对照结论（只列会直接造成客户端可见错误的部分）

### 0.1 路由与换家

| 维度 | new-api | 本仓现状 | 后果 |
|---|---|---|---|
| 重试状态码 | `1xx`、`3xx`、`401-407`、`409-499`、`500-503`、`505-523`、`525-599`；`504/524` 永久不重试（`setting/operation_setting/status_code_ranges.go:16-34`） | 只有 `429`、`5xx`、无状态码（`failover.ts:149-153`） | 401/403/404/408/409 在第一个候选就终止；多账号/多 Key 池形同单点 |
| 换家判据 | 状态码范围 + `skipRetry` 标志 + 渠道错误必换 + 固定渠道/会话粘性抑制（`service/relay_error.go:20-58`） | 状态码 + 五类文案白名单（工具超限、缺 reasoning、目录不认、强制 tool_choice、聚合空 400） | 白名单之外的上游 4xx 无法换家；白名单本身还在增长 |
| 渠道失败记账 | 只有 401 触发自动禁用；其余错误只记日志（`service/relay_error.go:66-79`） | `chat.ts:679-681` 对任何 `>=400` 调 `markAccountFailed` | 客户端自己的 400/404 把健康账号打进失败池，后续请求被无谓绕开 |
| 重试请求体 | 入向 body 存成 `BodyStorage`，每次重试重放（`controller/relay.go:188-211`） | 每次尝试重建 body，未保存原始字节 | 本仓暂未发现因此产生的错误；列为观察项，不在 A 批改 |
| 请求 ID | 错误 body 的 message 末尾统一带 request id（`controller/relay.go:78-80`） | 只有 `X-Request-Id` 头 | 客户端只把 body 贴给用户时，现场无法回查 |

### 0.2 协议与流

| 维度 | new-api | 本仓现状 | 后果 |
|---|---|---|---|
| 错误对象 | `NewAPIError` 保留 `errorType/errorCode/StatusCode/RelayError`，可按 OpenAI/Claude/Gemini 重新出信封（`relaykit/types/error.go:78-260`） | `ForwardResult` 只有 `status + error:string`（`types.ts:263-280`），chat 重建信封时 `param/code` 恒为 null（`chat.ts:697-704`） | 上游的结构化错误全部丢失；客户端无法按 `code` 做处置 |
| 上游状态码 | 原样保留，另支持按渠道配置重映射（`service/error.go:112-170`） | 401/403 一律改成 401（`errorMapping.ts:23-25`） | 403（权限/地区/套餐）被误报成 401（凭据），客户端会去轮换自己的 Key |
| 上游错误体 | 读完整 body，解析 OpenAI/Claude/Gemini 形状并保留 code/type（`service/error.go:87-135`） | 只抽一句话，body 丢弃（`upstreamErrorBody.ts:85-105`） | 现场只剩一句人话，无法机读 |
| 写头后的流错误 | `writeRelayStreamError` 统一收尾：OpenAI 出错帧 + `[DONE]`，Claude 出错事件（`controller/relay.go:245-263`） | 默认转换器把错误帧当空帧丢弃（`stream.ts:459-470`）；直通路径只透传、不改日志 | 客户端看到截断答案而非错误；日志仍记成功 |
| 流状态 | `StreamStatus` 记结束原因、是否要求终止事件、错误计数、协议结果（`relay/common/stream_status.go:54-180`） | 只有 `readStreamOutcome` 看 finish/[DONE]（`utils/streamOutcome.ts`） | 分不清「答完」「被掐断」「上游报错」 |
| 心跳与空闲超时 | SSE 头后按间隔发 `: PING`；每帧续期，长回答不被固定总时长砍断（`relay/helper/stream_scanner.go:27-46,115-180,251-264`） | 立即 flush 头，但不发心跳；axios 超时按 socket 静默 | 长 prefill/长思考期间客户端可能先超时；排障时无法区分静默与假死 |

### 0.3 消息处理与协议转换

| 维度 | new-api | 本仓现状 | 后果 |
|---|---|---|---|
| Claude→OpenAI | 独立转换库覆盖 thinking、cache、tool_result、图片、stop_reason、usage 语义（`relay/channel/claude/relay-claude.go`、`relaykit/relayconvert`） | `shared/anthropicWire.ts` 丢弃 `thinking/redacted_thinking`（`:186-197`），`tool_result` 只取文本、丢图片/文件与 `is_error`（`:324-330`） | Claude Code 的工具结果带图时，模型看到的内容缺一块；错误结果无法区分 |
| OpenAI→Claude | 转换 usage 的 cache 字段、message_delta 补丁、工具计费（`relay/channel/claude/relay-claude.go:55-70,100-160`） | `adapters/anthropic.ts` 的 usage 不含 cache token（`:306-315`） | 客户端算出的费用/缓存命中率偏低 |
| Responses 入向 | reasoning item、input_file 等有明确转换或明确拒绝（`service/response_converter.go`） | `reasoning` item 直接丢弃（`shared/responsesInbound.ts:111-113`） | 多轮推理上下文断裂 |
| 转换损耗可见 | `ConversionDiagnostics` 按请求记录丢失项（`relay/common/conversion_diagnostics.go`） | 部分路径有 `X-ModelPort-Anthropic-Dropped` + 日志 | 已有基础，但未覆盖全部转换路径 |
| 参数处理 | 请求深拷贝 + 模型映射 + reasoning 意图解析 + `RemoveDisabledFields` + 参数覆盖（`relay/compatible_handler.go:31-130`） | 白名单搬运，未列字段静默丢弃（`forwarder.ts:1183-1258`）；聚合条目另有 `dropParams` | 客户端发的 `logprobs/prediction/modalities` 等无声消失 |

## 1. 修正清单

### A 批：错误保真、重试口径、流错误收尾（建议先做）

| 编号 | 改法 | 主要落点 | 验收 | 代价 / 回退 |
|---|---|---|---|---|
| A1 | `ForwardResult` 增加结构化错误：`errorDetails {message,type,param,code,metadata}`、`errorBody`（截断原文）、`retryAfter`；所有上游错误路径填充（axios、responses、forwardToUrl、账号渠道、Anthropic 适配器） | `proxy/types.ts`、`proxy/upstreamErrorBody.ts`、`proxy/forwarder.ts`、`proxy/adapters/anthropic.ts` | 单测：OpenAI 形状、Claude 形状、顶层 `message`、非 JSON 四类输入都能取到 `code/type/param`；负控：删掉解析分支即红 | 纯增量字段；回退删字段即可 |
| A2 | 统一错误渲染：保留上游状态码；上游给了标准 `type/code/param` 就透传；没给才按状态码兜底。403 不再改写成 401。OpenAI/Anthropic/Responses 三个信封共用同一决策函数 | `proxy/errorMapping.ts`、`routes/chat.ts`、`routes/messages.ts`、`routes/responses.ts`、`routes/completions.ts` | 单测：403 进来是 403 且 `type=permission_error`（或上游原 type）；上游 `code/param` 原样出现；负控：改回 401 即红 | 破坏 AGENTS 现行「401/403 都是 authentication_error」的措辞，需同批改文档；回退还原映射 |
| A3 | 换家/轮换状态码对齐 new-api：`401-407`、`409-499`、`5xx`、无状态码可换；`400` 仍终止（能力不匹配/聚合空 400 例外）；`408/504/524` 不重试同一目标但可换下一家 | `proxy/failover.ts`、`proxy/forwarder.ts`、`routes/chat.ts` | 纯函数单测覆盖每个区间与例外；负控：把 404 改回不可换家即红 | 多账号池会把原本秒失败的请求多试几家；预算仍受 90s 墙钟与分级上限约束 |
| A4 | 账号失败只记渠道故障：401/403/408/429/5xx/网络错误才 `markAccountFailed`；客户端 400/404/409/422 不记账 | `routes/chat.ts`、`proxy/failover.ts` | 单测/源码钉点：400 不调用 markAccountFailed；负控：恢复无条件调用即红 | 健康账号不再被客户端错误误伤 |
| A5 | 流错误可见：默认转换器识别 `data.error` 帧并抛出带 status/code 的错误，由 chat 写 `error` 帧 + 单个 `[DONE]`；直通路径扫描错误帧并在缺 `[DONE]` 时补一个，同时把请求日志翻成 error | `proxy/stream.ts`、`routes/chat.ts` | 单测：错误帧不再被吞、`[DONE]` 恰好 1 个、日志 status=error；负控：恢复空帧过滤即红 | 客户端会看到明确的错误帧；回退删识别分支 |
| A6 | `/v1/completions` 接入同一错误映射与请求日志；`/v1/messages`、`/v1/responses` 的错误 body 保留 code/param | `routes/completions.ts`、`routes/messages.ts`、`routes/responses.ts` | 三条路由各一条错误用例；completions 失败也产生日志行 | 无行为风险 |
| A7 | 429/503 透传上游 `Retry-After`；错误 body 的 message 末尾带 `request_id`（与 `X-Request-Id` 同值） | `proxy/errorMapping.ts`、各路由 | 单测：头与 body 同时出现；负控：删掉即红 | 文案多一段；客户端若严格匹配 message 会受影响，属可接受 |

### B 批：流首帧探测、心跳、空闲超时（建议与 A 同批）

| 编号 | 改法 | 主要落点 | 验收 | 代价 / 回退 |
|---|---|---|---|---|
| B1 | 对 axios/聚合/自定义/Anthropic 流增加有界首帧探测：首块在极短时间内到达且是错误帧 → 判失败并换家；没数据则照常 flush 头，不额外等待 | `forwarder.ts`、`failover.ts`（复用 `probeSseHead`） | 单测：200+错误帧参与换家；正常首帧无额外延迟；负控：去掉探测即红 | 首帧错误可换家；正常流不增加等待 |
| B2 | 流式响应统一发 `: PING` 心跳（间隔取配置，默认 15s），OpenAI/Anthropic/Responses 共用；写失败即销毁上游 | `routes/chat.ts`、`routes/messages.ts`、`routes/responses.ts`、`server.ts` | 单测：10s 无数据仍收到 ping；客户端断开后上游被销毁 | 每个流多一个定时器；回退关配置 |
| B3 | 对 axios 流加块间静默看门狗（与账号渠道同一判据 `createIdleWatchdog`） | `forwarder.ts`、`failover.ts` | 单测：首块后停摆到点报错并销毁；正常长回答不误杀 | 与账号渠道语义一致 |

### C 批：协议与消息转换（体量最大，单独排期）

| 编号 | 改法 | 验收 |
|---|---|---|
| C1 | Anthropic 入向：`tool_result` 的图片/文件块保留为后续 user 内容；`is_error` 用明确前缀保留；`thinking` 映射为 assistant 的 `reasoning_content` | 工具结果带图/带错误的回放用例 |
| C2 | Anthropic 出向：usage 补 cache read/creation token；流式 `message_delta` 的 usage 补齐 | 上游 usage 带 cache 字段时客户端能看到 |
| C3 | Responses 入向：`reasoning` item → `reasoning_content`；不支持的附件类型显式 400 + `param` | 多轮 reasoning 回放用例 |
| C4 | 参数透传：补齐 `logprobs/top_logprobs/prediction/modalities/audio/service_tier/reasoning`，按 provider 能力决定转发或显式记录丢弃 | 参数矩阵用例；丢弃项出现在响应头与日志 |
| C5 | 工具参数修复失败时保留原文并在响应头标注，不再退化成 `{}` | 坏 JSON 回放用例 |

## 2. 已明确不做

1. 不移植 new-api 的计费、用户、分组、渠道管理、插件体系。
2. 不为了「多试几家」取消 90s 墙钟预算与账号冷却；new-api 的无限重试不适用于本仓的积分账号。
3. 不把上游原文直接全量交给客户端：保留结构，但 URL/凭据类内容仍需脱敏。
4. 不在本批改请求体缓存重放（A 批无证据表明它造成当前错误）。

## 3. 门禁

每批只跑该批定向测试；全部批次完成后跑一次：

```bash
npm run build
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
node --test "tests/**/*.test.ts" "tests/**/*.test.mjs" "tests/**/*.test.js"
```

A 批必须新增/更新的测试：

- `tests/proxy/error-fidelity.test.ts`：四类上游错误体解析与三协议信封
- `tests/proxy/failover-status-policy.test.ts`：新区间与例外
- `tests/proxy/stream-error-frame.test.ts`：转换路径与直通路径的错误帧、`[DONE]` 计数
- `tests/api/response-contract.test.ts`：403 不再变 401、request id、Retry-After
- 现有 `tests/proxy/failover.test.ts` 中「404 不可换家」的旧断言按新裁定更新（不做定点剔除，按同一判据重写）

## 4. 实施状态（2026-11-02）

- A1/A2/A6/A7：`ForwardResult` 携带 `errorDetails/errorBody/retryAfter`；四类上游错误体（OpenAI / Claude / 顶层 message / 纯文本）都解析；三协议共用 `mapForwardFailure`；403 不再改写成 401；错误 message 末尾带 `request_id`；429/503 透传 `Retry-After`；`/v1/completions` 失败也写请求日志。
- A3/A4：换家状态码对齐 new-api；`isSameTargetRetryableStatus` 把「换家」与「原地重试」分开；客户端 400/404/422 不再记账号失败。
- A5：默认转换器识别 `data.error` 帧并抛结构化错误；直通路径扫描错误帧、翻日志、缺 `[DONE]` 时补一个。
- B1/B2/B3：axios 流在写头前做 200ms 首帧探测；所有流式入口发 `: PING`（默认 15s）；axios 流接入块间静默看门狗。
- C1/C2/C3/C4：Anthropic 工具结果图片/`is_error`、历史 `thinking`、cache usage；Responses `reasoning`；新增可选参数透传（内置供应商仍剥离）。
- C5 的落地口径改为「不把非法 JSON 回传上游，但降级不再静默」：`tool_calls.arguments` 仍归成合法 JSON（`{}` 或 `{__raw_arguments}`），响应头写 `X-ModelPort-Tool-Args-Repaired/Discarded`，控制台保留计数。直接保留原文会重新引入「严格上游整段会话 400」那一类故障。
- 门禁：`npm run build`、两个 `tsc --noEmit`、全量 `node --test` 均通过（见本轮回报的读数）。

## 5. 两条拍板（2026-11-03）

**速度 vs 省钱 → 省钱。** agent 路由（`codex` 及其池子）不加首字延迟门槛、不排除慢渠道，
`prefer` 与成本权重照旧。实测代价要说在前面：同一段会话里 qodercn 首字节 1.2s / 整轮 4.3s，
raccoon 2.0s / 6.5s，loomy 4.8s / 14.9s；而粘性（`69a0686`）生效后，第一轮选中谁，整段会话
就都跟着谁的延迟走 —— 这是「稳定」换「便宜」的对价，不是回归。网关自己每轮的税与池子无关，
实测中位 655ms（p90 1.05s），占客户端等到首字的 3.1s 的两成。

**流已出内容后失败 → 已发内容 + 错误帧交回客户端，绝不整轮重跑。** 现码已经是这个语义，
本轮只是把它钉住并纠正我上一轮的错判：

- 换家只发生在**首帧之前**：`forwarder.ts::firstStreamEvent` + `probeSseHead` 判定错误才
  `continue` 到下一家；一旦头已提交给客户端，尝试就定局。
- 出内容后中止（块间静默看门狗 `forwarder.ts:1045`）走 `routes/chat.ts:1069-1076`：
  已转发的正文保留，追加 `buildStreamErrorFrame(...)` 再补唯一那个 `[DONE]`；
  Responses 侧对应 `response.failed` 且不再补 `completed`。
- 我上一轮说「53.7s / 78.5s 那两轮是流断掉后在别家重跑了一遍」——**按尝试记录核对后不成立**：
  那两轮的 `att=3` / `att=2` 全是内容之前的 502（每次 0.9–1.8s，`outcome=failover`），
  赢的那家 `endReason=done`、`truncated=false`、`bytesOut` 651KB / 140KB，
  即长生成本身，不是重跑。尾巴长的真原因是输出体量与所选渠道，不是换家语义。
