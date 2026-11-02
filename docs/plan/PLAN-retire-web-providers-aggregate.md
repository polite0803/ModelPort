# PLAN：退役 web 页面接入，上线聚合供应商目录与免密免费池

日期：2026-10-28
状态：待拍板（Q1–Q7）

## 0. 裁定与边界

**新裁定**：web 页面接入模式的稳定性不在本仓可控范围内（上游网页接口与其反爬随时改），
因此全部下线；对外能力改由两类标准化上游承担：自带 Key 的 OpenAI/Anthropic 兼容端点，
以及不签名的公共免费池。

**本次推翻的旧拍板**（必须当场点明）：

| 退役项 | 现状 |
| --- | --- |
| DeepSeek / GLM / Kimi / Mimo / MiniMax / Qwen(千问国内站) / Qwen AI / Z.ai 共 8 家 web 接入 | `src/main/providers/builtin/{deepseek,glm,kimi,mimo,minimax,qwen,qwen-ai,zai}.ts` |
| 对应的 8 个逆向适配器（含 deepseek-stream） | `src/main/proxy/adapters/*.ts`，合计约 8.5k 行 |
| 对应的 8 个 OAuth 适配器与站内登录抓取 | `src/main/oauth/adapters/*.ts` + `inAppLogin.ts` 路径 |
| 对应的 8 个 forwarder 方法 | `src/main/proxy/forwarder.ts:493-1380` |
| 5 个只服务这些供应商的清单读取器 | `modelListReaders.ts`：kimi-available-models / qwen-cn-model-list / minimax-cloud-config / mimo-bot-config / qwen-double-data |
| qwen/zai 专用提示词工具链、qwen-ai 专用 transcript | `promptToolUse.ts`、`utils/transcript.ts` |
| 用这 8 家反推出来的默认模型映射 | `shared/types.ts` 的 `DEFAULT_DEEPSEEK_MODEL_MAPPINGS` 等 |

**保留**：`opencode` 本机运行时供应商。它不是网页接入，而是启动真实 OpenCode 客户端，
走的仍是同一个免费池，且客户端指纹由官方程序自己提供。

**明确不上线（附理由，见 Q1/Q2）**：
- OFM 的 10 个账号渠道（LobsterAI、Qoder×2、TRAE、Cline、Loomy、Raccoon、MiniMax Code、
  ZCode、Gemini Code Assist）：全部是浏览器登录 + 账号池，与被退役的类别同源。
- EAC 渠道：桌面宿主指纹闸门 + GitHub star 授权 + 密封凭据，本仓无法也不应复制。
- 匿名免费车道的 v2 客户端伪装：本机实测当前不可用（见 §1），且它是对
  "free tier can only be used from within OpenCode" 这条闸门的绕过。

## 1. 已核实读数（2026-10-28，本机直连）

### 1.1 参考仓库 `Ebony-Vinyl/dsh-our-free-model`（v2.7.2）

来源：`src/providers/registry.json`（124KB，76 条）。

| 维度 | 读数 |
| --- | --- |
| 供应商总数 | 76 |
| 声明模型总数 | 502 |
| 分类 | apikey 61 / free-tier 10 / local 3 / oauth 2 |
| 线路 | openai-chat 70 / anthropic-messages 3 / openai-responses 3 |
| 认证 | apiKey 69 / none 3 / adc 2 / oauth 2 |
| 无可用默认地址（必须用户覆盖） | `azure_openai`、`cloudflare`、`vertex`、`vertex-partner` |
| 模型清单为空（只能「发现模型」） | `azure_openai`、`ollama`、`lmstudio`、`llamacpp` |

三条 anthropic-messages：`anthropic`、`glm`(z.ai /api/anthropic)、`minimax-cn`。
三条 openai-responses：`openai_api`、`fleetrelay_t1`、`openai`(ChatGPT 订阅)。

### 1.2 两条免密来源的当日实测

