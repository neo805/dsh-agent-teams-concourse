/**
 * 0.2.1 T2/T3 —— 持久化原子性、重启恢复、改边回放、审批 single-flight 与取消。
 */
import { describe, expect, test } from 'vitest';
import { ConcourseError, ConcourseService } from '../../src/service/concourse.js';
import { Ledger, type LedgerEvent } from '../../src/service/ledger.js';
import { replay } from '../../src/service/persistence.js';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { createTeamLinkTool } from '../../src/tools/team-link.js';
import { ROOT_AGENT_ID, SAMPLE_SPEC, fakeExec, makeFixture, makeRunning } from '../tools/helpers.js';
import { StubSubstrate, fakeClock } from './helpers.js';

/** 用 JSON 序列化模拟 JSONL 的 append 时快照，避免内存引用被后续边变更新污染。 */
function persistedSink(events: LedgerEvent[]) {
  return (event: LedgerEvent) => {
    events.push(JSON.parse(JSON.stringify(event)) as LedgerEvent);
  };
}

describe('T2 写盘原子性', () => {
  test('create 的 sink 失败 -> 调用报错且 service/order 不发布', () => {
    let fail = false;
    const ledger = new Ledger({
      now: fakeClock(),
      sink: () => {
        if (fail) throw new Error('disk full');
      },
    });
    const service = new ConcourseService({ substrate: new StubSubstrate(), ledger, now: fakeClock() });
    fail = true;
    expect(() => service.create(SAMPLE_SPEC)).toThrow('disk full');
    expect(service.list()).toEqual([]);
    expect(ledger.all()).toEqual([]);
  });

  test('vertex-start 落盘失败 -> 已启动顶点回滚，状态仍 pending-approval', async () => {
    let failVertexStart = true;
    const ledger = new Ledger({
      now: fakeClock(),
      sink: (event) => {
        if (failVertexStart && event.action === 'vertex-start') throw new Error('ledger offline');
      },
    });
    const substrate = new StubSubstrate();
    const service = new ConcourseService({ substrate, ledger, now: fakeClock() });
    service.create(SAMPLE_SPEC);
    service.submit('demo');
    await expect(service.approve('demo', { id: ROOT_AGENT_ID })).rejects.toMatchObject({
      code: 'APPROVE_FAILED',
    });
    expect(service.get('demo').status).toBe('pending-approval');
    expect(substrate.interrupted).toEqual(['a']);
    // 失败后允许重试（single-flight 已清除）。
    failVertexStart = false;
    await expect(service.approve('demo', { id: ROOT_AGENT_ID })).resolves.toHaveLength(2);
  });

  test('预算回填后复查：顶点额度超过全局预算 -> BUDGET_OVERFLOW，不落库', () => {
    const ledger = new Ledger({ now: fakeClock() });
    const service = new ConcourseService({ substrate: new StubSubstrate(), ledger, now: fakeClock() });
    const input = {
      ...SAMPLE_SPEC,
      budget: { tokens: 100 },
    };
    try {
      service.create(input);
      expect.unreachable('应当抛出 BUDGET_OVERFLOW');
    } catch (err) {
      expect(err).toBeInstanceOf(ConcourseError);
      expect((err as ConcourseError).code).toBe('INVALID_SPEC');
      expect((err as ConcourseError).issues?.some((i) => i.code === 'BUDGET_OVERFLOW')).toBe(true);
    }
    expect(service.list()).toEqual([]);
  });
});

