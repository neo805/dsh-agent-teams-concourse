import { describe, expect, it } from 'vitest';
import { parseConcourse, type Concourse } from '../../../src/kernel/topology/schema.js';
import { validateConcourse } from '../../../src/kernel/topology/validate.js';
import {
  invalidDanglingParent,
  invalidSelfLoop,
  invalidTierMismatch,
  t1aStar,
  t2aForest,
  validFixtures,
} from '../../fixtures/topology/index.js';

/** 提取 issue code 列表，便于断言。 */
function codes(c: Concourse, limits?: { maxVertices: number }): string[] {
  return validateConcourse(c, limits).map((i) => i.code);
}

describe('kernel/topology/validate（语义校验，不 throw，空数组=通过）', () => {
  it('合法样例矩阵全部通过（T0/T1a/T1b/T1.5/T2a）', () => {
    for (const c of validFixtures) {
      expect(validateConcourse(c), `fixture ${c.id} 应通过`).toEqual([]);
    }
  });

  it('DUPLICATE_VERTEX_ID：顶点 id 重复，path 定位到后者', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1a',
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'a', parent: 'a', layer: 1 },
      ],
    });
    const issues = validateConcourse(c);
    const hit = issues.find((i) => i.code === 'DUPLICATE_VERTEX_ID');
    expect(hit, '应命中 DUPLICATE_VERTEX_ID').toBeDefined();
    expect(hit?.path).toBe('vertices[1].id');
    expect(hit?.message).toContain('a');
  });

  it('SELF_LOOP：边 from===to（fixture invalid-self-loop）', () => {
    const issues = validateConcourse(invalidSelfLoop);
    expect(issues.map((i) => i.code)).toContain('SELF_LOOP');
    expect(issues.find((i) => i.code === 'SELF_LOOP')?.path).toBe('edges[0]');
  });

  it('DUPLICATE_EDGE：同一 (from,to) 声明两次', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1a',
      vertices: [
        { id: 'captain', origin: 'self' },
        { id: 'w-1', parent: 'captain', layer: 1 },
      ],
      edges: [
        { from: 'captain', to: 'w-1' },
        { from: 'captain', to: 'w-1' },
      ],
    });
    expect(codes(c)).toContain('DUPLICATE_EDGE');
  });

  it('DANGLING_EDGE_ENDPOINT：边端点不存在', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1a',
      vertices: [{ id: 'captain', origin: 'self' }],
      edges: [{ from: 'captain', to: 'ghost' }],
    });
    const issues = validateConcourse(c);
    const hit = issues.find((i) => i.code === 'DANGLING_EDGE_ENDPOINT');
    expect(hit).toBeDefined();
    expect(hit?.path).toBe('edges[0].to');
  });

  it('DANGLING_PARENT：parent 引用不存在（fixture invalid-dangling-parent）', () => {
    const issues = validateConcourse(invalidDanglingParent);
    const hit = issues.find((i) => i.code === 'DANGLING_PARENT');
    expect(hit).toBeDefined();
    expect(hit?.path).toBe('vertices[1].parent');
  });

  it('PARENT_CYCLE：parent 链成环', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1b',
      vertices: [
        { id: 'root', origin: 'self' },
        { id: 'b', parent: 'c', layer: 2 },
        { id: 'c', parent: 'b', layer: 1 },
      ],
    });
    expect(codes(c)).toContain('PARENT_CYCLE');
  });

  it('LAYER_MISMATCH：layer 与 parent 链深度不一致', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1b',
      vertices: [
        { id: 'captain', origin: 'self' },
        { id: 'w-1', parent: 'captain', layer: 2 },
      ],
    });
    const issues = validateConcourse(c);
    const hit = issues.find((i) => i.code === 'LAYER_MISMATCH');
    expect(hit).toBeDefined();
    expect(hit?.path).toBe('vertices[1].layer');
  });

  it('SELF_NOT_ROOT：origin=self 却有 parent', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1a',
      vertices: [
        { id: 'root', origin: 'joined' },
        { id: 'me', origin: 'self', parent: 'root', layer: 1 },
      ],
    });
    expect(codes(c)).toContain('SELF_NOT_ROOT');
  });

  it('MULTIPLE_SELF：多个 origin=self 顶点', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T2a',
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', origin: 'self' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(codes(c)).toContain('MULTIPLE_SELF');
  });

  it('SPAWNED_IS_ROOT：spawned 顶点没有逻辑父', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T0',
      vertices: [{ id: 'orphan' }],
    });
    expect(codes(c)).toContain('SPAWNED_IS_ROOT');
  });

  it('ROOT_COUNT_MISMATCH：T2a 根不足 2 个；非 T2a 根非恰好 1 个', () => {
    // t1a-star 形状却声明 T2a → 根只有 1 个
    const asT2a: Concourse = { ...t1aStar, tier: 'T2a' };
    expect(codes(asT2a)).toContain('ROOT_COUNT_MISMATCH');
    // t2a-forest 形状却声明 T1a → 根有 3 个
    const asT1a: Concourse = { ...t2aForest, tier: 'T1a' };
    expect(codes(asT1a)).toContain('ROOT_COUNT_MISMATCH');
  });

  it('T2A_ROOT_NOT_JOINED：T2a 中非 self 的根必须 origin=joined（FR-2.3）', () => {
    const c2 = parseConcourse({
      id: 'x2',
      tier: 'T2a',
      vertices: [
        { id: 'me', origin: 'self' },
        { id: 'spawned-root', origin: 'spawned', parent: 'me', layer: 1 },
        { id: 'bad-root' },
      ],
      edges: [{ from: 'me', to: 'bad-root' }],
    });
    const hit = validateConcourse(c2).find((i) => i.code === 'T2A_ROOT_NOT_JOINED');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('bad-root');
  });

  it('DUPLICATE_TASK_ID：任务 id 唯一，重复项逐条定位', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T0',
      vertices: [{ id: 'solo', origin: 'self' }],
      tasks: [
        { id: 'T-1', subject: '做 A', assignee: 'solo' },
        { id: 'T-1', subject: '做 B', assignee: 'solo', dependencies: ['T-1'] },
      ],
    });
    const hit = validateConcourse(c).find((i) => i.code === 'DUPLICATE_TASK_ID');
    expect(hit).toBeDefined();
    expect(hit?.path).toBe('tasks[1].id');
  });

  it('复合边键不碰撞：a→b,c 与 a,b→c 是两条不同边', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T0',
      vertices: [
        { id: 'a→b', origin: 'self' },
        { id: 'c', parent: 'a→b', layer: 1 },
        { id: 'a', parent: 'a→b', layer: 1 },
        { id: 'b→c', parent: 'a→b', layer: 1 },
      ],
      edges: [
        { from: 'a→b', to: 'c' },
        { from: 'a', to: 'b→c' },
      ],
    });
    expect(codes(c)).not.toContain('DUPLICATE_EDGE');
  });

  it('DANGLING_ASSIGNEE / DANGLING_DEPENDENCY：任务引用不存在', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T0',
      vertices: [{ id: 'solo', origin: 'self' }],
      tasks: [
        { id: 'T-1', subject: '做 A', assignee: 'ghost' },
        { id: 'T-2', subject: '做 B', assignee: 'solo', dependencies: ['T-9'] },
      ],
    });
    const cs = codes(c);
    expect(cs).toContain('DANGLING_ASSIGNEE');
    expect(cs).toContain('DANGLING_DEPENDENCY');
  });

  it('DEPENDENCY_CYCLE：任务依赖成环', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T0',
      vertices: [{ id: 'solo', origin: 'self' }],
      tasks: [
        { id: 'T-1', subject: 'A', assignee: 'solo', dependencies: ['T-2'] },
        { id: 'T-2', subject: 'B', assignee: 'solo', dependencies: ['T-1'] },
      ],
    });
    expect(codes(c)).toContain('DEPENDENCY_CYCLE');
  });

  it('TOO_MANY_VERTICES：只统计会实际拉起的非 self 顶点（FR-2.6）；limits 可覆盖', () => {
    const vertices = (spawned: number) => [
      { id: 'captain', origin: 'self' as const },
      ...Array.from({ length: spawned }, (_, i) => ({
        id: `w-${i}`,
        parent: 'captain',
        layer: 1,
      })),
    ];
    const atLimit = parseConcourse({ id: 'x', tier: 'T1a', vertices: vertices(8) });
    expect(codes(atLimit)).not.toContain('TOO_MANY_VERTICES');
    expect(codes(atLimit, { maxVertices: 16 })).not.toContain('TOO_MANY_VERTICES');

    const overLimit = parseConcourse({ id: 'x', tier: 'T1a', vertices: vertices(9) });
    expect(codes(overLimit)).toContain('TOO_MANY_VERTICES');
    expect(codes(overLimit, { maxVertices: 16 })).not.toContain('TOO_MANY_VERTICES');
    const issue = validateConcourse(overLimit).find((i) => i.code === 'TOO_MANY_VERTICES');
    expect(issue?.message).toContain('派生子顶点数 9');
    expect(issue?.message).toContain('上限 8');
  });

  it('BUDGET_OVERFLOW：顶点预算之和超过 concourse 预算', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1a',
      budget: { tokens: 100 },
      vertices: [
        { id: 'captain', origin: 'self', budget: { tokens: 60 } },
        { id: 'w-1', parent: 'captain', layer: 1, budget: { tokens: 60 } },
      ],
    });
    expect(codes(c)).toContain('BUDGET_OVERFLOW');
    // 预算充足则不报
    const ok = parseConcourse({
      id: 'x',
      tier: 'T1a',
      budget: { tokens: 200 },
      vertices: [
        { id: 'captain', origin: 'self', budget: { tokens: 60 } },
        { id: 'w-1', parent: 'captain', layer: 1, budget: { tokens: 60 } },
      ],
    });
    expect(codes(ok)).not.toContain('BUDGET_OVERFLOW');
  });

  it('DECLARED_TIER_MISMATCH：声明 T1a 实为 T1.5（fixture invalid-tier-mismatch）', () => {
    const issues = validateConcourse(invalidTierMismatch);
    const hit = issues.find((i) => i.code === 'DECLARED_TIER_MISMATCH');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('T1.5');
    expect(hit?.path).toBe('tier');
  });

  it('message 为中文可读、不 throw（对非法输入返回列表）', () => {
    const issues = validateConcourse(invalidDanglingParent);
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(typeof i.message).toBe('string');
      expect(i.message.length).toBeGreaterThan(0);
    }
  });
});
