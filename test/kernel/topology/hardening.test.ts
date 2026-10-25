/**
 * 0.2.1 T4 —— 统一有向边口径与嵌套未知键检测。
 */
import { describe, expect, it } from 'vitest';
import { parseConcourse } from '../../../src/kernel/topology/schema.js';
import {
  findUnknownKeyIssues,
  zodErrorToIssues,
} from '../../../src/kernel/topology/issues.js';
import { directedEdgeCapacity } from '../../../src/kernel/topology/edges.js';
import { ZodError } from 'zod';

describe('T4 一致性与 schema 边界', () => {
  it('有向完全图容量恒为 n(n-1)，工具与 UI 共用', () => {
    expect(directedEdgeCapacity(0)).toBe(0);
    expect(directedEdgeCapacity(1)).toBe(0);
    expect(directedEdgeCapacity(6)).toBe(30);
  });

  it('SCHEMA path 与语义 issue 同形：数字段用 [n]，根 path 省略', () => {
    try {
      parseConcourse({ id: 'x', tier: 'T0', vertices: [{ origin: 'self' }] });
      expect.unreachable('应当抛 ZodError');
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const issues = zodErrorToIssues(err as ZodError);
      expect(issues.some((i) => i.path === 'vertices[0].id')).toBe(true);
      expect(issues.every((i) => i.path !== '')).toBe(true);
    }
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
