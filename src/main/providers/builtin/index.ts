import type { BuiltinProviderConfig } from '../../store/types.ts'

/**
 * 内置供应商注册表。
 *
 * 现在是空的：唯一的成员 OpenCode（本机运行时）已于 2026-11-01 退役——它的免费
 * 车道要求 v2 客户端形状，而 npm 的 `opencode-ai` 线冻结在 1.19.5、官方 install
 * 脚本明确拒绝安装 2.x，所以「自带运行时」这条路已经没有可用的分发。OpenCode 的
 * 模型改由渠道包那条 v2 形状的通道提供（账号渠道目录里的 `opencode`）。
 *
 * 注册表本身保留：启动同步、清单来源判定、状态检查都按它遍历，将来加内置供应商
 * 只需要往这两个字面量里各加一条。
 */
export const builtinProviders: BuiltinProviderConfig[] = []

export const builtinProviderMap: Record<string, BuiltinProviderConfig> = {}

export function getBuiltinProvider(id: string): BuiltinProviderConfig | undefined {
  return builtinProviderMap[id]
}

export function getBuiltinProviders(): BuiltinProviderConfig[] {
  return builtinProviders
}

export default builtinProviders
