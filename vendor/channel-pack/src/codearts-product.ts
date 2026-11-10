/**
 * CodeArts（华为云码道）产品配置。
 *
 * 适配器与登录流程都自包含在 `llm-adapter.ts` / `service.ts`，这里只提供
 * provider 身份的单一真相源：RPC 分支用 `CODEARTS.id` 判定，测试也从这张表
 * 反查 provider id（`tests/channels/catalogue.test.ts::productIdsByConstant`）。
 */

/** CodeArts 产品配置。 */
export interface CodeArtsProduct {
  id: 'codearts'
  /** 面板与账号卡片展示的产品名。 */
  displayName: string
}

/** 单一实例：任何需要判定 provider 的地方都引用这里，不写散落的字面量。 */
export const CODEARTS: CodeArtsProduct = {
  id: 'codearts',
  displayName: 'CodeArts 码道',
}
