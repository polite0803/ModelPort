/**
 * sql.js, the pure-JS/WASM SQLite build.
 *
 * Why this build and not `node:sqlite` or a native module: the console runs on Electron
 * 33 (Node 20.x), which has no `node:sqlite`, and the packaged asar ships no
 * `node_modules` - every main-process runtime dependency has to be inlined by rollup
 * (`tests/build/main-bundle-deps.test.ts`). A native `.node` would additionally need an
 * Electron-ABI rebuild per platform. `sql-wasm-inline.js` embeds its own wasm as base64,
 * so it bundles to one file with no asset to ship and no `locateFile` to resolve.
 */
declare module 'sql.js/dist/sql-wasm-inline.js' {
  export interface SqlJsQueryResult {
    columns: string[]
    values: unknown[][]
  }

  export interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): void
    exec(sql: string): SqlJsQueryResult[]
    export(): Uint8Array
    close(): void
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase
  }

  export default function initSqlJs(config?: { wasmBinary?: ArrayLike<number> }): Promise<SqlJsStatic>
}