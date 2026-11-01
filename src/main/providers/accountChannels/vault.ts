/**
 * 渠道凭据库。
 *
 * vendor 源码里的 `ctx.credentials` 只看到 `ref -> value` 的读写，对落盘位置一无
 * 所知；这里把它接成一个**独立于 data.json** 的小文件，值走 `safeStorage`
 * （与 data.json 同一套加密，keychain 不可用时退化为明文并在日志里告警）。
 *
 * 为什么单独一个文件：
 * - 凭据数量与刷新频率都远高于 provider/account 记录，混进 data.json 会让那份
 *   文件频繁整体重写；
 * - 渠道包自己也把账号表写在 `channelHome/state.json`，两者相邻便于备份与排查。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { storeManager } from '../../store/store'

/** 解不开的凭据只报一次，避免每个请求都往应用日志里写一条。 */
let corruptedCredentialReported = false

export interface CredentialDescriptor {
  configured: boolean
  source: string
}

export interface ResolvedCredential {
  /** 上游约定的凭据内容（渠道包内部一律存 JSON 字符串）。 */
  value: string
}

export class ChannelCredentialVault {
  private readonly filePath: string
  private values: Record<string, string> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.filePath = join(directory, 'credentials.json')
  }

  private load(): Record<string, string> {
    if (this.values !== null) return this.values
    if (!existsSync(this.filePath)) {
      this.values = {}
      return this.values
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      this.values = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, string>
        : {}
    } catch (error) {
      // 读不出来时**不能**当成空的再覆盖写：那会把用户所有渠道登录态一起清掉。
      console.error(`[ChannelVault] 无法读取 ${this.filePath}：${String(error)}`)
      throw new Error('渠道凭据文件损坏，请备份后删除该文件重新登录')
    }
    return this.values
  }

  private async persist(next: Record<string, string>): Promise<void> {
    this.values = next
    await mkdir(dirname(this.filePath), { recursive: true })
    const payload = JSON.stringify(next, null, 2)
    const tempPath = `${this.filePath}.tmp`
    // 先写临时文件再改名：中途崩溃不会留下半份凭据表。
    await writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, this.filePath)
  }

  /** 串行化写入，避免并发登录的两次 `set` 互相覆盖。 */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(work, work)
    return this.writeChain
  }

  async resolve(ref: unknown): Promise<ResolvedCredential | undefined> {
    const name = this.nameOf(ref)
    const stored = this.load()[name]
    if (typeof stored !== 'string' || stored.length === 0) return undefined
    const value = storeManager.decryptData(stored)
    // 解不开的密文不再当明文交出去（那会让上游收到一串 base64 并回 401，而用户以为 Key
    // 是对的）。按「凭据不可用」返回 undefined，并在应用日志里留一条可见的错误。
    if (value === null) {
      if (!corruptedCredentialReported) {
        corruptedCredentialReported = true
        storeManager.addLog('error', `凭据「${name}」无法解密（系统密钥库或 store.key 已变化），请重新填写`)
      }
      return undefined
    }
    return { value }
  }

  async describe(ref: unknown): Promise<CredentialDescriptor> {
    const name = this.nameOf(ref)
    const stored = this.load()[name]
    const configured = typeof stored === 'string' && stored.length > 0
    return { configured, source: configured ? 'modelport' : 'none' }
  }

  async set(ref: unknown, value: unknown): Promise<void> {
    const name = this.nameOf(ref)
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
    const encrypted = storeManager.encryptData(text)
    return this.enqueue(async () => {
      await this.persist({ ...this.load(), [name]: encrypted })
    })
  }

  async unset(ref: unknown): Promise<void> {
    const name = this.nameOf(ref)
    return this.enqueue(async () => {
      const current = this.load()
      if (!(name in current)) return
      const next = { ...current }
      delete next[name]
      await this.persist(next)
    })
  }

  private nameOf(ref: unknown): string {
    if (typeof ref === 'string' && ref.length > 0) return ref
    // `credentialRef()` 在宿主侧是恒等函数，但万一有调用方传对象，取 name/id。
    if (ref !== null && typeof ref === 'object') {
      const candidate = (ref as { name?: unknown; id?: unknown }).name ?? (ref as { id?: unknown }).id
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
    throw new Error('无效的凭据引用')
  }
}
