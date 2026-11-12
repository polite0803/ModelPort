import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { LoadBalanceStrategy, AutoPreference, ModelRoute } from '@/types/electron'
import type { ModelScope } from '../../../../shared/types'
import {
  AUTO_POOL_PRESETS,
  AUTO_POOL_STRATEGIES,
  AUTO_PREFERENCES,
  DEFAULT_AUTO_ROUTING_CONFIG,
  DEFAULT_FAIRNESS_LEAD,
  FAIRNESS_LEAD_MAX,
  MODEL_SCOPES,
  type AutoPoolPresetMeta,
  type AutoPoolStrategy,
  type AutoPoolStrategyCategory,
  type AutoPoolStrategyId,
  type AutoPoolStrategyOperator,
  type RouteModelRef,
} from '../../../../shared/types'
import { RoutePoolEditor } from './RoutePoolEditor'

/**
 * 一条路由里除「名字」与「启用位」以外的全部可编辑字段。
 *
 * 抽成一个类型而不是散落的参数：新建表单与已有路由的编辑区共用同一份子组件，
 * 两边的字段集合必须由类型保证一致，否则加一个路由字段就要改两处。
 */
export interface ModelRouteFieldValues {
  /** 打分口径；账号挑选仍跟随服务级 `loadBalanceStrategy`。 */
  strategy: LoadBalanceStrategy
  prefer: AutoPreference
  /**
   * 一轮之内允许换到哪些模型（架构 A）。盘上是可选键，界面用一个确定的档位：
   * 缺键读作 `single` —— 与主进程 `normalizeModelRoutes` 同一条兜底口径。
   */
  modelScope: ModelScope
  maxAttempts: number
  stickyMinutes: number
  /**
   * 粘性硬优先：把上一轮成功的模型提到队首，盖过打分差。界面用一个确定的布尔，
   * 盘上却是可选键 —— 缺省即开，见 `routeFieldValuesOf` 那一侧的 `!== false`。
   * 关掉它，粘性就只剩打分里的 +0.12 / +0.06，差距过大时会让位。
   */
  stickyHardPin: boolean
  /**
   * 份额轮转的领先档：同一个模型最多可以领先「本池派发最少的模型」几次，超过就退到
   * 队后。0 = 严格轮流，越大越接近纯分数优先（上界 `FAIRNESS_LEAD_MAX`）。
   * 盘上是可选键（缺省走出厂默认），界面用一个确定的数，写回时落显式值。
   */
  fairnessLead: number
  poolStrategies: AutoPoolStrategy[]
  /** 策略之后手动加回的模型（误筛修正）。 */
  includeModels: RouteModelRef[]
  /** 策略之后手动移除的模型；优先于 include。 */
  excludeModels: RouteModelRef[]
  /**
   * 名字钉定：非空时这条路由的池只可能是这些模型。空 = 不钉（池 = 全部候选）。
   * 客户端可点名的名字域现在只有路由，所以「这条路由真的只跑那几个模型」全靠这一格。
   */
  pinModels: RouteModelRef[]
  /**
   * 池引用：非空时这条路由的**全部选择行为**取自被引用的那条路由，上面这些字段
   * 一概不参与（界面会把它们置灰并说明原因）。存在的理由与 `pinModels` 相反 ——
   * 一个客户端入口名不该复制一份池配置，复制了就有两份真值。
   */
  basedOnRoute?: string
}

/** Radix 的 SelectItem 不许用空串；「自带池（不引用）」这一档另起哨兵值。 */
export const NO_POOL_SOURCE = '__own_pool__'

/** 策略下拉的选项由父组件传入：五个策略的字面量与标签表只允许存在于 `LoadBalanceConfig.tsx`。 */
export interface ModelRouteOption {
  value: string
  label: string
}

export interface ModelRouteStrategyOption extends ModelRouteOption {
  value: LoadBalanceStrategy
}

interface ModelRouteFieldsProps {
  /**
   * 控件 `id` 的前缀：新建用 `new`，已有路由用路由名。
   * 同一张卡片里会同时存在多份这份控件组，`id` 必须唯一，`<Label htmlFor>` 才指得对。
   */
  idPrefix: string
  values: ModelRouteFieldValues
  onChange: (patch: Partial<ModelRouteFieldValues>) => void
  strategyOptions: ModelRouteStrategyOption[]
  /** 可作为池来源的其他路由（父组件已排除正在编辑的那一条）。 */
  poolRouteOptions?: ModelRouteOption[]
}

