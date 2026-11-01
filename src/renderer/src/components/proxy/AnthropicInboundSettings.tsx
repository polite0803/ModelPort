/**
 * Anthropic 入向（`/v1/messages`）设置。
 *
 * 这张卡只管两件事：客户端点名的 `claude-*` 落到网关的哪个模型，以及哪些面向客户端的
 * 名字会出现在 `/v1/models` 里。两个键都被 `proxy/routes/messages.ts` 直接读，所以这里
 * 没有「加了开关但没人读」的格子。
 *
 * 与 `CompressionSettings` 同一套纪律：**不在渲染层抄一份默认值**。两个键都是可选的，
 * 缺席即后端行为（能解析就原样用，否则落 `auto`）；这里把「还没读到」与「读到但没配」
 * 分成两个状态显示，否则空输入框会被读成「已配置成空」。
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Plus, Trash2, Braces, Radar } from 'lucide-react'
import type { AnthropicDiscoveryPlan, AnthropicInboundConfig } from '@/types/electron'
import { ANTHROPIC_FAMILY_TIERS, type AnthropicFamilyTier } from '@shared/types'
import { clientNamesForTieredRoutes, routesAbsentFromClaudePicker } from '@shared/anthropicWire'

/** Radix 的 SelectItem 不许用空串当值，「不广告」这一档另起一个哨兵值。 */
const TIER_NONE = '__none__'

