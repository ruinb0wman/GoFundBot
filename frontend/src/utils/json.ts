/**
 * 通用 JSON 文本辅助。
 *
 * `truncateJson` 原先在 `services/chatEngine/toolLoop.ts`（AI 工具循环）里，
 * 用来把工具信封压进模型输出预算。前端 AI 删除后，回测抽样相关的测试仍需要它，
 * 于是移到通用位置。
 */
export function truncateJson(value: unknown, maxLen = 4000): string {
  let str = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (str.length > maxLen) {
    str = str.slice(0, maxLen) + '... (truncated)'
  }
  return str
}
