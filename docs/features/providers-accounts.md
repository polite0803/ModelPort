# 渠道与账号（聚合目录 / 账号渠道 / 自定义）

> 适用版本：v1.7.0 ｜ 最后核对：2026-11-04 ｜ 状态：现行

## 这个功能点是什么

ModelPort 把上游分成三类，界面也对应三块：聚合目录、账号渠道、自定义供应商。三类最终都被写成同一种供应商记录（`Provider`），再由 `loadbalancer` 选账号、`modelMapper` 解析模型名、`forwarder` 转发请求；区别在于记录怎么来、凭据怎么拿、模型清单谁说了算。

聚合目录是数据表：`src/main/providers/aggregate/registry.ts` 里有 89 条渠道、570 个模型，覆盖带 Key 的 HTTP 端点、免密端点，以及标记为“本应用无法提供凭据”的 Google ADC 条目（`vertex` / `vertex-partner`）。用户在聚合页面选中一条、填 Key（若需要）后保存，才会生成 `type: 'aggregate'` 的供应商记录，因此供应商列表不会预先塞进几十条不可用行。

账号渠道是登录型端点：13 个渠道（`lobsterai`、`qoder`、`qodercn`、`trae`、`cline`、`loomy`、`raccoon`、`minimax`、`zcode`、`gemini`、`workbuddy`、`buddy`、`opencode`）由内置的“渠道包”托管登录、账号池、每日积分与模型目录。十二个走浏览器/设备码/OAuth，`opencode` 是唯一 `loginKind: 'api-key'` 的例外：不打开浏览器，加一条匿名槽或粘贴 `sk-` Key 即可。

自定义供应商由用户自建：名称、端点、认证方式、请求头、模型与凭据字段都自己填，适配器走 OpenAI 兼容的默认转发路径。内置供应商（`builtinProviders`）目前为空；2026-11-01 退役的本机 `opencode` 运行时已不再是供应商。

聚合目录的额度与价格是**生成旁车**，不是运行时抓取：`docs/data/**` 下的取证回执经构建脚本生成 `src/shared/aggregateQuota.ts` 与 `aggregatePricing.ts`，所以“没有公开上限”的条目标为 `undocumented`，它不阻止任何候选。实时额度是另一回事：聚合详情页点一次问一次，命中严格的“整行成立、非 unlimited、问到数、`<=0`、快照 15 分钟内”条件时只把余量折成闸门，不把美元、人民币与 token 三种计数域换算成同一个数。〔v1.5.5 起〕

账号渠道的宿主只负责“把渠道包的账号池与模型目录投影成供应商记录”。登录、刷新、每日签到、额度领取都在渠道包 worker 里完成；宿主通过 RPC 读 `model.list`、`credits.claimAll` 与账号快照。账号凭据由 `vault` 加密封存（`v1:` 前缀），编辑账号时渲染层拿不到已存明文，解不开的密文按“凭据不可用”处理并留日志。〔v1.4.2 起〕

## 关键行为与不变量（必守约束）

