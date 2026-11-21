/**
 * 声明额度模板库的读写钩子。
 *
 * 模板存在 `AppConfig.declaredQuotaTemplates`，写入口是 `config:update`（与其它设置页
 * 同一条通路：主进程归一、广播 `CONFIG_CHANGED`、备份随之带走）。这里只做三件事：
 * 读当前库、把「当前表单」存成新模板、删一条模板。
 *
 * 三条边界：
 * 1. **不碰账号**：模板是配置，账号声明是账号记录，两个写入口永不互相替代；
 * 2. **重名即覆盖**（同一 `name`）：用户再存一次同名模板，意思就是「这档改成现在这样」，
 *    而不是在下拉里多出一项互相矛盾的模板；
 * 3. **条数上限**：超过 `DECLARED_QUOTA_MAX_TEMPLATES` 时拒绝新增并返回原因，
 *    由调用方决定怎么提示，不静默丢弃。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  DECLARED_QUOTA_MAX_TEMPLATES,
  normalizeDeclaredQuota,
  normalizeDeclaredQuotaTemplates,
  type DeclaredQuotaLimit,
  type DeclaredQuotaTemplate,
} from '@shared/declaredQuota'

export type SaveTemplateOutcome =
  | { ok: true; templates: DeclaredQuotaTemplate[] }
  | { ok: false; reason: 'limit' | 'save-failed' | 'empty' }

export interface DeclaredQuotaTemplatesApi {
  templates: DeclaredQuotaTemplate[]
  saveTemplate: (name: string, limits: DeclaredQuotaLimit[]) => Promise<SaveTemplateOutcome>
  deleteTemplate: (id: string) => Promise<boolean>
}

export function useDeclaredQuotaTemplates(): DeclaredQuotaTemplatesApi {
  const [templates, setTemplates] = useState<DeclaredQuotaTemplate[]>([])

  const persist = useCallback(async (next: DeclaredQuotaTemplate[]): Promise<boolean> => {
    const previous = templates
    setTemplates(next)
    try {
      await window.electronAPI.config.update({ declaredQuotaTemplates: next })
      return true
    } catch (error) {
      console.error('[DeclaredQuotaTemplates] save failed:', error)
      setTemplates(previous)
      return false
    }
  }, [templates])

  useEffect(() => {
    let cancelled = false
    window.electronAPI.config.get()
      .then(config => {
        if (!cancelled) setTemplates(normalizeDeclaredQuotaTemplates(config?.declaredQuotaTemplates))
      })
      .catch(error => console.error('[DeclaredQuotaTemplates] load failed:', error))
    return () => { cancelled = true }
  }, [])

  const saveTemplate = useCallback(async (name: string, limits: DeclaredQuotaLimit[]): Promise<SaveTemplateOutcome> => {
    const normalized = normalizeDeclaredQuota(limits)
    if (normalized.length === 0) return { ok: false, reason: 'empty' }
    // 同名覆盖：先按名字剔除旧的一条，再归一（归一器的 id 会按新顺序重排）。
    const withoutSameName = templates.filter(template => template.name !== name)
    if (withoutSameName.length >= DECLARED_QUOTA_MAX_TEMPLATES) return { ok: false, reason: 'limit' }
    const next = normalizeDeclaredQuotaTemplates([...withoutSameName, { name, limits: normalized }])
    const saved = await persist(next)
    return saved ? { ok: true, templates: next } : { ok: false, reason: 'save-failed' }
  }, [persist, templates])

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    const next = normalizeDeclaredQuotaTemplates(templates.filter(template => template.id !== id))
    return persist(next)
  }, [persist, templates])

  return { templates, saveTemplate, deleteTemplate }
}