describe('T2 重启恢复与改边回放', () => {
  test('Ledger snapshot 恢复 seq/echo；edge-close 回放后仍关闭', async () => {
    const events: LedgerEvent[] = [];
    const sink = persistedSink(events);
    const ledger1 = new Ledger({ now: fakeClock(), sink });
    const substrate1 = new StubSubstrate();
    const service1 = new ConcourseService({ substrate: substrate1, ledger: ledger1, now: fakeClock() });
    service1.create(SAMPLE_SPEC);
    service1.submit('demo');
    await service1.approve('demo', { id: ROOT_AGENT_ID });
    await createTeamSendTool({ service: service1, ledger: ledger1 }).execute(
      { id: 'demo', from: 'lead', to: 'a', content: 'before restart' },
      fakeExec({ id: ROOT_AGENT_ID }),
    );
    await createTeamLinkTool({ service: service1, ledger: ledger1 }).execute(
      { id: 'demo', from: 'lead', to: 'a', action: 'close' },
      fakeExec(),
    );

    const maxSeq = Math.max(...events.map((e) => e.seq));
    const ledger2 = new Ledger({ now: fakeClock(), snapshot: events, sink });
    const substrate2 = new StubSubstrate();
    const service2 = new ConcourseService({
      substrate: substrate2,
      ledger: ledger2,
      now: fakeClock(),
      snapshot: replay(events),
    });
    expect(ledger2.echoCounts('demo').delivered).toBe(1);
    expect(ledger2.append({ concourseId: 'demo', kind: 'lifecycle', action: 'audit', detail: {} }).seq).toBe(
      maxSeq + 1,
    );
    expect(
      service2.runtime('demo').concourse.edges.some((e) => e.from === 'lead' && e.to === 'a'),
    ).toBe(false);
  });

  test('重启后目标 Agent 不在线 -> TARGET_UNAVAILABLE，不伪造 deliver', async () => {
    const events: LedgerEvent[] = [];
    const sink = persistedSink(events);
    const ledger1 = new Ledger({ now: fakeClock(), sink });
    const substrate1 = new StubSubstrate();
    const service1 = new ConcourseService({ substrate: substrate1, ledger: ledger1, now: fakeClock() });
    service1.create(SAMPLE_SPEC);
    service1.submit('demo');
    await service1.approve('demo', { id: ROOT_AGENT_ID });

    const ledger2 = new Ledger({ now: fakeClock(), snapshot: events, sink });
    const substrate2 = new StubSubstrate();
    substrate2.deliverError = new Error('live Agent unavailable');
    const service2 = new ConcourseService({
      substrate: substrate2,
      ledger: ledger2,
      now: fakeClock(),
      snapshot: replay(events),
    });
    const out = (await createTeamSendTool({
      service: service2,
      ledger: ledger2,
    }).execute(
      { id: 'demo', from: 'lead', to: 'a', content: 'after restart' },
      fakeExec({ id: ROOT_AGENT_ID }),
    )) as { outcome: string; code?: string };
    expect(out.outcome).toBe('error');
    expect(out.code).toBe('SEND_FAILED');
    expect(ledger2.query({ kind: 'comm', action: 'deliver' })).toHaveLength(0);
  });
});

describe('发送与准入的防御分支', () => {
  test('缺 sender / 未知目标 / 缺 ticket source 均不产生 deliver', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    expect(fx.service.send('demo', { from: 'lead', to: 'a', content: 'x' }, undefined)).toMatchObject({
      outcome: 'error',
      code: 'IDENTITY_MISMATCH',
    });
    expect(
      fx.service.send(
        'demo',
        { from: 'lead', to: 'ghost', content: 'x' },
        { id: ROOT_AGENT_ID },
      ),
    ).toMatchObject({ outcome: 'error', code: 'UNKNOWN_VERTEX' });
    const noSender = {
      content: [{ type: 'text', text: 'no sender' }],
      source: { kind: 'agent-message' },
    };
    expect(fx.service.filterInbound('child-a', [noSender])).toEqual([]);
    expect(fx.ledger.query({ kind: 'comm', action: 'deliver' })).toHaveLength(0);
  });

  test('link 要求 running 且顶点存在；replay 接受非法 edge detail 不崩溃', async () => {
    const fx = makeFixture();
    fx.service.create(SAMPLE_SPEC);
    expect(() => fx.service.link('demo', { from: 'lead', to: 'a', action: 'close' })).toThrowError(
      /running/,
    );
    fx.service.submit('demo');
    await fx.service.approve('demo', { id: ROOT_AGENT_ID });
    expect(() => fx.service.link('demo', { from: 'lead', to: 'ghost', action: 'close' })).toThrowError(
      /顶点不存在/,
    );
    expect(() => fx.service.link('missing', { from: 'lead', to: 'a', action: 'close' })).toThrowError(
      /不存在/,
    );
    expect(() => replay([{ seq: 1, at: 1, concourseId: 'c', kind: 'lifecycle', action: 'edge-open', detail: {} }])).not.toThrow();
  });
});

