# ModelPort 文档索引

> 适用版本：v1.7.3 ｜ 最后核对：2026-11-04 ｜ 状态：现行

这是 `docs/` 下唯一的索引入口。所有文档按性质归入 `design/`（方案）、`plan/`（计划）、
`audit/`（审计）与 `features/`（功能手册）四类；供应商笔记、上游快照与数据票据保留在原有旁支目录。索引覆盖
`docs/` 下的每一份文档，没有孤立文件。

当文档与代码冲突时，以代码和 [`AGENTS-full.md`](AGENTS-full.md) 为准。行为改变时，请在同一个
改动里更新文档。

## 新增文档该放哪

先问这份文档要回答的问题，再决定目录：

| 它回答的问题 | 放哪 | 典型内容 |
| --- | --- | --- |
| 为什么这样设计？当时拍板了什么？ | `design/` | 架构与子系统设计、方案评估、决策记录 |
| 接下来按什么顺序做？怎么迁移？ | `plan/` | 分阶段实施计划、迁移/改造排期、任务拆解 |
| 查出了什么问题？证据和结论是什么？ | `audit/` | 代码/安全/性能/文档审计、实测取证、门禁读数 |
| 某个功能现在的行为、不变量、默认值与代码落点 | `features/` | 面向使用与排查的功能手册（按功能点成篇） |
| 只是查阅参考、上游原文或数据来源 | 原旁支目录 | 供应商说明、上游快照、数据票据 |

命名沿用现有约定，不为了整齐改名。计划类文档用 `PLAN-<主题>.md`；方案与审计沿用
`PLAN-` 或日期前缀都可以，保持文件原名即可。

`design/`、`plan/`、`audit/` 的划分规则：

