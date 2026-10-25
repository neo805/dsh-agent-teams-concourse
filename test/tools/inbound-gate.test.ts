/**
 * 0.2.1 T0 —— 真实 agent-message 来源的模型准入闸门。
 *
 * 不直接调用 admitInbound 冒充旁路；这里构造宿主真实来源结构
 * `{kind:'agent-message', senderSessionId}`，验证收件侧身份映射与边集判定。
 */
import { describe, expect, test } from 'vitest';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import {
  ROOT_AGENT_ID,
  fakeExec,
  makeFixture,
  makeRunning,
} from './helpers.js';

type AgentSource = {
  kind: 'agent-message';
  form: 'relay';
  senderSessionId: string;
  concourse?: { id: string; admissionId: string };
};

function agentMessage(senderSessionId: string, content: string, admissionId?: string) {
  const source: AgentSource = {
    kind: 'agent-message',
    form: 'relay',
    senderSessionId,
    ...(admissionId !== undefined ? { concourse: { id: 'demo', admissionId } } : {}),
  };
  return createUserMessage({
    content: [{ type: 'text', text: content }],
    source: source as never,
  });
}

describe('T0 真实来源的模型准入闸门', () => {
  test('官方/裸路径的闭边消息按 senderSessionId 被移除并留 reject 痕', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const raw = agentMessage('child-a', '绕过 team_send 的闭边消息');
    const kept = fx.service.filterInbound('child-b', [raw]);
    expect(kept).toEqual([]);
    expect(fx.ledger.query({ kind: 'comm', action: 'reject' })).toHaveLength(1);
    expect(fx.ledger.query({ kind: 'comm', action: 'reject' })[0]?.detail).toMatchObject({
      from: 'a',
      to: 'b',
      reason: 'EDGE_CLOSED',
    });
    // 未被真实投递 -> 不产生 deliver / 预算消费。
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(0);
    expect(fx.ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(0);
  });

  test('开放边官方消息保留；未知 sender 按 fail-closed 移除', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const open = agentMessage(ROOT_AGENT_ID, '领队给 b 的合法消息');
    expect(fx.service.filterInbound('child-b', [open])).toEqual([open]);

    const forged = agentMessage('ghost-agent', '伪造发送者');
    expect(fx.service.filterInbound('child-b', [forged])).toEqual([]);
    expect(
      fx.ledger.query({ kind: 'comm', action: 'reject' }).some((e) => e.detail['reason'] === 'UNKNOWN_VERTEX'),
    ).toBe(true);
  });

  test('team_send 已提交的 admission 票据只消费一次，不重复扣预算', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute(
      { id: 'demo', from: 'lead', to: 'a', content: '一次合法投递' },
      fakeExec({ id: ROOT_AGENT_ID }),
    )) as { outcome?: string };
    expect(out.outcome).toBe('deliver');
    const admitted = fx.ledger.query({ kind: 'comm', action: 'admit' });
    expect(admitted).toHaveLength(1);
    const admissionId = String(admitted[0]?.detail['admissionId']);
    const message = agentMessage(ROOT_AGENT_ID, '一次合法投递', admissionId);
    const before = fx.ledger.query({ kind: 'budget', action: 'consume' }).length;
    expect(fx.service.filterInbound('child-a', [message])).toEqual([message]);
    expect(fx.ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(before);
  });

  test('真实 sender 与 from 不一致 -> IDENTITY_MISMATCH，不投递', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const tool = createTeamSendTool(fx.deps);
    const out = (await tool.execute(
      { id: 'demo', from: 'lead', to: 'a', content: '伪装' },
      fakeExec({ id: 'child-b' }),
    )) as { outcome?: string; code?: string };
    expect(out).toMatchObject({ outcome: 'error', code: 'IDENTITY_MISMATCH' });
    expect(fx.substrate.deliveries).toHaveLength(0);
  });
});
