/**
 * test/tools/team-status — 状态查询工具：列表/详情（开放边 x/y、预算余量、回声计数、熔断）。
 */
import { describe, expect, test } from 'vitest';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { createTeamStatusTool } from '../../src/tools/team-status.js';
import { SAMPLE_SPEC, fakeExec, makeFixture, makeRunning } from './helpers.js';

interface StatusSummary {
  id: string;
  tier: string;
  status: string;
  vertexCount: number;
  openEdges: number;
  totalEdges: number;
  delivered: number;
  rejected: number;
  degraded: number;
  fused: number;
}
interface StatusDetail {
  id: string;
  tierLabel: string;
  status: string;
  vertices: Array<{ id: string; layer: number; origin: string; role?: string }>;
  edges: Array<{ from: string; to: string; mode: string; wake: string; hopTTL: number }>;
  budgetRemaining: number | null;
  globalFused: boolean;
  fusedEdges: string[];
}
interface StatusOut {
  ok: boolean;
  count: number;
  concourses: StatusSummary[];
  detail?: StatusDetail;
  code?: string;
  message?: string;
}

describe('team_status', () => {
  test('空列表', async () => {
    const fx = makeFixture();
    const tool = createTeamStatusTool(fx.deps);
    const out = (await tool.execute({}, fakeExec())) as StatusOut;
    expect(out.ok).toBe(true);
    expect(out.count).toBe(0);
    expect(out.concourses).toEqual([]);
  });

  test('列表：概要字段齐全', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamStatusTool(fx.deps);
    const out = (await tool.execute({}, fakeExec())) as StatusOut;
    expect(out.count).toBe(1);
    expect(out.concourses[0]).toMatchObject({
      id: 'demo',
      tier: 'T1a',
      status: 'running',
      vertexCount: 3,
      openEdges: 4,
      totalEdges: 6, // 3*(3-1) 完全图对数
      delivered: 0,
      rejected: 0,
      degraded: 0,
      fused: 0,
    });
  });

  test('详情：顶点/边/预算余量/回声/熔断字段', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamStatusTool(fx.deps);
    const out = (await tool.execute({ id: 'demo' }, fakeExec())) as StatusOut;
    expect(out.ok).toBe(true);
    const d = out.detail;
    expect(d).toBeDefined();
    expect(d?.tierLabel).toContain('T1a');
    expect(d?.vertices).toHaveLength(3);
    expect(d?.vertices[0]).toMatchObject({ id: 'lead', layer: 0, origin: 'self', role: '领队' });
    expect(d?.edges).toHaveLength(4);
    // backfillBudget：无预算声明时按估算回填 → 余量为正整数
    expect(typeof d?.budgetRemaining).toBe('number');
    expect(d?.budgetRemaining).toBeGreaterThan(0);
    expect(d?.globalFused).toBe(false);
    expect(d?.fusedEdges).toEqual([]);
  });

  test('熔断状态：边预算耗尽 → FUSE_EDGE 拒绝 + fusedEdges/echoCounts 反映', async () => {
    const fx = makeFixture();
    const spec = {
      ...SAMPLE_SPEC,
      edges: SAMPLE_SPEC.edges.map((e) =>
        e.from === 'lead' && e.to === 'a' ? { ...e, budget: { tokens: 1 } } : e,
      ),
    };
    await makeRunning(fx, spec);
    const send = createTeamSendTool(fx.deps);
    const out = (await send.execute(
      { id: 'demo', from: 'lead', to: 'a', content: '这是一条内容足够长的消息确保超过一个 token 的边预算' },
      fakeExec(),
    )) as { ok: boolean; reason?: string };
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('FUSE_EDGE');
    const status = createTeamStatusTool(fx.deps);
    const after = (await status.execute({ id: 'demo' }, fakeExec())) as StatusOut;
    expect(after.detail?.fusedEdges).toEqual(['lead->a']);
    expect(after.detail?.globalFused).toBe(false);
    expect(after.concourses[0]).toMatchObject({ rejected: 1, fused: 1 });
  });

  test('未知 id：NOT_FOUND', async () => {
    const fx = makeFixture();
    const tool = createTeamStatusTool(fx.deps);
    const out = (await tool.execute({ id: 'nope' }, fakeExec())) as StatusOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('NOT_FOUND');
  });

  test('输出 schema 为闭合对象；description 带 team_task_* 边界约定', () => {
    const fx = makeFixture();
    const tool = createTeamStatusTool(fx.deps);
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.description).toContain('team_task_*');
  });
});
