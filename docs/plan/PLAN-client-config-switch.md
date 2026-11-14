# 客户端自定义模型代写（CCSwitch 式）：六家一次配好，切网关不再手改

> 成文：2026-11-14 ｜ 状态：**已批（用户 2026-11-14「本机已经安装Claude Desktop，其它正常批准」）｜代码已落地，门禁收口中** ｜ 目标版本：待定（建议 1.9.0，新增壳能力）
>
> 目标一句话：**壳里选一个网关，六家客户端的自定义模型配置就地改好**，用户不再逐个手改
> baseURL / API key。
>
> 范围由用户 2026-11-14 原话钉死：**Codex；Claude Code / Claude Desktop；Trae / Trae CN；
> Qoder / Qoder CN；Workbuddy（国际）/ Workbuddy（国内）**。本文不按「先做两家」收窄。

---

## 0. 先纠正我上一轮的两个错判

| 我说过的 | 实测 | 影响 |
|---|---|---|
| 「TRAE 不能代写，配置在服务端 dynamicConfig」 | **错**。`base_url` / `ak` / `custom_model_id` 全在本地 `state.vscdb` 的 ItemTable 里 | TRAE 从「不可做」升为「base_url 可写、凭据待解」 |
| 「`MODELPORT_CODEX_API_KEY` 不存在」（reg.exe 读数 0） | **假阴性**。PowerShell `[Environment]::GetEnvironmentVariable` 实测 User 作用域存在，len 51 | Codex 那一格没有缺口 |

---

## 1. 决策表（D1–D4 我按既有裁定合推，D5–D7 需你点头）

| # | 事项 | 裁定 / 建议 | 依据与代价 |
|---|---|---|---|
| D1 | 实现形态 | **C：壳代写客户端配置**。壳不新增监听端口 | 你 msg2 选定；且 `src/main/index.ts:16-25` 钉死「控制台进程不得求值网关树」，`tests/build/shell-entries.test.ts` 是这道栅栏。代价：每家客户端一套写入器，vendor 改格式就要跟 |
| D2 | 凭据存哪 | **不落壳**。切换时经管理 RPC 在目标网关写一把「规范 key」，明文只在写入那一刻存在于内存 | `addressBook.ts:31-44` 无凭据字段、`secretStore.ts:15-16`「gateways.json stays free of credentials」。代价：每次切换要能连上目标网关的管理面 |
| D3 | 新建还是改旧 | **原地更新既有条目**，不新建 | 稳定 id 保住各家的选中态：Qoder provider uuid、WorkBuddy `id`、Codex `[model_providers.modelport]`、TRAE `custom_model_id`。代价：用户手建的其它条目不动，只认我们打过标记的那条 |
| D4 | 规范 key 怎么来 | 用 `config:update` 把**同一把 key 写进地址簿里每个网关**的 `apiKeys`；**优先复用已有 key**，都没有才新铸 | `handlers.ts:337` 收 `Partial<AppConfig>`（含 `apiKeys`），`rpc.ts:11` 白名单就是 handler 注册表 ⇒ 壳可直接调。**本轮更正**：`GET /v1/management/api-keys` 返回掩码（`apiKeys.ts:41/83/191`），但 **`config:get` 返回明文 `apiKeys`**（`handlers.ts:333` → `store.ts:1351`）⇒ 能读回复用，不必每次新铸。分发是**追加**，绝不替换既有 key |
| D5 | TRAE 凭据 | 只改 `base_url`，`ak` 原样保留；规范 key 由你在 TRAE UI 里**输一次** | `ak` 解码 79 字节、无 `v10`/`v11`/DPAPI 魔数 ⇒ 应用自有 AES-GCM，我们铸不出。代价：一次性手工；此后切换零手工 |
| D6 | Claude 家 | **本机已装 Claude Desktop（用户更正）**，按公开契约实现并在本机验收 | 我上一轮判「无安装」是假阴性：Desktop 是 MSIX 包 `Claude_pzs8sxrjxfjjc`，装在 `WindowsApps`、数据在 `Local\Packages`，所以 `Roaming\Claude` / `Program Files\Claude` 当然不存在。判据改为「配置目录存在 **或** MSIX 包家族目录存在」 |
| D7 | 写 SQLite 类客户端 | **必须先确认应用已退出**，否则拒写并提示 | VSCode fork 把 state 持在内存、退出时整份回写，外部写入会被静默覆盖。代价：切换 TRAE / CodeBuddy 前要关窗口 |

**D4 是这版方案能覆盖六家的关键**：实测三家的 key 互不相同（Codex `7efc8ed4ce87`、
Qoder CN `e8b4f288d9ed`、WorkBuddy `100cea77c7ce`，均 len 51），所以「只改 base_url」今天
必然 401。把一把规范 key 铺到所有网关后，密文客户端才只需改地址。

---

## 2. 现状读数：六家逐个（本轮实测，全部只读）

### 2.1 Codex ✅ 全明文可写

