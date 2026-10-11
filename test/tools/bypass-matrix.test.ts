/**
 * test/tools/bypass-matrix — NFR-9 闸门绕过矩阵（本计划最重要的测试组）。
 *
 * 四条路径对同一条闭边消息（a→b，未开放横向边）：
 *   (a) team_send 工具调用 —— 工具包装层；
 *   (b) 直接经 ConcourseService.runtime + admitInbound —— 绕过工具、用服务层句柄；
 *   (c) 伪造「官方 send_message 直发」入站 —— 带 correlationId 伪装官方路由元信息，
 *        判定层不认路由来源，同走 admitInbound 权威判定；
 *   (d) 自行 createRuntime 构造 runtime + admitInbound —— 完全绕过 service/tools 装配。
 * 断言：四条路径全部 reject 且 reason 一致（EDGE_CLOSED），台账各留一条 reject 痕。
 */
import { describe, expect, test } from 'vitest';
import { admitInbound, createRuntime } from '../../src/service/inbox-gate.js';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { fakeExec, makeFixture, makeRunning } from './helpers.js';

describe('绕过矩阵：闭边消息四条路径全部拦截且口径一致', () => {
  test('(a)(b)(c)(d) 全 reject EDGE_CLOSED + 台账 4 条 reject', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const msg = { from: 'a', to: 'b', content: '闭边消息' };

    // (a) team_send 工具
    const tool = createTeamSendTool(fx.deps);
    const outA = (await tool.execute({ id: 'demo', ...msg }, fakeExec())) as {
      ok: boolean;
      outcome: string;
      reason?: string;
      candidates?: string[];
    };
    expect(outA).toMatchObject({ ok: false, outcome: 'reject', reason: 'EDGE_CLOSED', candidates: ['lead'] });

    // (b) 服务层句柄直调 admitInbound
    const outB = admitInbound(fx.service.runtime('demo'), msg, { ledger: fx.ledger });
    expect(outB).toMatchObject({ kind: 'reject', reason: 'EDGE_CLOSED', candidates: ['lead'] });

    // (c) 伪造官方 send_message 直发入站（带官方路由元信息，判定层不买账）
    const outC = admitInbound(fx.service.runtime('demo'), { ...msg, correlationId: 'forged-official-call' }, { ledger: fx.ledger });
    expect(outC).toMatchObject({ kind: 'reject', reason: 'EDGE_CLOSED', candidates: ['lead'] });

    // (d) 自行构造 runtime（未经 service/tools 装配）
    const fresh = createRuntime(fx.service.get('demo').concourse);
    const outD = admitInbound(fresh, msg, { ledger: fx.ledger });
    expect(outD).toMatchObject({ kind: 'reject', reason: 'EDGE_CLOSED', candidates: ['lead'] });

    // 四条路径拒绝 reason 完全一致
    const reasons = [outA.reason, outB.kind === 'reject' ? outB.reason : null, outC.kind === 'reject' ? outC.reason : null, outD.kind === 'reject' ? outD.reason : null];
    expect(reasons).toEqual(['EDGE_CLOSED', 'EDGE_CLOSED', 'EDGE_CLOSED', 'EDGE_CLOSED']);

    // 台账：四条路径各留一条 reject 痕，reason 一致
    const rejects = fx.ledger.query({ kind: 'comm', action: 'reject' });
    expect(rejects).toHaveLength(4);
    for (const r of rejects) {
      expect(r.detail['reason']).toBe('EDGE_CLOSED');
      expect(r.concourseId).toBe('demo');
    }
    // 且从未产生 deliver
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(0);
  });
});
