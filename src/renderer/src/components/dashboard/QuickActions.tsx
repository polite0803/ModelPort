import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Plus, FileText, Settings2, Zap } from 'lucide-react'

export interface QuickActionsProps {
  onAddAccount: () => void
  onViewLogs: () => void
  onOpenProxy: () => void
  className?: string
}

export function QuickActions({
  onAddAccount,
  onViewLogs,
  onOpenProxy,
  className,
}: QuickActionsProps) {
  const { t } = useTranslation()

  return (
    <Card className={cn('flex h-full flex-col p-5', className)}>
      <div className="flex items-center gap-2">
        <Zap className="h-[15px] w-[15px] text-[var(--text-muted)]" />
        <h3 className="card-heading">
          {t('quickActions.title')}
        </h3>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-1">
        <Button className="w-full justify-start" onClick={onAddAccount}>
          <Plus className="h-4 w-4" />
          {t('quickActions.addAccount')}
        </Button>

        <Button className="w-full justify-start font-normal" variant="ghost" onClick={onOpenProxy}>
          <Settings2 className="h-4 w-4" />
          {t('nav.proxy')}
        </Button>

        <Button className="w-full justify-start font-normal" variant="ghost" onClick={onViewLogs}>
          <FileText className="h-4 w-4" />
          {t('quickActions.viewLogs')}
        </Button>
      </div>
    </Card>
  )
}
