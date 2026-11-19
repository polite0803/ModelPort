# 视觉读图两段式（vision relay）

> 适用版本：v1.8.31+ ｜ 状态：现行（默认关闭） ｜ 日期：2026-11-19

## 它是什么

这一轮**真正服务的模型**收不下图时，网关先把请求里的图片交给一个**免费视觉模型**
转述成文字，再按原文本目标继续转发。已标注支持视觉的目标直发，本机制零介入。

审批记录：2026-11-19 用户拍板「要加，而且要逻辑完整：对于已经标注为 vision 的模型，
不需要采用两段式处理；对需要两段式处理的场景先验证 glm-4.6v-flash 是否免费可用」，
并追加「池中应该存在其它的免费视觉模型，不一定非得强行使用 glm-4.6v-flash」。
设计全文见 [`../plan/PLAN-vision-relay.md`](../plan/PLAN-vision-relay.md)。

## 触发判据（与派发同源，不另造）

| 场景 | 行为 |
| --- | --- |
| 开关关（缺省） | 全链路字节不变 |
| 请求不带图 | 零介入 |
| 路由路径：`select` 有候选 | 零介入（硬过滤保证候选能收图） |
| 路由路径：候选为空且 `missing` 含 `vision`，或 `pinBlocked.missing` 含 `vision` | 转述后重选 |
| 具名路径：目标 `visionOf` ≠ `yes` | 转述后按原目标转发 |
| 具名路径：目标 `visionOf` = `yes` | 直发 |

判据实现：`src/main/proxy/visionRelay.ts::routeDecisionNeedsVisionRelay`（路由）、
`autoRouter.visionOf`（具名，标注层与 `collectCandidates` 同一套）。
`select` 本身是「这一轮服务谁」的权威答案——本模块不另建一份「目标会不会收图」。

## 读图器候选链

- 配置 `visionRelay.reader` 显式点名：按显示名或 `<provider>/<model>` 精确命中，
  必须是 vision=yes；失败**不换家**。
- 缺省自动链：`autoRouter.relayCandidatePool()`（与选路同源采集）里 **vision=yes 且免费**
  的模型（`costClass='free'` 或渠道 `costBucket='free'`；`included` 套餐内**不进**），
  官方免费证据优先、目录免费其次、`open_router/openrouter/free` 这种元路由最后；
  同模型只取一个账号。链为空 → 两段式不介入（绝不静默用付费模型）。

## 转述与替换

- **全部图片部件都转述**（当轮 + 历史 + 工具结果），**绝不删除**——1.8.29 的铁律是
  「不静默丢图」，替换成自解释文本标记是合法形态：
  `[Image relayed via <reader>: <description>]`。
- 转述请求指令固定（`GATEWAY-TEXT: vision-relay-prompt`），只进 hop 请求，不进用户对话。
- LRU 按 `sha256(模板版本 + reader + 图片 url)` 缓存转述文本（上限 64 条）：同一张图
  每轮得到逐字节相同的标记，历史前缀稳定、prompt cache 不因措辞漂移失效。
- `file` / `video_url` 等读图器处理不了的视觉部件 → 整条 hop 放弃，走原错误，绝不半转述。
- data URL 超过 `maxImageBytes`（缺省 8MB）→ 判失败，不静默压缩图片。

## 隔离与可观测

- hop 走 `requestForwarder.forwardChatCompletion(..., { maxRetries: 0, probe: true })`：
  不占 AIMD、不进 Bandit/冷却/派发账本，usage 不并入主请求。
- 每次转述尝试落一条独立日志行：`kind: 'probe'`、`url: '/__modelport/vision-relay'`、
  `model` = 读图器显示名；拥塞时上游 429（如智谱 1305「overloaded」）按 5s/15s 退避
  最多 3 次；整条 hop 墙钟 60s，客户端断开即中止。
- 主响应带 `X-ModelPort-Vision-Relay: <reader>`。

## 配置

`appConfig.visionRelay`（缺省键不存在 = 关闭）：

| 键 | 缺省 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 总开关（读侧只认布尔 `true`） |
| `reader?` | 自动链 | 显式读图器 |
| `maxImageBytes` | 8388608 | 单图字节上限（data URL 解码后） |

设置页路径：上下文管理区「视觉读图两段式」卡片；读图器下拉的数据来自只读 IPC
`visionRelay:readers`（`autoRouter.relayCandidatePool()` + `relayReaderChainOf` 同一判据）。
读到持久化配置之前不渲染可编辑控件。

## 已知代价

- 信息有损：像素级细节在转述里丢失；默认关闭，由用户显式选择。
- 免费档拥塞时 hop 可能「慢后失败」（60s 超时→原错误），不是「快失败」。
- 首轮遇到多图历史时逐图转述，受总墙钟约束；超预算即整条放弃。

## 代码落点

`src/main/proxy/visionRelay.ts`（触发/收集/替换/链/缓存/hop）、
`src/main/proxy/routes/chat.ts`（两处挂点 + 响应头）、
`src/main/proxy/autoRouter.ts::relayCandidatePool` / `visionOf`、
`src/shared/visionRelayConfig.ts`（配置类型与归一）、
`tests/proxy/vision-relay.test.ts`（纯判据单测）。