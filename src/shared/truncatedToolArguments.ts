/**
 * 工具参数是不是「被截断的 JSON 外壳」。
 *
 * 上游在 `finish_reason:"length"` 上收尾时，`function.arguments` 会停在 JSON 中间
 * （`{"input":"Begin Patch\n*** Update File…`）。这种串**不是**可执行参数，但两条
 * 翻译层都会把它当字符串交出去：`sanitizeClientToolArguments` 解析失败就原样返回，
 * `freeformInputOf` 解析失败就把原文当自由文本补丁 —— 客户端读到的是一条能过语法
 * 检查、内容却被砍掉一半的补丁。
 *
 * 判据只认「外壳在、内容断」：非空、首字符是 `{` 或 `[`、整体解析不了。
 * 三条反例因此都不误伤：
 * - 合法空参数 `{}` / `[]` —— 解析得动；
 * - 上游把补丁当纯文本回（`*** Begin Patch`）—— 不以括号开头；
 * - 模型写错的完整 JSON —— 与截断同样不可执行，一并处置。
 *
 * 这是**唯一**判据源。三条消费点（responses 翻译层、chat 非流式剪枝、chat 流式
 * 标注）各写一遍就会有一遍先漂移。
 */
export function looksLikeTruncatedToolArguments(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const text = raw.trim()
  if (text === '') return false
  const head = text[0]
  if (head !== '{' && head !== '[') return false
  try {
    JSON.parse(text)
    return false
  } catch {
    return true
  }
}