/**
 * kernel/text/similarity — 通用编辑距离与 did-you-mean。
 *
 * 纯函数、零宿主依赖；工具入参守卫与 spec 内部未知字段检测共用这一份实现。
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