- **聚合目录只写用户保存过的记录**。`manager.ts` 不会为每条目录条目预建供应商；记录字段包括 `type: 'aggregate'`、`id` = 目录 id、`wire`、`authHeader` / `authPrefix`、`aggregateId`、`supportedModels`、`modelMappings`。〔v1.4.1 起〕
- 聚合模型显示名为 `<providerId>/<modelId>`；保存时同时写 `provider.modelMappings` 与全局 `config.modelMappings`（带 `preferredProviderId`），删除供应商时两处一起删。这是负载均衡把名字路由到唯一条目的依据。
- 带 Key 的聚合条目**一个 Key 一条账号**；负载均衡在该条目的账号间轮转，限流的 Key 自然落到下一个。免密条目（`kilo`、`ollama`、`lmstudio`、`llamacpp`）也会创建空凭据的本地账号，否则负载均衡没有可路由对象。
- `authKind: 'none'` 且 `autoProvision: true` 的条目会在启动时自动开通（例如 Pollinations、OVHcloud）；用户在界面删除后，id 记入 `dismissedAutoProviders`，下次启动不会复活。
- `authKind: 'unsupported'` 的条目（Google ADC）会列出但拒绝保存（`unsupported_auth`），不伪装成“填个 Key 就能用”。
- Base URL 含 `{placeholders}` 的条目（Azure、Vertex）**不会自动展开**，必须先由用户覆盖，否则请求会带着占位符发出。
- 聚合线路有三种：`openai-chat` 复用默认转发分支（86 条），`anthropic-messages` 经 Anthropic 适配器转换消息/工具块并回吐 OpenAI chunk，`openai-responses` 仅出站（`/responses`，在构建 chat body 之前接管）。
- 聚合模型同步 `syncModels` 只**增加**模型，不删除用户已有条目；探测失败才回退 models.dev，上游明确回答“零模型”时绝不用第三方列表覆盖，上游有列表时上游优先（三态判据在 `planSyncModelIds()`）。
- 账号渠道的模型目录以渠道包 `model.list` 为准，不是 OpenAI 形状的 `/v1/models`；后者只用于每轮缓存刷新时补 `context_window`。倍率只存在于显示名（`· x4.0`、`· x0.2→x0.1`、`· 免费` 三种形状）。〔v1.4.2 起〕
- 倍率缺失保持 `undefined`，**绝不写 0**；`isFree: true` 优先于标签；`contextWindow` 缺失保持缺失，不猜一个数字（猜小会让长上下文请求硬过滤掉整个渠道）。
- `disabled` 与 `dead` 模型保留在目录里（否则用户再也打不开/恢复不了），但 `syncProviders` 只把两者之外的模型写进 `supportedModels` / `modelMappings`。死模型的唯一自愈是 30 天 TTL 或用户点“清除死模型”。
- 账号渠道 **零账号时删除供应商记录**；有账号但模型列表为空时记录 `enabled: false`，因为启用但无模型的记录会被 `providerSupportsModel` 当成通配目标，吞掉所有模型名。
- 账号渠道记录是 `type: 'account'`、`apiEndpoint: channel://<id>`（仅占位、永不请求）、`supportsModelFetch: false`；模型名为 `<channel>/<model>`，worker 按第一个 `/` 切分，不能二次加前缀。
- 三个模型写操作（`channels:refreshModels`、`channels:setModelDisabled`、`channels:clearDeadModels`）都会清空**整个**目录缓存并跑全量 `syncProviders`；只刷一个渠道会让其他渠道看起来“没有模型”。
- `opencode` 不走 `account.create`：宿主必须调渠道包的 `opencode.addAccount` / `opencode.addAnonymous`，随后执行 `rpcSync` 的 resync 与 `notifyChanged()`。渠道包对这两个方法不发 `changed`，漏掉 resync 会得到“账号进了池子、供应商卡片仍显示未配置”。〔版本待考〕
- 渠道 worker 不能放进 asar：`resources/channel-pack` 通过 `extraResources` 复制，打包后从 `process.resourcesPath/channel-pack` 加载。spawn 必须带 `DSH_CHANNEL_PACK_STATE_DIR=<dataDir>`（否则写进用户真实 `~/.dsh`）与 `DSH_OPENAI_GATEWAY_ENABLED=0`（否则固定端口 8326 与第二个实例冲突）。
- 账号渠道的宿主重试预算是**一次 500ms**；渠道包内部已经处理排队、额度与换号，宿主的额外重试只会重复解密历史与重打上游。该策略只允许降低调用方给的预算，不会抬高。
- `opencode` 免费车道按出口 IP 限流，因此每个账号可单独配代理；403 表示客户端形状被拒，429 表示形状通过但该出口的匿名额度用尽，两者诊断含义不同。
- 自定义供应商端点必须是 `http://` 或 `https://`；`channel://` 只用于内部账号渠道占位。自定义与聚合参数**全部透传**，内置供应商才会静默丢弃不支持的采样参数。
- 聚合额度旁车（`shared/aggregateQuota.ts`、`aggregatePricing.ts`、`aggregateCapabilities.ts`）只能由 `docs/data/**` 的回执重新生成，禁止手改产物；`undocumented` 是“没有公开上限”，不是“没有额度”，不参与候选淘汰。
- 重置时间一律派生，不落库；`smart` / `pace` 算不出重置时退回 `fill-first` 顺序，耗尽额度的候选只作最后手段，不会被强选。
- 账号渠道的余额门控是 fail-open：探测超时（60 秒）或失败（5 秒 TTL）都放行，只有确认余额为 0 的账号才被跳过；`DSH_ACCOUNT_BALANCE_GATE` 可整体关闭。〔v1.4.4 起〕
- 账号渠道的账号 `weight` 缺失表示“无偏好”，不是 0（界面显示 0 即“不限”）；免费标记 `isFree` 优先于倍率标签；死模型 30 天 TTL 到期才自动清理，期间保留可恢复入口。
- `channels:*` 的账号增删改后都要广播「渠道池已变化」事件，让冷却与余额门控失效；只改 `data.json` 而不通知，会让旧冷却继续挡着已经换好的账号。
- 渠道 worker 崩溃或退出时，下一次请求会重新拉起进程；进程死亡本身不计入账号故障，只有请求链上的失败才影响评分。
- 登录型渠道按 `loginKind` 分派：`browser` 打开授权页回传回调，`device-code` 轮询设备码，`oauth` 走刷新令牌；`opencode` 的 `api-key` 不打开浏览器，匿名槽与 `sk-` Key 都是合法凭据。
- 供应商别名若被用户停用，状态落在 `ModelMapping.disabled` 而不是 `excludedModels`：别名不属于任何供应商目录，不能靠“从目录删除”来表达。
- 所有供应商记录最终共享同一套 `modelMappings` 名字域；`/v1/models` 只宣传路由，不宣传“目录里存在但没被任何路由选中”的条目。
- 模型是否加入候选池由“启用状态 + 路由池策略”决定；`supportedModels` 为空不等于“支持所有模型”，只有账号渠道的空目录被显式置为 `enabled: false` 来避免通配。
- 聚合、账号渠道、自定义的删除都是硬删除记录；账号渠道的硬删除会连带账号池，聚合的硬删除会连带全局模型映射，二者都不可通过“重新同步”恢复用户手填的 Key。

