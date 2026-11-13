# OpenCode

> 适用版本：v1.8.11 ｜ 最后核对：2026-11-13 ｜ 状态：现行

“OpenCode”在这个仓库里指三件互不相关的东西，只有下面第 1 项是本文档的对象。

| 名称 | 是什么 | 状态 |
| --- | --- | --- |
| 账号渠道 `opencode` | 渠道包里的登录渠道，走 `https://opencode.ai/inference` | 现存 |
| 聚合条目 `opencode_zen` / `opencode_go` | 带 Key 的 HTTP 聚合渠道（`/zen/v1`、`/zen/go/v1`） | 现存，与本文无关 |
| 内置 `opencode` 供应商（本机运行时） | 曾启动 `opencode-ai` 并驱动其本机 HTTP/SSE 服务 | 2026-11-01 已退役 |

本机运行时退役的原因：免费档校验客户端形状（`User-Agent: opencode/<channel>/<version>/<client>`，
主版本需 >= 2，1.x 会被 `403 FreeTierError` 拒绝），而可分发到本机的 `opencode-ai` 线停留在
1.19.5，`opencode.ai/install` 也不提供 2.x，因此这条运行时通路无法成为上游接受的客户端。旧文档
里的 envelope / `permission` / `invalid` 工具结论来自 1.19.4 的逐行阅读，未在 2.x 复验，已随
`src/main/opencode/`、`providers/builtin/opencode.ts`、`proxy/adapters/opencode.ts` 一并移除。

## 账号渠道 `opencode`

| 项目 | 说明 |
| --- | --- |
| 渠道 ID | `opencode` |
| 类型 | 账号渠道（`loginKind: 'api-key'`），不打开浏览器 |
| 端点 | `https://opencode.ai/inference` |
| 凭据 | 匿名槽位无需凭据；粘贴 `oc_sk_` Key 可解锁付费模型（官方格式，2026-11-13 实测；校验**不按前缀**白名单，只挡空白/非 ASCII/明显半截） |
| 免费额度 | 免费档按出口 IP 限额，因此每个账号可单独配置出口代理 |

添加账号时宿主调用渠道包的 `opencode.addAccount` / `opencode.addAnonymous`，而不是通用的
`account.create`。这两个方法不会广播 `changed`，所以宿主必须在调用后执行
`accountChannels/rpcSync.ts` 的 resync 并 `notifyChanged()`；否则账号会进入池子，但供应商记录
不会出现，卡片会卡在“未配置”。

### 多条匿名槽与出口代理

每个匿名槽是账号池里一条**普通条目**（凭据为字面量 `public`，id 形如
`opencode-anon-xxxx`），在「添加账号 → 加一条匿名槽」上可以重复添加，代码不设数量上限。
但**加槽不等于加额度**：匿名额度按**出口 IP** 计，同一出口上的多条槽共享一份配额桶，
额度耗尽时它们一起失败。有效的扩容手段只有「给不同槽配不同出口」。

每个账号（含匿名槽）可单独配置出口：账号行的「出口代理」按钮调用
`opencode.setProxy` / `opencode.testProxy`，前者负责归一并落盘，后者经该代理请求出口 IP
回显结果。代理表单接受 http / https / socks5，裸 `host:port` 自动补 `http://`，**必须显式
写端口**，支持 `user:pass@`；面板拿到的现有值由 `account.list` 的 `proxyLabel` 回传，口令
始终被掩码。清除代理 = 回到与其它无代理账号共享的本机出口。

账号行的「刷新凭据」按钮（`account.refresh`）对 OpenCode 只能做**重读该账号自己的 ref
并规范化回写**：静态 API key 没有续期端点，匿名槽更是字面量 `public`。不做在线判断是刻意的
——`GET /v1/models` 实测不鉴权（匿名 Bearer 也 200），拿它当 key 探针会造假成功；唯一的鉴权
探针是 chat 端点，会真花额度。key 被吊销时下一次真实请求即 401，刷新不替上游下结论。

匿名槽的指纹按**条目 id** 派生（`api_key` 全是 `public`，用它派生会让所有匿名槽拿到同一份
身份）。这份差异性只用于防关联，不参与配额计算——换 key、换伪装头、换指纹都不会多出额度。

### 实测读数（2026-11-01，本机出口）

| 请求 | 结果 |
| --- | --- |
| `GET /inference/v1/models` | 200 |
| `POST /inference/v1/chat/completions` | 429 `FreeUsageLimitError` + `retry-after` |

`403` 与 `429` 的区分就是全部诊断：403 表示客户端形状被拒绝，429 表示形状通过、但该出口 IP 的
匿名额度已用尽。接入这条渠道只代表它被诚实地列出来，不代表立刻可用。

### 额度复位：`retry-after` 是权威（2026-11-13 实测）

同一天补测（`POST /inference/v1/chat/completions`，`Bearer public`）：

| 读数 | 值 |
| --- | --- |
| 状态 / 类型 | `429` · `FreeUsageLimitError`（不是 `FreeTierError` ⇒ 形状通过） |
| `retry-after` | `75411` 秒 ≈ 20.9 小时 |
| `03:03:09Z + 75411s` | `2026-11-14T00:00:00Z` = **08:00 CST** |

⇒ 免费额度是**按日的固定窗口**，在 `00:00 UTC` 复位；上游每次都会把到那一刻的秒数写进
`retry-after`。渠道包据此标记该槽受限，**不钳位**（只保留 7 天防畸形头的上界，
见 `opencode-retry.ts`）；整池受限时用最早的那个解禁时刻回 `providerRetryAfterMs`
（→ 宿主的 `Retry-After` 与面板文案）。旧实现把上游值一律钳到 30 分钟，会变成
「每 30 分钟必然重撞一次 + 面板说 30 分钟后恢复而真实复位在 21 小时后」。

### key 账号不附带免费额度（2026-11-13 实测）

用户添加了两个独立工作区的 `oc_sk_` key（402 报错里的 org/wrk id 不同）后逐槽探测：

| 槽 | 出口 | 免费模型 `deepseek-v4.1-flash-free` | 付费模型 `deepseek-v4.1-flash` |
| --- | --- | --- | --- |
| 主 key / 辅 key / 匿名 | 直连（NAT 出口） | `429 FreeUsageLimitError` | — |
| 主 key / 辅 key / 匿名 | 隧道代理（不同 IP） | `429 FreeUsageLimitError` | — |
| 主 key | 直连 | — | `402 Insufficient balance`（wrk_…0M，余额 0） |
| 辅 key | 直连 | — | `402 Insufficient balance`（org_…CMZ，余额 0） |

结论：**加 API key 不会多出免费额度**。免费档聊天模型只随 OpenCode 客户端提供，API key
认证的是付费面（ToS：「Free-tier chat models require OpenCode; use paid models or Go from
other clients」）；key 有效与否看付费模型 —— `402` 是「认证通过、余额为零」，`401` 才是 key
无效。网关请求日志里 0 行 opencode，额度不是被本仓流量消耗的。渠道的实际价值 =
付费模型（充值 / 订阅 Go 后 45 个模型可用）+ 每槽独立出口代理。

本机桌面客户端早已卸载、当日未产生任何消耗，这个 429 仍然出现 —— 额度耗尽不是本机用量造成的。

模型目录、积分倍率与免费标注由渠道包 `model.list` 提供，解析规则见
[`../AGENTS-full.md`](../AGENTS-full.md) §Account Channels。