| 项 | 读数 |
|---|---|
| 主配置 | `C:\Users\polit\.codex\config.toml`（3576 B，TOML） |
| 当前值 | `model="codex-deepseek"`、`model_provider="modelport"`、`model_catalog_json="modelport-catalog.json"`、`wire_api="responses"`、`base_url="http://127.0.0.1:8080/v1"` |
| 凭据 | `env_key="MODELPORT_CODEX_API_KEY"` ⇒ **User 作用域环境变量**，len 51，digest `7efc8ed4ce87`（Machine / Process 作用域均无） |
| 模型表 | `modelport-catalog.json` = `{"models":[6 行]}`，slug `codex/auto/codex-deepseek/daily/performance/stable`，每行 `{slug,display_name,description,default_reasoning_level,supported_reasoning_levels[]}` |
| 选择指针 | 就是 `config.toml` 的 `model` + `model_provider`，无独立数据库 |
| 坑 | `model_catalog_json` 是**整表替换**、按 `CODEX_HOME` 解析、只能写裸文件名（`C:\` 与 `/mnt/c` 各坏一边）；`[desktop] runCodexInWindowsSubsystemForLinux=true` ⇒ WSL-mode core 读 Windows `CODEX_HOME` |
| 缺口 | 无。切网关要同时改 `base_url` + 环境变量 + 按目标 `/v1/models` 重建 catalog |

### 2.2 Claude Code / Claude Desktop ✅ 本机已装（上一轮判「无安装」是假阴性）

| 项 | 读数 |
|---|---|
| 安装形态 | MSIX 包家族 `Claude_pzs8sxrjxfjjc`（Desktop 5.11492.2）；二进制在 `WindowsApps`，用户数据在 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc`，`app.asar` 在 `app/resources/app.asar`（**不是** `resources/app.asar`） |
| 为什么我判错 | 只找了 `~/.claude*`、`Roaming/Claude*`、`Local/Anthropic*`、`Program Files/Claude*`、npm 全局 `@anthropic-ai` —— MSIX 布局一个都不命中 |
| 配置契约 | `process.env.CLAUDE_CONFIG_DIR || homedir()` + `.claude/settings.json`；写 `env.ANTHROPIC_BASE_URL`（**裸 origin**，不带 `/v1`）与 `env.ANTHROPIC_AUTH_TOKEN` |
| 模型名 | **不需要写**：网关 `routes/messages.ts` 有 `anthropicInbound.modelMap` / `defaultModel`（默认 `auto`），入站名由网关自己映射 |
| 文件缺席 | Desktop  bundles CLI，但从不主动写 `settings.json` ⇒ 「未安装」与「已装未配置」必须分开：判据是配置目录 **或** MSIX 包目录存在 |

### 2.3 Trae CN ⚠️ 地址可写、凭据密文（国际版 Trae 未安装）

| 项 | 读数 |
|---|---|
| 位置 | `%APPDATA%\Trae CN\User\globalStorage\state.vscdb`（1,236,992 B）→ ItemTable。**本轮更正**：`LIKE '%AI.agent.model.model_list_map'` 命中 **3 个键**，冒号形与下划线形**都带端点**（上一轮写「下划线形没有端点字段」是错的） |
| 分区 | 两个 uid `4035664558954057` / `590883017213417`。冒号形各 **18 个 label**、其中 **11 个**带自定义模型；下划线形（仅 `4035664558954057`）**7 个 label 全带**。合计 43 个 label、29 个 label 实例 × 2 条 = 58 条自定义条目。**只改 `assistant`/`personal_assistant` 会让客户端按模式表现不一致**，所以写入器遍历全部 label |
| 现网地址 | 两个账号指向**不同**网关：`4035664558954057` → `http://192.168.0.239:8080/v1/chat/completions`，`590883017213417` → `http://192.168.85.131:8080/v1/chat/completions`（两者都不在地址簿里 ⇒ 见 §8 的判据更正） |
| 条目形状 | `provider="custom_openai_compatible"`、`name="custom_openai_compatible//<模型名>"`、`base_url="http://<host>:8080/v1/chat/completions"`（**含完整路径**）、`is_custom_base_url=true`、`client_connect=true`、`config_source=3`、`custom_model_id="3195120002"`（服务端下发的数字 id）、`status/selectable=true` |
| 凭据 | `ak` len 108 base64 → 解码 **79 字节**，`v10`/`v11`/DPAPI 魔数**全 false**，可打印比 0.24–0.38 ⇒ AES-GCM 形（79 = 51 明文 + 12 IV + 16 tag），**应用自有密钥**；`sk` 空、`auth_type=0` |
| 选择指针 | 未定位（不在 `state.json`）。靠 D3 原地更新绕开 |
| 缺口 | ① `ak` 铸不出 ⇒ D5；② `name` 里的模型名是**显示名**（`Raccoon (商汤) / DeepSeek-V4.1-Flash-1017`）而非路由名，换网关后目标是否服务同名需实测；③ 改 `name` 是否让 `custom_model_id` 失效未知 ⇒ 需一次差分取证 |

### 2.4 Qoder / Qoder CN ✅ 全明文可写

