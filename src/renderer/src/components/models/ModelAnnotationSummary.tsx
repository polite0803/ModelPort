/**
 * 模型行上的标注摘要：把解析后的六项关键属性压成一行，值后面不带占位。
 *
 * 批量补全写的是采用台账；行上不显示值，用户只能看到「跑完了」，看不到「补成了什么」。
 * 未知字段直接省略（不输出 0 / 「未知」占位），悬停给出完整字段名与出处。
 */
import { useTranslation } from 'react-i18next'
import type { MetadataAttribute, ModelMetadata } from '@shared/modelMetadata'
import { SOURCE_LABEL_KEYS, formatTokens } from './ModelAnnotationDialog'

type SummaryAttribute = Extract<
  MetadataAttribute,
  'contextTokens' | 'maxOutputTokens' | 'tools' | 'vision' | 'reasoning' | 'modalities'
>

const SUMMARY_ATTRIBUTES: ReadonlyArray<{
  attribute: SummaryAttribute
  shortKey: string
  fullKey: string
}> = [
  {
    attribute: 'contextTokens',
    shortKey: 'models.metadata.attrShortContextTokens',
    fullKey: 'models.metadata.attrContextTokens',
  },
  {
    attribute: 'maxOutputTokens',
    shortKey: 'models.metadata.attrShortMaxOutputTokens',
    fullKey: 'models.metadata.attrMaxOutputTokens',
  },
  { attribute: 'tools', shortKey: 'models.metadata.attrShortTools', fullKey: 'models.metadata.attrTools' },
  { attribute: 'vision', shortKey: 'models.metadata.attrShortVision', fullKey: 'models.metadata.attrVision' },
  {
    attribute: 'reasoning',
    shortKey: 'models.metadata.attrShortReasoning',
    fullKey: 'models.metadata.attrReasoning',
  },
  {
    attribute: 'modalities',
    shortKey: 'models.metadata.attrShortModalities',
    fullKey: 'models.metadata.attrModalities',
  },
]

function formatSummaryValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join('+')
  if (value === 'yes') return '✓'
  if (value === 'no') return '✗'
  if (typeof value === 'number') return formatTokens(value)
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return String(value)
}

export function ModelAnnotationSummary({
  metadata,
  className,
}: {
  metadata?: ModelMetadata
  className?: string
}) {
  const { t } = useTranslation()
  if (!metadata) return null

  const parts: string[] = []
  const details: string[] = []
  for (const row of SUMMARY_ATTRIBUTES) {
    const fact = metadata[row.attribute]
    if (fact.state !== 'known') continue
    const value = formatSummaryValue(fact.value)
    parts.push(`${t(row.shortKey)} ${value}`)
    details.push(
      `${t(row.fullKey)}: ${value}（${
        t(SOURCE_LABEL_KEYS[fact.source] ?? 'models.metadata.sourceUnclassified')
      }）`,
    )
  }
  if (parts.length === 0) return null

  return (
    <span
      className={`truncate text-[11px] text-muted-foreground${className ? ` ${className}` : ''}`}
      title={details.join(' · ')}
    >
      {parts.join(' · ')}
    </span>
  )
}

export default ModelAnnotationSummary
