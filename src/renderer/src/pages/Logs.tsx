import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { RequestLogList } from '@/components/logs'

export default function LogsPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight') || undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('logs.pageTitle')}</h1>
          <p className="text-muted-foreground">{t('logs.pageDescription')}</p>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
          <RequestLogList highlightId={highlightId} />
        </CardContent>
      </Card>
    </div>
  )
}