| 项 | 读数 |
|---|---|
| 权威面 | `~/.qoder-cn/settings.json`（16183 B），顶层 `['enabledPlugins','mcpServers','providers']`，**11 个 provider**，`apiKey` 明文 len 51 |
| 条目形状 | `qoder-custom-<uuid>` → `{baseUrl,apiKey,type:"openai-compatible",protocol:"openai",authType:"bearer",model,models:[{model,displayName,contextWindow,maxOutputTokens,capabilities:{vision,thinking:{modes,supportsEffort,supportedEffortLevels}}}],displayName}` |
| 现网地址 | 10 个指 `http://192.168.0.239:8080/v1`，1 个指 `http://127.0.0.1:8080/v1`；**11 个 key 全同一把** `e8b4f288d9ed` |
| 国际版 | `~/.qoder/settings.json`（266 B）只有 `enabledPlugins`/`mcpServers`，**providers=0** ⇒ 首次写入要建整个键 |
| 选择指针 | `com.qodercn.app.stable\main.sqlite` → `chat_model_preferences.model_key = byok:qoder-custom-<uuid>/<urlencoded-model>`（20 行，8 行是 byok）。**`byok_model_profiles` / `byok_model_credentials` 均 0 行** ⇒ 那两张表不是权威，settings.json 才是 |
| 另有形态 | IDE 形 `Roaming\Qoder` 的 `state.vscdb` 有 `aicoding.modelConfigs.cache.*`；CLI 形 `~/.qoder-cli`。本轮只认 settings.json 这一面，其余形态列为未覆盖 |
| 缺口 | 无（桌面 app 形）。`models[].capabilities` 要按目标网关的模型能力填，不能照抄旧值 |

### 2.5 Workbuddy 国际 = WorkBuddy ✅ 两处都明文

产品身份依据：`src/shared/channelRename.ts:29-30` —— `buddy` = 「CodeBuddy (腾讯)」（国内）、
`workbuddy` = 「WorkBuddy (腾讯)」（国际）；安装目录 `Roaming` 有 `WorkBuddy` + `CodeBuddy CN`。

| 形态 | 位置与形状 |
|---|---|
| Agent app | `~/.workbuddy/models.json`（1402 B，4 条）：`{id,name,vendor:"Custom",url,apiKey,supportsToolCall,supportsImages,supportsReasoning,useCustomProtocol}`；可选 `defaultEffort/maxInputTokens/maxOutputTokens/reasoning/supportedEfforts`。3 条指 `127.0.0.1:8080`（key `100cea77c7ce`），1 条直连 DeepSeek（len 35，**不是我们的，不动**） |
| IDE 形 | `%APPDATA%\WorkBuddy\User\globalStorage\state.vscdb` → ItemTable `CodeBuddy.settings` → **`.api.apiKey` 明文字段**（当前 `""`）、`.api.apiProvider="openai"`、`.api.apiModelId=""`、`.api.contextWindowSize=200000`、`.api.maxOutputTokens=-1` |
| 选择指针 | `user-state.json`(5 键)/`settings.json`(10 键)/`last-launch.json` 均无模型指针；`workbuddy.db` 无模型表 ⇒ 靠 D3 原地更新 |
| 权威面确证 | `resources/app.asar`（182 MB）里有符号 **`getModelsJsonApiKeyFields`** ⇒ 应用自己就是从 `models.json` 读 apiKey 字段；同一份 asar 里 **`oaicopilot` 字符串 0 命中** ⇒ 那套配置不属于 WorkBuddy |
| 缺口 | IDE 形 `.api` 段**没有 baseUrl 字段**（因为从未配过）⇒ 自定义 provider 下地址字段名未知，需一次差分取证。**主面（models.json）无缺口** |

### 2.6 Workbuddy 国内 = CodeBuddy CN ✅ 明文（与 2.5 IDE 形同扩展）

两家 IDE 是**同一个扩展** `tencent-cloud.coding-copilot`，`secret://` 键集完全一致。

| 项 | 读数 |
|---|---|
| 明文面 A | `%APPDATA%\CodeBuddy CN\User\settings.json` → `oaicopilot.baseUrl`（现值 `https://ark.cn-beijing.volces.com/api/coding/v3`，**不是 ModelPort**）、`oaicopilot.models`（6 条 `{id,owned_by,context_length,max_tokens,temperature,vision}`）、`oaicopilot.delay/readFileLines/retry` |
| 明文面 B | `state.vscdb` → `CodeBuddy.settings.api.apiKey`（明文，现 `""`） |
| 密文块 | 12 个 `secret://` 键，值 `{type:"Buffer",data:[44 B]}`，head **`763130` = "v10"** ⇒ Chromium os_crypt 形；但它们全是**缓存类**键（`CodeBuddy-Endpoint-Cache`、`chatSelectedModelGlobalMap`、`ACC_SHARE_CACHE_PRODUCT_MODELS`…），**不是凭据面** |
| 凭据入口 | `oaicopilot.setApikey` 是个**命令**（在 `sync/globalState` 的键位绑定里见到）⇒ 面 A 的 key 落点未定位；面 B 的 key 落点已确认明文 |
| 缺口 | 面 A 的 apiKey 存哪未知（settings.json 里没有、`secret://` 里没有对应键、扩展 globalStorage 目录只有 genie-history/message-queue/todos）⇒ 需一次差分取证；`~/.codebuddy` / `~/.codebuddy-cn` 均不存在 |
| **安装状态（本轮定案）** | 二进制仍未定位（`Local/Programs/CodeBuddy CN`、`Program Files*`、`Local/CodeBuddyExtension` 都不命中），但 `%APPDATA%\CodeBuddy CN\User\settings.json` **存在且已配置**（`oaicopilot.baseUrl` 是真 Ark 地址、`oaicopilot.models` 6 条）⇒ 写入面成立，按「已装」处理。二进制在哪不影响代写 |
| **选定写入面** | 只改 `settings.json` 的 `oaicopilot.baseUrl`（纯 JSON，不需要 SQLite）。`state.vscdb` 里的 `CodeBuddy.settings.api.apiKey` 当前是空串、且 `.api` 段没有 baseUrl 字段 ⇒ **那是从未启用的第二套面，本轮不动**。key 落点仍未定位 ⇒ 与 TRAE 同档：给一句手动步骤 |
| `oaicopilot` 归属 | 声明面**未找到**：WorkBuddy asar 0 命中、`.trae-cn/extensions` 43 个声明属性里无 `oaicopilot`、`CodeBuddyExtension` 空 ⇒ 它属于另一个未定位的扩展 |