- **design/** 记录“方案本身”——包括被否决或只实现一部分的设计，重点是判断依据与取舍。
- **plan/** 记录“执行顺序”——任务、批次、落点、验收判据；计划完成后保留为历史记录。
- **audit/** 记录“核查结果”——缺陷清单、实测数据、门禁读数与收口结论，不承担设计职责。
- **features/** 记录“某个功能现在是什么样”——行为、必守不变量、默认值与代码落点；面向使用与排查，随行为改动同步更新。

## 从哪里开始

| 你想做什么 | 先读 |
| --- | --- |
| 安装应用并发第一个请求 | [`../README.md`](../README.md)、[`../README_CN.md`](../README_CN.md) |
| 写代码前了解硬规则 | [`../AGENTS.md`](../AGENTS.md) |
| 查某个子系统的完整说明 | [`AGENTS-full.md`](AGENTS-full.md) |
| 查某个功能现在的行为、默认值与代码落点 | [`features/`](features/) |
| 添加聚合条目、登录账号渠道或自定义供应商 | [`providers/README.md`](providers/README.md)、[`../AGENTS.md`](../AGENTS.md) |
| 查历史设计与决策依据 | [`design/`](design/)、[`plan/`](plan/) |
| 查缺陷证据、实测读数与审计结论 | [`audit/`](audit/) |
| 修改生成型额度/价格/能力表 | [`data/`](data/)、[`../AGENTS.md`](../AGENTS.md) |

## 方案（design/）

`design/` 存放架构设计、子系统设计与决策记录。结论可能已经落地，也可能只是当时的选择。

| 文档 | 说明 | 适用版本 | 状态 | 日期 |
| --- | --- | --- | --- | --- |
| [`design/PLAN-auto-routing-v2.md`](design/PLAN-auto-routing-v2.md) | `auto` 虚拟模型的过滤、打分、粘性与失败切换设计；粘性硬钉为默认 | v1.4.1 | 历史记录 | 2026-10-29 |
| [`design/PLAN-magpie-borrowing.md`](design/PLAN-magpie-borrowing.md) | 从 magpie 借鉴目录数据、导入、smart/pace 路由与 responses 出向的取舍 | v1.4.1 | 历史记录 | 2026-10-29 |
| [`design/PLAN-token-compression.md`](design/PLAN-token-compression.md) | Headroom 的 JSON/日志/live-zone 压缩与 CCR 可逆存储方案；P4 判定不做 | v1.4.1 | 部分过期 | 2026-10-29 |
| [`design/PLAN-routes-only-surface.md`](design/PLAN-routes-only-surface.md) | `/v1/models` 只广告路由、启用位只管路由池的口径与落库设计 | v1.4.10 | 历史记录 | 2026-11-01 |
| [`design/PLAN-model-list-scheduler.md`](design/PLAN-model-list-scheduler.md) | 三类供应商模型清单的周期刷新调度器与周期拍板，已落地于 `src/main/scheduler/` | v1.6.1 | 现行 | 2026-11-03 |
| [`design/2026-05-26-in-app-update-design.md`](design/2026-05-26-in-app-update-design.md) | 应用内更新（electron-updater 检查、下载、重启安装）设计方案 | v1.3.0 | 历史记录 | 2026-05-26 |
| [`design/2026-05-27-modelport-tool-testing-skills-design.md`](design/2026-05-27-modelport-tool-testing-skills-design.md) | 工具调用测试技能集（管理 API、HAR、客户端回放、模型矩阵）设计 | v1.3.0 | 历史记录 | 2026-05-27 |
| [`design/2026-11-04-model-metadata-resolution.md`](design/2026-11-04-model-metadata-resolution.md) | 《模型元数据自动标注的分层解析链》：六层来源优先级（人工标记 > 上游声明 > 标准库 > 实测探测 > 家族规则 > 成本台账）、`ModelFact` 结构与分库、探测档位与 TTL、覆盖率与对外暴露门槛 | v1.7.3 | 现行 | 2026-11-04 |

## 计划（plan/）

`plan/` 存放分阶段实施、迁移与任务拆解。计划完成后保留，用于追溯“当时按什么顺序做”。

| 文档 | 说明 | 适用版本 | 状态 | 日期 |
| --- | --- | --- | --- | --- |
| [`plan/PLAN-retire-web-providers-aggregate.md`](plan/PLAN-retire-web-providers-aggregate.md) | 退役 8 家 Web 页面接入，上线聚合目录与免密免费池 | v1.4.0 | 历史记录 | 2026-10-28 |
| [`plan/PLAN-port-freellmapi-free-token.md`](plan/PLAN-port-freellmapi-free-token.md) | 聚合渠道免费额度层与实时积分门槛的取数与落地 | v1.4.1 | 历史记录 | 2026-10-29 |
| [`plan/PLAN-auto-routing-freellmapi.md`](plan/PLAN-auto-routing-freellmapi.md) | 借鉴 FreeLLMAPI 的 auto 路由强化（预算、分级尝试、限流感知） | v1.4.6 | 历史记录 | 2026-10-30 |
| [`plan/PLAN-newapi-parity.md`](plan/PLAN-newapi-parity.md) | 与 new-api 的入向协议、错误语义差异对照及修正计划 | v1.5.2 | 历史记录 | 2026-11-02 |
| [`plan/PLAN-workbuddy-adaptation.md`](plan/PLAN-workbuddy-adaptation.md) | WorkBuddy/CodeBuddy 渠道（v2.5.1 快照）的适配清单与落地记录 | v1.6.1 | 历史记录 | 2026-11-03 |
| [`plan/PLAN-next-dev-code-tasks.md`](plan/PLAN-next-dev-code-tasks.md) | 三条活跃线的剩余项拆解、落点与验收判据 | v1.6.1 | 历史记录 | 2026-11-03 |
| [`plan/PLAN-channel-identity-alignment.md`](plan/PLAN-channel-identity-alignment.md) | 13 个账号渠道的客户端身份头与实际发包对齐、版本号自动更新机制 | v1.6.2 | 实施中 | 2026-11-05 |
| [`plan/PLAN-wsl-headless-daemon-and-shell.md`](plan/PLAN-wsl-headless-daemon-and-shell.md) | WSL 无头守护进程、管理面走网络与 Windows 原生壳的四阶段改造 | v1.8.0 | 实施中 | 2026-11-05 |
| [`plan/PLAN-shell-three-modes.md`](plan/PLAN-shell-three-modes.md) | 控制台三形态（本地 / WSL / 远程）与网关按需安装；取消主应用发布形态 | v1.8.0 | 实施中 | 2026-11-07 |
| [`plan/PLAN-prompt-cache.md`](plan/PLAN-prompt-cache.md) | Prompt 缓存命中：DeepSeek 优先（亲和 + 缓存优先压缩）、Anthropic 显式断点、按模型缓存仪表盘与压缩净收益门 | v1.7.9 | 实施中 | 2026-11-08 |
| [`plan/2026-05-26-in-app-update.md`](plan/2026-05-26-in-app-update.md) | 应用内更新的任务拆解与测试计划 | v1.3.0 | 历史记录 | 2026-05-26 |
| [`plan/2026-05-27-modelport-tool-testing-skills.md`](plan/2026-05-27-modelport-tool-testing-skills.md) | 工具调用测试技能集的目录、脚本与验收计划 | v1.3.0 | 历史记录 | 2026-05-27 |

## 审计（audit/）

`audit/` 存放代码、安全、性能与文档审计报告，以及由实测驱动的缺陷取证与收口结论。

| 文档 | 说明 | 适用版本 | 状态 | 日期 |
| --- | --- | --- | --- | --- |
| [`audit/PLAN-api-defects.md`](audit/PLAN-api-defects.md) | `/v1/*` 鉴权、契约、失败语义与工具调用的两轮缺陷核查与修复结论 | v1.4.0 | 历史记录 | 2026-10-27 |
| [`audit/PLAN-api-defects-status.md`](audit/PLAN-api-defects-status.md) | 上述修复的门禁读数、完成清单与遗留项状态 | v1.4.0 | 历史记录 | 2026-10-27 |
| [`audit/PLAN-channel-auto-stability.md`](audit/PLAN-channel-auto-stability.md) | 渠道与 auto 路由连接稳定性的实测取证（192.168.85.131）与修复批次 | v1.4.10 | 历史记录 | 2026-11-01 |
| [`audit/DEFECT_ANALYSIS_REPORT.md`](audit/DEFECT_ANALYSIS_REPORT.md) | 主进程关键子系统的逐文件缺陷核查（限流、脱敏、调试输出、探测终局、巡检写盘放大）与完善建议；本仓按 `AGENTS-full.md` 口径对照，落地的修复见 CHANGELOG v1.7.3 | v1.7.3 | 历史记录 | 2026-11-04 |
| [`audit/2026-11-13-clear-logs-statistics-loss.md`](audit/2026-11-13-clear-logs-statistics-loss.md) | 「清空日志连带删除使用统计」的现场读数、副本普查、恢复口径与已知失真量（重建段的成功数高估、渠道成败撤为未记录） | v1.8.8 | 历史记录 | 2026-11-13 |

## 功能手册（features/）

`features/` 按功能点成篇，写“现在是什么样”：行为、必守不变量、配置默认值与代码落点，面向使用与排查。行为改动时与代码在同一个提交里更新。

| 文档 | 说明 | 适用版本 | 状态 | 日期 |
| --- | --- | --- | --- | --- |
| [`features/data-backup.md`](features/data-backup.md) | 完整备份与迁移：导出范围、跨机凭据「解密再重封」、口令封装、覆盖/合并语义、导入 token 与重启 | v1.7.3 | 现行 | 2026-11-04 |
| [`features/desktop-ui-updates.md`](features/desktop-ui-updates.md) | 桌面界面与更新：主/渲染进程分工、具名 IPC、单实例与托盘、开机自启对账、`electron-updater` 检查下载安装 | v1.7.3 | 现行 | 2026-11-04 |
| [`features/https-certificate-trust.md`](features/https-certificate-trust.md) | HTTPS 与证书信任：8443 TLS 监听、托管自签与自带 PEM 两种来源、SAN 覆盖、系统信任库与 Node 客户端的 `NODE_EXTRA_CA_CERTS` 通路 | v1.7.3 | 现行 | 2026-11-04 |
| [`features/logging-diagnostics.md`](features/logging-diagnostics.md) | 日志与诊断：请求行的尝试/`streamTrace` 读数、错误保留下限、脱敏与截断、`X-ModelPort-Trace` 与诊断包导出 | v1.7.3 | 现行 | 2026-11-04 |
| [`features/providers-accounts.md`](features/providers-accounts.md) | 渠道与账号：聚合目录（89 条 / 568 模型）、账号渠道、自定义供应商三类的记录来源、凭据与清单归属 | v1.7.3 | 现行 | 2026-11-04 |
| [`features/wsl-daemon.md`](features/wsl-daemon.md) | 无头守护进程与远程管理：三种运行形态、WSL 安装与 systemd 常驻、`--init-host` / `--import-backup`、管理面 RPC/SSE/`/ui` 的鉴权口径与不变量 | v1.8.0 | 现行 | 2026-11-06 |

## 参考与旁支目录

这些内容不属于上面四类，保留在原目录，避免把参考手册硬塞进分类。

| 文档或目录 | 说明 | 适用版本 | 状态 |
| --- | --- | --- | --- |
| [`README.md`](README.md) | 本索引：分类规则、全量清单与版本/状态维护方式 | v1.7.3 | 现行 |
| [`AGENTS-full.md`](AGENTS-full.md) | 完整子系统参考；每条规则背后的故障与边界 | v1.7.3 | 现行 |
| [`../AGENTS.md`](../AGENTS.md) | 编码代理的简版规则书：构建门禁、架构、不变量 | v1.7.3 | 现行 |
| [`../CODE_WIKI.md`](../CODE_WIKI.md) | 较早的模块定位概览；与 `AGENTS.md` 冲突时以后者为准 | v1.7.0 | 部分过期 |
| [`../README.md`](../README.md)、[`../README_CN.md`](../README_CN.md) | 面向使用者的安装、配置与运行说明 | v1.7.3 | 现行 |
| [`providers/README.md`](providers/README.md) | 三类供应商的存储、命名空间与聚合保存流程 | v1.7.3 | 现行 |
| [`providers/opencode.md`](providers/opencode.md) | `opencode` 账号渠道，以及已退役本机运行时的区分 | v1.7.3 | 现行 |
| [`providers/deepseek.md`](providers/deepseek.md) | DeepSeek 上下文缓存的取证、能力表取值与缓存优先策略约束 | v1.7.9 | 现行 |
| [`providers/anthropic.md`](providers/anthropic.md) | Anthropic 显式 prompt caching 的断点位置、能力表与待复核项 | v1.7.9 | 现行 |
| [`upstream/workbuddy-v2.5.1/README.md`](upstream/workbuddy-v2.5.1/README.md) | WorkBuddy v2.5.1 逐字快照的来源、校验和与用途 | v1.6.1 | 历史记录 |
| [`repo-description.md`](repo-description.md) | GitHub “About” 文案：短描述与长介绍 | v1.7.3 | 现行 |
| [`data/`](data/) | 生成型 sidecar 的源票据（`models-dev-cost.json`、`models-dev-capabilities.json`、`free-quota-research/*.json`）；只改票据再跑 builder | v1.7.3 | 现行 |
| [`screenshots/`](screenshots/) | README 使用的截图资源；不存在的页面不应保留旧图 | v1.7.3 | 现行 |

数据票据与生成物的对应关系：

| 票据 | 生成物 | Builder |
| --- | --- | --- |
| `data/models-dev-cost.json` | `src/shared/aggregatePricing.ts` | `scripts/build-aggregate-pricing.mjs` |
| `data/models-dev-capabilities.json` | `src/shared/aggregateCapabilities.ts` | `scripts/build-aggregate-capabilities.mjs` |
| `data/free-quota-research/*.json` | `src/shared/aggregateQuota.ts` | `scripts/build-aggregate-quota.mjs` |

## 版本与状态字段怎么维护

- **适用版本**：这份文档描述的代码状态对应的版本号。现行文档统一对齐 `package.json` 的当前
  版本（1.7.3）；历史文档写“成文版本”，按撰写时点的 CHANGELOG 版本边界判定，无法确定的写
  “待核对”，不编造。
- **状态**：`现行`（内容与当前代码一致）、`部分过期`（主体可用但含已退役内容）、`已退休`
  （所述能力已整体移除，需写明“自 v某版本起退役”）、`历史记录`（成文时的计划或审计记录，
  结论可能仍生效，但不再随代码更新）。
- **维护方式**：文档实质改动时，同时更新文首元信息块（适用版本 / 最后核对 / 状态）和本索引
  对应行的版本、状态与日期。
