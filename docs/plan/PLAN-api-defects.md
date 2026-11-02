# 对外 API 缺陷修复 PLAN（两轮核查合并）

- 状态：待批准（按编号拍板后执行）
- 基线：main @ 59f03ab
- 范围：`/v1/*` 的鉴权、契约、失败语义、工具调用；`/v0/management/*` 的可达性与校验
- 不在本批：原生 function calling 透传、`/v1/responses` 路由、账号与会话粘性重构（单列观察项，不在本计划内）

## 0. 全局约束

1. 门禁全量只跑一次（P6）：`npm run build`、`npx tsc --noEmit -p tsconfig.node.json`、`npx tsc --noEmit -p tsconfig.json`、`node --test "tests/**/*.test.ts" "tests/**/*.test.mjs" "tests/**/*.test.js"`。每阶段只跑该阶段定向测试。
2. tsc 口径：`tsconfig.node.json` 当前 0 错误，必须保持 0；`tsconfig.json` 只允许既有的 2 条 TS6305。
3. 每条行为改动必须配一个能红的负控：把被测分支改回旧行为，该条测试必须红；不得写恒真断言。
4. 能力不靠「默认关闭」交付：凡是本计划里声称修好的能力，默认配置下必须可用。
5. 改动完成后在 `AGENTS.md` 的 API 小节写明当前真实边界（支持什么、显式拒绝什么）。

## P1 安全默认值（对外 API 的可达面）

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
|---|---|---|---|---|
| P1-1 | 鉴权条件是 `enableApiKey && apiKeys.length>0`，任一项为假即放行（`src/main/proxy/server.ts:78`）；默认两项都为空（`src/main/store/types.ts:741-742`） | 改为 fail-closed：只要 `/v1/*` 未配置任何密钥，且监听地址不是回环，则拒绝启动；监听为回环时允许无密钥但日志显式告警 | 新增 `tests/api/auth-matrix.test.ts`：无密钥+非回环 → `start()` 返回 false；无密钥+回环 → 200；有密钥+错密钥 → 401；负控：把条件改回 `&&` 该测试红 | 老用户升级后若监听 0.0.0.0 会被拦；回退只需还原条件。发布说明必须写明 |
| P1-2 | 密钥可比对可走 query（`server.ts:82`），比较用 `===`（`:97`） | 只接受 `Authorization: Bearer` 与 `X-API-Key`；比较改为 sha256 + `timingSafeEqual`；401 响应保持现有 JSON 形状 | 测试断言 `?api_key=` 返回 401；`X-API-Key` 与 Bearer 等价；负控：把比较换回 `===` 后 timing 断言不适用，改为断言实现引用 `timingSafeEqual`（源码门） | 依赖 query 传参的脚本会断，属于预期收口 |
| P1-3 | 所有响应 `Access-Control-Allow-Origin: *`，预检在鉴权前返回 204，且允许头里没有 `X-API-Key`（`server.ts:42-50`） | 允许头补齐 `X-API-Key`；`*` 仅在「无密钥且监听回环」时下发，其余按请求 Origin 回显回环来源；预检不再跳过鉴权判定（预检只回 CORS 头） | 新增 3 条用例：预检带 `X-API-Key` 通过；外部 Origin 拿不到 `*`；负控：允许头去掉 `X-API-Key` 时预检用例红 | 浏览器端本地调试无变化 |
| P1-4 | `start(port, host)` 缺 host 时回落到 `status.ts:26` 的 `0.0.0.0`（`server.ts:282`）；管理接口把请求体 host 原样传入（`routes/management/proxy.ts:70-74,126-130`） | 状态管理器默认值改 `127.0.0.1`；管理接口校验 host ∈ {`127.0.0.1`,`::1`}，其他值返回 400 `invalid_host`；`0.0.0.0` 只允许由配置文件显式开启 | 测试：`POST /v0/management/proxy/start` 带 `host:"0.0.0.0"` → 400；不带 host → 监听 127.0.0.1（读 `proxyStatusManager.getHost()`）；负控：去掉校验该用例红 | 需要远程访问的用户改为改配置；回退还原默认值 |
| P1-5 | `PUT /config` 可写任意键，`proxyHost`/`enableApiKey`/`apiKeys` 只经 `store/config.ts:313-320` 的两个字段校验；`koa-bodyparser` 在鉴权前解析 50MB（`server.ts:55-59` 先于 `:62`） | 配置写入加字段级校验（host 同上、`enableApiKey` 布尔、`apiKeys[].key` 非空串）；中间件顺序改为 CORS → 路径分流 → 鉴权 → bodyParser | 测试：写 `proxyHost:"0.0.0.0"` → 400；未带密钥提交 51MB → 401 而非 413；负控：顺序改回旧版，第二条用例红 | 管理面写入多一次校验，无兼容影响 |