/**
 * 新路由的初始字段：**默认值只有共享常量这一份真值源**。
 *
 * `strategy` 是唯一不在 `DEFAULT_AUTO_ROUTING_CONFIG` 里的字段（legacy 单 auto 用的就是
 * 服务级策略），所以由调用方把当前 `loadBalanceStrategy` 传进来 —— 那正是主进程
 * `normalizeModelRoutes` 的兜底口径，UI 不再抄一个字面量。
 */
export function defaultRouteFieldValues(strategy: LoadBalanceStrategy): ModelRouteFieldValues {
  return {
    strategy,
    prefer: DEFAULT_AUTO_ROUTING_CONFIG.prefer,
    // 架构 A 的缺省范围就是主进程读侧的缺省：一轮只服务一个模型。
    modelScope: 'single' as ModelScope,
    maxAttempts: DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts,
    stickyMinutes: DEFAULT_AUTO_ROUTING_CONFIG.stickyMinutes,
    // 与主进程同一条判据：缺键即硬钉（`!== false`），新路由的初值因此是开。
    stickyHardPin: true,
    fairnessLead: DEFAULT_FAIRNESS_LEAD,
    poolStrategies: DEFAULT_AUTO_ROUTING_CONFIG.poolStrategies.map((strategyItem) => ({ ...strategyItem })),
    includeModels: [],
    excludeModels: [],
    pinModels: [],
    basedOnRoute: undefined,
  }
}

/** 盘上的一条路由 → 编辑草稿（新对象 + 新数组，绝不返回入参的引用）。 */
export function routeFieldValuesOf(route: ModelRoute): ModelRouteFieldValues {
  return {
    strategy: route.strategy,
    prefer: route.prefer,
    // 盘上缺这一格 = 一轮一个模型，与 `autoRouter` 读侧同一条兜底。
    modelScope: route.modelScope ?? 'single',
    maxAttempts: route.maxAttempts,
    stickyMinutes: route.stickyMinutes,
    // 盘上没有这一格 = 硬钉开着，与 `autoRouter` 读侧同一条 `!== false` 判据。
    stickyHardPin: route.stickyHardPin !== false,
    // 同上：盘上没这一格 = 走出厂默认，草稿里显示的就是实际生效的那个数。
    fairnessLead: route.fairnessLead ?? DEFAULT_FAIRNESS_LEAD,
    poolStrategies: route.poolStrategies.map((strategyItem) => ({ ...strategyItem })),
    includeModels: route.includeModels.map((ref) => ({ ...ref })),
    excludeModels: route.excludeModels.map((ref) => ({ ...ref })),
    pinModels: route.pinModels.map((ref) => ({ ...ref })),
    basedOnRoute: route.basedOnRoute,
  }
}

/** 勾选/取消一个候选池策略：追加在序列末尾，取消则移除（始终返回新数组）。 */
export function withPoolStrategyToggled(
  poolStrategies: AutoPoolStrategy[],
  id: AutoPoolStrategyId
): AutoPoolStrategy[] {
  return poolStrategies.some((item) => item.id === id)
    ? poolStrategies.filter((item) => item.id !== id)
    : [...poolStrategies, { id, operator: 'and' as AutoPoolStrategyOperator }]
}

/** 改某个位置上策略的运算符（第一个的运算符被求值器忽略，但保留原值，不静默改写用户输入）。 */
export function withPoolStrategyOperator(
  poolStrategies: AutoPoolStrategy[],
  index: number,
  operator: AutoPoolStrategyOperator
): AutoPoolStrategy[] {
  return poolStrategies.map((item, position) => (position === index ? { ...item, operator } : item))
}

/** 预设 → 一整份新的策略序列（逐项拷贝，避免与 `AUTO_POOL_PRESETS` 共享引用）。 */
export function poolStrategiesOfPreset(preset: AutoPoolPresetMeta): AutoPoolStrategy[] {
  return preset.strategies.map((item) => ({ ...item }))
}

