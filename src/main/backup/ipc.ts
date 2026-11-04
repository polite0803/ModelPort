/**
 * 备份通道的 IPC 注册。
 *
 * 单独成文件而不是塞进 `ipc/handlers.ts`：那支已经 67k，而这里的五条通道只服务一个
 * 功能，还需要做入参形状校验（渲染层送来的东西一律先收窄再往下传）。
 */

import { ipcMain, type BrowserWindow } from 'electron'

import { IpcChannels } from '../ipc/channels.ts'
import type {
  BackupApplyResult,
  BackupExportOptions,
  BackupExportResult,
  BackupMode,
  BackupPickResult,
  BackupUnlockResult,
} from '../../shared/backup.ts'
import {
  applyBackup,
  discardBackup,
  exportBackup,
  pickBackupFile,
  restartApplication,
  unlockBackup,
} from './service.ts'

/** 口令只是 KDF 的输入，长度上限防的是「有人把一整个文件塞进 password 字段」。 */
const MAX_PASSWORD_LENGTH = 1024

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeExportOptions(raw: unknown): BackupExportOptions {
  const source = isPlainObject(raw) ? raw : {}
  const password = typeof source.password === 'string' ? source.password.slice(0, MAX_PASSWORD_LENGTH) : ''
  return {
    // 统计默认在、日志默认不在：日志体量最大且含用户输入片段，必须是用户显式勾选。
    includeStatistics: source.includeStatistics !== false,
    includeLogs: source.includeLogs === true,
    ...(password === '' ? {} : { password }),
  }
}

export function registerBackupHandlers(mainWindow: BrowserWindow | null): void {
  ipcMain.handle(
    IpcChannels.BACKUP_EXPORT,
    async (_, rawOptions: unknown): Promise<BackupExportResult> => {
      return exportBackup(mainWindow, normalizeExportOptions(rawOptions))
    },
  )

  ipcMain.handle(IpcChannels.BACKUP_PICK, async (): Promise<BackupPickResult> => {
    return pickBackupFile(mainWindow)
  })

  ipcMain.handle(
    IpcChannels.BACKUP_UNLOCK,
    async (_, token: unknown, password: unknown): Promise<BackupUnlockResult> => {
      if (typeof token !== 'string' || typeof password !== 'string') {
        return { ok: false, error: 'expired' }
      }
      return unlockBackup(token, password.slice(0, MAX_PASSWORD_LENGTH))
    },
  )

  ipcMain.handle(
    IpcChannels.BACKUP_APPLY,
    async (_, token: unknown, mode: unknown): Promise<BackupApplyResult> => {
      if (typeof token !== 'string') return { ok: false, error: 'expired' }
      // 非法模式必须拒绝而不是回退到 replace：一次笔误就换掉整份账号表，代价太大。
      if (mode !== 'replace' && mode !== 'merge') return { ok: false, error: 'wrong-format' }
      return applyBackup(token, mode as BackupMode)
    },
  )

  ipcMain.handle(IpcChannels.BACKUP_CANCEL, async (_, token: unknown): Promise<void> => {
    if (typeof token === 'string') discardBackup(token)
  })

  ipcMain.handle(IpcChannels.BACKUP_RESTART, async (): Promise<void> => {
    restartApplication()
  })
}
