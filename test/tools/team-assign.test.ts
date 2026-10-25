/**
 * test/tools/team-assign — 审批执行工具：approve(id, exec.agent)，返回逐顶点拉起结果。
 */
import { describe, expect, test } from 'vitest';
import { createTeamAssignTool } from '../../src/tools/team-assign.js';
import { SAMPLE_SPEC, fakeExec, makeFixture, makeRunning } from './helpers.js';

interface AssignVertex {
  vertexId: string;
  self?: boolean;
  childId?: string;
  requestedModel?: string | null;
  requestedEffort?: string | null;
  effectiveModel?: string;
  effectiveEffort?: string;
}
interface AssignOut {
  ok: boolean;
  id?: string;
  status?: string;
  vertices: AssignVertex[];
  code?: string;
  message?: string;
}

describe('team_assign', () => {
  test('approve 成功：逐顶点 childId + requested-vs-effective；self 顶点不拉起', async () => {
    const fx = makeFixture();
    fx.service.create(SAMPLE_SPEC);
    fx.service.submit('demo');
    const tool = createTeamAssignTool(fx.deps);
    const out = (await tool.execute({ id: 'demo' }, fakeExec({ id: 'agent-root' }))) as AssignOut;
    expect(out.ok).toBe(true);
    expect(out.status).toBe('running');
    expect(out.vertices).toHaveLength(3);
    const lead = out.vertices.find((v) => v.vertexId === 'lead');
    expect(lead?.self).toBe(true);
    expect(lead?.childId).toBeUndefined();
    const a = out.vertices.find((v) => v.vertexId === 'a');
    expect(a?.childId).toBe('child-a'); // StubSubstrate 口径 child-<vertexId>
    expect(a?.requestedModel).toBeNull(); // 未声明 → null（未指定）
    expect(a?.effectiveModel).toBe('inherit');
    // 台账留痕
    expect(fx.ledger.query({ action: 'approve' })).toHaveLength(1);
    expect(fx.ledger.query({ action: 'vertex-start' })).toHaveLength(2);
  });

  test('未知 id：ok=false code=NOT_FOUND', async () => {
    const fx = makeFixture();
    const tool = createTeamAssignTool(fx.deps);
    const out = (await tool.execute({ id: 'nope' }, fakeExec())) as AssignOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('NOT_FOUND');
  });

  test('draft 直接 assign（未 submit）：ILLEGAL_TRANSITION', async () => {
    const fx = makeFixture();
    fx.service.create(SAMPLE_SPEC);
    const tool = createTeamAssignTool(fx.deps);
    const out = (await tool.execute({ id: 'demo' }, fakeExec())) as AssignOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('ILLEGAL_TRANSITION');
  });

  test('重复 approve：ILLEGAL_TRANSITION', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamAssignTool(fx.deps);
    const out = (await tool.execute({ id: 'demo' }, fakeExec())) as AssignOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('ILLEGAL_TRANSITION');
  });

  test('非法 model：approve-intent 与任何 vertex-start 之前失败', async () => {
    const fx = makeFixture({ withCatalog: true });
    const spec = {
      ...SAMPLE_SPEC,
      vertices: SAMPLE_SPEC.vertices.map((v) => (v.id === 'a' ? { ...v, model: 'no-such-model' } : v)),
    };
    fx.service.create(spec);
    fx.service.submit('demo');
    const out = (await createTeamAssignTool(fx.deps).execute(
      { id: 'demo' },
      fakeExec({ id: 'agent-root' }),
    )) as AssignOut;

    expect(out.ok).toBe(false);
    expect(out.code).toBe('APPROVE_FAILED');
    expect(out.message).toContain('no-such-model');
    expect(fx.substrate.started).toEqual([]);
    expect(fx.ledger.query({ action: 'approve-intent' })).toEqual([]);
    expect(fx.ledger.query({ action: 'vertex-start' })).toEqual([]);
    expect(fx.service.get('demo').status).toBe('pending-approval');
  });

  test('非法 reasoningEffort：所有显式定档预检通过前不启动任何顶点', async () => {
    const fx = makeFixture({ withCatalog: true });
    const spec = {
      ...SAMPLE_SPEC,
      vertices: SAMPLE_SPEC.vertices.map((v) =>
        v.id === 'a' ? { ...v, model: 'm-big', reasoningEffort: 'extreme' } : v,
      ),
    };
    fx.service.create(spec);
    fx.service.submit('demo');
    const out = (await createTeamAssignTool(fx.deps).execute(
      { id: 'demo' },
      fakeExec({ id: 'agent-root' }),
    )) as AssignOut;

    expect(out.ok).toBe(false);
    expect(out.code).toBe('APPROVE_FAILED');
    expect(out.message).toContain('extreme');
    expect(fx.substrate.started).toEqual([]);
    expect(fx.ledger.query({ action: 'approve-intent' })).toEqual([]);
  });

  test('合法显式 model/effort：预检通过并正常拉起', async () => {
    const fx = makeFixture({ withCatalog: true });
    const spec = {
      ...SAMPLE_SPEC,
      vertices: SAMPLE_SPEC.vertices.map((v) =>
        v.id === 'a' ? { ...v, model: 'm-big', reasoningEffort: 'high' } : v,
      ),
    };
    await makeRunning(fx, spec, { id: 'agent-root' });
    expect(fx.substrate.started.map((s) => s.vertexId)).toEqual(['a', 'b']);
  });

  test('缺必填字段 id：defineTool 入参校验拦截', async () => {
    const fx = makeFixture();
    const tool = createTeamAssignTool(fx.deps);
    await expect(tool.execute({}, fakeExec())).rejects.toThrow();
  });

  test('输出 schema 为闭合对象；description 带 team_task_* 边界约定', () => {
    const fx = makeFixture();
    const tool = createTeamAssignTool(fx.deps);
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.description).toContain('team_task_*');
  });
});