---

## 3. 共享设计

### 3.1 一次切换的动作序列

```
壳选中网关 G
  ├─ 1 读 G 的 /v1/models（路由名域）+ /health
  ├─ 2 经 config:update 把「规范 key」写进 G 的 apiKeys（若已存在则跳过）
  ├─ 3 逐家生成写入计划（diff 形式，先预览）
  ├─ 4 用户确认 → 逐家落盘（JSON/TOML 直接写；SQLite 先查进程，见 D7）
  └─ 5 逐家回报：写了哪个文件、改了哪几个字段、验收结果
```

规范 key 的生成与分发是**幂等**的：同一把 key 铺到地址簿全部网关，之后任何一家客户端
持有的都是它，密文客户端从此只需改地址。

### 3.2 写入器契约（每家一个，形状可测）

沿用 `gatewayTrust.ts` 的权限模型：**页面不得传路径、不得传 PEM**，路径由主进程按产品
常量推导；写入器只接受「目标网关 origin + 规范 key + 模型清单」三个输入，输出
`{file, before, after}` 供预览。纯函数部分（TOML/JSON/ItemTable 值的变换）与 IO 分离，
测试只打形状，不碰真实用户目录。

### 3.3 模型名域

切网关同时换了**名字域**。Codex 的 catalog 必须按目标 `/v1/models` 整表重建；
Qoder 的 `models[]`、WorkBuddy 的条目、CodeBuddy 的 `oaicopilot.models` 同理。
`context_window` 遵守既有栅栏：**目标没广告就省略键，不填 0、不猜**。

### 3.4 不做的事

- 不给壳加监听端口（D1）。
- 不把客户端凭据写进 `gateways.json` / `secrets.json`（D2）。
- 不逆向 TRAE 的 AES 密钥、不伪造 vendor 客户端 UA / 版本 / 指纹。
- 不动用户手建的、没打我们标记的条目（含 WorkBuddy 那条直连 DeepSeek）。
- 不碰 Qoder IDE 形 / CLI 形、Trae 国际版（未安装）——列为未覆盖面，不假装支持。
- 不碰 **Trae CN 里装的 `tencent-cloud.coding-copilot` 扩展**（`.trae-cn/extensions/…-4.12.38765564-universal`）：
  那是 Trae 里的另一套自定义模型面，与 Trae 原生 `model_list_map` 互不消费，本轮不在范围内。

---

## 4. 缺口分档

### 4.1 我能解（纯代码 / 只读取证）

| 缺口 | 下一步 |
|---|---|
| Codex catalog 重建 | 按目标 `/v1/models` 生成 6 行同形状表 |
| Qoder 国际版 providers 键不存在 | 首次写入建键 |
| SQLite 写入被内存态覆盖 | 写前进程检测 + 拒写提示（D7） |
| 规范 key 分发 | `config:update` 幂等写入 |
| 写入器形状测试 | 纯函数 + 夹具，不碰真实目录 |

### 4.2 需你配合（一次性，之后不再需要）

| 缺口 | 要你做的 | 我拿到的 |
|---|---|---|
| TRAE 规范 key（D5） | 在 TRAE 自定义模型里把 key 改成规范 key，**一次** | 此后 TRAE 只改 base_url |
| CodeBuddy 面 A 的 apiKey 落点 | **先确认国内版还装着没有、装在哪**（本机找不到二进制）；若在用，配一次自定义 provider，我前后各快照一次 | 差分定位真实写入面 |
| WorkBuddy IDE `.api` 的地址字段名 | 同上，在 WorkBuddy IDE 里配一次 | 同上 |
| TRAE `name` 与 `custom_model_id` 的耦合 | 在 TRAE 里改一次自定义模型的名字 | 判断改名是否要重新注册 |
| Claude 验收（D6） | 给一台装了 Claude 的机器，或按我给的步骤验一次 | 端到端 200 |

**差分取证是只读的**：我只快照键名与值的长度/摘要，不打印凭据明文。

---

## 5. 里程碑

