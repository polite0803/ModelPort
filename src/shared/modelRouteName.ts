/**
 * 模型路由（`AppConfig.routes`）的名字规则 —— 全仓唯一真值源。
 *
 * 为什么单独成文件：这段字符集校验在仓库里原本不存在（旧代码只有一句
 * 「保留字：不能作为真实模型或映射名」的注释），而它现在必须被**三处**共用：
 * - 读取侧的 `normalizeConfig`（丢弃非法条目，绝不抛异常）；
 * - main 侧的路由 CRUD（IPC `routes:*`，要返回可读错误）；
 * - 管理 API 的 `PUT /v1/management/config[/:key]`（同一套错误码）。
 * 复制三份就是三个口径，最容易长的地方是「一处允许、另一处拒绝」。
 *
 * 规则（本轮起真正强制）：
 * - `trim` + 转小写：存储键与比较都用同一份规范化结果，`Auto` 与 `auto` 是同一个名字，
 *   `' Fast '` 与 `fast` 也是同一个名字（**首尾空白先裁掉**，只有内部空白才判错）；
 * - 规范化后 1–64 字符，只允许 `[a-z0-9_-]`：**不许为空、单词之间不许有空格** ——
 *   名字要进 `X-ModelPort-Route-Name` 响应头，空格与控制字符会把请求打成 500；
 * - 在同一份 routes 里大小写不敏感唯一；
 * - 不得与任何模型展示名（含**已停用但仍在目录里**的名字）、供应商内部映射名、
 *   或全局 `config.modelMappings` 的键（用户自建别名）冲突，比较同样大小写不敏感。
 *   冲突只在**写入**时拒绝：请求解析时路由名优先于同名模型，所以一个已经生效的
 *   路由不会因为后来同步进来一个同名模型而被改名或消失。
 */
import type { ModelRoute } from './types.ts'

/** 路由名长度上限（与 `ROUTE_NAME_PATTERN` 里的 `{1,64}` 同值，供文案引用）。 */
export const ROUTE_NAME_MAX_LENGTH = 64

/** 规范化后的路由名字符集：小写字母、数字、下划线、连字符，1–64 个字符。 */
const ROUTE_NAME_PATTERN = /^[a-z0-9_-]{1,64}$/

/** 校验失败的错误码：UI 与 i18n 按 code 取文案，`message` 只是英文兜底。 */
export type ModelRouteErrorCode =
  | 'invalid_name'
  | 'duplicate_name'
  | 'conflicts_model'
  | 'conflicts_alias'
  | 'unknown_pool_strategy'
  | 'not_found'
  | 'invalid_input'

export interface ModelRouteError {
  code: ModelRouteErrorCode
  message: string
}

/** 一次路由写入（新建/编辑/删除）的结果：成功时带回最新的整表。 */
export type ModelRouteMutation =
  | { ok: true; route: ModelRoute; routes: Record<string, ModelRoute> }
  | { ok: false; error: ModelRouteError }

/** 删除一次操作的结果：成功时带回被移除的那一条，供 UI 撤销提示使用。 */
export type ModelRouteRemoval =
  | { ok: true; removed: ModelRoute; routes: Record<string, ModelRoute> }
  | { ok: false; error: ModelRouteError }

/**
 * IPC `routes:*` 四条通道的返回形状 = store 层的 CRUD 结果 + 一条存储层错误。
 *
 * 为什么要把错误码放宽一档：`storeManager.createRoute()` 这类调用在存储没起来时
 * 抛异常，而 IPC 边界不许把裸异常扔给 renderer（`ipc/handlers.ts` 的 `channels:*`
 * 那批定的规矩是「错误以可读文本返回」）。多出来的这一档 `storage_unavailable`
 * 不是新的名字校验结论，UI 只需要显示 `message`。
 *
 * 成功都带回**归一后的整表**，所以 UI 不必在写完之后再拉一次 `routes:list`；
 * 失败只带回 `{ok:false,error}`，`routes` 保持缺席而不是「空表」——
 * 「读不到」不等于「没有路由」。
 */
export type RouteIpcErrorCode = ModelRouteErrorCode | 'storage_unavailable'

export interface RouteIpcError {
  code: RouteIpcErrorCode
  message: string
}

export type RouteListResult =
  | { ok: true; routes: ModelRoute[] }
  | { ok: false; error: RouteIpcError }