describe('运行期改边参数校验', () => {
  test('直调 service.link 的 hopTTL<=0 在写台账前 fail-loud，拓扑不变', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const before = fx.service.get('demo').concourse.edges;
    for (const hopTTL of [0, -1]) {
      let error: unknown;
      try {
        fx.service.link('demo', { from: 'a', to: 'b', action: 'open', hopTTL });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ConcourseError);
      expect((error as ConcourseError).code).toBe('INVALID_SPEC');
      expect((error as ConcourseError).issues?.length).toBeGreaterThan(0);
    }
    expect(fx.service.get('demo').concourse.edges).toEqual(before);
    expect(fx.ledger.query({ action: 'edge-open' })).toHaveLength(0);
  });

  test('直调 service.link 开自环在写台账前失败，拓扑不变', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const before = fx.service.get('demo').concourse.edges;
    for (const mode of ['notify', 'request-reply'] as const) {
      let error: unknown;
      try {
        fx.service.link('demo', { from: 'a', to: 'a', action: 'open', mode });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ConcourseError);
      expect((error as ConcourseError).code).toBe('INVALID_SPEC');
    }
    expect(fx.service.get('demo').concourse.edges).toEqual(before);
    expect(fx.ledger.query({ action: 'edge-open' })).toHaveLength(0);
  });

  test('hopTTL=1 可开边，第一跳投递、第二跳 HOP_LIMIT', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const out = fx.service.link('demo', { from: 'a', to: 'b', action: 'open', hopTTL: 1 });
    expect(out.concourse.edges.find((e) => e.from === 'a' && e.to === 'b')?.hopTTL).toBe(1);
    const runtime = fx.service.runtime('demo');
    const { evaluateInbound } = await import('../../src/service/inbox-gate.js');
    expect(evaluateInbound(runtime, { from: 'a', to: 'b', content: 'first', hops: 1 }).verdict).toBe(
      'deliver',
    );
    expect(evaluateInbound(runtime, { from: 'a', to: 'b', content: 'second', hops: 2 })).toMatchObject({
      verdict: 'reject',
      reason: 'HOP_LIMIT',
    });
  });
});

describe('多 concourse 身份解析', () => {
  test('同一领队下按唯一 sender 归属 concourse，闭边记到正确的第二条', async () => {
    const fx = makeFixture();
    await makeRunning(fx);
    const second = {
      id: 'demo2',
      tier: 'T1a',
      vertices: [
        { id: 'lead', origin: 'self', parent: null, layer: 0 },
        { id: 'c2', parent: 'lead', layer: 1 },
      ],
      edges: [{ from: 'lead', to: 'c2', mode: 'request-reply', wake: 'on-reply', hopTTL: 2 }],
      tasks: [{ id: 't2', subject: 'second', assignee: 'c2' }],
    };
    await makeRunning(fx, second);
    const message = {
      content: [{ type: 'text', text: 'closed reply' }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: 'child-c2' },
    };
    expect(fx.service.filterInbound(ROOT_AGENT_ID, [message])).toEqual([]);
    const rejects = fx.ledger.query({ kind: 'comm', action: 'reject' });
    expect(rejects.at(-1)?.concourseId).toBe('demo2');
    expect(rejects.at(-1)?.detail).toMatchObject({ from: 'c2', to: 'lead', reason: 'EDGE_CLOSED' });
  });
});

describe('T3 审批 single-flight 与取消', () => {
  test('并发 approve：第二个 APPROVAL_IN_PROGRESS，顶点只拉起一次', async () => {
    const fx = makeFixture();
    fx.service.create(SAMPLE_SPEC);
    fx.service.submit('demo');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fx.substrate.startVertex.bind(fx.substrate);
    fx.substrate.startVertex = async (spec, parent, signal) => {
      await gate;
      return original(spec, parent, signal);
    };
    const first = fx.service.approve('demo', { id: ROOT_AGENT_ID });
    await expect(fx.service.approve('demo', { id: ROOT_AGENT_ID })).rejects.toMatchObject({
      code: 'APPROVAL_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toHaveLength(2);
    expect(fx.substrate.started.map((s) => s.vertexId)).toEqual(['a', 'b']);
  });

  test('审批中途取消：不再启动后续顶点，已启动者回滚', async () => {
    const fx = makeFixture();
    fx.service.create(SAMPLE_SPEC);
    fx.service.submit('demo');
    const controller = new AbortController();
    const original = fx.substrate.startVertex.bind(fx.substrate);
    fx.substrate.startVertex = async (spec, parent, signal) => {
      const handle = await original(spec, parent, signal);
      controller.abort();
      return handle;
    };
    await expect(
      fx.service.approve('demo', { id: ROOT_AGENT_ID }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fx.substrate.started.map((s) => s.vertexId)).toEqual(['a']);
    expect(fx.substrate.interrupted).toEqual(['a']);
    expect(fx.service.get('demo').status).toBe('pending-approval');
  });
});