| # | 内容 | 完成判据 |
|---|---|---|
| M1 | 规范 key 分发 + 写入器契约 + 预览/确认 UI 骨架 | 壳里能对任一网关幂等铺 key；预览显示逐家 diff |
| M2 | **Codex** 写入器（TOML + 环境变量 + catalog 整表重建） | 切换后 `codex` 真跑通一轮，`state_5.sqlite.threads` 有新行 |
| M3 | **Qoder / Qoder CN** 写入器（settings.json providers 原地更新） | 客户端模型选择器里出现目标路由名，且发一条消息得 200 |
| M4 | **WorkBuddy**（agent app models.json，主面无缺口）+ **CodeBuddy CN**（先确认安装状态，再定 `oaicopilot.*` 还是 `CodeBuddy.settings.api`） | 同上；CodeBuddy 若已卸载则本格只交付 WorkBuddy，并明说国内版未覆盖 |
| M5 | **Trae CN**（base_url-only，D5 前置） | 同上；`custom_model_id` 保持原值 |
| M6 | **Claude**（按公开契约，验收挂起） | 代码 + 形状测试绿；端到端验收等 D6 |
| M7 | 收口：`npm run gate` 全量、文档同步、`tmp-*` 清理 | 门禁绿（两套 tsc 0 错 + 全量测试） |

M2–M5 每家独立可交付，不互相阻塞。M4/M5 依赖 4.2 的差分取证，**取证不做则该家只交付
「地址可写、凭据待确认」的半成品并明说**，不假装完成。

---

## 6. 验收（产出层 + 呈现层，两条都要）

**产出层**：`npm run gate` 经 SSH 全绿；写入器纯函数有形状测试；坏样本（目标网关不可达、
应用正在运行、模型名域为空）各自拒写并给出可读原因。

**呈现层**（每家都要，缺一不可）：
1. 客户端**模型选择器里真的出现**目标网关的路由名（不是只改了文件）；
2. 在该客户端里**真发一条消息拿到 200**，且网关请求日志里能按 `X-Request-Id` 找到那一行；
3. 切换回原网关后，原来的选中态还在（D3 的原地更新真保住了选择）。

只报「文件已写 / 门禁绿」不算完成。

---

## 7. 本轮取证产物与清理

只读探针脚本与日志（**全部待清理，无产品代码改动**）：
`tmp-client-config-probe{,2,3,4,5,6,7,8,9}.py` / `.log`、
`tmp-client-check.sh` / `.log`、`tmp-env-check.ps1` / `.log`（GBK 坏档）、
`tmp-env-check2.sh` / `.log`、`tmp-env-hash.sh` / `.log`。

凭据处理：全程只打印长度与 sha256 前 12 位，**没有任何凭据明文进入工具调用或日志**。

---

## 8. 执行记录（2026-11-14，批准后当轮落地）

### 8.1 落地清单

| 层 | 文件 | 职责 |
|---|---|---|
| 共享类型 | `src/shared/clientSync.ts` | 7 个客户端 id、7 种状态、预览/结果形状；`KEY_PLACEHOLDER`、`CODEX_ENV_KEY` |
| 纯函数 | `src/shell/clientSyncPlan.ts:224/279/314/355/381/408` | 六家写入器（Codex TOML / Qoder / WorkBuddy / Claude / CodeBuddy / TRAE），只吃字符串出字符串，不碰 fs、不碰 Electron |
| 路径与标签 | `src/shell/clientSyncPlan.ts:23/36/57` | `CLIENT_LABELS`、`isClientId`、`clientPaths`（放纯函数侧，测试才不会被 `addressBook → electron` 拖死） |
| SQLite | `src/shell/clientSqlite.ts:39/60/82/106` | sidecar 检查、LIKE 读、备份 + 选择性 `INSERT OR REPLACE` + 原子换名 + 重开校验 |
| 管理 RPC | `src/shell/clientSyncRpc.ts:44/53/64/99` | `managementCall`、`config:get` 读明文 key、`/v1/models` 取路由、规范 key 选取与幂等分发 |
| 编排 | `src/shell/clientSync.ts:217/507/515` | 一次 `gather` 同时服务预览与写入；`applySync` 只收 id，重新推导一切 |
| 进程/环境 | `src/shell/clientSync.ts:65/72/111/126` | Claude 安装判据、`tasklist`/`ps` 三态、User 环境变量读写（名与值走**子进程环境**，不上命令行） |
| 桥 | `src/shared/shellBridge.ts:198`、`src/shell/preload.ts:50-55` | `clients.preview()` / `clients.apply(ids)`，只有这两个方法过桥 |
| 主进程 | `src/shell/main.ts:1603/1623/1627` | `clientSyncInputFor` 走 `activeGatewayForSender`；两条通道都按发送方门控 |
| 页面 | `src/renderer/src/pages/ClientSync.tsx`（394 行） | 预览 + 勾选 + 确认框 + 逐行结果与备份路径 |
| 页内入口 | `Sidebar.tsx:119/180-182`、`App.tsx:79` | `/clients` 路由，懒加载，宿主门独立于网关管理 |
| 打包 | `electron.vite.config.ts:82`、`package.json` | `sql.js@1.16.0` 进 `exclude`（= 内联），依赖进 `dependencies` |
| 测试 | `tests/shell/client-sync-plan.test.ts`（30）、`tests/shell/client-sqlite.test.ts`（7）、`tests/shell/client-sync-key.test.ts`（7）、`tests/renderer/client-sync-surface.test.mjs`（10） | 形状 + 真实 SQLite 往返 + 规范 key 不变量 + 呈现层围栏 |
| 既有门扩清单 | `tests/build/shell-entries.test.ts`、`tests/build/main-bundle-deps.test.ts` | 四个新壳文件纳入「不得 import 网关树」清单；sql.js 必须内联 + 必须用 inline 构建 |

