# 计划：供应商模型清单定时刷新调度器

> 日期：2026-11-03
> 背景：应用目前三类供应商的模型清单都没有"周期自动刷新"——账号渠道靠 30s 内存 TTL + 手点 `refreshModels`；聚合目录靠手点 `syncModels`；内置供应商已退役无运行时对象。本计划把三者统一收进一个可调周期的调度器，做内存预热（不写持久化、不污染状态）。

## 关键认知校正

- **聚合目录是构建期静态真值**（`aggregate/registry.ts`，79 入口 / 500 模型），运行时没有"远端清单"可拉。它真正的运行时刷新能力是 `AggregateProviderManager.syncModels(id)`（走 `/models` 探测 + models.dev 兜底），当前只由手点触发。调度器对聚合目录做的是**周期触发 `syncModels`**，而非凭空拉清单。
- **账号渠道清单不来自真·远端 HTTP**，而是渠道包**本地** `model.list` RPC + `/v1/models` 视图。现有 `refreshModels()` 会 `resync()`（清整个缓存 + 写 provider 记录 + 广播），纯周期预热不应走这条路 → 新增 `warmModels()`（只刷内存缓存）。
- builtin 当前为空，预热方法保留通路，启用即自动纳入调度。

## 架构落点

## 最终决策（2026-11-04 用户拍板）

- **周期用天/周/月，不用小时/分钟**：模型清单是周月级事件，密刷纯属浪费。
- **两档**：账号渠道（本地 RPC）默认 **1 周**；聚合 + 内置（真·HTTP 打上游）默认 **2 周**。
- UI **现在做**，两个独立周期下拉（短档 1周/2周/1月/3月；长档 2周/1月/3月/6月）。
- 首轮**不立即跑**（等一个完整周期），避免启动期与初始化抢资源；`runOnStart` 留给需要的任务。

### 1. 新增 `src/main/scheduler/Scheduler.ts`（调度器单例）
- 原生 `setInterval`（**不引 node-cron**：asar 不带 node_modules，主进程依赖须 rollup 打包）。
- 能力：
  - 注册命名任务 `{ name, intervalMs, run }`，支持瞬时重试退避。
  - **串行化执行**：任务自带 `running` 守卫，重叠执行直接跳过（借鉴 `AccountChannelsManager.syncing` 与 `quotaProbe` 纪律）。
  - 记录 `lastRunAt` / `nextRunAt` / `lastError` / `lastResult`，供 UI 展示。
  - `start()` / `stop()` / `triggerNow(name)` / `setInterval(name, ms)`。
  - `app.on('before-quit')` 统一 `clearInterval`（修复现有散落 timer 漏 clear 隐患）。
- 纯逻辑、无 electron 依赖，便于单测。

### 2. 三类预热方法
- **账号渠道** `AccountChannelsManager.warmModels()`（新增）：并发调 `fetchModels` 刷新整个 `modelsCache`（不调 `syncProviders`，不写盘、不广播）。
- **聚合目录** `AggregateProviderManager`（复用）：调度器遍历已配置 `aggregate` 类型 provider，周期调 `syncModels(id)`，fail-soft（保留旧映射）。
- **内置供应商**（复用 `fetchProviderModels`）：遍历有 `modelsFetch` 的 builtin（当前空集合），周期重拉。

### 3. 设置项 + IPC + 启动接线
- `src/shared/types.ts` `AppConfig` 增加：
  ```ts
  modelListRefresh?: {
    enabled: boolean
    intervalMs: number          // 默认 4h
    accountChannels: boolean
    aggregate: boolean
    builtin: boolean
  }
  ```
  **可选字段**（`?`），`DEFAULT_CONFIG` 不预设，`store.normalizeConfig` 缺省回落（遵循 `routes`/`seededPresetRoutes` 的同款"缺席即默认"门禁纪律，老配置零迁移）。
- 在 `src/main/store/store.ts` `DEFAULT_CONFIG` 与 `normalizeConfig` 补默认值。
- 新增 IPC：`modelRefresh:getStatus`、`modelRefresh:setConfig`、`modelRefresh:triggerNow`（在 `ipc/handlers.ts`、`ipc/channels.ts` 注册）。
- `src/main/index.ts`：`app.on('ready')` 内 `scheduler.init(getConfig())` 启动；`before-quit` 调 `scheduler.stop()`。

### 4. 渲染端设置面板（可调 UI）
- `src/renderer/src/components/settings/` 新增 `ModelListRefreshSettings.tsx`：开关 + 周期下拉（30m/1h/2h/4h/6h/12h/24h）+ 三类细分开关 + "立即刷新"按钮 + 上次/下次运行时间展示。
- `Settings.tsx` 挂入；`settingsStore.ts` 透传 `modelListRefresh` 配置（走既有 `updateConfig`）。

## 测试与门禁
- `tests/scheduler.test.ts`：覆盖串行化跳过、周期漂移、fail-soft、stop 清理。
- `tests/providers/accountChannels/warmModels.test.ts`：缓存刷新、不写盘。
- 跑 `npm run gate`（build + tsc×2 + node --test）确认全绿。

## 风险与边界
- 合盖休眠后 `setInterval` 不补偿（按唤醒后周期走），可接受；如需精确时刻改用 `node-cron` 但需打包，本计划不引入。
- 预热失败一律 fail-soft，绝不清空现有清单（继承"未知≠没有"纪律）。
- 不触碰静态 registry 真值；聚合预热只动已配置条目的运行时 modelMappings。
