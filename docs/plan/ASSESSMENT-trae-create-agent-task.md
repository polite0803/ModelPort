# 评估：TRAE 通道切 `create_agent_task` 代理协议拿前缀缓存

日期：2026-11-15 · 供拍板 · 不含代码改动 · 原版未花积分；§8 探针经授权花了一次（＋免费正控）
证据来源：2026-11-15 可逆 MITM 真实报文 + `ai_agent.dll`/native 模块串表 + 现网关 `vendor/channel-pack/src/trae*.ts`。上游根因见 `PLAN-prompt-cache.md §9.12`。

## 0. 结论先行（2026-11-15 探针后订正）

> **重大订正：加密闸门已被一次性探针证伪——服务端入口不强制加密。** 用户授权 B 后，用网关自己的 `traeSOLOHeaders` 签名＋**明文** body 发 `create_agent_task`（不带任何 helios/medusa/neptune），上游回 **400 `code:4001 ... expr_path=conversation_id, cause=missing required parameter`**——这是**参数绑定校验错**，证明请求**已过鉴权、已被明文解析、已进到字段校验**，只是缺 `conversation_id`。同批免费正控 `GetUserInfo=200`（凭据有效）。⇒ 本文原版把「请求体加密」判成硬 go/no-go（❌）是**错的**：加密是官方客户端 SDK 的自愿行为，**不是服务端入口强制**。详见 §8。

**订正后的判断：C（切 agent 协议）从「不可行」变为「工程上可行」**——不再需要逆向原生安全 SDK。但它仍是一次大改（任务/会话状态机＋请求/SSE/工具双向映射，约 2–4 周），且**收益上限有限、计价口径未验证**：TRAE 耗分几乎全由 prompt 体量决定（~0.5 分/轮），缓存只省重复前缀的一部分（实测 ~18%），**若 cache_read 不打折则一分不省**。

一句话：**缓存确实长在 `create_agent_task` 上，那条泳道现在证明能明文进去；要不要花 2–4 周去拿那 ~18% 前缀缓存（且可能不省钱），是性价比取舍，不再是可行性问题。** 现状 A（`llm_utils_chat` + 按渠道裁剪，prompt 107K→67K）仍是零成本止血。

## 1. 为什么两条泳道待遇不同（已实证）

| | 网关现用 | 官方主对话 |
|---|---|---|
| 端点 | `POST /api/agent/v3/llm_utils_chat` | `POST /api/agent/v3/create_agent_task` |
| 域 | `trae-api-cn.mchost.guru` | `api5-normal.mchost.guru` |
| 请求体 | **明文 JSON**（网关现在就这么发，能用） | **密文**（MITM 实测 base64 样密文） |
| 安全头 | 无 helios | `x-helios` / `x-medusa` / `x-neptune` |
| 鉴权 | `Cloud-IDE-JWT` | `authorization`（+ 一整套设备/隧道头） |
| 缓存 | 恒 0（四假设排除） | **命中 12288 token**（deepseek-flash 实测） |
| 官方用途 | 仅辅助：标题/commit msg/图标/输入优化/系统诊断 | 主对话/代理任务 |

`dll` 里 `Cloud llm_utils_chat failed for title generation / commit message / icon generation / input optimization / system_diagnosis` 证明：**补全泳道在官方那儿就是打杂的，主对话从不走它**——所以它没缓存不是 bug，是设计。

## 2. 加密层在哪（可行性闸门）

- `ai_agent.dll`（284MB）里 **helios/medusa/neptune 零命中**；agent 逻辑构造的是**明文** `CreateAgentTaskRequest`（字段串齐全），且有 `[create_agent_task] request body:` 明文日志。⇒ 加密发生在 agent 逻辑**下游**。
- `@byted-icube/trae-network-client` 的 package.json 自述：**"ZeroMQ client for Trae Network Service – Node.js bindings"**。即真实 HTTP（含加密）由一个**独立的 Trae 网络服务进程**执行，Electron 侧只是 ZeroMQ IPC 客户端；`AhaNet`（`@aha-kit/net`）是字节的网络库。
- 结论：**加密是字节专用安全网络服务做的**（helios=加密、medusa/neptune=设备指纹/风控一类的原生 SDK），密钥/算法在原生二进制里、大概率设备绑定＋混淆。**网关要复现它＝逆向一个原生安全 SDK**，这不是适配协议，是破解风控。

**已验证（2026-11-15 探针，§8）：服务端入口不强制加密。** 明文 `create_agent_task`（无 helios/medusa/neptune）被收下并解析到参数校验（4001 缺 `conversation_id`），不是安全拒绝。⇒ 上面「加密＝逆向风控」的推断对**官方客户端为何加密**仍成立（SDK 自愿/风控评分），但**对网关能否进入不构成闸门**。残留未知：①补齐 `conversation_id`＋完整 body 后任务能否真跑通并回缓存（要建 C 或再探针才知道）；②长期不带安全头是否触发风控评分（未知，官方仍发这些头）；③cache_read 是否打折计费（未验证）。

