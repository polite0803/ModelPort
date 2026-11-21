/**
 * 账号的「声明额度」只读展示行。
 *
 * 这里是第五层额度证据（用户自己写下的上限），与实时钱余额、token 账本、官方静态帽
 * 严格分域：`tokens` 与 `requests` 分行写、永不换算，也没有进度条。
 *
 * 复位时刻只认两种能算的：`week` / `month` 走 UTC 自然边界，给确定时刻；
 * `fiveHour` / `day` 是滚动窗口，复位要按账本里最老那笔用量推算，而 renderer
 * 拿不到那个输入 —— 一律写「复位时刻未知」，不猜、不伪造「约」。
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { anchoredWindow, type DeclaredQuotaLimit } from '@shared/declaredQuota'
import { describeDelay } from '@shared/routeQuotaView'

function delayLabel(
  until: number,
  now: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const { unit, n } = describeDelay(Math.max(0, until - now))
  return t(`routes.delay_${unit}`, { n })
}

export function DeclaredQuotaRows(props: {
  quota?: readonly DeclaredQuotaLimit[]
  now: number
}): ReactNode {
  const { t } = useTranslation()
  const { quota, now } = props
  if (quota === undefined || quota.length === 0) return null

  return (
    <div className="mt-1 space-y-0.5">
      {quota.map((row, index) => {
        const windowLabel = t(`providers.declaredWindow_${row.window}`)
        const unitLabel = t(`providers.declaredUnit_${row.unit}`)
        const isNatural = row.window === 'week' || row.window === 'month'
        const reset = isNatural
          ? t('routes.quotaResetExact', {
              when: delayLabel(anchoredWindow(row.window as 'week' | 'month', now).resetAt, now, t),
            })
          : t('routes.quotaResetUnknown')
        return (
          <div key={`${row.window}-${row.unit}-${index}`} className="text-xs text-muted-foreground">
            {t('providers.declaredQuotaRow', {
              window: windowLabel,
              limit: row.limit,
              unit: unitLabel,
            })}
            {' · '}
            {reset}
            {/* 自然窗口按 UTC 算，而厂商可能用本地时区或订阅日：把口径写出来而不是假装精确。 */}
            {isNatural && (
              <span title={t('routes.quotaResetUtcNote')}>{' · '}{t('routes.quotaUtcShort')}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
