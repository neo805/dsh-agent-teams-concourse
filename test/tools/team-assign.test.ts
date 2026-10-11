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