## 3. 分项可行性

| 维度 | 判定 | 说明 |
|---|---|---|
| **请求体加密** | ✅ **入口已证开放** | 探针：明文 body 被解析到参数校验（4001），无安全拒绝；加密是官方 SDK 自愿行为，非服务端强制。残留：完整任务链路/风控评分未验证（§8） |
| 鉴权 | ✅ 可行 | 已有 `Cloud-IDE-JWT` + 设备头构造（`traeSOLOHeaders`），agent 泳道头可仿 |
| 工具执行模型 | 🟡 相近 | 官方也是**客户端执行工具→回传**（`commit_toolcall_result`，vm_core 本机跑），与 OpenAI tool 协议同构，非不可逾越 |
| 任务/会话生命周期 | 🟠 大改 | 需要 per-会话维护 `task_id/agent_run_id/tunnel_id`，`create→resume→commit_toolcall_result→query/sync_history_state` 状态机；网关现在是无状态补全 |
| 请求结构 | 🟠 大改 | `CreateAgentTaskRequest`：`tool_call_results/extra_context/available_tool_list/mcp_tool_list/available_plugins/connector_list/agent_static_dsl` + `CreateAgentTaskExtraConfig`（core_memory/chat_memory/ask_user_question 等开关），与 OpenAI body 差异大 |
| 响应/SSE 映射 | 🟡 中等 | `agent_identity/task_created/model_config/output/token_usage/done` → OpenAI chunk；usage 已会读（`readCachedInput`） |
| 缓存收益计价 | ❓ 未验证 | TRAE 是否对 cache_read 打折计费未知；不打折则拿到缓存也不省积分 |

## 4. 工程量（探针后订正，非承诺）

- **加密不再是阻塞**（§8 已证入口接受明文），无需逆向原生安全 SDK。
- 协议适配器本身约 **2–4 周专注工作量**：`conversation_id`/会话生命周期、`create→resume→commit_toolcall_result→query/sync_history_state` 状态机、OpenAI↔agent 请求/工具/SSE 双向映射、会话态持久化、凭据/隧道头、全套测试与真机回归。
- 仍**远大于**「注入 cache_control」那种小改（后者已证无效并回退）；且收益受 §5.3 计价口径制约。

## 5. 风险

1. **ToS/ impersonation**：网关本就以第三方身份复用 TRAE 凭据；切 agent 泳道＋复现安全头是**更深地冒充官方客户端**，且 helios/medusa/neptune 本身就是反滥用风控——绕过它性质上比现在更重。（与「冒领 TRAE 宝限免」是两回事，但同属「绕上游识别」家族，参见既有裁定。）
2. **脆弱性**：私有协议＋加密 SDK 随版本变（dll 11-13 刚更新），每次 TRAE 升级都可能打断，维护成本长期存在。
3. **收益不确定**：实测单轮 cache_read≈12288/67238≈**18% 前缀**；且 TRAE 耗分几乎全由 prompt 体量决定（~0.5 分/轮，§9.11），缓存只省重复前缀的一部分，**若 cache_read 不打折则一分不省**。

## 6. 选项（供拍板）

| 选项 | 动作 | 成本 | 收益 | 建议 |
|---|---|---|---|---|
| **A 维持现状** | `llm_utils_chat` + `channelIds=["trae"]` 裁剪 | 0（已上线） | prompt 107K→67K，直接降耗 | ✅ 零成本止血默认 |
| **B 一次性探针** | 发明文 `create_agent_task` 验服务端是否强制加密 | 已花（一次探针＋免费正控） | **已完成：闸门开放**（§8） | ✅ 已做 |
| **C 切 agent 协议** | 完整适配 `create_agent_task` | 2–4 周（加密不再阻塞） | 最多 ~18% 前缀缓存，计价未验证 | 🟡 可行但是否值得看取舍 |
| **D 长会话导到有缓存的渠道** | 路由把长上下文转给 buddy/loomy/raccoon（85–98% 命中） | 路由配置 | 真缓存收益 | 仅当你不强求用 TRAE 额度时 |

**B 已完成，加密闸门开放，C 不再被可行性卡死。** 现在的取舍是性价比而非可行性：就「省积分」而言 A/D 仍最划算（耗分主因是 prompt 体量，不是缓存）；C 的价值在于「specifically 要 TRAE 这条额度的缓存」，愿付 2–4 周＋承担私有协议维护与计价不确定才立项。**若目标只是少耗分，推荐 A（＋必要时 D）；若目标是非要 TRAE 缓存不可，C 现在可以立项。**

## 7. 证据留档

