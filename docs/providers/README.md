# Provider Adaptation Guides

> 适用版本：v1.7.3 ｜ 最后核对：2026-11-04 ｜ 状态：现行

这些文档记录内置供应商的认证方式、模型来源、适配状态和配置入口。更新模型或新增供应商能力时，
优先同步对应供应商文档。

## 三类供应商

| 类别 | 数量 | 凭据 | 文档 / 数据源 |
| --- | --- | --- | --- |
| 聚合目录 | 92 条渠道 / 580 个模型 | API Key、免密，或标记为不支持（Google ADC） | 数据源为 `src/main/providers/aggregate/registry.ts`，无独立文档 |
| 账号渠道 | 15 个渠道 | 浏览器 / 设备码 / OAuth，`opencode` 为 API Key | [`opencode.md`](opencode.md)（单渠道说明）；整体机制见 [`../AGENTS-full.md`](../AGENTS-full.md) §Account Channels |
| 自定义供应商 | 用户自建 | 自行配置 | 在应用内的供应商页面直接添加 |

已单独记录提示缓存口径的聚合条目：[`anthropic.md`](anthropic.md)（显式断点）、
[`deepseek.md`](deepseek.md)（隐式前缀）、[`minimax-cn.md`](minimax-cn.md)（隐式前缀）。

`builtinProviders` 目前为空。1.5 退役的八家 Web UI 页面接入供应商（deepseek / glm / kimi /
mimo / minimax / qwen / qwen-ai / zai）不再有适配文档；2026-11-01 退役的本机 `opencode`
运行时也不再是内置供应商，现存的是同名的账号渠道。

## 聚合目录流程

1. 在**聚合渠道**页面选择条目，需要 Key 时填入密钥；Base URL 含 `{placeholders}` 的条目
   （Azure、Vertex）必须先覆盖。
2. 保存后生成 `type: 'aggregate'` 的供应商记录，模型名为 `<providerId>/<modelId>`，写进该记录的
   `modelMappings` 账本（全局别名表只放用户自己的条目）。
3. 该条目声明了 `modelsUrl` 时可在页面触发模型发现，结果写入
   `userModelOverrides[providerId].fetchedModels`。
4. Kilo 等免密条目（`authKind: none`）保存时创建空凭据的本地账户，可立即路由；其模型只保留
   `isFree` 项。
5. 需要 Google ADC 的条目（vertex / vertex-partner）会列出但标记为不支持。

## 账号渠道流程

1. 在**账号渠道**页面选择渠道，按 `loginKind` 走浏览器登录或本地凭据表单。
2. 每个渠道维护自己的账号池、每日积分领取、模型目录与模型门禁。
3. `opencode` 是例外：它不需要浏览器登录，添加匿名槽位或粘贴 `sk-` Key 即可；详见
   [`opencode.md`](opencode.md)。
4. 模型名会携带上游积分倍率（`· x4.0`、`· x0.2→x0.1`、`· 免费`），免费模型单独标注；上游不再
   报告健康的模型可以在同一面板恢复。

## 验证

用 OpenAI-compatible `/v1/chat/completions` 验证流式、非流式、多轮、工具调用与模型发现。