### 8.2 本轮推翻的旧判据（三条）

| 旧的 | 实测 | 改法 |
|---|---|---|
| 「`config:get` 也读不回明文，只能新铸 key」 | `handlers.ts:333` → `store.ts:1351` 返回**明文** `apiKeys`；掩码只存在于 `apiKeys.ts` 那条专用 REST 路由 | 规范 key **优先复用**（当前网关第一把 → 任一网关第一把 → 才新铸），分发是追加不是替换 |
| 「客户端地址在地址簿里才认」 | Qoder 10 条指 `192.168.0.239:8080`、TRAE 两个账号分别指 `192.168.0.239` 与 `192.168.85.131`，**都不在地址簿** | 判据换成**每家自己的自定义端点标记**：Qoder `type==='openai-compatible'`、WorkBuddy `vendor==='Custom'`、CodeBuddy 有 `oaicopilot.baseUrl`、TRAE `provider==='custom_openai_compatible'`、Claude 有 `env.ANTHROPIC_BASE_URL`。安全性靠 before→after 预览 + 备份，不靠地址白名单 |
| 「TRAE 下划线形那份没有端点字段」 | 3 个键全带 `base_url`（§2.3） | 读取用 `LIKE '%AI.agent.model.model_list_map'`，两种键形一起覆盖 |

### 8.3 设计取舍（自己拍的，依据与代价）

| 取舍 | 依据 | 代价 |
|---|---|---|
| **sql.js `dist/sql-wasm-inline.js`** 写 SQLite | Electron 33 = Node 20，没有 `node:sqlite`；原生 `.node` 要按 Electron ABI 逐平台重编；安装包里没有 `node_modules`。inline 构建把 wasm 以 base64 自带（964,922 B），rollup 可内联成单文件、零额外资产。已实测：无头初始化成功，1.2 MB 真实 Trae 库 254 行往返后字节长度一致 | 壳 bundle 增大约 1 MB；懒加载（`sqlEngine()` 里 `import()`），不同步 fork 的控制台不付这个钱 |
| **不重建模型表**（Codex catalog / Qoder `models[]` / WorkBuddy 条目 / CodeBuddy `oaicopilot.models`） | D3 原地更新 + 既有栅栏「`context_window` 没广告就省略，不填 0 不猜」。Codex catalog 的 `comp_hash` 推导方式未知，克隆等于伪造 | 名字域缺口不静默：逐行报 `unservedModels`，Codex 另报「没有 catalog 文件」；`model` 只在当前名目标不服务时才改（优先 `auto`） |
| **明文 key 不过桥** | 页面是网关发来的远程文档 | 计划里放 `KEY_PLACEHOLDER`，写入前替换；替换后仍含占位符则**拒写**（占位符落盘会看起来配好了但每条请求都失败） |
| **进程检测三态** | `tasklist` 失败时返回空集合会被读成「什么都没在跑」，从而写进活着的 fork | `{names, known}`；`known===false` ⇒ 状态 `blocked` 拒写，不是 `app-running` 也不是放行 |
| **Claude 安装判据 = 配置目录 OR MSIX 包目录** | Desktop 从不主动写 `settings.json` | 避免给不存在的客户端造文件 |
| **CodeBuddy 只写 `settings.json`** | `.api` 段从未启用（apiKey 空串、无 baseUrl 字段） | 不动第二套面；key 落点未定位 ⇒ 与 TRAE 同档给手动步骤 |

### 8.4 已取读数

| 项 | 读数 |
|---|---|
| `tsc --noEmit -p tsconfig.node.json` | EXIT=0，0 行 |
| `tsc --noEmit -p tsconfig.json` | EXIT=0，0 行 |
| `node --test tests/shell/client-sync-plan.test.ts tests/shell/client-sqlite.test.ts tests/shell/client-sync-key.test.ts` | **44 tests / 44 pass / 0 fail** |
| `node --test tests/renderer/client-sync-surface.test.mjs` | **10 tests / 10 pass / 0 fail** |
| 坏样本自证（临时副本树，5 个变异） | 删侧边栏入口 / 给预览类型加明文 `key` / 删一条 zh-CN 状态标签 / 让非 ready 行可勾选 / 页面自己 import `node:fs` —— **5 个全部按预期红，且红在对应那条测试上**；基线副本绿 |
| 坏样本自证（规范 key 门，6 个变异，原地改+`finally` 还原） | 用裸 `entry.url` / 删「目标不可达」守卫 / 删「目标写入失败」检查 / 删 Codex 的无 key 手动步骤 / 退回旧 `applySync` 守卫 / 让 TRAE 手动步骤无条件点名「规范 key」 —— **6 个全部 exit=1 且红在对应那条测试上**；还原后两份源文件**逐字节相同**，基线 7/7 绿 |
| `npm run gate` 全量（经 SSH，本轮只跑一次） | **EXIT=0**：build ✓ / build:daemon ✓（`modelport-daemon-1.8.13-x64.tar.gz`）/ 两套 `tsc --noEmit` 0 错 / **2595 tests，2595 pass，0 fail**，日志里 0 个 `✖`、0 行 `error TS`。日志 `/tmp/mp-gate-client-sync-5.log` |

