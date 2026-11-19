/**
 * 把「每条路由当前对外公布的窗口」自动写进本机各 Codex 的 catalog。
 *
 * 为什么要有这一层：客户端只认自己那份 `modelport-catalog.json`，而它的窗口值必须在
 * 路由器切模型时跟上（池里换了一个不同窗口的模型，客户端的压缩点就该跟着变）。让
 * 用户为此点一次「同步客户端」、或者重启 Codex，都是把配置的后果推给人。
 *
 * 三条边界：
 * - **读数为 `undefined` 的路由不动**（空池是临时状态，删键会让客户端失去压缩点）；
 * - **没有变化就不写盘**（池读数在多数事件里没变，227 KB × N 份的文件重写不能白做）；
 * - **写回原属主**（daemon 以 root 运行，直接写会把 `~/.codex` 里的文件变成 root 所有，
 *   客户端随后可能读不了）。
 */
import { chownSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rewriteCatalogWindows } from '../../shared/codexCatalog.ts'
import { storeManager } from '../store/store'
import { autoRouter } from './autoRouter'

const CATALOG_FILE = join('.codex', 'modelport-catalog.json')

/** 上次每个文件写入的内容指纹：内容没变就不重复写。 */
const lastWritten = new Map<string, string>()

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * 本机上可能存在的 Codex catalog。
 *
 * 不读配置：daemon 以 root 运行，`os.homedir()` 是 `/root`，与客户端所在的用户目录
 * 无关；而把用户路径写进配置又要多一处需要维护的一致性问题。直接扫两个固定位置
 * （WSL 的 `/home/*`、Windows 的 `/mnt/c/Users/*`），只认真正存在的文件。
 */
export function codexCatalogCandidates(): string[] {
  const out: string[] = []
  for (const user of listDir('/home')) {
    if (user.startsWith('.')) continue
    out.push(join('/home', user, CATALOG_FILE))
  }
  for (const user of listDir('/mnt/c/Users')) {
    // Windows 的公共目录不是真实用户，扫到也不会命中 `.codex`
    out.push(join('/mnt/c/Users', user, CATALOG_FILE))
  }
  return out.filter(path => existsSync(path))
}

/**
 * 同步一次。返回实际写了几个文件（0 = 全部无变化）。
 *
 * 失败不抛出：这是旁路动作，写不了 catalog 不该让一次路由切换或标注保存失败。
 */
export function syncCodexCatalogs(): { written: string[]; floors: Map<string, number | undefined> } {
  const written: string[] = []
  let floors = new Map<string, number | undefined>()
  // 测试进程会调用 bootstrap / IPC handler，而这里扫的是**真实用户目录**：不拦住就等于
  // 跑一次测试改一次用户的 Codex 配置。纯函数（`rewriteCatalogWindows`）仍可单独测。
  if (process.env.NODE_TEST_CONTEXT !== undefined) return { written, floors }
  try {
    floors = autoRouter.advertisedContextFloors(storeManager.listModelRoutes())
  } catch (error) {
    console.error('[CatalogSync] route windows unavailable:', error)
    return { written, floors }
  }
  for (const path of codexCatalogCandidates()) {
    try {
      const raw = readFileSync(path, 'utf8')
      const rewrite = rewriteCatalogWindows(raw, floors)
      if (rewrite === null) continue
      if (lastWritten.get(path) === rewrite.content) continue
      const stat = statSync(path)
      const tmp = `${path}.tmp-${process.pid}`
      writeFileSync(tmp, rewrite.content)
      renameSync(tmp, path)
      // daemon 是 root：不改回属主的话，客户端（polit）下次可能写不了自己的 catalog。
      try {
        chownSync(path, stat.uid, stat.gid)
      } catch {
        // 跨文件系统（/mnt/c）不支持 chown：那里本来就不承载 unix 属主语义
      }
      lastWritten.set(path, rewrite.content)
      written.push(path)
    } catch (error) {
      console.error(`[CatalogSync] failed for ${path}:`, error)
    }
  }
  return { written, floors }
}

/** 进程重启后别拿旧指纹当"已写过"（文件可能已被用户改过）。 */
export function resetCatalogSyncCache(): void {
  lastWritten.clear()
}