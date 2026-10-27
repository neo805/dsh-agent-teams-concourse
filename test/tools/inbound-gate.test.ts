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
  SAMPLE_SPEC,
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

type DeferredMessage = {
  readonly message: ReturnType<typeof agentMessage>;
  readonly concourseId: string;
  readonly admissionId: string;
};

function withTicket(request: DeferredMessage): ReturnType<typeof agentMessage> {
  return {
    ...request.message,
    source: {
      ...(request.message.source as unknown as AgentSource),
      concourse: { id: request.concourseId, admissionId: request.admissionId },
    },
  } as ReturnType<typeof agentMessage>;
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

describe('RC8-1 官方路径 wake/degrade 两轮语义', () => {
  test.each([
    { mode: 'notify', wake: 'never' },
    { mode: 'board', wake: 'always' },
  ] as const)(
    '官方 agent-message（mode=$mode wake=$wake）首次从当前批排除，带票据重排后只消费一次',
    async ({ mode, wake }) => {
      const fx = makeFixture();
      await makeRunning(fx, {
        ...SAMPLE_SPEC,
        edges: [{ from: 'lead', to: 'a', mode, wake, hopTTL: 2 }],
      });
      const raw = agentMessage(ROOT_AGENT_ID, `never-${mode}`);
      const deferred: DeferredMessage[] = [];
      const kept = fx.service.filterInbound('child-a', [raw], (request) => {
        deferred.push(request);
      });
      expect(kept).toEqual([]);
      expect(deferred).toHaveLength(1);
      const first = deferred[0]!;
      expect(first.message).toBe(raw);
      expect(first.concourseId).toBe('demo');
      expect(first.admissionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(fx.ledger.query({ kind: 'comm', action: 'admit' })).toHaveLength(1);
      expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(1);
      expect(fx.ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(1);
      expect(fx.service.runtime('demo').admissions.size).toBe(1);

      const ticketed = withTicket(first);
      const secondDeferred: DeferredMessage[] = [];
      expect(
        fx.service.filterInbound('child-a', [ticketed], (request) => {
          secondDeferred.push(request);
        }),
      ).toEqual([ticketed]);
      expect(secondDeferred).toEqual([]);
      expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(1);
      expect(fx.ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(1);
      expect(fx.service.runtime('demo').admissions.size).toBe(0);
    },
  );

  test('官方路径 RATE_LIMIT 降级也重排；下一轮票据消费不重复扣账', async () => {
    const fx = makeFixture();
    await makeRunning(fx, {
      ...SAMPLE_SPEC,
      edges: [
        { from: 'lead', to: 'a', mode: 'notify', wake: 'always', hopTTL: 2, rate: { n: 1, perMs: 60_000 } },
      ],
    });
    const first = agentMessage(ROOT_AGENT_ID, 'first-rate');
    expect(fx.service.filterInbound('child-a', [first], () => {})).toEqual([first]);
    const degraded = agentMessage(ROOT_AGENT_ID, 'second-rate');
    const deferred: DeferredMessage[] = [];
    expect(
      fx.service.filterInbound('child-a', [degraded], (request) => {
        deferred.push(request);
      }),
    ).toEqual([]);
    expect(deferred).toHaveLength(1);
    expect(fx.ledger.query({ kind: 'comm', action: 'degrade' })).toHaveLength(1);

    const deliverBefore = fx.ledger.query({ kind: 'comm', action: 'deliver' }).length;
    const consumeBefore = fx.ledger.query({ kind: 'budget', action: 'consume' }).length;
    const ticketed = withTicket(deferred[0]!);
    expect(fx.service.filterInbound('child-a', [ticketed], () => {})).toEqual([ticketed]);
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' }).length).toBe(deliverBefore);
    expect(fx.ledger.query({ kind: 'budget', action: 'consume' }).length).toBe(consumeBefore);
  });

  test('混合批保留 user 消息，多条 deferred 按 FIFO 重排，全部 deferred 时当前批为空', async () => {
    const fx = makeFixture();
    await makeRunning(fx, {
      ...SAMPLE_SPEC,
      edges: [{ from: 'lead', to: 'a', mode: 'notify', wake: 'never', hopTTL: 2 }],
    });
    const userMessage = createUserMessage({
      content: [{ type: 'text', text: 'human input' }],
      source: { kind: 'user' } as never,
    });
    const first = agentMessage(ROOT_AGENT_ID, 'fifo-1');
    const second = agentMessage(ROOT_AGENT_ID, 'fifo-2');
    const deferred: DeferredMessage[] = [];
    expect(
      fx.service.filterInbound('child-a', [first, userMessage, second], (request) => {
        deferred.push(request);
      }),
    ).toEqual([userMessage]);
    expect(deferred.map((d) => d.message)).toEqual([first, second]);

    const allDeferred: DeferredMessage[] = [];
    expect(
      fx.service.filterInbound('child-a', [agentMessage(ROOT_AGENT_ID, 'fifo-3')], (request) => {
        allDeferred.push(request);
      }),
    ).toEqual([]);
    expect(allDeferred).toHaveLength(1);
  });

  test('重排队失败：零 deliver/预算/admission，只留 delivery-failed，且原文不进入当前批', async () => {
    const fx = makeFixture();
    await makeRunning(fx, {
      ...SAMPLE_SPEC,
      edges: [{ from: 'lead', to: 'a', mode: 'notify', wake: 'never', hopTTL: 2 }],
    });
    const raw = agentMessage(ROOT_AGENT_ID, 'requeue-fails');
    expect(
      fx.service.filterInbound('child-a', [raw], () => {
        throw new Error('inbox append failed');
      }),
    ).toEqual([]);
    expect(fx.ledger.query({ kind: 'comm', action: 'delivery-failed' })).toHaveLength(1);
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(0);
    expect(fx.ledger.query({ kind: 'comm', action: 'degrade' })).toHaveLength(0);
    expect(fx.ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(0);
    expect(fx.service.runtime('demo').admissions.size).toBe(0);
  });
});
