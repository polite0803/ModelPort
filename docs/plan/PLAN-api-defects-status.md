# API 缺陷修复执行状态（2026-10-27）

对应计划：`docs/plan/PLAN-api-defects.md`（D1–D4 全部按推荐值批准）

## 门禁读数（剩余两项收尾实测）

| 门 | 读数 |
|---|---|
| `npm run build` | 通过（渲染层两段 `✓ built`，含 `check:source-artifacts`） |
| `npx tsc --noEmit -p tsconfig.node.json` | 0 错误（0 行输出） |
| `npx tsc --noEmit -p tsconfig.json` | 仅 2 条既有 TS6305 |
| `node --test` 全量 | 237 条：235 通过，2 失败 |
| 2 条失败的性质 | `restore-tool-config` 的 `ERR_UNSUPPORTED_ESM_URL_SCHEME`、`versioned ModelPort testing skills` 的 CRLF 正则；AGENTS.md 已记录的 Windows 环境问题 |

## 本批新增（P2-4 / P4-1）

| 编号 | 证据 | 落点 | 验收 |
|---|---|---|---|
| P2-4 | 全仓 grep：8 个内置适配器的请求体没有任何 token 上限字段，响应里也没有截断信号（`finishReason`/`stop_reason` 无上游来源） | `parameterPolicy.ts` 把 `max_tokens` 加入内置供应商拒绝清单 | 内置供应商带 `max_tokens` → 400 `unsupported_parameter`；自定义供应商仍透传 |
| P4-1 | `zai.ts:444` 本就发送完整 `messages`（只有 qwen-ai 丢轮次）；`qwen-ai.ts:259-281` 只保留 system 与最后一条 user | 新增 `utils/transcript.ts`；`qwen-ai.ts` 用全文转录替换单轮提取 | 转录保留全部 user/assistant/tool 轮次，工具调用与结果按 `tool_call_id` 对齐 |

`finish_reason:"length"` 因此**不会实现**：没有任何内置上游提供截断信号，伪造 `length` 会比伪造 `stop` 更糟；
改为在契约上拒绝 `max_tokens`，并把这一点写进 AGENTS.md 的 Public API Contract。

## 全量已完成清单

P1-1 ~ P1-5、P2-1 ~ P2-3、P2-5、P2-6、P3-1 ~ P3-5、P4-1 ~ P4-4、P5-1 ~ P5-5 全部落地。

关键落点：`proxy/authPolicy.ts`、`proxy/errorMapping.ts`、`proxy/parameterPolicy.ts`、
`proxy/utils/contentText.ts`、`proxy/utils/transcript.ts`、`proxy/utils/textCompletion.ts`、
`toolCalling/streamPlanWrapper.ts`、`ToolStreamParser.ts`、`routes/chat.ts`、`routes/completions.ts`、
`routes/management/{proxy,sessions}.ts`、`forwarder.ts`、`server.ts`、`status.ts`、`store/config.ts` 与 8 个适配器。

新增用例：`tests/api/{auth-policy,response-contract,parameter-policy,completions-shape}.test.ts`、
`tests/tool-calling/{stream-plan-wrapper,history-and-choice}.test.ts`、`tests/providers/transcript.test.ts`。
按裁定更新旧期望 3 处（parser 的文本释放与 id 规则、provider-profiles 与 mimo-query 的历史格式）。

> **P3 一族已于 2026-11-03 整条退役。** 上面这些落点（`toolCalling/streamPlanWrapper.ts`、
> `ToolStreamParser.ts`、`tests/tool-calling/*`、provider-profiles 的历史格式）当时修的是**托管工具层**
> ——把工具描述写进 system、再把回复文本解析回 `tool_calls`。裁定「本网关不注入任何提示词」之后，
> 该子系统连同其配置、面板与管理端点一并删除，工具改为原生透传，「这家没有工具能力」回到路由层
> （`needsTools → hardFilterFailure → 503 details.missing:['tools']`）。因此 P3-1 ~ P3-4 的
> 「现状证据」与「改法」现在都不成立，保留只为记录当时的判据来源；仍活着的是
> `proxy/utils/toolViolationTap.ts`（只观察原生 `tool_calls`，不写字）与 P3-5 里非工具层的部分。
> 出处见 `docs/AGENTS-full.md` §Gateway-Authored Text 的 Retired 台账与 §Tool Calling。

## 仍未做

无。流式强制调用违反已改为在终结 chunk 上增加 `x_modelport_tool_violation:"required"` 字段
（`utils/toolViolationTap.ts`），非流式仍是 `X-ModelPort-Tool-Violation` 头。
