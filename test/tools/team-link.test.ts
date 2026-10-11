/**
 * test/tools/team-link — 运行中开/闭通信边：立即生效于收件箱准入，台账留痕。
 */
import { describe, expect, test } from 'vitest';
import { admitInbound } from '../../src/service/inbox-gate.js';
import { createTeamLinkTool } from '../../src/tools/team-link.js';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { fakeExec, makeFixture, makeRunning } from './helpers.js';

interface LinkOut {
  ok: boolean;
  id?: string;
  action?: string;
  from?: string;
  to?: string;
  openEdges: number;
  code?: string;
  message?: string;
}

describe('team_link', () => {
  test('开边立即生效：a→b 由拒转通；spec 边集与台账同步', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    // 前置：a→b 是闭边
    const before = admitInbound(fx.service.runtime('demo'), { from: 'a', to: 'b', content: 'x' }, { ledger: fx.ledger });
    expect(before).toMatchObject({ kind: 'reject', reason: 'EDGE_CLOSED' });
    const tool = createTeamLinkTool(fx.deps);
    const out = (await tool.execute({ id: 'demo', from: 'a', to: 'b', action: 'open' }, fakeExec())) as LinkOut;
    expect(out.ok).toBe(true);
    expect(out.action).toBe('open');
    expect(out.openEdges).toBe(5); // 4 树边 + 1 新开
    // 立即生效
    const after = admitInbound(fx.service.runtime('demo'), { from: 'a', to: 'b', content: 'y' }, { ledger: fx.ledger });
    expect(after.kind).toBe('deliver');
    // spec 边集同步 + 台账留痕
    expect(fx.service.get('demo').concourse.edges.some((e) => e.from === 'a' && e.to === 'b')).toBe(true);
    expect(fx.ledger.query({ action: 'edge-open' })).toHaveLength(1);
  });

  test('request-reply 开边自动绑反向应答边（A2）', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamLinkTool(fx.deps);
    const out = (await tool.execute(
      { id: 'demo', from: 'a', to: 'b', action: 'open', mode: 'request-reply', wake: 'on-reply' },
      fakeExec(),
    )) as LinkOut;
    expect(out.ok).toBe(true);
    expect(out.openEdges).toBe(6); // 4 树边 + a→b + b→a 应答边
    const edges = fx.service.get('demo').concourse.edges;
    expect(edges.some((e) => e.from === 'b' && e.to === 'a')).toBe(true);
  });

  test('闭边立即生效：close lead→a 后 team_send 被拒 EDGE_CLOSED', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const link = createTeamLinkTool(fx.deps);
    const out = (await link.execute({ id: 'demo', from: 'lead', to: 'a', action: 'close' }, fakeExec())) as LinkOut;
    expect(out.ok).toBe(true);
    expect(out.openEdges).toBe(3);
    const send = createTeamSendTool(fx.deps);
    const sent = (await send.execute({ id: 'demo', from: 'lead', to: 'a', content: 'hi' }, fakeExec())) as {
      ok: boolean;
      reason?: string;
    };
    expect(sent.ok).toBe(false);
    expect(sent.reason).toBe('EDGE_CLOSED');
    expect(fx.ledger.query({ action: 'edge-close' })).toHaveLength(1);
  });

  test('非 running 状态拒绝（draft）', async () => {
    const fx = makeFixture();
    fx.service.create({
      id: 'demo',
      tier: 'T1a',
      vertices: [
        { id: 'lead', origin: 'self', parent: null, layer: 0 },
        { id: 'a', parent: 'lead', layer: 1 },
      ],
      edges: [],
      tasks: [],
    });
    const tool = createTeamLinkTool(fx.deps);
    const out = (await tool.execute({ id: 'demo', from: 'lead', to: 'a', action: 'open' }, fakeExec())) as LinkOut;
    expect(out.ok).toBe(false);
    expect(out.code).toBe('ILLEGAL_STATE');
  });

  test('未知顶点 / 未知 concourse', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamLinkTool(fx.deps);
    const bad = (await tool.execute({ id: 'demo', from: 'a', to: 'zz', action: 'open' }, fakeExec())) as LinkOut;
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('UNKNOWN_VERTEX');
    const missing = (await tool.execute({ id: 'nope', from: 'a', to: 'b', action: 'open' }, fakeExec())) as LinkOut;
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('NOT_FOUND');
  });

  test('action 枚举越界：defineTool 入参校验拦截', async () => {
    const fx = makeFixture();
    const tool = createTeamLinkTool(fx.deps);
    await expect(
      tool.execute({ id: 'demo', from: 'a', to: 'b', action: 'poke' }, fakeExec()),
    ).rejects.toThrow();
  });

  test('输出 schema 为闭合对象；description 带 team_task_* 边界约定', () => {
    const fx = makeFixture();
    const tool = createTeamLinkTool(fx.deps);
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.description).toContain('team_task_*');
  });
});
