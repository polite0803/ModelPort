# PLAN：TRAE 通道切 `create_agent_task` 代理泳道拿前缀缓存（项目 C）

日期：2026-11-15 · 用户已「立项 C」 · 决策档案，逐阶段推进
前置：`ASSESSMENT-trae-create-agent-task.md`（§8 探针已证服务端入口不强制加密）；根因 `PLAN-prompt-cache.md §9.12`。

## 目标与边界

- **目标**：让 TRAE 渠道走官方主对话泳道 `create_agent_task`，拿到服务端会话态前缀缓存（MITM 实测官方 `cache_read=12288`），降低长会话重复前缀的积分消耗。
- **硬边界**：
  - 不冒领 TRAE 宝限免资格（既有裁定）；本项目只复用账号凭据走代理协议，不声明「任务由 TRAE 宝派发」。
  - 不绕上游计量/风控（不轮换 machine_id/device_id，不伪造安全头）。
  - 网关不变量全守：fail-closed 鉴权、每流单一 `[DONE]`、错误状态/类型保真、`usage` 不伪造、`X-Request-Id`。
  - 不碰并行会话文件；红门禁不部署；命令一律 SSH→WSL。
- **收益上限须先验证**：TRAE 耗分主因是 prompt 体量（~0.5 分/轮），缓存只省 ~18% 重复前缀；**若 cache_read 不打折计费则一分不省**——阶段 0 必须先定死计价口径。

## 阶段 0：全链路验证探针（最便宜排雷，GATE）

目的：在投适配器本体前，用最小代价确认三件事，任一不成立即止损。

1. **Schema 发现（只读、免费）**：从 `ai_agent.dll`/native 串表取 `CreateAgentTaskRequest` 必填字段与 `conversation_id` 来源（客户端生成 UUID？还是 `create_conversation` 端点？）。
2. **全链路跑通**：构造最小有效 body（含 `conversation_id`）发 `create_agent_task`，确认 **200＋agent SSE＋`token_usage.cache_read_input_tokens`**。4001 校验错免费，可迭代补字段；首个 200 才花一次积分。
3. **计价口径**：`ide_user_ent_usage` 前后读数，判定 cache_read 是否打折（对比同 prompt 体量无缓存轮）。

**GATE**：
- 跑不通（明文被后续阶段拒/必须加密）→ 止损，报告，C 不投。
- 跑通但 cache_read 不打折 → 缓存不省积分，C 价值归零，止损报告（除非用户另有目标）。
- 跑通且打折 → 进阶段 1。

### 阶段 0 实测结果（2026-11-15，约 18 轮免费校验探针＋3 次免费目录读，**零积分**——从未有任务真跑）

**入口与 schema：已证开放。** 明文 `create_agent_task`（网关 `traeSOLOHeaders` 签名、无 helios/medusa/neptune）被收下并解析到字段校验。必填字段已逐个探明：`conversation_id`（客户端 UUID 即可）、`user_id`、`device_id`、`agent_type`、`ide_version`、`user_input{id,text}`、`model_name`（必填，缺则 binding 错）。`function` 被服务端按 `agent_type` 改写（`solo_agent`→Function `solo_agent`）。

**全链路：卡在模型 provisioning，跑不通。** 上游有**两道独立配置闸**：
1. config-item 闸：按 `{AppId,Function,ConfigName,VersionCode,IdeVersion,ModeType,AgentType,IsCustomModel,Account}` 查。`agent_type=solo_agent` 是已注册代理（`solo` 报 `unsupported agent`）；`ConfigName=deepseek-v4.1-flash`（目录值）能过此闸。
2. model-config 闸：按 `model_name` 查实际模型服务配置。**所有**目录 config_name 对应的 model_name 都报 `model config is empty for model name`（`deepseek-v4.1-flash`/`deepseek-flash`/`glm-5.3-flash`/空 全失败）；官方 MITM 的 `config_name=deepseek-flash` 又过不了 solo_agent 的 config-item 闸。

