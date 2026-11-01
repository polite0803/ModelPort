import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Production loads the renderer from file://, so the policy goes into the HTML
// itself - webRequest.onHeadersReceived never sees file:// requests. 'self' is
// the document's own origin; style-src still needs 'unsafe-inline' because
// Radix sets style attributes, and the renderer talks to the main process over
// IPC only, never over the network.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'"
].join('; ')

// The dev server serves the page from http://localhost:5173 and @vitejs/plugin-react
// injects an inline refresh preamble, so both inline script and the HMR socket
// have to be allowed. Everything else stays as strict as production.
const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'"
].join('; ')

function contentSecurityPolicy(): Plugin {
  let dev = false
  return {
    name: 'modelport-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: dev ? DEVELOPMENT_CSP : PRODUCTION_CSP
          },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  // ⚠️ 不要用 __dirname：electron-vite 加载 config 前会 realpathSync(configFile)，
  // 在 VMware 共享文件夹的映射盘环境（D: → \\vmware-host\Shared Folders\D）下会得到
  // UNC 形态路径，随后 vite 的 realpath/URL 转换会产出 `Z:\ Folders\D\...` 这类坏路径。
  // 构建进程的 cwd 始终是 package.json 所在目录（盘符形态），以此为基准最稳。
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          'axios',
          '@koa/router',
          'koa',
          'koa-bodyparser',
          'koa-router',
          'eventsource-parser',
          'js-sha3',
          'mime-types',
          'zstd-codec',
          // ⚠️ electron-store 必须放进 exclude（= 打进 bundle），不能留作 external。
          //
          // 打包产物里根本没有 node_modules：`package.json` 的 build.files 排除了
          // `!node_modules/**/*`，主进程的运行时依赖全部由 rollup 内联进 out/main。
          // 一旦 electron-store 变成 external，安装包里 `await import('electron-store')`
          // 必然 ERR_MODULE_NOT_FOUND —— store 初始化失败，但该异常发生在 store.ts
          // 的 try 之外，`initializationError` 不会被记录，最终所有 IPC 只报
          // "Storage not initialized, please call initialize() first"（1.4.5 的故障）。
          //
          // ESM-only 不是理由：rollup 打包时会把 ESM 转成 CJS 内联，1.4.4 及更早
          // 的安装包就是这样工作的。映射盘解析问题已由 cwd/preserveSymlinks 处理。
          'electron-store',
          'electron-updater'
        ]
      })
    ],
    resolve: {
      // 映射盘 realpath 会把模块 id 还原成 UNC，见顶部说明。
      preserveSymlinks: true
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(process.cwd(), 'src/main/index.ts')
        },
        output: {
          format: 'cjs'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(process.cwd(), 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(process.cwd(), 'src/renderer'),
    plugins: [react(), contentSecurityPolicy()],
    resolve: {
      // 映射盘 realpath 会把模块 id 还原成 UNC 坏路径，见顶部说明。
      preserveSymlinks: true,
      alias: {
        '@': resolve(process.cwd(), 'src/renderer/src'),
        '@shared': resolve(process.cwd(), 'src/shared'),
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(process.cwd(), 'src/renderer/index.html')
        }
      }
    },
    server: {
      // 默认只绑回环。开发态的 CSP 放开 `script-src 'unsafe-inline'`，而 dev 模式下渲染进程
      // 挂着完整 `electronAPI`：绑 0.0.0.0 等于让同网段任意主机把这套界面加载起来。
      // 确实需要局域网调试（手机、另一台机器）时显式指定：MODELPORT_DEV_HOST=0.0.0.0。
      host: process.env.MODELPORT_DEV_HOST || '127.0.0.1',
      port: 5173
    }
  }
})
