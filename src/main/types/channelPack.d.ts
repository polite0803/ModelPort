/**
 * 上游 channel-pack 通过虚拟模块接入：vendor 目录不参与 `tsc` 门禁，
 * 这里声明我们实际依赖的导出面。升级 vendor 后若签名变化，只有本文件需要同步。
 */

declare module 'virtual:channel-pack' {
  export function apply(
    ctx: unknown,
    config?: {
      disableOpencode?: boolean
      outlet?: unknown
      /** 按渠道决定是否走系统代理链（`AppConfig.channelSystemProxy`）。 */
      systemProxy?: (channel: string) => boolean
    },
  ): void
}

declare module 'virtual:channel-pack-messages' {
  export function normalizeMaxTokens(
    value: number | undefined,
    provider: string,
    model: string,
  ): number | undefined
  export function normalizeReasoningEffort(
    requested: unknown,
    modelInfo: unknown,
    provider?: string,
    model?: string,
    onNotice?: (notice: unknown) => void,
  ): string | null | undefined
  export function toGenerateOptions(
    body: unknown,
    signal: AbortSignal,
    reasoningEffortOverride?: string | null,
    maxTokensOverride?: number,
    images?: { bridge?: unknown; limits?: unknown },
  ): Promise<Record<string, unknown>>
}

declare module 'virtual:channel-pack-gateway' {
  export function markGatewayChannel<T>(options: T): T
}

declare module 'virtual:channel-pack-stream' {
  export function toOpenAiSse(
    chunks: AsyncIterable<unknown>,
    requestId?: string,
    model?: string,
  ): AsyncIterable<string>
  export function collectOpenAiCompletion(
    chunks: AsyncIterable<unknown>,
    requestId?: string,
    model?: string,
  ): Promise<Record<string, unknown>>
}

declare module 'virtual:channel-pack-models' {
  export function collectGatewayModels(
    llm: unknown,
    onError?: (provider: string, error: unknown) => void,
  ): Promise<Array<{ provider: string; models: readonly Record<string, unknown>[] }>>
  /**
   * 逐模型解析出的附加信息（档位 + 上下文窗口）。
   *
   * ⚠️ 窗口**只能**从这里拿到：`listModels` 不带它。宿主侧若只取档位，
   * `/v1/models` 的 `context_window` 就永远缺席，客户端因此退回自己的默认窗口。
   */
  export function collectGatewayModelDetails(
    llm: unknown,
    groups: readonly unknown[],
    onError?: (provider: string, error: unknown) => void,
  ): Promise<Map<string, { reasoning?: unknown; contextWindow?: number }>>
  export function collectGatewayEffortViews(
    llm: unknown,
    groups: readonly unknown[],
    onError?: (provider: string, error: unknown) => void,
  ): Promise<Map<string, unknown>>
  export function toOpenAiModels(
    groups: readonly unknown[],
    details?: ReadonlyMap<string, { reasoning?: unknown; contextWindow?: number }>,
  ): Array<Record<string, unknown>>
}