## P2 失败语义与流终结（让失败可见）

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
|---|---|---|---|---|
| P2-1 | 流内错误被写成正常 chunk：`delta.content="\n\n[Error: …]"` + `finish_reason:"stop"`（`routes/chat.ts:347-367`） | 统一发 `data: {"error":{...}}` 错误帧后跟 `[DONE]`，不再改 content；客户端据此可判失败 | 新增流错误用例：注入一个会抛错的 stream，断言出现 error 帧且最终 chunk 的 content 为空；负控：改回写 content 即红 | 依赖 `[Error:` 文本的老客户端受影响；回退恢复旧帧 |
| P2-2 | 429 不惩罚账号也不回 `Retry-After`（`chat.ts:195`）；所有失败一律 `api_error`（`:203`） | 按上游状态映射：401/403→`authentication_error`，429→`rate_limit_error` 并回 `Retry-After`（若上游带），5xx→`api_error`；429 计入账号失败 | 测试：上游 429 + `retry-after: 7` → 响应 429、`Retry-After: 7`、`error.type="rate_limit_error"`；负控：去掉透传该用例红 | 客户端重试逻辑可能变化，属修正 |
| P2-3 | 7 个适配器共 17 处硬编码 `prompt_tokens: 1`（如 `adapters/glm.ts:1082`、`adapters/qwen.ts:573`） | 上游不提供用量时显式返回 `usage: null`；能算的（mimo）保留真实值。禁止伪造 | 源码门：`grep -c "prompt_tokens: 1"` 为 0；行为测试：无用量路径断言 `usage === null`；负控：恢复一处硬编码即红 | 依赖 usage 非空的客户端需判空（契约允许 null） |
| P2-4 | 全仓没有 `finish_reason:"length"`；`max_tokens` 本来也未转发（`forwarder.ts:1273-1302` 只在通用路径出现） | 转发 `max_tokens` 并在上游截断时返回 `length`；上游不提供截断信号时返回 `stop` 但在 `usage`/日志标注 `truncationUnknown: true` | 测试：通用路径透传 `max_tokens`；适配器路径收到该参数（以 deepseek 为样例）；截断用例断言 `length`；负控：去掉映射即红 | 需要逐适配器确认上游信号，P2-4 允许拆成多次提交 |
| P2-5 | 通用转换在 `[DONE]` 处发一次、flush 再发一次（`stream.ts:174` 与 `:350`）；mimo 流完全不发（全文件 grep 无 `[DONE]`）；kimi/qwen-ai 在错误路径重复 end | 每个响应恰好一个 `[DONE]`，由统一的终结函数负责；适配器不再各自写终结 | 测试：通用路径、mimo、kimi、qwen-ai 各一条，断言 `[DONE]` 计数 === 1；负控：删掉终结函数里的去重标志即红 | 无行为风险 |
| P2-6 | `stop()` 依赖 `server.close()`，全仓无 `closeAllConnections`（grep 零命中），有流在跑时 `restart()` 永不返回 | `stop()` 先 `closeIdleConnections()`，再对存活连接设 5s 宽限后 `closeAllConnections()`；`restart()` 复用同一路径 | 测试：起一个长连接后调用 `stop()`，断言 6s 内 resolve 且 `isRunning()===false`；负控：去掉强制关闭该用例超时红 | 强行断开长对话，属预期 |