| 目标 | 请求 | 结果 |
| --- | --- | --- |
| `GET https://api.kilo.ai/api/gateway/models` | 匿名 | **200**，401 个模型，其中 `isFree:true` **16 个** |
| `POST …/chat/completions`，`kilo-auto/free` | 匿名 | **200**，实际由 `nvidia/nemotron-3.5-super-vl:free` 应答 |
| 同上，`liquid/lfm-2.5-2.6b:free` | 匿名 | **429** `model_rate_limit_exceeded`（上游共享池限流） |
| `GET https://opencode.ai/inference/v1/models` | 匿名 | **200**，84 个 id（含 9 个 `*-free`） |
| `POST …/inference/v1/chat/completions`，`deepseek-v4.1-flash-free` | 匿名、无指纹 | **429** `FreeUsageLimitError: Free usage limit reached` |

结论只能说到这里：匿名车道在本机出口当前是配额耗尽状态，**不是**"加个指纹就能用"；
该车道按出口/会话计额，额度在别人手里。Kilo 池当前可用，但**单个模型会 429**
（共享池），必须靠 `kilo-auto/free` 这类自路由 id 或逐模型降级。

## 2. 落地形态

### 2.1 一个「聚合渠道」页 + 按需建供应商

不预建 76 张供应商卡（ProviderCard 一屏放不下、也无账号可填）。新增：

- 数据：`src/main/providers/aggregate/registry.ts`（由 `registry.json` 机械转写，带类型）
- 服务：`src/main/providers/aggregate/manager.ts`——列出目录、写 Key、启停、
  测试（列表探测）、发现模型、覆盖 baseUrl 与模型清单
- 存储：写 Key 时才创建 `type: 'aggregate'` 的 provider 记录（id 即注册表 id，
  如 `groq`），`initializeDefaultProviders` 只过滤 `type === 'builtin'`（store.ts:507-512），
  不会误删；记录里带 `apiEndpoint/baseUrl`、`chatPath`、`authHeader`、`wire`
- 账号：apiKey 类建一个带 `credentials.apiKey` 的账号；`none` 类（ollama/lmstudio/
  llamacpp/kilo-free）复用 `ensureLocalAccount`（store.ts:544）

### 2.2 模型命名：`<providerId>/<modelId>`

502 个模型里同名极多（`minimax-m3`、`kimi-k2.6`、`glm-5` 在十来家出现）。
现状 `/v1/models` 按 `displayName` 全局去重（`routes/models.ts:44`），
`loadbalancer.providerSupportsModel` 命中多家时会在多家之间轮询
（loadbalancer.ts:128-176）。因此聚合供应商一律以 `provider/model` 作为 displayName，
并写一条 `modelMappings`（`actualModel` = 原名，`preferredProviderId` = 该家），
走 `modelMapper.getPreferredProvider` 已有的偏好通路（modelMapper.ts:97）。

### 2.3 线路

| wire | 实现 | 覆盖 |
| --- | --- | --- |
| `openai-chat` | 复用 `forwarder.doForward` 默认分支（forwarder.ts:407-483） | 70 家 |
| `anthropic-messages` | 新增 `adapters/anthropic.ts`（请求转 messages/system/tool_use，流式 SSE 转 OpenAI chunk） | 3 家 |
| `openai-responses` | 暂不做；`openai_api` 改走 chat 线路 | 其余 2 家不列 |

认证头按注册表声明：默认 `Authorization: Bearer <key>`；`anthropic` 用 `x-api-key`；
`azure_openai` 用 `api-key`。URL 里的 `{placeholders}` 不做模板引擎，
一律要求用户在页面上覆盖 baseUrl（与 OFM 行为一致）。

### 2.4 免费池

新增一个 `kilo` 免密供应商：`auth: none`、baseUrl `https://api.kilo.ai/api/gateway`、
模型清单实时拉 `isFree:true`（新增 reader `openai-isFree-list`），默认模型保留
`kilo-auto/free`。当前 16 个免费模型。

匿名 OpenCode 车道不再实现；`opencode` 本机运行时保持现状，仍提供同一批免费模型。

## 3. 阶段

### P0 基线与门禁
- 记录当前 `npm run build`、两份 `tsc --noEmit`、`node --test` 的基线读数
  （288 条，2 条 Windows 环境失败）
- 备份 `~/.modelport/data.json` 到 `data.json.pre-aggregate.bak`

### P1 退役（纯删除，不掺新功能）
1. 删 8 个 builtin 配置 + `builtin/index.ts` 两条登记
2. 删 8 个适配器 + `adapters/index.ts` 导出；删 8 个 OAuth 适配器 + 两处 switch
3. 删 `forwarder.ts` 8 个方法 + 8 条 `providerForwarders` 登记 + 相关 import
   （`renderTranscript`、`buildCompletion` 之外的 7 家 import）
