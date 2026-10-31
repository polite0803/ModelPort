/**
 * 哪些渠道 RPC 改动账号池之后，宿主必须自己重新镜像 provider 记录。
 *
 * 渠道包只在少数几处广播 `llm/adapters-updated`（`channel-pack-rpc.ts` 的
 * `broadcastCatalogChanged`），而 opencode 的两个加账号方法**都不发** —— 见
 * `vendor/channel-pack/src/opencode-rpc.ts` 的 `opencode.addAccount` /
 * `opencode.addAnonymous` 分支。不补这一步的后果很具体：账号进了池子，但
 * `syncProviders()` 没被触发，provider 记录不会出现 —— 界面上这张卡永远停在
 * 「未配置」，模型也进不了路由，而用户看到的是「添加成功」。
 *
 * 单独成文件（无 import）是因为 `accountChannels/manager.ts` 会拉进 electron，
 * 单测直接 import 它跑不起来。
 */
const RESYNC_AFTER_METHODS: ReadonlySet<string> = new Set([
  'opencode.addAccount',
  'opencode.addAnonymous',
])

export function resyncsAfterChannelRpc(method: string): boolean {
  return RESYNC_AFTER_METHODS.has(method)
}
