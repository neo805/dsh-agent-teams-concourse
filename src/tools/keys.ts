/**
 * tools/keys — 入参未知字段检测 + did-you-mean 建议。
 *
 * defineTool 的 parameter schema 根是隐式开放对象（宿主约定），未知字段不会
 * 被入参校验拦住；为尽早暴露笔误，每个工具在 execute 开头调 assertKnownKeys。
 * 编辑距离算法与 spec 内部未知字段检测共用 kernel/text/similarity。
 */
import { didYouMean } from '../kernel/text/similarity.js';

export { didYouMean, levenshtein } from '../kernel/text/similarity.js';

/**
 * 未知字段检测：发现即 throw Error，message 附 did-you-mean 建议与允许字段清单。
 * 非对象入参（数组/null/标量）直接放行——留给 defineTool 的入参校验兜底。
 */
export function assertKnownKeys(args: unknown, known: readonly string[], toolName: string): void {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return;
  for (const key of Object.keys(args)) {
    if (known.includes(key)) continue;
    const hints = didYouMean(key, known);
    const hint = hints.length > 0 ? `did you mean ${hints.map((h) => `"${h}"`).join(' / ')}？` : '';
    throw new Error(`${toolName} 收到未知字段 "${key}"。${hint}允许字段：${known.join(', ')}`);
  }
}
