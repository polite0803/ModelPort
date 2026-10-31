import type { NormalizedToolResult, ToolProtocolId } from './types.ts'
import { managedXmlProtocol } from './protocols/managedXml.ts'

export interface ProviderToolProfile {
  providerId: string
  managedSupport: boolean
  supportsNativeTools: boolean
  /** 上游自己把工具调用翻好了（OpenCode 的信封协议），托管层必须完全不碰 */
  handlesToolsItself?: boolean
  preferredManagedProtocol: ToolProtocolId
  formatAssistantToolCalls(calls: Array<{ id: string; name: string; arguments: string }>): string
  formatToolResult(result: NormalizedToolResult): string
}

const modelPortXmlHistoryProfile: Omit<ProviderToolProfile, 'providerId'> = {
  managedSupport: true,
  supportsNativeTools: false,
  preferredManagedProtocol: 'managed_xml',
  formatAssistantToolCalls(calls) {
    return managedXmlProtocol.formatAssistantToolCalls(calls)
  },
  formatToolResult(result) {
    return managedXmlProtocol.formatToolResult(result)
  },
}

/**
 * 逐供应商的工具处理档案。
 *
 * 现在是空的：唯一的成员 `opencode`（信封协议自己翻工具）随本机运行时一起于
 * 2026-11-01 退役。`getProviderToolProfile` 的兜底档案因此覆盖所有在册供应商，
 * 也就是「托管层负责把工具调用写进历史」这条默认路径。
 */
const profiles: Record<string, ProviderToolProfile> = {}

export function getProviderToolProfile(providerId: string): ProviderToolProfile {
  return profiles[providerId] ?? {
    providerId,
    ...modelPortXmlHistoryProfile,
  }
}
