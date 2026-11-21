/**
 * 声明额度编辑器（第五层额度证据的表单）。
 *
 * 从 `AddAccountDialog` 里提出来：账号弹窗与聚合详情页的 Key 行都要用同一份表单，
 * 两处各写一份就会在「窗口白名单、单位二分、归一规则」上分叉。
 *
 * 行内只保留已有的声明；「新增」按还没用过的窗口给一条默认（同窗口同单位只保留一条，
 * 归一器取更小的那个）。
 *
 * ## 模板库（2026-11-20 拍板）
 *
 * 「模板」是用户自建的填表助手：选中即把该模板的窗口**填进当前表单**，用户仍可改；
 * 之后要保存才会写进这个账号（或这把 Key）的声明。产品**不内置任何套餐档位数字** ——
 * 官方数字随订阅变化，写进代码就是把某一刻的文档变成产品承诺。
 *
 * 三条边界：
 * 1. 模板只在用户点「存为模板」时才落进配置，与表单本身是两份数据；
 * 2. 选中模板填表**不写盘**，也不改变任何已保存的声明；
 * 3. 删模板只删配置里那一条，绝不触碰任何账号已有的声明。
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Save, Trash2 } from 'lucide-react'
import {
  DECLARED_QUOTA_MAX_LIMIT,
  DECLARED_QUOTA_MAX_TEMPLATE_NAME,
  DECLARED_QUOTA_MAX_TEMPLATES,
  DECLARED_QUOTA_MAX_WINDOWS,
  DECLARED_QUOTA_WINDOWS,
  normalizeDeclaredQuota,
  type DeclaredQuotaLimit,
  type DeclaredQuotaTemplate,
  type DeclaredQuotaUnit,
  type DeclaredQuotaWindow,
} from '@shared/declaredQuota'

export interface DeclaredQuotaEditorProps {
  value: DeclaredQuotaLimit[]
  onChange: (next: DeclaredQuotaLimit[]) => void
  /** 可用的模板库（来自 `AppConfig.declaredQuotaTemplates`）；缺省或空数组时不渲染模板行。 */
  templates?: readonly DeclaredQuotaTemplate[]
  /** 存为新模板；缺省则不渲染「存为模板」。 */
  onSaveTemplate?: (name: string, limits: DeclaredQuotaLimit[]) => void
  /** 删除一个模板；缺省则不渲染删除按钮。 */
  onDeleteTemplate?: (id: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function DeclaredQuotaEditor({
  value,
  onChange,
  templates,
  onSaveTemplate,
  onDeleteTemplate,
  t,
}: DeclaredQuotaEditorProps) {
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const used = new Set(value.map(entry => entry.window))
  const nextWindow = DECLARED_QUOTA_WINDOWS.find(window => !used.has(window))
  const update = (index: number, patch: Partial<DeclaredQuotaLimit>): void => {
    onChange(normalizeDeclaredQuota(value.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))))
  }
  const canOfferTemplates = templates !== undefined && templates.length > 0
  const selectedTemplate = canOfferTemplates
    ? templates.find(template => template.id === selectedTemplateId)
    : undefined
  const canSaveTemplate = onSaveTemplate !== undefined
    && value.length > 0
    && (templates === undefined || templates.length < DECLARED_QUOTA_MAX_TEMPLATES)

  const applyTemplate = (id: string): void => {
    setSelectedTemplateId(id)
    const template = templates?.find(entry => entry.id === id)
    // 填入是「以模板为准」：先归一模板里的 limits，再交给受控表单；用户随后可改。
    if (template !== undefined) onChange(normalizeDeclaredQuota(template.limits))
  }

  const saveTemplate = (): void => {
    if (onSaveTemplate === undefined) return
    const name = templateName.trim().slice(0, DECLARED_QUOTA_MAX_TEMPLATE_NAME)
    if (name.length === 0 || value.length === 0) return
    onSaveTemplate(name, normalizeDeclaredQuota(value))
    setTemplateName('')
  }

  return (
    <div className="space-y-2">
      <Label>{t('providers.declaredQuota')}</Label>
      <p className="text-xs text-muted-foreground">{t('providers.declaredQuotaHint')}</p>

      {(canOfferTemplates || canSaveTemplate) && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <span className="text-xs font-medium text-muted-foreground">{t('providers.declaredTemplate')}</span>
          {canOfferTemplates && (
            <div className="flex items-center gap-2">
              <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                <SelectTrigger className="flex-1" aria-label={t('providers.declaredTemplatePick')}>
                  <SelectValue placeholder={t('providers.declaredTemplatePick')} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map(template => (
                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate !== undefined && onDeleteTemplate !== undefined && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('providers.declaredTemplateDelete')}
                  onClick={() => {
                    onDeleteTemplate(selectedTemplate.id)
                    setSelectedTemplateId('')
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          {canSaveTemplate && (
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder={t('providers.declaredTemplateName')}
                aria-label={t('providers.declaredTemplateName')}
                maxLength={DECLARED_QUOTA_MAX_TEMPLATE_NAME}
                value={templateName}
                onChange={event => setTemplateName(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={templateName.trim().length === 0}
                onClick={saveTemplate}
              >
                <Save className="mr-1.5 h-4 w-4" />
                {t('providers.declaredTemplateSave')}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t('providers.declaredTemplateHint')}</p>
        </div>
      )}

      {value.map((entry, index) => (
        <div key={`${entry.window}-${entry.unit}`} className="flex items-center gap-2">
          <Select
            value={entry.window}
            onValueChange={window => update(index, { window: window as DeclaredQuotaWindow })}
          >
            <SelectTrigger className="w-[120px]" aria-label={t('providers.declaredQuotaWindow')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECLARED_QUOTA_WINDOWS.map(window => (
                <SelectItem key={window} value={window}>{t(`providers.declaredWindow_${window}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={entry.unit}
            onValueChange={unit => update(index, { unit: unit as DeclaredQuotaUnit })}
          >
            <SelectTrigger className="w-[110px]" aria-label={t('providers.declaredQuotaUnit')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requests">{t('providers.declaredUnit_requests')}</SelectItem>
              <SelectItem value="tokens">{t('providers.declaredUnit_tokens')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={DECLARED_QUOTA_MAX_LIMIT}
            className="flex-1"
            aria-label={t('providers.declaredQuotaLimit')}
            value={String(entry.limit)}
            onChange={event => {
              const parsed = Number.parseInt(event.target.value, 10)
              // 空输入暂时按 1 存：这一行是用户刚加的，删掉它要用右边的按钮，不是清空数字。
              update(index, { limit: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 })
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('providers.declaredQuotaRemove')}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {nextWindow !== undefined && value.length < DECLARED_QUOTA_MAX_WINDOWS && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...value, { window: nextWindow, unit: 'requests', limit: 100 }])}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {t('providers.declaredQuotaAdd')}
        </Button>
      )}
    </div>
  )
}