## 配置项与默认值

| 配置键 | 默认值 | 作用 |
| --- | --- | --- |
| `modelListRefresh.enabled` | `true`（键缺席即默认） | 模型清单定时刷新总开关 |
| `modelListRefresh.accountChannels` | `true` | 账号渠道预热是否注册 |
| `modelListRefresh.aggregate` | `true` | 聚合目录同步是否注册 |
| `modelListRefresh.builtin` | `true` | 内置供应商拉取是否注册 |
| `modelListRefresh.accountIntervalMs` | 1 周 | 渠道包本地 `model.list` 周期 |
| `modelListRefresh.aggregateIntervalMs` | 2 周 | 聚合/内置的真实 HTTP 周期 |
| `dismissedAutoProviders` | `[]` | 用户删除过的免密自动开通条目 |

模型发现结果写入 `userModelOverrides[providerId].fetchedModels` 与 `fetchedAt`，不写 `provider.supportedModels`；手工能力标注单独放在 `userModelMarks`，避免同步覆盖用户纠正。

`modelListRefresh` 的周期在设置页按“天 / 周 / 月”选择，但落库仍是毫秒值；“月”档的毫秒值超过 `setInterval` 的 2^31-1 上限（约 24.8 天），必须走调度器的长周期实现，否则定时器会立刻触发。〔v1.7.0 起〕

账号渠道还读取环境变量 `DSH_ACCOUNT_BALANCE_GATE`（关闭余额门控）；渠道包进程由宿主注入 `DSH_CHANNEL_PACK_STATE_DIR` 与 `DSH_OPENAI_GATEWAY_ENABLED`，这两个变量不是用户配置项。

## 相关代码位置

- `src/main/providers/aggregate/registry.ts` — 89 条 / 570 模型目录
- `src/main/providers/aggregate/manager.ts` — 保存、账号、同步、额度探测
- `src/main/providers/accountChannels/catalogue.ts` — 13 个渠道元数据
- `src/main/providers/accountChannels/manager.ts` — 供应商记录镜像与模型门禁
- `src/main/providers/accountChannels/modelCatalog.ts` — 倍率/免费/窗口解析
- `src/main/providers/accountChannels/rpcSync.ts` — 渠道包 RPC 后重同步
- `src/main/providers/accountChannels/vault.ts` — 渠道凭据加解密
- `src/main/providers/custom.ts` — 自定义供应商校验与增删改
- `src/main/channelPack/bridge.ts` — worker 启动、消息通道、路径解析
- `src/main/providers/modelListSource.ts` / `modelCatalog.ts` — HTTP 模型来源与探测
- `src/main/scheduler/modelListRefresh.ts` — 三类来源统一调度
- `src/main/oauth/manager.ts` — OAuth 登录会话
- `src/shared/aggregate.ts` / `aggregateCredit.ts` / `channels.ts` — 目录、余额、渠道类型
- `docs/providers/README.md` / `docs/providers/opencode.md` — 分类与单渠道说明

## 版本沿革

| 版本 | 变化 | 证据 |
| --- | --- | --- |
| v1.4.1 | 聚合渠道目录（API Key / 免费额度 / 本机三类，openai-chat 与 anthropic-messages 两种线路）；十个登录账号渠道 | CHANGELOG「v1.4.1」条目 |
| v1.4.2 | WorkBuddy 登录渠道族；账号渠道目录同步、成本分桶、停用/死模型处理；免费额度账本 | CHANGELOG「v1.4.2」条目 |
| v1.4.4 | 余额门控选号（8 个渠道，fail-open，60s/5s TTL，`DSH_ACCOUNT_BALANCE_GATE` 可关） | CHANGELOG「v1.4.4」条目 |
| v1.4.7 | 手工能力标注独立成 `modelMarks`；聚合能力旁车 | CHANGELOG「v1.4.7」条目 |
| v1.4.10 | OpenCode 本机运行时退役，不再作为内置供应商 | CHANGELOG「v1.4.10」条目 |
| v1.5.0 | 渠道按上游能力决定签到按钮（`dailyCheckin` 必填） | CHANGELOG「v1.5.0」条目 |
| v1.5.5 | 聚合实时额度接通，余量只当闸门不当数字 | CHANGELOG「v1.5.5」条目 |
| v1.6.0 | 聚合目录新增 10 条国内主站与套餐端点，套餐与按量严格分条 | CHANGELOG「v1.6.0」条目 |
| v1.7.0 | 供应商模型清单定时刷新收进统一调度器，账号渠道/聚合/内置三类可按天/周/月预热 | CHANGELOG「v1.7.0」条目 |