4. 删 5 个 reader 与其测试；`reader: 'auto'` 退化为只认 `openai-list`
5. 删 `promptToolUse.ts` / `utils/transcript.ts`（先 grep 确认无其它消费者）
6. 删 `DEFAULT_DEEPSEEK_MODEL_MAPPINGS` 及 `initializeDefaultModelMappings` 的播种
7. **凭据迁移**：启动时删除 `providerId` 已不存在的账号（`data.json` 里存着
   cookie / refresh_token / SSO ticket）。现状只 filter provider 不 filter account
   （store.ts:503-545），退役后会留一堆无主凭据
8. 删 i18n 8 个供应商块、8 个 icon、`docs/providers/<8 家>.md`
9. 删引用这些供应商的测试（16 个文件命中）

### P2 聚合注册表与线路
1. 转入 `registry.ts`（76 条，502 模型），加类别/线路/认证类型
2. `AggregateProviderManager`（CRUD、测试、发现模型、baseUrl/模型覆盖）+ IPC 通道
3. `anthropic.ts` 线路适配器 + 一致性测试（对本地 stand-in 断言帧形状）
4. 命名空间与 `modelMappings` 生成
5. `parameterPolicy`：聚合供应商**直通**全部参数（不做内置那套静默丢弃）

### P3 免密池
1. `kilo` 供应商（无凭据、本地账号）
2. `openai-isFree-list` reader + 测试（全收费清单 → 空池语义按既有惯例）
3. 失败语义：单模型 429 明确报 `rate_limit_error`，不伪装成可用

### P4 UI / i18n
1. `pages/Aggregate.tsx`：76 行目录表（搜索、按类别筛选、free 徽章、Key 输入、
   启停、测试、发现模型、baseUrl 与模型覆盖）
2. 导航入口、路由、两语言词条
3. 供应商图标不逐家做，用首字母徽章

### P5 文档与收口
1. 重写 `AGENTS.md` 的 Provider 章节（删除「8 家 web 接入」「在线清单」旧事实，
   写入聚合目录与线路契约）
2. `README.md` / `README_CN.md` / `CODE_WIKI.md` 同步
3. 全量门禁：build + 两份 tsc + 全量 test 只在最后一次跑
4. 真机冒烟：`/v1/models` 命名空间正确；Kilo 免密请求 200；启停与 Key 掩码

## 4. 待拍板

| # | 事项 | 建议 | 代价 |
| --- | --- | --- | --- |
| Q1 | OFM 的 10 个账号渠道是否也上线 | 不上线：与被退役的网页登录同类 | 少 10 家「登录即用」入口 |
| Q2 | 匿名 OpenCode 免费车道是否移植（需伪造 v2 客户端指纹） | 不移植：本机实测已 429，且是对闸门的绕过；`opencode` 本机运行时提供同一批模型 | 免费模型可用性取决于该运行时额度 |
| Q3 | 模型名是否加 `provider/` 命名空间 | 加：502 个模型重名太多，不加则路由不可预测 | 客户端模型名变长；旧名不再广播 |
| Q4 | UI 形态 | 一个「聚合渠道」页，按需建供应商 | 新增 1 页；不动现有 ProviderCard |
| Q5 | 退役后是否删除已存账密 | 删除，先备份 data.json | 用户需重新填 Key（本来也要换） |
| Q6 | 聚合供应商的参数策略 | 直通，不套内置那套静默丢弃 | 少数端点会因未知字段 400，按错误如实回报 |
| Q7 | Responses 线路 | 不做；`openai_api` 走 chat | ChatGPT 订阅 OAuth 与 FleetRelay 不上线 |

## 5. 验收口径

- 门禁三段：`npm run build`、两份 `tsc --noEmit`、`node --test`（全量只跑一次）
- 新门必须有坏样本自证：命名空间冲突、anthropic 帧形状、Kilo 全收费清单
- 冒烟必须走真实入口：应用内聚合页写 Key → `/v1/models` 出现 `provider/model` →
  一次真实流式请求；Kilo 免密请求必须有 200 读数
- 退役面自证：启动后 `data.json` 不再含 8 家 provider 与其账号；
  `/v1/models` 不再广播这 8 家的任何模型
