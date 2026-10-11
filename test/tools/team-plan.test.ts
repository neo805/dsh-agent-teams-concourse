/**
 * test/tools/team-plan — 计划工具：create + submit，返回 §7.6.3 口径计划全文。
 */
import { describe, expect, test } from 'vitest';
import { createTeamPlanTool } from '../../src/tools/team-plan.js';
import { SAMPLE_SPEC, fakeExec, makeFixture } from './helpers.js';

interface PlanOut {
  ok: boolean;
  id?: string;
  status?: string;
  plan?: string;
  risks: string[];
  issues: Array<{ code: string; message: string }>;
  code?: string;
  message?: string;
}

describe('team_plan', () => {
  test('合法 spec：draft→pending-approval，计划全文含拓扑/任务表/通信边表/审批策略/预算', async () => {
    const fx = makeFixture();
    const tool = createTeamPlanTool(fx.deps);
    const out = (await tool.execute({ spec: SAMPLE_SPEC }, fakeExec())) as PlanOut;
    expect(out.ok).toBe(true);
    expect(out.id).toBe('demo');
    expect(out.status).toBe('pending-approval');
    expect(out.issues).toEqual([]);
    const plan = out.plan ?? '';
    expect(plan).toContain('拓扑');
    expect(plan).toContain('任务表');
    expect(plan).toContain('通信边表');
    expect(plan).toContain('审批策略');
    expect(plan).toContain('once');
    expect(plan).toContain('t1');
    expect(plan).toContain('lead');
    // SAMPLE_SPEC 无显著风险：显式占位行
    expect(out.risks).toEqual(['（无显著风险）']);
    // 已落库且已提交
    expect(fx.service.get('demo').status).toBe('pending-approval');
  });

  test('风险显式列出：wake=always 边触发回声风险提示', async () => {
    const fx = makeFixture();
    const tool = createTeamPlanTool(fx.deps);
    const spec = {
      ...SAMPLE_SPEC,
      edges: [{ from: 'lead', to: 'a', mode: 'notify', wake: 'always', hopTTL: 2 }],
    };
    const out = (await tool.execute({ spec }, fakeExec())) as PlanOut;
    expect(out.ok).toBe(true);
    expect(out.risks.some((r) => r.includes('wake=always'))).toBe(true);
  });

  test('语义非法：ok=false，code=INVALID_SPEC 附 issues', async () => {
    const fx = makeFixture();
    const tool = createTeamPlanTool(fx.deps);
    const spec = {
      ...SAMPLE_SPEC,
      vertices: [...SAMPLE_SPEC.vertices, { id: 'a', parent: 'lead', layer: 1 }],
    };
    const out = (await tool.execute({ spec }, fakeExec())) as PlanOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('INVALID_SPEC');
    expect(out.issues.some((i) => i.code === 'DUPLICATE_VERTEX_ID')).toBe(true);
    expect(fx.service.list()).toHaveLength(0);
  });

  test('重复 id：INVALID_SPEC', async () => {
    const fx = makeFixture();
    const tool = createTeamPlanTool(fx.deps);
    await tool.execute({ spec: SAMPLE_SPEC }, fakeExec());
    const out = (await tool.execute({ spec: SAMPLE_SPEC }, fakeExec())) as PlanOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('INVALID_SPEC');
  });

  test('缺必填字段 spec：defineTool 入参校验拦截', async () => {
    const fx = makeFixture();
    const tool = createTeamPlanTool(fx.deps);
    await expect(tool.execute({}, fakeExec())).rejects.toThrow();
  });

  test('输出 schema 为闭合对象；description 带 team_task_* 边界约定', () => {
    const fx = makeFixture();
    const tool = createTeamPlanTool(fx.deps);
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.description).toContain('team_task_*');
  });
});
