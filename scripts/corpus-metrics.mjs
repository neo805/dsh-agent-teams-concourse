/**
 * corpus-metrics — 语料门禁的纯计算口径。
 *
 * 展示百分比可以四舍五入，但门禁判定必须使用原始计数比例；total=0 明确失败。
 */

export const CORPUS_THRESHOLDS = Object.freeze({
  effortExact: 0.5,
  effortNear: 0.85,
  tierExact: 0.7,
});

/**
 * @param {{total:number, effortExact:number, effortNear:number, tierExact:number}} counts
 * @returns {boolean}
 */
export function corpusPass(counts) {
  if (!Number.isInteger(counts.total) || counts.total <= 0) return false;
  return (
    counts.effortExact / counts.total >= CORPUS_THRESHOLDS.effortExact &&
    counts.effortNear / counts.total >= CORPUS_THRESHOLDS.effortNear &&
    counts.tierExact / counts.total >= CORPUS_THRESHOLDS.tierExact
  );
}

/** 展示用百分比（最多 1 位小数，带 % 后缀）。 */
export function formatPct(numerator, denominator) {
  if (denominator <= 0) return '0%';
  const rounded = Math.round((numerator / denominator) * 1000) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}
