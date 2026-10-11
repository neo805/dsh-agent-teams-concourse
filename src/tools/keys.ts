/**
 * tools/keys — 入参未知字段检测 + Levenshtein "did you mean" 建议。
 *
 * defineTool 的 parameter schema 根是隐式开放对象（宿主约定），未知字段不会
 * 被入参校验拦住；为尽早暴露笔误，每个工具在 execute 开头调 assertKnownKeys。
 * 建议算法借鉴 nanmicoder 的 did-you-mean 做法：编辑距离阈值内候选按距离排序。
 */

/** 编辑距离（DP，滚动两行数组）。 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}

/** 距离阈值内（≤ max(2, ⌊len/2⌋)）的候选，按 (距离, 字典序) 排序。 */
export function didYouMean(input: string, candidates: readonly string[]): string[] {
  const threshold = Math.max(2, Math.floor(input.length / 2));
  return candidates
    .map((c) => ({ c, d: levenshtein(input, c) }))
    .filter((x) => x.d <= threshold)
    .sort((x, y) => x.d - y.d || (x.c < y.c ? -1 : x.c > y.c ? 1 : 0))
    .map((x) => x.c);
}

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