## P3 工具调用结构性断路

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
|---|---|---|---|---|
| P3-1 | 注入提示要求 `<\|MODELPORT\|tool_calls>`（`toolCalling/protocols/managedXml.ts:31`），但 qwen-ai/zai/minimax 的流处理器构造不带 plan（`forwarder.ts:915`、`:1016`、`:1105-1127`；构造器 `qwen-ai.ts:379`、`zai.ts:584`、`minimax.ts:1068`），流式把标记当正文、`finish_reason:"stop"` | 三个构造器增加 `toolCallingPlan?`，与 deepseek/glm/kimi/qwen 同构：`plan.shouldParseResponse` 为真时用 `ToolStreamParser`，为假时保留旧格式解析 | 新增 `tests/providers/stream-tool-calls.test.ts`：三家各喂一段含 managed XML 的假流，断言产出 `tool_calls` 且 `finish_reason:"tool_calls"`；负控：不传 plan 时该条红（即当前状态） | 改动集中在三个适配器 + 三个调用点；回退按 provider 逐个还原 |
| P3-2 | 解析失败时把原始标记当 content 返回（`managedXml.ts:69-77`）；完整块但工具名非法时清空缓冲、不产出任何 chunk（`ToolStreamParser.ts:60-63`）；解析成功后无条件清缓冲，同一缓冲里的下一块被丢（`:56`） | 规则改为：能解析 → 发调用；识别到标记但解析失败 → 剥掉标记、正文照发，并在响应头 `X-ModelPort-Tool-Parse: failed` 标注；缓冲按「已消费长度」推进，不整段清空 | 测试 3 条：幻觉工具名 → content 为剥掉标记后的正文且 finish `stop`；正文里出现 `<tool_calls>` 讲解 → 文本完整；两块同批到达 → 两个调用、id 不同。负控：恢复 `buffer=''` 即红 | `tests/tool-calling/tool-stream-parser.test.ts:84-90` 与 `:108-116` 的旧期望随裁定一起改（不再丢弃调用后文本、id 不再是 `call_0`） |
| P3-3 | id 恒为 `call_${index}`（`managedXml.ts:140`），跨响应重复；分批到达时同一响应内重复（`ToolStreamParser.ts:49` 只改 index）；通用路径所有调用共用 `id: responseId`（`stream.ts:328`） | id 改为 `call_<requestId>-<n>`，`n` 在同一响应内单调；通用路径同样用该生成器。历史回放时按 id 与 `tool_call_id` 对齐 | 测试：同一请求两个并行调用 id 不同；两个相邻请求不复用 id；通用路径两个调用 id 不同。负控：改回常量即红 | 客户端若缓存旧 id 需重新对齐；影响面小 |
| P3-4 | 历史回放里 assistant 调用不带 id（`managedXml.ts:89-101`）、结果带 `tool_call_id`（`:104`），并行调用无法对号 | `formatAssistantToolCalls` 输出 `id` 属性，`formatToolResult` 同源引用；无法解析的历史 args 保留原文而非退化成 `{}`（`:146-153`） | 测试：两条并行调用 + 两条结果，回放文本中 id 一一对应；坏 args 原文保留。负控：去掉 id 属性即红 | 提示词略变长 |
| P3-5 | minimax 轮询流没有任何工具解析、终结恒为 `stop`（`minimax.ts:1254-1267`）；zai 在错误后追加 `stop` 会覆盖已发的 `tool_calls` | 轮询流接入同一 parser；终结原因由「本响应是否发过调用」决定，错误路径不再追加 finish | 测试：minimax 轮询流含调用 → 终结为 `tool_calls`；zai 调用后上游报错 → 仍是 `tool_calls` 且带错误帧。负控：恢复常量 `stop` 即红 | 与 P3-1 同批提交更稳 |

## P4 多轮上下文与工具结果回传

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
|---|---|---|---|---|
| P4-1 | qwen-ai 只保留 system 与最后一条 user（`adapters/qwen-ai.ts:270-281`），工具循环无法闭合；zai 每次新建 chat 并把历史压进一条消息（`zai.ts:397-401`） | 两家按各自上游能力改成逐轮消息：qwen-ai 用其 chat 接口按 parent 串联；zai 保留完整 messages 渲染（含工具段） | 测试：三段对话回放时，上游请求体包含全部 assistant/tool 轮次；负控：恢复单轮提取即红 | 需要上游接口验证，允许先落 qwen-ai，zai 单独一批 |
| P4-2 | 数组型 tool 结果被 `String()` 成 `[object Object]`（`adapters/deepseek.ts:305`、`kimi.ts:181`） | 统一用 `extractTextContent`（`qwen.ts` 已有），非 text 部分丢弃并记日志 | 测试：`[{type:"text",text:"ok"}]` 回放为 `ok`；负控：改回 `String()` 即红 | 无 |
| P4-3 | 上下文管理裁剪时把消息重建为 `{role, content}`（`forwarder.ts:259-263`、`:282-286`），`tool_calls`/`tool_call_id`/`name` 全丢 | 裁剪只作用于文本长度，消息对象保留原字段；摘要结果不得插入字面量 `Failed to generate conversation summary.`（`contextManagementService.ts` 对应分支改为不注入） | 测试：触发裁剪后消息仍带 `tool_call_id`；摘要失败时消息数不变且无该字面量。负控：恢复 `{role, content}` 即红 | 裁剪后体积略增 |
| P4-4 | 会话表零调用方（`store.ts` 的 `addSession`/`addMessageToSession` 无引用），但 `GET /v0/management/sessions` 恒返回 `[]`，sweeper 每分钟同步重写 `data.json` | 二选一，需拍板：接线（记录真实会话）或显式退役（接口返回 501 + sweeper 停止） | 测试：按选项断言接口行为；负控：恢复空数组即红 | 退役会移除一个对外接口，需在发布说明写明 |

