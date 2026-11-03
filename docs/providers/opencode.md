# OpenCode

> 适用版本：v1.7.0 ｜ 最后核对：2026-11-04 ｜ 状态：现行

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
| 凭据 | 匿名槽位无需凭据；粘贴 `sk-` Key 可解锁付费模型 |
| 免费额度 | 免费档按出口 IP 限额，因此每个账号可单独配置出口代理 |

添加账号时宿主调用渠道包的 `opencode.addAccount` / `opencode.addAnonymous`，而不是通用的
`account.create`。这两个方法不会广播 `changed`，所以宿主必须在调用后执行
`accountChannels/rpcSync.ts` 的 resync 并 `notifyChanged()`；否则账号会进入池子，但供应商记录
不会出现，卡片会卡在“未配置”。

### 实测读数（2026-11-01，本机出口）

| 请求 | 结果 |
| --- | --- |
| `GET /inference/v1/models` | 200 |
| `POST /inference/v1/chat/completions` | 429 `FreeUsageLimitError` + `retry-after` |

`403` 与 `429` 的区分就是全部诊断：403 表示客户端形状被拒绝，429 表示形状通过、但该出口 IP 的
匿名额度已用尽。接入这条渠道只代表它被诚实地列出来，不代表立刻可用。

模型目录、积分倍率与免费标注由渠道包 `model.list` 提供，解析规则见
[`../AGENTS-full.md`](../AGENTS-full.md) §Account Channels。
