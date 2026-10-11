/**
 * test/tools/team-send — 消息发送工具：admitInbound 权威判定在前，deliver 才投递。
 */
import { describe, expect, test } from 'vitest';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { SAMPLE_SPEC, fakeExec, makeFixture, makeRunning } from './helpers.js';

interface SendOut {
  ok: boolean;
  outcome: string;
  reason?: string;
  candidates?: string[];
  mode?: string;
  wake?: string;
  childId?: string;
  code?: string;
  message?: string;
}

describe('team_send', () => {
  test('deliver：开边消息投递到已拉起顶点（mode/wake/childId 回传 + 台账）', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute({ id: 'demo', from: 'lead', to: 'a', content: '开始任务' }, fakeExec())) as SendOut;
    expect(out).toMatchObject({ ok: true, outcome: 'deliver', mode: 'request-reply', wake: 'on-reply', childId: 'child-a' });
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(1);
  });

  test('reject：闭边原样返回 EDGE_CLOSED + candidates + 台账留痕（不投递）', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute({ id: 'demo', from: 'a', to: 'b', content: 'hi' }, fakeExec())) as SendOut;
    expect(out).toMatchObject({ ok: false, outcome: 'reject', reason: 'EDGE_CLOSED', candidates: ['lead'] });
    const rejects = fx.ledger.query({ kind: 'comm', action: 'reject' });
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.detail['reason']).toBe('EDGE_CLOSED');
  });

  test('self 顶点：a→lead 应答不经 substrate，childId=self', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute({ id: 'demo', from: 'a', to: 'lead', content: '汇报完毕' }, fakeExec())) as SendOut;
    expect(out).toMatchObject({ ok: true, outcome: 'deliver', childId: 'self' });
  });

  test('degrade：窗口内第 n+1 条原样返回 RATE_LIMIT（不投递不拒绝）', async () => {
    const fx = makeFixture();
    const spec = {
      ...SAMPLE_SPEC,
      edges: SAMPLE_SPEC.edges.map((e) =>
        e.from === 'lead' && e.to === 'a' ? { ...e, rate: { n: 1, perMs: 60_000 } } : e,
      ),
    };
    await makeRunning(fx, spec);
    const tool = createTeamSendTool(fx.deps);
    const first = (await tool.execute({ id: 'demo', from: 'lead', to: 'a', content: '第一条' }, fakeExec())) as SendOut;
    expect(first.outcome).toBe('deliver');
    const second = (await tool.execute({ id: 'demo', from: 'lead', to: 'a', content: '第二条' }, fakeExec())) as SendOut;
    expect(second).toMatchObject({ ok: true, outcome: 'degrade', reason: 'RATE_LIMIT' });
    expect(fx.ledger.query({ kind: 'comm', action: 'degrade' })).toHaveLength(1);
  });

  test('目标顶点未拉起（pending-approval）：deliver 判定通过但 NOT_STARTED', async () => {
    const fx = makeFixture();
    fx.service.create(SAMPLE_SPEC);
    fx.service.submit('demo');
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute({ id: 'demo', from: 'lead', to: 'a', content: 'hi' }, fakeExec())) as SendOut;
    expect(out.ok).toBe(false);
    expect(out.outcome).toBe('error');
    expect(out.code).toBe('NOT_STARTED');
  });

  test('未知 concourse：NOT_FOUND', async () => {
    const fx = makeFixture();
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute({ id: 'nope', from: 'a', to: 'b', content: 'x' }, fakeExec())) as SendOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('NOT_FOUND');
  });

  test('缺必填字段 content：defineTool 入参校验拦截', async () => {
    const fx = makeFixture();
    const tool = createTeamSendTool(fx.deps);
    await expect(tool.execute({ id: 'demo', from: 'a', to: 'b' }, fakeExec())).rejects.toThrow();
  });

  test('输出 schema 为闭合对象；description 带 team_task_* 边界约定', () => {
    const fx = makeFixture();
    const tool = createTeamSendTool(fx.deps);
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.description).toContain('team_task_*');
  });
});
