# 2026-11-13 清空日志连带删除使用统计：取证与恢复记录

## 现象与根因

用户在控制台点「清空」请求日志后，仪表盘的使用统计一起归零。根因一处：
`src/main/store/store.ts::clearRequestLogs()` 在清完日志行之后，还把整块 `statistics`
写回 `DEFAULT_STATISTICS`。`docs/features/logging-diagnostics.md` 早就写明「日志清空是独立
操作，不会连带清掉统计」，但全仓没有任何判据调用过这个方法（唯一一处
`tests/routes/empty-turn-stream-trace.test.ts` 只拿它清场、不断言统计），所以文档与代码
漂移无门可拦。修复见本版 `Fixed` 条目：删掉那句写入，并补
`tests/store/clear-logs-keeps-usage.test.ts` 四条判据（清空后统计与 token 台账原样、落盘
一致、面板计数改由账本提供、重建行的构造）。

## 现场读数

| 项 | 清空后 | 可用快照 | 恢复后 |
| --- | --- | --- | --- |
| `statistics.totalRequests` | 1,550 | 43,117（截止 11-11 02:39） | 55,559 |
| `statistics.failedRequests` | 0 | 1,591 | 1,592 |
| `dailyStats` 行数 | 2（11-12、11-13） | 13（10-30 → 11-11） | 15 |
| `modelUsage` 键数 | 5 | 171 | 172 |
| `tokenUsage` 天数 | 15（未受影响） | 13 | 15 |

副本普查（整台机器，含 `/root`、`/home/polit`、`/mnt`、`/tmp`、`/var/tmp`）：带
`statistics` 块的 JSON 共 34 份，除现网文件与本次恢复自留的备份外，其余全是门禁临时目录
（`totalRequests` 为 0）。唯一可用的历史快照是 electron-store 原子写遗留的
`data.json.tmp-4336005505c627b6`，统计截止 **2026-11-11 02:39:46**（本地）。

清空发生时刻 ≈ **2026-11-12 17:43**（本地）：按 `quota-ledger.json` 的逐分钟请求数从末尾
往回累加，累计量刚越过「清空后统计已记 1,550」的那一分钟。该定位只能算近似——同时段账本
记 551 条而统计记 303 条，两本账口径差约 1.8 倍。

## 缺口与恢复口径

丢失段 = 11-11 02:39 → 11-12 17:43 的 `statistics` 增量。实测边界（按未被波及的
`tokenUsage` 日桶）：11-11 全天 5,031 条带用量请求（快照只覆盖到 673）、11-12 全天 6,860
条（清空后才记的 303 条在尾部），合计约 10,709 条请求的统计无从逐笔恢复。

**成败数没有残留证据**：请求日志行已被清空；journald 在该窗口有 8,413 行，抽样后全是诊断
行（重复判定、思考回灌、上下文裁剪），没有一行带状态码的请求完成记录；活着的两本账
（`tokenUsage`、`quota-ledger`）只记请求数不记成败。

经用户裁定，这两天按本账本自身的构造落数（13 个完整天实测 `success + failed == total`
恒真）：

- `totalRequests` ← `tokenUsage[day].requests`（实测，只含带回用量回执的请求，因此是下限）；
- `successRequests` = `totalRequests − failedRequests(已记)`；
- `failedRequests` 保持已记值（11-11 为 125，11-12 为 0）；
- 顶层 `totalRequests` / `successRequests` 同步，保持 `sum(日行) == 顶层总数`；
- 行与顶层都写 `totalRequestsSource: 'tokenLedger'`。

已知失真，按已记段失败率折算：11-11 已记段 125/879 = 14.2%，据此未记的 4,152 条里约
590 条其实是失败而被计成成功；11-12 的已记段是清空之后的 303 条、零失败，因此未记的
6,557 条全部按成功计，该天失败数被低估的量没有本地依据。

`providerSuccess` / `providerLatency` 在这两天**删除**而不是保留：留下的只是已记段的量，
除以换算后的成功数会读出一个凭空的渠道成功率；缺键在既有语义里就是「未记录」，界面按
`-` 跳过该天，与「零失败」不是一回事。

`dailyStats[day].modelUsage` 未重建：统计记的是客户端可见名（如 `Loomy (国内) / GLM 5.3
Flash`、别名 `daily`），用量桶记的是上游真实模型名（如 `loomy/GLM-5.3-Flash`），11-10 实测
两边零重名，折进同一张表会让按模型的成功率与缓存命中读成跨口径的数。这两天的模型使用量
保持已记段（11-11 为 5 个键、11-12 为 2 个键）。

## 落盘动作与回路

两次停服写入（各约 10 秒不可用），都用「临时文件 + rename」并保留改前副本：

1. `data.json.pre-stat-restore.1794514246492.json` —— 快照与现网 `statistics` 并回之前；
2. `data.json.pre-rebuild.1794515663529.json` —— 按用量桶重建 11-11/11-12 之前；
3. `data.json.pre-success-derive.1794516140338.json` —— 成功数换算之前。

三个写脚本都带不可重复执行的闸门（已带 `tokenLedger` 标记或现网累计量不低于快照即退出），
并在写前逐顶层键比对「除 `statistics` 外一律不变」。起服后 8 秒与 18 秒各取一次读数，
`totalRequests` 继续增长，证明运行中的进程没有把内存里那份被清空的统计盖回去。

请求日志行按用户要求**没有**找回（`request-logs.ndjson` 仍是清空后的 200 行）。
