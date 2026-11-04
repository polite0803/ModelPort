/**
 * Management API - Configuration Routes
 * Provides configuration management endpoints
 */

import Router from '@koa/router'
import type { Context } from 'koa'
import { managementAuthMiddleware } from '../../middleware/managementAuth'
import ConfigManager from '../../../store/config'
import type { ManagementApiResponse, ConfigUpdateRequest } from '../../../../shared/types'
import type { AppConfig } from '../../../store/types'
// 脱敏口径统一在 main/logging/maskConfig.ts：同一条规则同时约束配置变更日志与
// 管理接口响应体，否则「HTTP 已脱敏、日志仍明文」的分叉会重新长出来。
import { maskConfig, maskSensitiveValue } from '../../../logging/maskConfig'

const router = new Router({ prefix: '/v1/management/config' })

router.use(managementAuthMiddleware)

router.get('/', async (ctx: Context) => {
  try {
    const config = ConfigManager.get()
    const maskedConfig = maskConfig(config)

    ctx.body = {
      success: true,
      data: maskedConfig,
    } as ManagementApiResponse<Record<string, unknown>>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    ctx.status = 500
    ctx.body = {
      success: false,
      error: {
        code: 'internal_error',
        message: errorMessage,
      },
    } as ManagementApiResponse
  }
})

router.put('/', async (ctx: Context) => {
  try {
    const updates = ctx.request.body as ConfigUpdateRequest

    if (!updates || typeof updates !== 'object') {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: {
          code: 'invalid_request',
          message: 'Request body must be a valid configuration object',
        },
      } as ManagementApiResponse
      return
    }

    // routes 现在也在这道校验里（`ConfigManager.validate` → `validateRoutesForWrite`）：
    // 脏表以前会被读取侧静默丢条目，现在改成 400 + 逐条原因。
    const validation = ConfigManager.validate(updates as Partial<AppConfig>)

    if (!validation.valid) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: {
          code: 'validation_error',
          message: validation.errors.join('; '),
          details: { errors: validation.errors },
        },
      } as ManagementApiResponse
      return
    }

    const updatedConfig = ConfigManager.update(updates as Partial<AppConfig>)
    const maskedConfig = maskConfig(updatedConfig)

    ctx.body = {
      success: true,
      data: maskedConfig,
    } as ManagementApiResponse<Record<string, unknown>>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    ctx.status = 500
    ctx.body = {
      success: false,
      error: {
        code: 'internal_error',
        message: errorMessage,
      },
    } as ManagementApiResponse
  }
})

router.get('/:key', async (ctx: Context) => {
  try {
    const key = ctx.params.key as keyof AppConfig

    const config = ConfigManager.get()

    // 这道门槛只拒绝「不是 AppConfig 的键」，不再拦得住 `routes`：
    // `ConfigManager.get()` → `storeManager.getConfig()` → `normalizeConfig` **无条件**
    // 输出 `routes` 键（store.ts::normalizeConfig），所以 `'routes' in config` 恒为真，
    // 读与写都会走到 `ConfigManager.validate`，那里才是 routes 的校验点。
    if (!(key in config)) {
      ctx.status = 404
      ctx.body = {
        success: false,
        error: {
          code: 'config_key_not_found',
          message: `Configuration key '${key}' not found`,
        },
      } as ManagementApiResponse
      return
    }

    const value = config[key]
    const maskedValue = maskSensitiveValue(value, key)

    ctx.body = {
      success: true,
      data: maskedValue,
    } as ManagementApiResponse<unknown>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    ctx.status = 500
    ctx.body = {
      success: false,
      error: {
        code: 'internal_error',
        message: errorMessage,
      },
    } as ManagementApiResponse
  }
})

router.put('/:key', async (ctx: Context) => {
  try {
    const key = ctx.params.key as keyof AppConfig
    const { value } = ctx.request.body as { value: unknown }

    if (value === undefined) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: {
          code: 'invalid_request',
          message: 'Request body must contain a "value" field',
        },
      } as ManagementApiResponse
      return
    }

    const config = ConfigManager.get()

    // 同 `GET /:key`：`routes` 永远在归一后的配置里，所以这道门槛放行它，
    // 由下面的 `ConfigManager.validate` 做名字/池策略校验（400 + 可读原因）。
    // 落盘的是 `storeManager.updateConfig` 归一后的整表，与读取侧同形。
    if (!(key in config)) {
      ctx.status = 404
      ctx.body = {
        success: false,
        error: {
          code: 'config_key_not_found',
          message: `Configuration key '${key}' not found`,
        },
      } as ManagementApiResponse
      return
    }

    const updates = { [key]: value } as Partial<AppConfig>
    const validation = ConfigManager.validate(updates)

    if (!validation.valid) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: {
          code: 'validation_error',
          message: validation.errors.join('; '),
          details: { errors: validation.errors },
        },
      } as ManagementApiResponse
      return
    }

    const updatedConfig = ConfigManager.update(updates)
    const maskedValue = maskSensitiveValue(updatedConfig[key], key)

    ctx.body = {
      success: true,
      data: maskedValue,
    } as ManagementApiResponse<unknown>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    ctx.status = 500
    ctx.body = {
      success: false,
      error: {
        code: 'internal_error',
        message: errorMessage,
      },
    } as ManagementApiResponse
  }
})

export default router
