import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { LoadBalanceStrategy, AutoPreference, ModelRoute } from '@/types/electron'
import {
  AUTO_POOL_PRESETS,
  AUTO_POOL_STRATEGIES,
  AUTO_PREFERENCES,
  DEFAULT_AUTO_ROUTING_CONFIG,
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
  maxAttempts: number
  stickyMinutes: number
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
}

/** 策略下拉的选项由父组件传入：五个策略的字面量与标签表只允许存在于 `LoadBalanceConfig.tsx`。 */
export interface ModelRouteStrategyOption {
  value: LoadBalanceStrategy
  label: string
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
    maxAttempts: DEFAULT_AUTO_ROUTING_CONFIG.maxAttempts,
    stickyMinutes: DEFAULT_AUTO_ROUTING_CONFIG.stickyMinutes,
    poolStrategies: DEFAULT_AUTO_ROUTING_CONFIG.poolStrategies.map((strategyItem) => ({ ...strategyItem })),
    includeModels: [],
    excludeModels: [],
    pinModels: [],
  }
}

/** 盘上的一条路由 → 编辑草稿（新对象 + 新数组，绝不返回入参的引用）。 */
export function routeFieldValuesOf(route: ModelRoute): ModelRouteFieldValues {
  return {
    strategy: route.strategy,
    prefer: route.prefer,
    maxAttempts: route.maxAttempts,
    stickyMinutes: route.stickyMinutes,
    poolStrategies: route.poolStrategies.map((strategyItem) => ({ ...strategyItem })),
    includeModels: route.includeModels.map((ref) => ({ ...ref })),
    excludeModels: route.excludeModels.map((ref) => ({ ...ref })),
    pinModels: route.pinModels.map((ref) => ({ ...ref })),
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
export function ModelRouteFields({ idPrefix, values, onChange, strategyOptions }: ModelRouteFieldsProps) {
  const { t } = useTranslation()

  const operatorLabel = (operator: AutoPoolStrategyOperator) =>
    operator === 'and' ? t('proxy.autoRoutingPoolOperator_and') : t('proxy.autoRoutingPoolOperator_or')

  return (
    <div className="space-y-4">
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
  )
}

export default ModelRouteFields