门禁一共启动四次，只有最后一次作数：log 2 完整跑完（EXIT=0 / 2588 pass）但启动早于后续源码改动，**读数作废**；log 3、log 4 都在测试段被我主动终止（期间又改了源码，改动前的绿不作数）。终止本地 ssh 不会杀掉远端进程，两次都用 `pgrep` 找到孤儿 PID 后 `kill -TERM`，并确认无 `run-tests.mjs` 残留才重跑——并发门禁会挤 OOM 造整批进程级假红。log 5 的脚本自带「已有测试进程则拒跑」守卫。本轮临时脚本 `tmp-gate-run.sh` / `tmp-key-fence-probe.py` 已删除，工作树无 `tmp-*` 残留。

### 8.5 未覆盖边界（明说，不假装支持）

- **Trae 国际版**未安装；**Qoder IDE 形**（`Roaming\Qoder` 的 `state.vscdb`）与 **CLI 形**（`~/.qoder-cli`）不在本轮写入面。
- **WorkBuddy IDE 形** `.api` 段没有 baseUrl 字段（从未配过）⇒ 只写 agent app 的 `models.json`。
- **TRAE / CodeBuddy 的 key** 铸不出（应用自有加密）⇒ 各需一次手动输入。
- **Codex catalog** 不重建；`model_catalog_json` 与 `env_key` 两个字段刻意不动（裸文件名规则 + `comp_hash` 未知）。
- **非 Windows 平台**不能代写 User 环境变量 ⇒ Codex 那格给手动步骤而不是静默跳过。
- `src/types/sql.js.d.ts` 被 `.gitignore` 的 `src/**/*.d.ts` 命中（`src/types/zstd-codec.d.ts` 是当年强制加入的）⇒ **提交时必须 `git add -f`**，否则新检出 tsc 红。

### 8.6 需你做的（一次性，之后切换零手工）

| # | 动作 | 为什么只能你做 |
|---|---|---|
| 1 | 在 **Trae CN** 自定义模型里把 API Key 改成规范 key（页面会显示掩码） | `ak` 是应用自有 AES-GCM，控制台铸不出 |
| 2 | 在 **CodeBuddy CN** 自定义端点里把 API Key 改成同一把 | key 落点未定位，且不在明文面 |
| 3 | **Qoder 国际版**先手工加一个自定义模型（OpenAI 兼容） | `providers` 为 0；建条目要 uuid / 显示名 / 模型清单，那是「新建」不是「改旧」（D3） |
| 4 | 同步 Trae CN 前**先退出 Trae CN** | D7：它退出时整份回写状态，现在写会被覆盖 |
| 5 | 写完 Codex 环境变量后**重启客户端** | User 作用域环境变量只对新进程生效 |
| 6 | 逐家验收：选择器里出现目标路由名 + 真发一条消息拿 200 + 网关日志按 `X-Request-Id` 找到那一行 | §6 的呈现层判据，只报「文件已写」不算完成 |

### 8.7 复审改掉的三处「看着配好了其实 401」

落地后逐行复审 `clientSyncRpc.ts` / `clientSync.ts`，发现三处会让面板显示成功、客户端第一条请求就失败的缺口。三处都不是新需求，是 D4「一把规范 key」自身的完整性。

| # | 缺口 | 后果 | 改点 |
|---|---|---|---|
| 1 | 地址簿 url 未归一就与 `activeOrigin` 比较（`readBook()` 不归一，只有 `upsertEntry` 归一） | 旧条目带尾斜杠 ⇒ 找不到目标 ⇒ 走「任一网关第一把 key」的兜底，把那把 key 发给客户端，而目标从没接受过它 | `clientSyncRpc.ts:110` 每个条目先 `normalizeOrigin(entry.url) ?? entry.url`，请求、比较、分发行全用归一后的 origin |
| 2 | 目标管理面不可达（没存管理密钥 / 连接失败）时仍返回别的网关的 key | 同上：地址改了、key 是别家的 ⇒ 401，而面板一片绿 | `clientSyncRpc.ts:127-137` 目标不在 `reachable` 里就返回 `key: null` + 明说原因；`clientSyncRpc.ts:187-190` 目标那一格分发 `failed` 也返回 `key: null` |
| 3 | 没有 key 时 Codex / Qoder / WorkBuddy 三格不吭声 | 地址已改、key 还是旧的，行却读作「已指向目标」 | `clientSync.ts:456` 新增 `NO_KEY_MANUAL_STEP`，Qoder `:307` 与 WorkBuddy `:321` 在 `key === null` 时挂上；Codex `:269` 用自己的说法并点名 `MODELPORT_CODEX_API_KEY`（Codex 界面里没有填 key 的地方，说「在客户端里填」是误导）；Claude 那格本来就有自己的说法 |