export type RouteMutationResult =
  | { ok: true; route: ModelRoute; routes: Record<string, ModelRoute> }
  | { ok: false; error: RouteIpcError }

export type RouteRemovalResult =
  | { ok: true; removed: ModelRoute; routes: Record<string, ModelRoute> }
  | { ok: false; error: RouteIpcError }

/**
 * 每条路由当前的候选模型数（键是路由名）。`0` 是真的没候选；读不到时走 `ok:false`，
 * 界面不许把「取不到」渲染成 0 —— 那会把一次存储故障说成「用户把池筛空了」。
 */
export type RoutePoolSizesResult =
  | { ok: true; sizes: Record<string, number> }
  | { ok: false; error: RouteIpcError }

/**
 * 规范化：非字符串一律得到 `''`（调用方据此判非法），字符串按 trim + 小写。
 * 这里**不**做字符集校验，只做形态收敛：读取侧要能拿它比较键与字段。
 */
export function canonicalRouteName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** 一个已经规范化的名字是否合法（`[a-z0-9_-]{1,64}`）。 */
export function isCanonicalRouteName(name: string): boolean {
  return ROUTE_NAME_PATTERN.test(name)
}

/**
 * 把任意输入规范化并校验成一个可用的路由名：先 trim、再小写（与 `canonicalRouteName`
 * 同一份规范化），然后才判非法。失败原因分开报（空 / 内部含空格 / 超长 / 字符集非法），
 * 因为「`my route` 少个下划线」和「名字太长」在 UI 上是两条不同的提示，合成一条就只能猜。
 * 返回的 `name` 一定是规范形（键与规范形不一致的整表写入由 `validateRoutesForWrite` 拒绝）。
 */
export function validateRouteNameInput(raw: unknown): { ok: true; name: string } | { ok: false; error: ModelRouteError } {
  if (typeof raw !== 'string') {
    return { ok: false, error: { code: 'invalid_name', message: 'Route name must be a string' } }
  }
  const name = canonicalRouteName(raw)
  if (name.length === 0) {
    return { ok: false, error: { code: 'invalid_name', message: 'Route name must not be empty' } }
  }
  // 到这里首尾空白已经被 trim 掉了，`name` 里还剩空白就一定是**内部**空白（`a b` 那种）。
  if (/\s/.test(name)) {
    return {
      ok: false,
      error: {
        code: 'invalid_name',
        message: `Route name must not contain spaces (use '-' or '_'), got: ${JSON.stringify(raw)}`,
      },
    }
  }
  if (name.length > ROUTE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: { code: 'invalid_name', message: `Route name must be at most ${ROUTE_NAME_MAX_LENGTH} characters` },
    }
  }
  if (!isCanonicalRouteName(name)) {
    return {
      ok: false,
      error: { code: 'invalid_name', message: 'Route name may only use a-z, 0-9, underscore and hyphen' },
    }
  }
  return { ok: true, name }
}

/**
 * 在 `occupants` 里找与这个名字大小写不敏感冲突的那一项，返回它**原始**写法
 * （错误文案要指出撞了谁，只说「冲突」等于没报告）。
 */
export function findRouteNameConflict(name: string, occupants: Iterable<string>): string | undefined {
  const target = name.toLowerCase()
  for (const occupant of occupants) {
    if (typeof occupant !== 'string') continue
    if (occupant.toLowerCase() === target) return occupant
  }
  return undefined
}

/** routes 表里已占用的名字（键与 `name` 字段都算，大小写不敏感比较由调用方负责）。 */
export function routeNamesOf(routes: Record<string, ModelRoute> | undefined): string[] {
  if (!routes) return []
  const names: string[] = []
  for (const [key, route] of Object.entries(routes)) {
    names.push(key)
    if (typeof route?.name === 'string' && route.name !== key) names.push(route.name)
  }
  return names
}

/**
 * routes 里是否已经有这个名字（大小写不敏感）。`excluding` 是正在被改写的那条的
 * 旧名：改名成自己不算冲突，否则每次编辑都会自我拒绝。
 */
export function hasRouteNamed(
  routes: Record<string, ModelRoute> | undefined,
  name: string,
  excluding?: string
): boolean {
  const target = canonicalRouteName(name)
  const skip = canonicalRouteName(excluding)
  for (const existing of routeNamesOf(routes)) {
    const canonical = canonicalRouteName(existing)
    if (canonical.length === 0) continue
    if (skip.length > 0 && canonical === skip) continue
    if (canonical === target) return true
  }
  return false
}
