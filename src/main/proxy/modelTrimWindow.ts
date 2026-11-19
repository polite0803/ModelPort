/**
 * 「这一跳真正服务的那个模型，自己声明的上下文窗口是多大」。
 *
 * 上下文裁剪的预算只有这一个正确答案：一条路由可以指向任意模型，同一家供应商也
 * 常常同时挂 128K 与 1M 两档（火山 Agent Plan 就是），所以任何按供应商或全局写死
 * 的数都会在某个模型上错 —— 对 128K 的模型太宽（上游 context 400，客户端读成自己
 * 的错），对 1M 的模型太窄（把会话裁没）。2026-11-16 现网正是后者：
 * `maxTokensByProvider.volcengine_ark_agent_plan = 65536` 对着一个声明 1,000,000
 * 的模型，Claude Code 自己的系统提示就 65,880 token，于是每一轮都落进「系统块独占
 * 上限」的退化分支，整段对话被丢掉，客户端读成「模型在中英文之间跳」。
 *
 * 证据层级刻意窄：手工标注 > 供应商同步记录 > 聚合官方旁表 > 实测 probe。这四层说
 * 的都是**这个模型**；标准库快照（catalog）与第三方旁表不进这一格，它们是转述而不
 * 是这家上游此刻的声明。缺失一律返回 `undefined` —— 由调用方回落到配置档位，绝不猜
 * 一个数。
 */
import { storeManager } from '../store/store'
import type { Provider } from '../store/types'
import {
  indexProbeRows,
  probeRowKey,
  probeRowToLayer,
  type ModelProbeRow,
} from '../../shared/modelProbe.ts'
import { getProbeRowsSync } from '../providers/modelProbeStore.ts'
import { advertisedContextTokens, resolveCapabilityDetail } from './autoRouting'
import { aggregateContextWindow } from './modelCapabilities'

/**
 * 探测表索引的进程内缓存。
 *
 * `getProbeRowsSync()` 交回的是同一份数组，只有写盘时才换成新数组，所以按数组身份
 * 缓存就够：每次转发都重建一遍会把「一次请求」放大成一次全表扫描（见
 * `modelProbeStore.ts` 里同步视图的理由）。
 */
let probeRowsSource: readonly ModelProbeRow[] | undefined
let probeRowsIndex: ReadonlyMap<string, ModelProbeRow> = new Map()

function probeIndex(): ReadonlyMap<string, ModelProbeRow> {
  const rows = getProbeRowsSync()
  if (rows !== probeRowsSource) {
    probeRowsSource = rows
    probeRowsIndex = indexProbeRows(rows)
  }
  return probeRowsIndex
}

/**
 * 目录里 `actualModelId` 对应的展示名。
 *
 * 手工标注与供应商同步记录都按展示名建键，所以这一步不能省。目录可能还没同步到这
 * 一行（手写了映射、或刚改过名），此时用供应商映射表反查一次；都没有就保持未知 ——
 * 这时「不知道」是诚实的回答，不是回落成别处的一个数。
 */
function displayNameOf(provider: Provider, actualModelId: string): string | undefined {
  const hit = storeManager
    .getModelCatalogue(provider.id)
    .find(model => model.actualModelId === actualModelId)
  if (hit !== undefined) return hit.displayName
  for (const [displayName, mapped] of Object.entries(provider.modelMappings ?? {})) {
    if (mapped === actualModelId) return displayName
  }
  return undefined
}

/**
 * 该模型自己声明的上下文窗口；`undefined` = 没有任何一级证据，交给配置档位兜底。
 *
 * 出口过 `advertisedContextTokens` 而不是直接读 `capability.contextTokens`：
 * `resolveCapabilityDetail` 还会把静态表与家族规则折进来（`glm-5.3` → 128000），
 * 那是**转述的类比**，不是这家上游对这个模型的声明。裁剪预算按它取数就是同一个缺陷
 * 换了个来源 —— 一个真跑 1M 的模型被静态表按 128K 裁掉。两道闸用的是同一份判据，
 * 免得「对外广告」与「自己裁剪」各有一套可信度标准。
 */
export function declaredContextWindowOf(
  provider: Provider,
  actualModelId: string,
): number | undefined {
  const displayName = displayNameOf(provider, actualModelId)
  if (displayName === undefined) return undefined

  const record = provider.modelCapabilities?.[displayName]
  const manual = storeManager.getUserModelMarks()[provider.id]?.[displayName]
  const aggregateId = provider.type === 'aggregate' ? (provider.aggregateId ?? provider.id) : undefined
  const officialWindow = aggregateId === undefined
    ? undefined
    : aggregateContextWindow(aggregateId, actualModelId)
  const probeRow = probeIndex().get(probeRowKey({ providerId: provider.id, displayName }))
  const probe = probeRow === undefined ? undefined : probeRowToLayer(probeRow)?.hint

  const capability = resolveCapabilityDetail(provider.id, displayName, {
    ...(manual === undefined ? {} : { manual }),
    ...(record === undefined ? {} : { record }),
    ...(officialWindow === undefined
      ? {}
      : { aggregateOfficial: { contextTokens: officialWindow } }),
    ...(probe === undefined ? {} : { probe }),
  })
  return advertisedContextTokens(capability)
}