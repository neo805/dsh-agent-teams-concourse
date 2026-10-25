/**
 * kernel/budget/normalize —— 预算规范化与本次估算结果一次产出。
 */
import { describe, expect, it } from 'vitest';
import { parseConcourse } from '../../../src/kernel/topology/schema.js';
import {
  normalizeConcourseBudgets,
  normalizeConcourseBudgetsWithEstimate,
} from '../../../src/kernel/budget/normalize.js';

function input() {
  return {
    id: 'c-normalize',
    tier: 'T1a',
    vertices: [
      { id: 'a', origin: 'self' },
      { id: 'b', parent: 'a', layer: 1, reasoningEffort: 'low' },
    ],
    tasks: [{ id: 't1', subject: '实现', assignee: 'b' }],
  };
}

describe('normalizeConcourseBudgetsWithEstimate', () => {
  it('返回规范化结果与对应的本次估算，避免 preview/plan 二次重算', () => {
    const parsed = parseConcourse(input());
    const out = normalizeConcourseBudgetsWithEstimate(parsed);
    expect(out.estimate.total).toBeGreaterThan(0);
    expect(out.concourse.vertices.find((v) => v.id === 'b')?.budget?.tokens).toBe(
      Math.ceil(out.estimate.perVertex['b'] ?? 0),
    );
    expect(out.concourse.budget?.tokens).toBe(Math.ceil(out.estimate.total));
  });

  it('兼容 wrapper 返回同一规范化结果', () => {
    const parsed = parseConcourse(input());
    expect(normalizeConcourseBudgets(parsed)).toEqual(
      normalizeConcourseBudgetsWithEstimate(parsed).concourse,
    );
  });
});