## P5 参数契约与可观测

| 编号 | 现状证据 | 改法 | 验收（可执行） | 代价 / 回退 |
|---|---|---|---|---|
| P5-1 | `response_format`/`stream_options` 全目录零命中；`top_p`/`stop`/`n` 等只在通用路径转发（`forwarder.ts:1269-1302`），8 家内置供应商只认 `temperature` | 二选一，需拍板：显式 `400 unsupported_parameter`（推荐）或逐家尽力转发。选前者时在响应里列出被拒参数名 | 测试：内置供应商收到 `response_format` → 400 且 `param` 指向该字段；通用路径不受影响。负控：改回静默丢弃即红 | 现存的「带参数也能跑」客户端会开始报错；这是有意的契约收紧 |
| P5-2 | `/v1/completions` 复用 chat 转发结果，文件内无任何 `text_completion` 转换（`routes/completions.ts` grep 零命中），流式还无条件二次转换（`:269`，未判 `skipTransform`） | 输出改为 `object:"text_completion"`、`choices[].text`；流式尊重 `skipTransform` | 测试：非流式断言 `text_completion`；流式断言只有一层转换（`[DONE]` 计数 1）。负控：去掉形状转换即红 | 依赖 chat 形状的调用方会断，属修正 |
| P5-3 | `requestId` 只进日志，响应无 `X-Request-Id`（`chat.ts:27-29` 后无 `ctx.set`）；`/v1/completions` 不写请求日志 | 所有 `/v1/*` 响应回 `X-Request-Id`，两条路由共用同一日志写入 | 测试：任意成功/失败响应都带该头；completions 产生日志行。负控：去掉头即红 | 无 |
| P5-4 | `tool_choice:"required"` 与强制函数只收窄清单、从不校验（`runtimePlan.ts:23-24`）；未声明函数名抛错后变 500（`:19-21` + `chat.ts` 兜底）；`parallel_tool_calls` 全仓未读 | 强制/`required` 时在提示中加入「必须调用 X」并在未调用时返回 `finish_reason:"stop"` + `X-ModelPort-Tool-Violation: required`；未声明名 → 400；`parallel_tool_calls:false` 时只发第一个调用 | 测试 3 条按上述断言；负控：去掉强制措辞即红 | 提示词变长；与 P3-2 的失败标注共用同一响应头机制 |
| P5-5 | 自定义供应商完全不注入、也不转发 `tools` | 通用路径接入同一 `ToolCallingEngine`，`tools` 有原生字段时透传，否则注入提示 | 测试：custom provider 带 tools 时请求体含注入提示或原生 tools；负控：去掉接线即红 | 取决于自定义供应商是否原生支持，默认走注入 |

## P6 收尾

| 编号 | 内容 | 验收 |
|---|---|---|
| P6-1 | 全量门禁一次跑完 | `npm run build` 通过；`tsc -p tsconfig.node.json` 0 错误；`tsc -p tsconfig.json` 仅 2 条 TS6305；`node --test` 除既有的 2 条 skills 环境失败外全绿 |
| P6-2 | 文档与能力声明 | `AGENTS.md` 写明：默认鉴权语义、支持的 OpenAI 参数、被拒绝的参数、工具调用在各供应商的流式/非流式差异 |

## 已拍板（2026-10-27，全部按推荐值）

- **D1（对应 P1-1/P1-4）默认鉴权**：有密钥才对外，没密钥只许回环监听。✅
- **D2（对应 P3-3）工具调用 id**：`call_<requestId>-<n>`，stable 且跨请求不重复。✅
- **D3（对应 P4-4）会话表**：显式退役，接口返回 501 并停止 sweeper。✅
- **D4（对应 P5-1）不支持参数**：显式 400 `unsupported_parameter`，不再静默丢弃。✅

## 验收总表（收尾核对用）

| 阶段 | 可执行验收 | 判红条件 |
|---|---|---|
| P1 | curl 矩阵 6 条 + `tests/api/auth-matrix.test.ts` | 任一条负控不红 |
| P2 | 流错误/429/usage/终结符各 1 条用例 | `[DONE]` 计数 ≠1，或 usage 仍为 1/1/2 |
| P3 | 三家流式工具用例 + parser 3 条 + id 2 条 | managed XML 出现在 content 里 |
| P4 | 历史回放用例 3 条 | 出现 `[object Object]` 或 `tool_call_id` 丢失 |
| P5 | 契约用例 4 条 | 静默接受 `response_format` |
| P6 | 全量门禁 + 文档 | build 失败或 tsc 新错误 |