const CATEGORY_ORDER: AutoPoolStrategyCategory[] = ['capability', 'cost', 'context', 'tier', 'channel']

/**
 * 单条路由的全部字段控件：新建表单与已有路由的编辑区共用这一份实现。
 *
 * 只负责「改草稿」，不碰 IPC：写盘时机、错误文案的显示都由父组件决定，
 * 于是新建与编辑两条路径能共享同一个 `error.message` 展示区。
 */
export function ModelRouteFields({
  idPrefix,
  values,
  onChange,
  strategyOptions,
  poolRouteOptions = [],
}: ModelRouteFieldsProps) {
  const { t } = useTranslation()

  const referenced = values.basedOnRoute ?? ''
  const isReferenced = referenced !== ''

  const operatorLabel = (operator: AutoPoolStrategyOperator) =>
    operator === 'and' ? t('proxy.autoRoutingPoolOperator_and') : t('proxy.autoRoutingPoolOperator_or')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`route-based-on-${idPrefix}`}>{t('proxy.routeBasedOn')}</Label>
        <Select
          value={referenced === '' ? NO_POOL_SOURCE : referenced}
          onValueChange={value =>
            onChange({ basedOnRoute: value === NO_POOL_SOURCE ? undefined : value })
          }
        >
          <SelectTrigger id={`route-based-on-${idPrefix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_POOL_SOURCE}>{t('proxy.routeBasedOnNone')}</SelectItem>
            {poolRouteOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('proxy.routeBasedOnHelp')}</p>
      </div>

      {/* 引用了别人的池，下面这些字段就一概不参与选路（`store/modelRoutes.ts::resolvePoolRoute`
          只取被引用那一条的池策略、钉名与手动增删）。留着可编辑又不起作用，比不给编辑更糟，
          所以整组置灰并点名来源。 */}
      {isReferenced && (
        <p className="text-sm rounded-lg bg-muted/30 p-3 text-muted-foreground">
          {t('proxy.routeBasedOnNotice', { route: referenced })}
        </p>
      )}

      <div className={isReferenced ? 'space-y-4 opacity-50 pointer-events-none' : 'space-y-4'}>
      <div className="space-y-2">
        <Label htmlFor={`route-strategy-${idPrefix}`}>{t('proxy.routeStrategy')}</Label>
        <Select
          value={values.strategy}
          onValueChange={(value) => onChange({ strategy: value as LoadBalanceStrategy })}
        >
          <SelectTrigger id={`route-strategy-${idPrefix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {strategyOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('proxy.routeStrategyHelp')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`auto-model-scope-${idPrefix}`}>{t('proxy.autoRoutingModelScope')}</Label>
        <Select
          value={values.modelScope}
          onValueChange={(value) => onChange({ modelScope: value as ModelScope })}
        >
          <SelectTrigger id={`auto-model-scope-${idPrefix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_SCOPES.map((scope) => (
              <SelectItem key={scope} value={scope}>
                {t(`proxy.autoRoutingModelScope_${scope}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingModelScopeHelp')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`auto-prefer-${idPrefix}`}>{t('proxy.autoRoutingPrefer')}</Label>
        <Select
          value={values.prefer}
          onValueChange={(value) => onChange({ prefer: value as AutoPreference })}
        >
          <SelectTrigger id={`auto-prefer-${idPrefix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTO_PREFERENCES.map((preference) => (
              <SelectItem key={preference} value={preference}>
                {t(`proxy.autoRoutingPrefer_${preference}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingPreferHelp')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`auto-max-attempts-${idPrefix}`}>{t('proxy.autoRoutingMaxAttempts')}</Label>
          <Input
            id={`auto-max-attempts-${idPrefix}`}
            type="number"
            min={1}
            max={5}
            value={values.maxAttempts}
            onChange={(event) => onChange({ maxAttempts: Number(event.target.value) || 1 })}
          />
          <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingMaxAttemptsHelp')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`auto-sticky-minutes-${idPrefix}`}>{t('proxy.autoRoutingSticky')}</Label>
          <Input
            id={`auto-sticky-minutes-${idPrefix}`}
            type="number"
            min={0}
            max={1440}
            value={values.stickyMinutes}
            onChange={(event) => onChange({ stickyMinutes: Number(event.target.value) || 0 })}
          />
          <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingStickyHelp')}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              id={`auto-sticky-hard-pin-${idPrefix}`}
              type="checkbox"
              checked={values.stickyHardPin}
              onChange={(event) => onChange({ stickyHardPin: event.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--primary)]"
            />
            <Label
              htmlFor={`auto-sticky-hard-pin-${idPrefix}`}
              className="text-sm font-normal cursor-pointer"
            >
              {t('proxy.autoRoutingStickyHardPin')}
            </Label>
          </div>
          {/* 粘性时长为 0 时这一格不起作用（压根没有粘性记录可提到队首）。不说这句，
              用户会以为是这个勾坏了，而不是上面那格填了 0。 */}
          {values.stickyMinutes === 0 && (
            <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingStickyHardPinIdle')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingStickyHardPinHelp')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`auto-fairness-lead-${idPrefix}`}>{t('proxy.autoRoutingFairness')}</Label>
          <Input
            id={`auto-fairness-lead-${idPrefix}`}
            type="number"
            min={0}
            max={FAIRNESS_LEAD_MAX}
            value={values.fairnessLead}
            onChange={(event) => onChange({
              fairnessLead: Math.min(FAIRNESS_LEAD_MAX, Math.max(0, Math.round(Number(event.target.value) || 0)))
            })}
          />
          <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingFairnessHelp')}</p>
        </div>
      </div>

      {/* 候选池策略筛选：17 项策略 + 5 个预设的选择 UI，标签与枚举键沿用既有 i18n */}
      <div className="space-y-3 pt-4 border-t">
        <div className="flex items-center justify-between gap-2">
          <Label>{t('proxy.autoRoutingPoolStrategy')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {AUTO_POOL_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onChange({ poolStrategies: poolStrategiesOfPreset(preset) })}
                title={t(`proxy.autoRoutingPoolPreset_${preset.id}_desc`)}
              >
                {t(`proxy.autoRoutingPoolPreset_${preset.id}`)}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingPoolStrategyHelp')}</p>

        {CATEGORY_ORDER.map((category) => {
          const strategies = AUTO_POOL_STRATEGIES.filter((meta) => meta.category === category)
          if (strategies.length === 0) return null
          return (
            <div key={category} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                {t(`proxy.autoRoutingPoolStrategyCategory_${category}`)}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {strategies.map((meta) => {
                  const index = values.poolStrategies.findIndex((item) => item.id === meta.id)
                  const checked = index >= 0
                  const checkboxId = `pool-strategy-${meta.id}-${idPrefix}`
                  return (
                    <div
                      key={meta.id}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        aria-label={t(`proxy.autoRoutingPoolStrategy_${meta.id}`)}
                        checked={checked}
                        onChange={() =>
                          onChange({ poolStrategies: withPoolStrategyToggled(values.poolStrategies, meta.id) })
                        }
                        className="h-3.5 w-3.5 accent-[var(--primary)]"
                      />
                      <label htmlFor={checkboxId} className="text-sm flex-1 cursor-pointer leading-tight">
                        <span className="flex flex-col">
                          <span>{t(`proxy.autoRoutingPoolStrategy_${meta.id}`)}</span>
                          <span className="text-xs text-muted-foreground">
                            {t(`proxy.autoRoutingPoolStrategy_${meta.id}_desc`)}
                          </span>
                        </span>
                      </label>
                      {checked && (
                        <Select
                          value={values.poolStrategies[index]!.operator}
                          onValueChange={(value) =>
                            onChange({
                              poolStrategies: withPoolStrategyOperator(
                                values.poolStrategies,
                                index,
                                value as AutoPoolStrategyOperator
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="h-7 w-[68px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="and">{operatorLabel('and')}</SelectItem>
                            <SelectItem value="or">{operatorLabel('or')}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {values.poolStrategies.length > 1 && (
          <p className="text-xs text-muted-foreground">{t('proxy.autoRoutingPoolOperatorHelp')}</p>
        )}
      </div>

      {/* 候选池预览 + 手动增删 + 逐模型标注：误筛/漏筛的修正入口 */}
      <RoutePoolEditor idPrefix={idPrefix} values={values} onChange={onChange} />
      </div>
    </div>
  )
}

export default ModelRouteFields
