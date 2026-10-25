/**
 * NFR-9 真实路径矩阵（0.2.1 T0 重写）。
 *
 * 旧矩阵把“直接再调一次 admitInbound”当作旁路证据，实际上没有经过宿主消息
 * 路径。本矩阵改为：
 *   (a) team_send 工具（真实 sender Agent）；
 *   (b) 宿主生成 agent-message 后进入 child pre-step（官方 send_message 同形）；
 *   (c) 未知发送者伪造来源；
 * 三条实际路径都必须被拦或从模型输入中移除，并留 reject 痕。
 */
import { describe, expect, test } from 'vitest';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { fakeExec, makeFixture, makeRunning } from './helpers.js';

function officialMessage(senderSessionId: string, content: string) {
  return createUserMessage({
    content: [
      { type: 'text', text: `Agent ${senderSessionId} sent a message: ` },
      { type: 'text', text: content },
    ],
    source: {
      kind: 'agent-message',
      form: 'relay',
      senderSessionId,
    } as never,
  });
}

describe('NFR-9 真实路径矩阵：闭边 a→b 无法进入模型', () => {
  test('team_send / 官方 pre-step / 伪造 sender 全部拦截，deliver 为 0', async () => {
    const fx = makeFixture();
    await makeRunning(fx);

    // (a) 工具路径：真实 child-a Agent 调用。
    const tool = createTeamSendTool(fx.deps);
    const outA = (await tool.execute(
      { id: 'demo', from: 'a', to: 'b', content: '闭边消息' },
      fakeExec({ id: 'child-a' }),
    )) as { ok: boolean; outcome: string; reason?: string; candidates?: string[] };
    expect(outA).toMatchObject({ ok: false, outcome: 'reject', reason: 'EDGE_CLOSED', candidates: ['lead'] });

    // (b) 官方/裸路径：宿主 agent-message 进入目标 child-b 的模型准入。
    const official = officialMessage('child-a', '闭边消息-官方路径');
    expect(fx.service.filterInbound('child-b', [official])).toEqual([]);

    // (c) 伪造 sender：目标仍是 concourse 顶点，但不属于任何顶点 -> fail-closed。
    const forged = officialMessage('ghost-agent', '伪造');
    expect(fx.service.filterInbound('child-b', [forged])).toEqual([]);

    const rejects = fx.ledger.query({ kind: 'comm', action: 'reject' });
    expect(rejects).toHaveLength(3);
    expect(rejects.slice(0, 2).map((e) => e.detail['reason'])).toEqual(['EDGE_CLOSED', 'EDGE_CLOSED']);
    expect(rejects[2]?.detail['reason']).toBe('UNKNOWN_VERTEX');
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(0);
    expect(fx.substrate.deliveries).toHaveLength(0);
  });
});
