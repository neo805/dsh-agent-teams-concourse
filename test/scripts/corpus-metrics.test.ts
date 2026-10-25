import { describe, expect, it } from 'vitest';
import { corpusPass, formatPct } from '../../scripts/corpus-metrics.mjs';

describe('corpus 门禁阈值', () => {
  it('按原始比例判定：49.95% 即使显示为 50% 也不得通过', () => {
    const counts = { total: 2000, effortExact: 999, effortNear: 1700, tierExact: 1400 };
    expect(formatPct(counts.effortExact, counts.total)).toBe('50%');
    expect(corpusPass(counts)).toBe(false);
  });

  it('恰好达到三项下限才通过', () => {
    expect(
      corpusPass({ total: 2000, effortExact: 1000, effortNear: 1700, tierExact: 1400 }),
    ).toBe(true);
    expect(
      corpusPass({ total: 2000, effortExact: 1000, effortNear: 1699, tierExact: 1400 }),
    ).toBe(false);
  });

  it('空语料明确失败，不用 0/0 当通过', () => {
    expect(corpusPass({ total: 0, effortExact: 0, effortNear: 0, tierExact: 0 })).toBe(false);
  });
});