function tiersToRecord(entries: Record<string, string>): AnthropicInboundConfig['routeTiers'] {  const kept: Record<string, AnthropicFamilyTier> = {}
  for (const [route, tier] of Object.entries(entries)) {
    if ((ANTHROPIC_FAMILY_TIERS as readonly string[]).includes(tier)) {
      kept[route] = tier as AnthropicFamilyTier
    }
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** 空显示名不写键：留空就是「按路由名显示」，写空串进库会让客户端显示空白。 */
function namesToRecord(entries: Record<string, string>): AnthropicInboundConfig['routeDisplayNames'] {
  const kept: Record<string, string> = {}
  for (const [route, label] of Object.entries(entries)) {
    const value = label.trim()
    if (route.trim() !== '' && value !== '') kept[route.trim()] = value
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** 编辑态把 `modelMap` 摊成行；落库时再折回记录（见 `rowsToMap`）。 */
interface MappingRow {
  from: string
  to: string
}

function rowsToMap(rows: MappingRow[]): Record<string, string> | undefined {
  const entries = rows
    .map(row => ({ from: row.from.trim(), to: row.to.trim() }))
    .filter(entry => entry.from !== '' && entry.to !== '')
  return entries.length === 0 ? undefined : Object.fromEntries(entries.map(entry => [entry.from, entry.to]))
}

function duplicateNames(rows: MappingRow[]): string[] {
  const seen = new Map<string, number>()
  for (const row of rows) {
    const key = row.from.trim()
    if (key === '') continue
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key)
}

export function AnthropicInboundSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()

  // `null` = 还没读后端值；`{}` = 读到了但这份安装还没配过。两者在界面上必须不同，
  // 否则用户会把「没配」当成「配成了空」，而这两种状态的后端行为不一样。
  const [draft, setDraft] = useState<AnthropicInboundConfig | null>(null)
  const [rows, setRows] = useState<MappingRow[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  // 档位编辑态用裸字符串（含「不广告」哨兵值），落库前才折成合法档位。
  const [tierDraft, setTierDraft] = useState<Record<string, string>>({})
  // 客户端显示名：id 必须是能被解析的路由名，想让用户看见别的字只能改这一格。
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({})
  const [routeNames, setRouteNames] = useState<string[]>([])

  useEffect(() => {
    void loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const appConfig = await window.electronAPI.config.get()
      setRouteNames(
        Object.values(appConfig?.routes ?? {})
          .filter(route => route.enabled)
          .map(route => route.name),
      )
      const inbound = appConfig?.anthropicInbound
      if (inbound === undefined) {
        setDraft({})
        setRows([])
        setTierDraft({})
        setNameDraft({})
        return
      }
      setDraft(inbound)
      setRows(
        Object.entries(inbound.modelMap ?? {}).map(([from, to]) => ({ from, to: String(to ?? '') })),
      )
      setTierDraft({ ...(inbound.routeTiers ?? {}) })
      setNameDraft({ ...(inbound.routeDisplayNames ?? {}) })
    } catch (error) {
      console.error('Failed to load anthropic inbound config:', error)
      setDraft(null)
    }
  }

  const saveConfig = async () => {
    if (draft === null) return
    try {
      // 留空 = 不写键：把空串写进库会让后端把「用户要求落空名」当成一条真实映射。
      const next: AnthropicInboundConfig = {
        defaultModel: draft.defaultModel?.trim() === '' ? undefined : draft.defaultModel,
        modelMap: rowsToMap(rows),
        routeTiers: tiersToRecord(tierDraft),
        routeDisplayNames: namesToRecord(nameDraft),
        // 没动过就不写这一格（undefined = 走默认开）；只有用户真关过才落 `false`。
        documentPassThrough: draft.documentPassThrough,
      }
      await window.electronAPI.config.update({ anthropicInbound: next })
      setDraft(next)
      setRows(
        Object.entries(next.modelMap ?? {}).map(([from, to]) => ({ from, to: String(to ?? '') })),
      )
      setTierDraft({ ...(next.routeTiers ?? {}) })
      setNameDraft({ ...(next.routeDisplayNames ?? {}) })
      setHasChanges(false)
      toast({ title: t('common.success'), description: t('anthropicInbound.configSaved') })
    } catch (error) {
      console.error('Failed to save anthropic inbound config:', error)
      toast({
        title: t('common.error'),
        description: t('anthropicInbound.configSaveFailed'),
        variant: 'destructive',
      })
    }
  }

  const updateRow = (index: number, updates: Partial<MappingRow>) => {
    setRows(previous => previous.map((row, i) => (i === index ? { ...row, ...updates } : row)))
    setHasChanges(true)
  }

  /* ---------------------------------- Anthropic 客户端可发现名（读预览 / 写别名） */

  const [plan, setPlan] = useState<AnthropicDiscoveryPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  // 逐条建路由时失败的那些（名字冲突、校验拒绝）：已建成的不回滚，所以必须单独列。
  const [failed, setFailed] = useState<Array<{ name: string; message: string }>>([])
  const [discoveryBusy, setDiscoveryBusy] = useState(false)

  const readPlan = async () => {
    setDiscoveryBusy(true)
    try {
      const result = await window.electronAPI.anthropicDiscovery.plan()
      setPlan(result.ok ? result.plan : null)
      setPlanError(result.ok ? null : result.error.message)
      setFailed([])
    } catch (error) {
      // IPC 边界不许把裸异常变成 undefined：这里兜住渲染层的调用异常本身。
      setPlan(null)
      setPlanError(error instanceof Error ? error.message : String(error))
      setFailed([])
    } finally {
      setDiscoveryBusy(false)
    }
  }

  const applyPlan = async () => {
    setDiscoveryBusy(true)
    try {
      const result = await window.electronAPI.anthropicDiscovery.apply()
      if (!result.ok) {
        setPlanError(result.error.message)
        return
      }
      setPlanError(null)
      setFailed(result.failed)
      toast({
        title: t('common.success'),
        description: result.created.length === 0
          ? t('anthropicInbound.discoveryNothingNew')
          : t('anthropicInbound.discoveryApplied', { total: result.created.length }),
      })
      // 落库后重算再显示：新建的路由下一轮会自己归进「已存在」，面板不能还停在点之前的草稿。
      const again = await window.electronAPI.anthropicDiscovery.plan()
      if (again.ok) setPlan(again.plan)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiscoveryBusy(false)
    }
  }

  const duplicates = draft === null ? [] : duplicateNames(rows)

  // 客户端名这一节只在目录里真有 Claude 形态的模型时才成立，所以挂载即读一次预览：
  // 不读就不知道该不该出现，让用户去点「预览」才发现点了是 0 —— 那正是被退回过的形态。
  useEffect(() => {
    void readPlan()
  }, [])

  // 档位只过客户端「发现」那一关，它的下拉还有一道独立的名称关（判据与出处都写在
  // `shared/anthropicWire.ts`）。按编辑态算，选完档位就能看到「这条名字点不到」，
  // 不必保存后再去客户端那边猜为什么只有默认模型。
  const pickerGaps = useMemo(
    () =>
      routesAbsentFromClaudePicker({
        routeNames,
        routeTiers: tierDraft,
        modelMap: rowsToMap(rows) ?? {},
      }),
    [routeNames, tierDraft, rows],
  )

  // 补名字这件事的判据也只有一份：面板不自己拼 `claude-` 前缀，撞名与序号都在 shared 里算。
  const clientNamePlan = useMemo(
    () =>
      clientNamesForTieredRoutes({
        routeNames,
        routeTiers: tierDraft,
        modelMap: rowsToMap(rows) ?? {},
      }),
    [routeNames, tierDraft, rows],
  )

  const applyClientNames = () => {
    if (clientNamePlan.add.length === 0) return
    // 只写进上面那张映射表的编辑态：用户先看得见补了哪几条，再决定保不保存。
    setRows(previous => [...previous, ...clientNamePlan.add])
    setHasChanges(true)
  }

  // 「生成路由」那一节的成立条件：目录里有候选（要建/已可见/被跳过都算）或读它出过错。
  // 三堆全空 = 这份安装的目录里根本没有 Claude 形态的模型，那一节就只剩两个点了没反应的
  // 按钮和三个 0 —— 那是歧义，不是信息，所以整节不出现（有了候选会自己回来）。
  const discoveryRelevant =
    planError !== null
    || failed.length > 0
    || (plan !== null
      && (plan.create.length > 0 || plan.alreadyVisible.length > 0 || plan.skipped.length > 0))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Braces className="h-5 w-5" />
          {t('anthropicInbound.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {draft === null ? (
          <p className="p-4 text-sm text-muted-foreground rounded-lg bg-muted/30">
            {t('anthropicInbound.loading')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="anthropic-document-pass-through">{t('anthropicInbound.documentPassThrough')}</Label>
                <p className="text-sm text-muted-foreground">{t('anthropicInbound.documentPassThroughHint')}</p>
              </div>
              {/* 这一格的消费方是 `proxy/routes/messages.ts` 里 `anthropicToChatRequest` 的
                  `documentsAsFileParts`，判据在 tests/routes/anthropic-inbound.test.ts：
                  开 → 上游报文带 `type:"file"`；关 → 缺席进响应头与 warn 日志。 */}
              <Switch
                id="anthropic-document-pass-through"
                // 可选且默认开：只有显式 `false` 才关（与 `trailingUserGuard` 同一形态）。
                checked={draft.documentPassThrough !== false}
                onCheckedChange={checked => {
                  setDraft({ ...draft, documentPassThrough: !checked })
                  setHasChanges(true)
                }}
              />
            </div>

            <div className="space-y-2 p-4 bg-muted/30 rounded-lg">
              <Label htmlFor="anthropic-default-model">{t('anthropicInbound.defaultModel')}</Label>
              <p className="text-sm text-muted-foreground">{t('anthropicInbound.defaultModelHint')}</p>
              <Input
                id="anthropic-default-model"
                value={draft.defaultModel ?? ''}
                placeholder="auto"
                onChange={event => {
                  setDraft({ ...draft, defaultModel: event.target.value })
                  setHasChanges(true)
                }}
              />
            </div>

            <div className="space-y-3 pt-4 border-t">
              <div className="space-y-0.5">
                <Label>{t('anthropicInbound.mappings')}</Label>
                <p className="text-sm text-muted-foreground">{t('anthropicInbound.mappingsHint')}</p>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('anthropicInbound.noMappings')}</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        className="flex-1 font-mono"
                        value={row.from}
                        placeholder="claude-sonnet-4-6"
                        aria-label={t('anthropicInbound.clientName')}
                        onChange={event => updateRow(index, { from: event.target.value })}
                      />
                      <span className="text-sm text-muted-foreground">→</span>
                      <Input
                        className="flex-1 font-mono"
                        value={row.to}
                        placeholder="auto"
                        aria-label={t('anthropicInbound.gatewayModel')}
                        onChange={event => updateRow(index, { to: event.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('anthropicInbound.remove')}
                        onClick={() => {
                          setRows(previous => previous.filter((_, i) => i !== index))
                          setHasChanges(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setRows(previous => [...previous, { from: '', to: '' }])
                  setHasChanges(true)
                }}
              >
                <Plus className="h-4 w-4" />
                {t('anthropicInbound.addMapping')}
              </Button>

              {duplicates.length > 0 && (
                // 同名键折回记录时后者覆盖前者 —— 不报出来就等于静默丢一条映射。
                <p className="text-sm text-destructive">
                  {t('anthropicInbound.duplicateNames', { names: duplicates.join(', ') })}
                </p>
              )}

              <p className="text-sm text-muted-foreground">{t('anthropicInbound.discoveryNote')}</p>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <div className="space-y-0.5">
                <Label>{t('anthropicInbound.tierTitle')}</Label>
                <p className="text-sm text-muted-foreground">{t('anthropicInbound.tierHint')}</p>
              </div>

              {routeNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('anthropicInbound.tierNoRoutes')}</p>
              ) : (
                <div className="space-y-2">
                  {routeNames.map(route => (
                    <div key={route} className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-sm truncate">{route}</code>
                      <Input
                        className="flex-1"
                        value={nameDraft[route] ?? ''}
                        placeholder={route}
                        aria-label={t('anthropicInbound.displayNameColumn')}
                        onChange={event => {
                          setNameDraft(previous => ({ ...previous, [route]: event.target.value }))
                          setHasChanges(true)
                        }}
                      />
                      <Select
                        value={tierDraft[route] ?? TIER_NONE}
                        onValueChange={value => {
                          setTierDraft(previous => ({ ...previous, [route]: value }))
                          setHasChanges(true)
                        }}
                      >
                        <SelectTrigger className="w-[200px]" aria-label={t('anthropicInbound.tierColumn')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TIER_NONE}>{t('anthropicInbound.tierNone')}</SelectItem>
                          {ANTHROPIC_FAMILY_TIERS.map(tier => (
                            <SelectItem key={tier} value={tier}>
                              {t(`anthropicInbound.tier_${tier}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}

              {/* 客户端的模型选择器还有一道与档位无关的名称关（判据出处见 shared/anthropicWire.ts）。
                  不说这一格，「测连说找到 3 个模型」与「下拉里只有默认模型」在用户那边就是矛盾。 */}
              {pickerGaps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm text-destructive">
                    {t('anthropicInbound.pickerGapTitle', { names: pickerGaps.map(gap => gap.route).join(', ') })}
                  </p>
                  {pickerGaps.map(gap => (
                    <p key={gap.route} className="text-xs text-destructive">
                      <span className="font-mono">{gap.route}</span>
                      {' — '}
                      {t(`anthropicInbound.pickerGapReason.${gap.shape}`)}
                    </p>
                  ))}
                  {clientNamePlan.add.length > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={applyClientNames}>
                      {t('anthropicInbound.pickerGapApply')}
                    </Button>
                  )}
                  {clientNamePlan.blocked.length > 0 && (
                    // 补不出不冲突的名字时不许静默少补：那几条只能由用户自己改名。
                    <p className="text-sm text-destructive">
                      {t('anthropicInbound.pickerGapBlocked', { names: clientNamePlan.blocked.join(', ') })}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">{t('anthropicInbound.pickerGapFix')}</p>
                </div>
              )}
            </div>

            {/* 目录里没有 Claude 形态的模型时整节不出现（成立条件见上面的 `discoveryRelevant`）：
                两个点了只出三个 0 的按钮是歧义，不是信息；等目录里真出现候选，它会自己回来。 */}
            {discoveryRelevant && (
              <div className="space-y-3 pt-4 border-t">
                <div className="space-y-0.5">
                  <Label>{t('anthropicInbound.discoveryTitle')}</Label>
                  <p className="text-sm text-muted-foreground">{t('anthropicInbound.discoveryHint')}</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={discoveryBusy}
                    className="gap-2"
                    onClick={() => void readPlan()}
                  >
                    <Radar className="h-4 w-4" />
                    {t('anthropicInbound.discoveryPreview')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={discoveryBusy}
                    onClick={() => void applyPlan()}
                  >
                    {t('anthropicInbound.discoveryApply')}
                  </Button>
                </div>

                {planError !== null && (
                  <p className="text-sm text-destructive">
                    {t('anthropicInbound.discoveryError', { message: planError })}
                  </p>
                )}

                {plan !== null && (
                  <div className="space-y-2 text-sm">
                    {/* 三类结果各占一句：并成一个数字就看不出「少了的那些去了哪」。 */}
                    <p>{t('anthropicInbound.discoveryCreate', { total: plan.create.length })}</p>
                    {plan.create.map(route => (
                      <p key={route.name} className="font-mono text-xs text-muted-foreground">
                        {route.name}
                        {' ← '}
                        {route.pinModels.map(ref => ref.displayName).join(', ')}
                        {route.providerNames.length > 1
                          ? ` · ${t('anthropicInbound.discoveryAlsoServedBy', { names: route.providerNames.join(', ') })}`
                          : ''}
                      </p>
                    ))}

                    {plan.alreadyVisible.length > 0 && (
                      <p>{t('anthropicInbound.discoveryAlready', { total: plan.alreadyVisible.length })}</p>
                    )}
                    {plan.alreadyVisible.length > 0 && (
                      <p className="font-mono text-xs text-muted-foreground">
                        {plan.alreadyVisible.join(', ')}
                      </p>
                    )}

                    <p>{t('anthropicInbound.discoverySkipped', { total: plan.skipped.length })}</p>
                    {plan.skipped.map((entry, index) => (
                      <p key={`${entry.name}-${index}`} className="text-xs text-muted-foreground">
                        <span className="font-mono">{entry.name}</span>
                        {' — '}
                        {t(`anthropicInbound.discoveryReason.${entry.reason}`)}
                      </p>
                    ))}
                  </div>
                )}

                {failed.length > 0 && (
                  // 建到一半失败不倒回去：已建好的是可用产物，这里逐条点名剩下的原因。
                  <div className="space-y-1">
                    <p className="text-sm text-destructive">
                      {t('anthropicInbound.discoveryFailed', { total: failed.length })}
                    </p>
                    {failed.map(entry => (
                      <p key={entry.name} className="text-xs text-destructive">
                        <span className="font-mono">{entry.name}</span>
                        {' — '}
                        {entry.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {hasChanges && draft !== null && (
          <div className="flex justify-end">
            <Button onClick={() => void saveConfig()}>{t('common.save')}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
