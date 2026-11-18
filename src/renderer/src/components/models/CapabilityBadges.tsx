/**
 * 一个模型能力解析的徽标组：V/T/R、档位、输入模态、上下文与输出上限。
 *
 * 值与出处都来自选路用的**同一份** `ModelCapability`，所以徽标写什么，路由就真的按
 * 什么判断（`vision` 未知即接不了图片）。路由池编辑器与「路由与模型」页共用这一份，
 * 不许各画一套 —— 两处的判据一旦分叉，用户会以为改标注只对其中一个界面生效。
 *
 * `unknown` 照写不省：这一格恰恰是「没证据就不许接图」的原因，留白会被读成「支持」。
 */
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { CapabilitySource, ModelCapability } from '@shared/types'

function formatContext(tokens: number | undefined): string | null {
  if (tokens === undefined) return null
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

export function CapabilityBadges({ capability }: { capability: ModelCapability }) {
  const { t } = useTranslation()
  const entries: { key: string; label: string; source: CapabilitySource }[] = [
    { key: 'vision', label: `V:${capability.vision}`, source: capability.sources.vision },
    { key: 'tools', label: `T:${capability.tools}`, source: capability.sources.tools },
    { key: 'reasoning', label: `R:${capability.reasoning}`, source: capability.sources.reasoning },
    { key: 'tier', label: capability.tier, source: capability.sources.tier },
  ]
  if (capability.modalities !== undefined && capability.modalities.length > 0) {
    entries.push({
      key: 'modalities',
      label: `M:${capability.modalities.join('+')}`,
      source: capability.sources.modalities,
    })
  }
  const context = formatContext(capability.contextTokens)
  if (context !== null) {
    entries.push({ key: 'context', label: `ctx ${context}`, source: capability.sources.contextTokens })
  }
  const maxOutput = formatContext(capability.maxOutputTokens)
  if (maxOutput !== null) {
    entries.push({ key: 'maxOutput', label: `out ${maxOutput}`, source: capability.sources.maxOutputTokens })
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entries.map((entry) => (
        <Badge
          key={entry.key}
          variant="outline"
          className="text-[10px] font-normal"
          title={t(`proxy.routePoolSource_${entry.source}`)}
        >
          {entry.label}
          {entry.source !== 'unknown' && (
            <span className="ml-1 opacity-60">{t(`proxy.routePoolSourceShort_${entry.source}`)}</span>
          )}
        </Badge>
      ))}
    </span>
  )
}

export default CapabilityBadges