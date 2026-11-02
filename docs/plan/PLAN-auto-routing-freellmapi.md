# PLAN: auto 路由升级——借鉴 FreeLLMAPI

> 来源：[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)（README + architecture 文档）智能路由特性调研，2026-10-30。
> 原则：只借对本项目（积分制账号渠道）划算的部分；每项独立可落地、可单独验收。

## 已有等价能力（不再重复建设）

| FreeLLMAPI 特性 | ModelPort 对应物 |
|---|---|
| 429/5xx fallover + cooldown | forwarder.ts `forwardFirstReachable`（3 家上限） |
| 配额事后学习 | quota/observations.ts（learnFromErrorBody/Headers） |
| 限流感知 | model.rateLimits rpc 预检（问渠道 worker）+ 余额门控 |
| 会话粘性 | autoRouter 粘性打分 |
| Prompt 压缩 | compression 模块 |
| 流式失败感知 | firstStreamEvent + probeSseHead（比它细） |

## P0 —— 本周可落地（小改动，高确定性）

### 1. 墙钟预算 + 分级尝试上限
- **借鉴点**：它 20 次尝试受 wall-clock 预算约束；我们固定 `AUTO_MAX_ATTEMPTS=3` 一刀切。
- **方案**（autoRouter.ts + forwarder.ts）：
  - 换家上限按错误类分级：账号故障类（5xx/网络/冷却）维持 3 家；可恢复类（排队 ModelQueuedError、限流预检后新解禁）放宽到 6 家；
  - 新增总时长预算（建议 90s，常量入 shared/config）：`forwardFirstReachable` 循环内每轮检查 `Date.now() - startTime > budget` 即停止换家，返回最后失败；
  - startTime 已在 `attemptRequest` 传递，无需改签名。
- **验收**：单测覆盖「预算耗尽返回最后错误」「排队类错误允许第 4~6 家」；全量测试 + 构建。

### 2. 降级可观测（跳过原因透出）
- **借鉴点**：顶部链配额耗尽时它明确降级；我们静默跳过，客户端不知道为什么没走某渠道。
- **方案**（chat.ts）：
  - 预检/maxTools 剔除候选时收集跳过清单：`loomy/spark-x2.6: quota_until_midnight`、`cline:tools_limit`；
  - 写入响应头 `X-ModelPort-Auto-Skipped`（复用 toHeaderValue 编码），与已有 `X-ModelPort-Auto-Degraded` 并列；
  - 客户端 harness 可据此提示「已跳过 xx（当日额度用尽）」。
- **验收**：单测断言头存在与编码；手动验证 loomy 限流场景头部内容。

## P1 —— 中等改动

### 3. 主动配额账本（本地消耗轨迹）
- **借鉴点**：它按 `(平台,模型,key)` 记 RPM/RPD/TPM/TPD 并从响应学习上限，路由前排除越界者；我们目前是「撞了才知道」（事后反应）。
- **方案**（新模块 quota/ledger.ts）：
  - 内存 `Map<channelId|modelId|accountId, {rpm, rpd, tpm, tpd, windowStart}>`，请求成功后累计（数据源：usage 结算处已有 per-request token 数）；
  - 上限来源：429 响应头的 x-ratelimit-*/retry-after（learnFromHeaders 扩展为写账本上限），未学到的渠道不设限（只计数不拦截）；
  - autoRouter.select 候选打分时扣分/过滤：RPD 剩余 < 10% 降权，耗尽直接跳过；
  - 与 model.rateLimits 预检并存：账本管「自己看到的消耗」，rpc 预检管「渠道内部限流」，互为冗余；
  - 定时（每 5 分钟）把账本快照写 data.json 或独立文件，重启恢复。
- **验收**：单测覆盖计数窗口滚动、上限学习、过滤打分；production 构建后观察 request-log 与账本一致性。

### 4. 工具能力位过滤（带工具请求只路由到支持的模型）
- **借鉴点**：它的 tool-call 路由只发给声明支持工具的模型；maxTools 只限数量，不限能力。
- **方案**（shared/channels.ts + autoRouter.ts）：
  - `ChannelDefinition` 加 `capabilities?: { tools?: boolean; vision?: boolean }`；
  - 候选过滤：`request.tools?.length > 0 && capabilities.tools === false` → 跳过（与 maxTools 同一循环）；
  - 能力盘点：首轮按渠道文档/实测填 loomy/raccoon/minimax 等的 tools 支持，缺省 undefined = 不限（fail-open）；
  - 可选进阶：从 worker `model.list` 返回的模型元数据读取 per-model 能力位（vendor 已有 model 目录结构）。
- **验收**：单测 + 真实带工具请求路由验证。

## P2 —— 观察收益后决定

### 5. Bandit 实时评分
- **借鉴点**：Thompson-sampling 按 live 成功率/速度/能力/余量四维自适应排序；我们是启发式静态权重。
- **方案**（autoRouter.ts，渐进式）：
  - 第一步：从 request-logs.ndjson 按 `(providerId, actualModel)` 滚动 24h 统计成功率与 TTFT p50，作为评分因子替换静态分（静态权重先行，不上 sampling）；
  - 第二步（观察后）：引入 Thompson sampling 处理探索/利用平衡；
  - 注意冷启动：新账号/新模型用乐观先验，避免永远轮不到。
- **验收**：离线回放 request-log 对比新旧排序的命中率。

### 6. 换模型后的粘性交接（可选，低优先级）
- auto 中途换家后调用 `autoRouter` 的粘性记账把会话粘到新模型（若尚未如此）；交接摘要（context handoff）属于客户端体验层，ModelPort 侧可先不做，观察 harness 反馈再定。

## 明确不借鉴

- **Fusion 多模型合成**：一次烧 N 家积分，与积分制账号模型冲突。
- **20 次尝试**：免费池失败零成本；积分账号每次失败可能烧钱，保持保守。
- **自更新签名目录**：账号渠道模式没有免费 key 池的目录维护问题。

## 附：发布流程备忘（本轮踩坑）

- 改动涉及 vendor 时构建链：vendor `tsc --noEmit` → 主进程 `tsconfig.node.json` → `node --test` → `npm run build` → `electron-builder --win --x64` → **安装重跑**（用户运行安装版，工作区 out/ 不生效）。
- 已知问题：electron-builder 的 winCodeSign 缓存 7z 解压失败（exit 1，重试 3 次仍败）→ 处理办法：删除 `C:\Users\刘小平\AppData\Local\electron-builder\Cache\winCodeSign` 后重跑。
- **待办**：2026-10-30 22:31 的打包因上述缓存问题失败，22:23 的 setup.exe 尚不含 model.rateLimits 剥前缀修复（loomy 限流预检在已装版本上仍会漏拦）——重新打包安装后生效。
