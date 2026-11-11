import { RETIRED_PROVIDER_IDS } from '../../shared/types.ts'
import { getAggregateEntry } from './aggregate/registry.ts'
import { isAccountChannelId } from './accountChannels/catalogue.ts'
import { getBuiltinProvider } from './builtin/index.ts'

/**
 * 「退役」的唯一定义：名字在 1.5 网页登录集成的名单里，**且随包代码里已经没有任何现役
 * 定义叫这个名字**。
 *
 * 只按名单判会删活人的数据：名单里的 `deepseek` / `glm` / `kimi` / `minimax` / `zai`
 * 同时是聚合目录现役条目的 id，`minimax` 还同时是账号渠道 id，而三家的凭据账号都以
 * providerId = 这个 id 落库。2026-11-11 的用户报告「更新后 DeepSeek 的 Key 丢了」就是
 * 这个撞名：启动清理把聚合 DeepSeek 的 Key 账号连同它的每模型开关一起当孤儿删掉了，
 * 且每次网关启动都重演（更新只是必然带一次重启）。
 *
 * 现役定义按三层分别查，缺一层就会漏判：内置注册表、聚合目录、账号渠道目录。
 */
export function isRetiredProviderId(id: string): boolean {
  if (!(RETIRED_PROVIDER_IDS as readonly string[]).includes(id)) return false
  return !getBuiltinProvider(id) && !getAggregateEntry(id) && !isAccountChannelId(id)
}

/** 当前真正退役的那批名字（名单减去仍在服的撞名）。 */
export function retiredProviderIds(): string[] {
  return RETIRED_PROVIDER_IDS.filter((id) => isRetiredProviderId(id))
}