连带一处：`applySync` 的守卫从 `preview.error && key === null` 改成 `plans.length === 0`（`clientSync.ts:521`）。旧守卫把「拿不到 key」和「地址无效」混成一件事，于是管理面不可达时连**只改地址 + 手动填 key** 这条合法路径也被拒；新守卫只拦真正无可写入的情形，占位符落盘仍由 `materialize` 拒写兜住。

还有一处措辞缺口（同一类，但只在文案上）：TRAE / CodeBuddy / 非 Windows 的 Codex 这三格**永远**要手动填 key，原文案无条件写「改成规范 key」，而没有规范 key 时页面顶部恰恰显示「取不到密钥」。改成「目标网关的 key」后两种情形都成立，不需要加分支（`clientSync.ts:259/338/450`）。

新门 `tests/shell/client-sync-key.test.ts`（7 条）把这些不变量钉住：归一、目标不可达不出 key、目标拒收不出 key、分发追加且幂等、Qoder/WorkBuddy 无 key 必挂手动步骤、Codex 无 key 时点名环境变量、任何手动步骤不得无条件点名「规范 key」、`applySync` 守卫口径。6 个坏样本各自红在对应那条上（读数见 §8.4）。

## 9. 移植 cc-switch 的客户端接入（11-14，按「不要自己分析，参考它的实现」执行）

来源 <https://github.com/farion1231/cc-switch>（MIT，Copyright (c) 2025 Jason Young），
克隆后逐个读取写入面，按本仓的分层落地（纯决策 / IO 分离，`node --test`）。

### 9.1 共享底座

| 本仓文件 | 移植自 | 职责 |
|---|---|---|
| `src/shell/clientLiveWrite.ts` | `live/engine.rs`、`mode/operation.rs` | 暂存＋fsync、首份备份（`<userData>/client-backups/live-first-write/` 加 `.source` 标记）、发布前重读比哈希、`client-write-journal.json` 与前进式恢复（`main.ts` 启动时 `recoverClientWrites`）、按路径加锁 |
| `src/shell/clientToml.ts` | `live/patch/toml.rs` | 行级 TOML：改/删键、整表替换、追加、按段引用的表名 |
| `src/shell/clientYaml.ts` | `live/patch/` 的 YAML 侧 | 缩进块级替换/插入、序列条目 upsert、`setNestedBlock` 嵌套路径；块外逐字节不变 |
| `src/shell/clientFormats.ts` | `live/patch/{json,dotenv}.rs`、`jsonc_document.rs` | dotenv 保行保 `export ` 前缀并去重、JSON5/JSONC 带注释的跨度定位与拼接、严格 JSON 整体重写 |

### 9.2 新增 13 个写入器

`claude-desktop`：两份配置写 `deploymentMode` 为 3p，profile 写 gateway 四键，`_meta.json` upsert 与 `appliedId`。**这就是「实测 Claude Desktop 写入无效」的根因**：原先写的 `~/.claude/settings.json` 是 Claude Code 的面，Desktop 不读它。
其余：`gemini`（`.env` 两个变量加 `security.auth.selectedType`）、`grokbuild`（整张模型表加 `models.default`）、`opencode`（V1 与原生两形）、`openclaw`（JSON5 的 `models.providers.<id>`）、`hermes`（`custom_providers` 列表项加 `model.provider/default`）、`kimi`（provider 表加按归属重建的 `[models.*]`）、`mcode`（`custom_provider.<id>`，`kind` 不是 custom 就让位）、`omp`（`models.yml` 的 `providers.<id>`，只有 `models.json` 时拒写）、`pi`、`copilot`（两个数组、`wireApi` 枚举）、`dsh`（各 profile 合并 `llm-pi-ai`，密钥进 `.credentials.yaml` 的 refs，profile 之间不一致就拒写）、`agy`（无持久端点可写，如实呈现 no-entry）。
同时 Codex 改为 `experimental_bearer_token`（不再写 Windows 用户环境变量，因此省掉「重启客户端」那一条），Claude Code 补「先清上一家的地板键」。

### 9.3 有意偏离与代价

1. 不删 Codex `auth.json`：cc-switch 删它并另存 stash，本仓没有 stash，删了不可逆；保留，靠 provider 表内显式 token 生效。
2. 注释保留按块生效：被改写的那个节点内部注释会丢（与 cc-switch 的 hermes/mcode 同口径），节点外逐字节不变。
3. `inferenceModels` 只写 `claude-*` 形状的路由名，其余省略，不伪造模型清单。
4. 密钥不进计划：计划里只有占位符；判 `unchanged` 需要真值时由主进程用 `keyValue` 现场比，页面永远拿不到。

### 9.4 门禁

`tests/shell/client-apps.test.ts`（21 条：逐家断言非目标字节不变、无 key 路径、幂等）、
`tests/shell/client-live-write.test.ts`（4 条：首份备份只一次、no-op 不动 mtime、删除留副本、journal 两种分岔的前进式恢复）。
