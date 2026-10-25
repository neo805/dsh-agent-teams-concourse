/**
 * 0.2.1 T4 —— 统一有向边口径与嵌套未知键检测。
 */
import { describe, expect, it } from 'vitest';
import { findUnknownKeyIssues } from '../../../src/kernel/topology/issues.js';
import { directedEdgeCapacity } from '../../../src/kernel/topology/edges.js';

describe('T4 一致性与 schema 边界', () => {
  it('有向完全图容量恒为 n(n-1)，工具与 UI 共用', () => {
    expect(directedEdgeCapacity(0)).toBe(0);
    expect(directedEdgeCapacity(1)).toBe(0);
    expect(directedEdgeCapacity(6)).toBe(30);
  });

  it('concourse/edge 的 wallclockMs 不再被共享预算键集放行', () => {
    const issues = findUnknownKeyIssues({
      id: 'c',
      tier: 'T1a',
      budget: { tokens: 100, wallclockMs: 1000 },
      vertices: [
        { id: 'a', origin: 'self', budget: { tokens: 10, wallclockMs: 100 } },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', budget: { tokens: 5, wallclockMs: 100 } }],
    });
    expect(issues.filter((i) => i.code === 'UNKNOWN_FIELD').map((i) => i.path)).toEqual([
      'budget.wallclockMs',
      'edges[0].budget.wallclockMs',
    ]);
  });
});
