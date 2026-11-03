/**
 * 供应商模型清单定时刷新装配
 *
 * 把三类"模型清单来源"的刷新逻辑注册进统一 `Scheduler`：
 *
 *   1. 账号渠道（`accountChannelManager.warmModels`，本地 model.list RPC 预热）；
 *   2. 聚合目录（遍历已配置 `aggregate` provider，跑 `syncModels`）；
 *   3. 内置供应商（遍历有 `modelsFetch` 的 builtin，跑 `fetchProviderModels`）。
 *
 * 两档周期：账号渠道用 `accountIntervalMs`（本地 RPC 零成本，默认 1 周），
 * 聚合/内置用 `aggregateIntervalMs`（真·HTTP 打上游，默认 1 月）。模型清单是
 * 周/月级事件，周期过密纯属浪费还增加上游压力。由 UI 暴露天/周/月档位旋钮。
 * 每个类别对应一个命名任务；模块级别的开关（accountChannels / aggregate / builtin）
 * 决定该任务是否在本次装配里注册——关掉就不注册，而非注册了空跑。
 *
 * 装配是**幂等**的：`reconfigure` 用 `scheduler.setIntervalMs` / 重新 `register`
 * 来响应运行时配置变化，不会叠加重复任务。
 */

import { scheduler } from './Scheduler'
import { storeManager } from '../store/store'
import type { ModelListRefreshConfig, SchedulerTaskStatus } from '../../shared/types'
import { DEFAULT_MODEL_REFRESH } from '../../shared/types'
import { accountChannelManager } from '../providers/accountChannels/manager'
import { aggregateProviderManager } from '../providers/aggregate'
import { fetchProviderModels } from '../providers/modelCatalog'
import { getBuiltinProvider } from '../providers/builtin'

const TASK_ACCOUNT = 'model-list-refresh:account-channels'
const TASK_AGGREGATE = 'model-list-refresh:aggregate'
const TASK_BUILTIN = 'model-list-refresh:builtin'

/** 已注册的类别名集合，用于判断是否需要在 reconfigure 时增删任务。 */
let registeredTasks = new Set<string>()

/**
 * 按当前 config 装配 / 重排调度任务。在 `app.on('ready')` 调一次，之后每次
 * `modelListRefresh:setConfig` 再调一次应用变更。
 */
export function configureModelListRefresh(config?: ModelListRefreshConfig | null): void {
  const refresh = config ?? DEFAULT_MODEL_REFRESH
  if (!refresh.enabled) {
    // 整体关闭：注销全部三类任务。
    for (const name of registeredTasks) scheduler.unregister(name)
    registeredTasks = new Set()
    return
  }

  const desired = new Set<string>()
  if (refresh.accountChannels) {
    scheduler.register({
      name: TASK_ACCOUNT,
      intervalMs: refresh.accountIntervalMs,
      run: () => accountChannelManager.warmModels(),
    })
    desired.add(TASK_ACCOUNT)
  }
  if (refresh.aggregate) {
    scheduler.register({
      name: TASK_AGGREGATE,
      intervalMs: refresh.aggregateIntervalMs,
      run: refreshAggregateCatalogues,
    })
    desired.add(TASK_AGGREGATE)
  }
  if (refresh.builtin) {
    scheduler.register({
      name: TASK_BUILTIN,
      intervalMs: refresh.aggregateIntervalMs,
      run: refreshBuiltinCatalogues,
    })
    desired.add(TASK_BUILTIN)
  }

  // 关掉的类别：从调度器注销。Scheduler.register 同名会覆盖，但关掉的类根本不进 desired，
  // 这里显式停掉那些"上一次开了、这次关了"的任务。
  for (const name of registeredTasks) {
    if (!desired.has(name)) scheduler.unregister(name)
  }
  registeredTasks = desired
}

/**
 * 聚合目录刷新：遍历所有已配置的 `aggregate` provider，逐个跑 `syncModels`。
 *
 * fail-soft：单个条目失败不抛（syncModels 自身已返回 reason，不抛异常），
 * 即使抛了，`Scheduler` 的 execute 会接住并记 lastError，不拖垮其它类别。
 */
async function refreshAggregateCatalogues(): Promise<void> {
  const configured = storeManager
    .getProviders()
    .filter(provider => provider.type === 'aggregate')
    .map(provider => provider.id)
  for (const id of configured) {
    try {
      await aggregateProviderManager.syncModels(id)
    } catch (error) {
      console.warn(
        `[ModelListRefresh] 聚合目录 ${id} 同步失败，跳过：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/**
 * 内置供应商刷新：遍历有 `modelsFetch` 的 builtin（当前为空集合），逐个重拉。
 * 当前 builtin 为空，循环体不执行——但若未来复活内置供应商，这里自动纳入。
 */
async function refreshBuiltinCatalogues(): Promise<void> {
  // builtin providers 由 id 索引，这里直接枚举有模型清单端点的那些。
  const ids = builtinProviderIdsWithModelFetch()
  for (const id of ids) {
    try {
      await fetchProviderModels(id)
    } catch (error) {
      console.warn(
        `[ModelListRefresh] 内置供应商 ${id} 模型清单刷新失败，跳过：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

function builtinProviderIdsWithModelFetch(): string[] {
  // `getBuiltinProvider` 按 id 查；要枚举所有 builtin，从 store 的 providers 里挑 builtin 类型，
  // 再筛出声明了 modelsFetch 的。
  return storeManager
    .getProviders()
    .filter(provider => provider.type === 'builtin')
    .map(provider => provider.id)
    .filter(id => {
      const config = getBuiltinProvider(id)
      return Boolean(config && (config as { modelsFetch?: unknown }).modelsFetch)
    })
}

/** 当前所有刷新任务的状态快照（供 IPC `modelRefresh:getStatus`）。 */
export function schedulerStatus(): SchedulerTaskStatus[] {
  return scheduler.status()
}

/**
 * 立即触发一轮刷新（供 IPC `modelRefresh:triggerNow`）。
 * 遍历本次装配里登记的类别任务各跑一次；串行化守卫仍生效，所以连点不会叠加。
 */
export async function triggerModelListRefreshNow(): Promise<void> {
  for (const name of registeredTasks) {
    await scheduler.triggerNow(name)
  }
}
