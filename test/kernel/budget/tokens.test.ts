/**
 * kernel/budget/tokens 测试 —— 成本估算（估算口径，非计费；供计划期预算条与 FR-2.6 校验）。
 * 启发式：base 8000 + cognitive×4000 + contextTokens + toolCalls×2000，
 * 顶点级再乘 effort 系数（low×0.6 / high×1.8 / 其他×1）。
 * profile 缺省维度按 schema 默认（cognitive 3 等）。
 */
import { describe, expect, it } from 'vitest';
import type { Concourse, TaskSpec } from '../../../src/kernel/topology/schema.js';
import {
  estimateConcourseBudget,
  estimateTaskTokens,
} from '../../../src/kernel/budget/tokens.js';

const task = (over: Partial<TaskSpec> = {}): TaskSpec => ({
  id: 't1',
  subject: 's',
  assignee: 'a',
  dependencies: [],
  ...over,
});

describe('estimateTaskTokens（单任务视角，不乘 effort 系数）', () => {
  it('确定性：同输入同输出', () => {
    const t = task({ profile: { cognitive: 3, contextTokens: 1000, toolCalls: 2 } });
    expect(estimateTaskTokens(t)).toBe(estimateTaskTokens(t));
    expect(estimateTaskTokens(t)).toBe(8000 + 3 * 4000 + 1000 + 2 * 2000); // 23000
  });

  it('profile 缺省按 schema 默认：cognitive=3, contextTokens=0, toolCalls=0 → 20000', () => {
    expect(estimateTaskTokens(task())).toBe(8000 + 3 * 4000);
  });

  it('部分 profile 维度缺省回落默认', () => {
    expect(estimateTaskTokens(task({ profile: { cognitive: 5 } }))).toBe(8000 + 5 * 4000);
    expect(estimateTaskTokens(task({ profile: { toolCalls: 3 } }))).toBe(8000 + 3 * 4000 + 3 * 2000);
  });

  it('边界：cognitive=1 与 5', () => {
    expect(estimateTaskTokens(task({ profile: { cognitive: 1 } }))).toBe(12000);
    expect(estimateTaskTokens(task({ profile: { cognitive: 5 } }))).toBe(28000);
  });
});

describe('estimateConcourseBudget（顶点级乘 effort 系数）', () => {
  const concourse = (over: Partial<Concourse> = {}): Concourse => ({
    id: 'c1',
    tier: 'T1a',
    substrate: { depthAlwaysOne: true, completeGraph: true },
    approval: 'once',
    vertices: [],
    edges: [],
    tasks: [],
    ...over,
  });

  const vertex = (id: string, reasoningEffort?: string) => ({
    id,
    origin: 'spawned' as const,
    parent: null,
    layer: 0,
    lifecycle: 'task' as const,
    contextMode: 'spawn' as const,
    maxDepth: 0,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  });

  it('effort 系数：low×0.6 / high×1.8 / 其他×1', () => {
    const c = concourse({
      vertices: [vertex('low', 'low'), vertex('high', 'high'), vertex('mid', 'medium')],
      tasks: [
        task({ id: 't1', assignee: 'low' }),
        task({ id: 't2', assignee: 'high' }),
        task({ id: 't3', assignee: 'mid' }),
      ],
    });
    const r = estimateConcourseBudget(c);
    expect(r.perVertex['low']).toBe(20000 * 0.6);
    expect(r.perVertex['high']).toBe(20000 * 1.8);
    expect(r.perVertex['mid']).toBe(20000);
    expect(r.total).toBe(20000 * 0.6 + 20000 * 1.8 + 20000);
  });

  it('未声明 reasoningEffort 的顶点系数为 1', () => {
    const c = concourse({ vertices: [vertex('a')], tasks: [task()] });
    expect(estimateConcourseBudget(c).perVertex['a']).toBe(20000);
  });

  it('perVertex 按 assignee 汇总，total 为总和', () => {
    const c = concourse({
      vertices: [vertex('a'), vertex('b')],
      tasks: [task({ id: 't1', assignee: 'a' }), task({ id: 't2', assignee: 'a' }), task({ id: 't3', assignee: 'b' })],
    });
    const r = estimateConcourseBudget(c);
    expect(r.perVertex['a']).toBe(40000);
    expect(r.perVertex['b']).toBe(20000);
    expect(r.total).toBe(60000);
  });

  it('空任务列表：total=0', () => {
    expect(estimateConcourseBudget(concourse()).total).toBe(0);
  });
});
