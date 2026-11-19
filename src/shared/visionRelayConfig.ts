/**
 * 视觉读图两段式的配置（PLAN-vision-relay，2026-11-19 批准）。
 *
 * 语义：这一轮真正服务的模型不能收图时，先把**当轮新图**交给一个免费视觉模型
 * 转述成文字，再按原文本目标转发。已标注 vision 的目标直发、零介入。
 *
 * 缺省关闭：键不存在 = 行为与从前逐字节相同。读侧归一只丢弃坏值，不发明开关。
 */

export interface VisionRelaySettings {
  /** 总开关。false / 缺省 = 两段式完全不介入。 */
  enabled: boolean
  /**
   * 显式指定的读图器，`<providerId>/<modelId>`（聚合条目）或渠道模型显示名。
   * 给了它就只用它：失败不换家（用户点名优先）。缺省 = 自动候选链
   * （已启用条目中 vision=yes 且免费的模型，官方免费证据优先）。
   */
  reader?: string
  /** 单张图片的字节上限（base64 解码后）。超过直接判失败，不静默压缩图片。 */
  maxImageBytes: number
}

export const DEFAULT_VISION_RELAY: VisionRelaySettings = {
  enabled: false,
  maxImageBytes: 8 * 1024 * 1024,
}

/** 读侧归一：只保留形状正确的值；坏值回落出厂默认，绝不把「手坏」读成「开启」。 */
export function normalizeVisionRelay(raw: unknown): VisionRelaySettings | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const enabled = record.enabled === true
  const reader = typeof record.reader === 'string' && record.reader.trim().length > 0
    ? record.reader.trim()
    : undefined
  const maxImageBytes = typeof record.maxImageBytes === 'number'
    && Number.isFinite(record.maxImageBytes)
    && record.maxImageBytes > 0
    ? Math.floor(record.maxImageBytes)
    : DEFAULT_VISION_RELAY.maxImageBytes
  return {
    enabled,
    ...(reader === undefined ? {} : { reader }),
    maxImageBytes,
  }
}