- MITM 决定性帧：`create_agent_task -> 200`，`token_usage{prompt_tokens:67238, cache_read_input_tokens:12288, cache_creation_input_tokens:0}`，`config_name:deepseek-flash`；请求体密文、含 `x-helios/x-medusa/x-neptune`。
- `ai_agent.dll`：`CreateAgentTaskRequest`/`CreateAgentTaskExtraConfig` 字段串、`[create_agent_task] request body:`、`[workflow_host] agent cache hit: task_id=`、`Cloud llm_utils_chat failed for <辅助任务>`；helios/medusa/neptune 零命中。
- `trae-network-client` package.json：ZeroMQ client for Trae Network Service（独立网络服务进程）。
- 网关侧四假设排除读数见 `PLAN-prompt-cache.md §9.12`。

## 8. 一次性探针（2026-11-15，用户授权 B）——加密闸门开放

方法：esbuild 打包网关真实的 `traeSOLOHeaders`/`TRAE`（签名与现网逐字一致，非手搓），root 脚本内读 `channel-pack/credentials.json` 的 TRAE 凭据（只打印 uid/长度，不打印密钥），发两个请求：

| 请求 | 端点 | 结果 | 含义 |
|---|---|---|---|
| 正控（免费） | `api.trae.com.cn/cloudide/api/v3/trae/GetUserInfo` | **200**，返回真实用户信息 | 凭据＋签名头有效 |
| 探针 | `api5-normal.mchost.guru/api/agent/v3/create_agent_task`，**明文 body、无 helios/medusa/neptune** | **400** `{"code":4001,"message":"bad request: binding: expr_path=conversation_id, cause=missing required parameter"}` | **参数绑定校验错**：已过鉴权、已明文解析、已进字段校验，仅缺 `conversation_id` |

**判定：服务端入口不强制加密。** 4001 是 Go 应用层参数绑定错（与 `llm_utils_chat` 的 `4001 param is invalid` 同族），不是安全/解密拒绝（那会是 403/解密失败/helios 相关码）。请求体用 `{function:'assistant', config_name:'deepseek-flash', query:'ping', stream:true, available_tool_list:[]}`，上游准确报出缺 `conversation_id` ⇒ 明文被完整解析。

**这推翻了 §2/§3 原版「加密＝硬阻塞」的推断。** 官方客户端加密是 SDK 自愿行为（可能用于风控评分），不是服务端入口强制。

**残留未知（探针只定入口，未定全链路）：**
1. 补齐 `conversation_id`＋完整 `CreateAgentTaskRequest` 后任务能否真跑通、SSE 能否回 `cache_read`（要建 C 或再探针）。
2. 长期不带 helios/medusa/neptune 是否触发风控评分/封号（未知；官方仍发这些头，性质上比现在更深地复用官方身份，ToS 风险仍在）。
3. `cache_read` 是否打折计费（未验证；不打折则拿到缓存也不省积分）。

探针临时文件已删（凭据仅在运行时读取，未落盘）；未重复探测、未额外烧积分。

## 9. 阶段 0 全链路探针（2026-11-15，用户「立项 C」后）——入口开放，但全链路卡在模型 provisioning

约 18 轮**免费**校验探针＋3 次免费目录读，**零积分**（从未有任务真跑，全部止于 `event:error` 校验码）。

- **入口/Schema 已证开放**：明文 body 被解析到字段校验；必填字段探明（`conversation_id` 客户端 UUID 即可、`user_id/device_id/agent_type/ide_version/user_input{id,text}/model_name`）。`function` 被服务端按 `agent_type` 改写。
- **两道配置闸**：①config-item 按 `{AppId,Function,ConfigName,VersionCode,IdeVersion,ModeType,AgentType,...}`；②model-config 按 `model_name`。`agent_type=solo_agent` 已注册（`solo` 报 `unsupported agent`），目录值 `ConfigName=deepseek-v4.1-flash` 过①，但**任何** model_name 都报 `model config is empty for model name`（②失败）；官方 `config_name=deepseek-flash` 又过不了 solo_agent 的①。
- **根因（dll 明文日志）**：`[create_agent_task] resolved cloud task identity: local_agent_type/cloud_agent_type/function/config_name/model_name/raw_chat_function` ＋ `DSLAgentTemplateDetail{ModelName,ProviderModelName}`。工作元组由**客户端侧 DSL 代理模板**解析（local→cloud agent_type＋ModelName），在加密体内；`batch_get_detail_param` 目录不暴露 agent 泳道 wire model_name。`auto`/`Qoder` 目录条目是用户 BYOK 自定义模型（`base_url http://192.168.85.131:8080`、`custom_openai_compatible`），与 TRAE 服务端缓存无关。
- **计价旁证**：`display_contact_config.consumption_rate`（deepseek-v4.1-flash 0.06、glm-5.3-flash 0.08）坐实耗分＝费率×体量；cache_read 打折仍未证（任务没跑成）。

**判定**：加密闸门开放≠全链路可跑通。打通模型 provisioning＝逆向官方 DSL 代理解析（评估 §4 的 2–4 周深逆向），**不是便宜探针**。GATE 落「跑不通」格 → 建议止损，C 不投阶段 1；是否仍投逆向由用户拍板。详见 `PLAN-trae-agent-lane.md` 阶段 0 实测结果。