**为什么不是便宜探针**：`ai_agent.dll` 明文日志暴露解析链——`[create_agent_task] resolved cloud task identity: local_agent_type=, cloud_agent_type=, function=, config_name=, model_name=, raw_chat_function=`，且有 `DSLAgentTemplateDetail{ConfigItem,ModelName,ProviderModelName,...}`。即工作元组由**客户端侧 DSL 代理模板**把 local_agent_type 解析成 cloud_agent_type＋ModelName/ProviderModelName 得到；该解析在加密请求体内，`batch_get_detail_param` 目录（`agent_type:''`）**不暴露** agent 泳道的 wire model_name（内置模型 `model_detail_list` 无 model_name 字段；`auto`/`Qoder` 条目是用户自己的 BYOK 自定义模型，`base_url http://192.168.85.131:8080`、`provider custom_openai_compatible`，与 TRAE 服务端缓存无关）。要凑出工作元组＝逆向官方 DSL 代理解析，正是评估 warned 的 2–4 周深逆向，**不是阶段 0 设想的「补几个字段就 200」**。

**计价旁证（免费目录读）**：`display_contact_config.consumption_rate` 坐实「耗分＝费率×token 体量」——`deepseek-v4.1-flash` rate 0.06（off-peak 0.12→0.06）、`glm-5.3-flash` rate 0.08；`model_entitlement_usage_cost:1`。cache_read 是否打折**仍未验证**（任务没跑成，无法前后对拍 `ide_user_ent_usage`），但耗分主因是体量这一判断再获支撑。

**GATE 判定：落在「跑不通」格 → 建议止损，C 不投阶段 1。** 加密闸门虽开放，但全链路被模型 provisioning 卡死，而打通它需要逆向官方 DSL 解析（深逆向＋私有协议维护＋风控未知），收益上限仍只有 ~18% 前缀且计价未证。性价比不成立。最终是否仍要投逆向，由用户拍板；未获新授权前不进阶段 1。

## 阶段 1：协议适配器本体（bulk，约 2–4 周）

- 新泳道模块 `vendor/channel-pack/src/trae-agent.ts`（与现 `trae-adapter.ts` 的 `llm_utils_chat` 并存）。
- **会话生命周期状态机**：`conversation_id` 管理；`create_agent_task → resume_agent_task → commit_toolcall_result → query_history_state / sync_history_state`；per-会话持久化 `task_id/agent_run_id`。
- **请求映射**：OpenAI `{model,messages,tools,tool_choice}` → `CreateAgentTaskRequest`（`tool_call_results/extra_context/available_tool_list/...`＋`CreateAgentTaskExtraConfig`）。
- **SSE 映射**：`agent_identity/task_created/model_config/output/token_usage/done` → OpenAI chunk；复用 `readCachedInput`。
- **工具执行**：客户端执行工具→`commit_toolcall_result` 回传（与 OpenAI tool 协议同构）。
- 复用 `traeSOLOHeaders` 签名（已证可用）。

## 阶段 2：接入渠道＋路由

- 配置开关：TRAE 渠道可选 agent 泳道 vs `llm_utils_chat`（默认保守，灰度）。
- 缓存上报复用 `readCachedInput/cachedReported`；错误/失败转移遵循网关状态政策。
- 会话态与网关无状态补全的衔接（路由 sticky/pin 与 conversation_id 的对应）。

## 阶段 3：测试＋门禁＋部署＋真机回归

- 映射/状态机单测＋源码结构门；`npm run gate` 全绿（SSH）；部署 WSL daemon；真机客户端回归（缓存命中率读数）。

## 当前进度

- [完成·GATE 失败] 阶段 0：入口开放＋schema 探明，但全链路卡在模型 provisioning（需逆向官方 DSL 解析）；零积分。建议止损。
- [冻结·待用户拍板] 阶段 1–3：GATE 未过，未获新授权前不投。

## 风险账（立项即接受）

- 私有协议随 TRAE 版本变（dll 11-13 刚更新），长期维护成本。
- 长期不带 helios/medusa/neptune 的风控后果未知（官方仍发；本项目不伪造，缺失即缺失）。
- 计价口径未定前，收益可能为零——阶段 0 先排此雷。