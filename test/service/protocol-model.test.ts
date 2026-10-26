/**
 * H3.0 当前已承诺行为的 live/replay 参考模型。
 *
 * 这里只验证当前实现明确承诺的部分：事件回放确定性、运行期改边、句柄与
 * rootSessionId 恢复、预算账目等价。崩溃窗口中尚未实现的恢复语义属于 H3.1，
 * 不得用本测试冒充已支持。
 */
import { describe, expect, it } from 'vitest';
import { ConcourseService } from '../../src/service/concourse.js';
import { Ledger, type LedgerEvent } from '../../src/service/ledger.js';
import { createMemoryStore, replay, type ReplayState } from '../../src/service/persistence.js';
import { StubSubstrate, manualClock } from './helpers.js';
import { ROOT_AGENT_ID, SAMPLE_SPEC } from '../tools/helpers.js';

function summary(state: ReplayState) {
  return state.concourses.map((rc) => ({
    id: rc.concourse.id,
    status: rc.status,
    handles: rc.handles,
    rootSessionId: rc.rootSessionId,
    edges: rc.concourse.edges,
    global: rc.budget.remainingGlobal(),
    fusedGlobal: rc.budget.isGlobalFused(),
    edgeRemaining: Object.fromEntries(
      rc.concourse.edges.map((edge) => [
        `${edge.from}->${edge.to}`,
        rc.budget.remainingEdge(edge.from, edge.to) ?? null,
      ]),
    ),
    fusedEdges: rc.concourse.edges
      .filter((edge) => rc.budget.isFusedEdge(edge.from, edge.to))
      .map((edge) => `${edge.from}->${edge.to}`),
  }));
}

describe('H3.0 当前协议模型：live 与 replay 等价', () => {
  it('create→approve→close/open→deliver 的事件流可确定性重放', async () => {
    const clock = manualClock();
    const store = createMemoryStore();
    const ledger = new Ledger({
      now: clock.now,
      sink: (event: LedgerEvent) => store.append(event),
    });
    const substrate = new StubSubstrate();
    const service = new ConcourseService({ substrate, ledger, now: clock.now });

    service.create(SAMPLE_SPEC);
    service.submit('demo');
    await service.approve('demo', { id: ROOT_AGENT_ID });
    service.link('demo', { from: 'lead', to: 'a', action: 'close' });
    service.link('demo', {
      from: 'lead',
      to: 'a',
      action: 'open',
      mode: 'request-reply',
      wake: 'on-reply',
    });
    const sent = service.send(
      'demo',
      { from: 'lead', to: 'a', content: 'protocol model' },
      { id: ROOT_AGENT_ID },
    );
    expect(sent.outcome).toBe('deliver');

    const events = store.load();
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const first = replay(events);
    const second = replay(events);
    expect(summary(first)).toEqual(summary(second));

    const rc = first.concourses[0];
    expect(rc?.status).toBe('running');
    expect(rc?.handles).toEqual([
      { vertexId: 'a', childId: 'child-a' },
      { vertexId: 'b', childId: 'child-b' },
    ]);
    expect(rc?.rootSessionId).toBe(ROOT_AGENT_ID);
    expect(rc?.concourse.edges).toEqual(service.get('demo').concourse.edges);
    expect(rc?.budget.remainingGlobal()).toBe(service.runtime('demo').budget.remainingGlobal());
  });

  it('全局预算按唤醒账域分配：never 不扣全局，live/replay 的余额与熔断全等', async () => {
    const clock = manualClock();
    const store = createMemoryStore();
    const ledger = new Ledger({
      now: clock.now,
      sink: (event: LedgerEvent) => store.append(event),
    });
    const substrate = new StubSubstrate();
    const service = new ConcourseService({ substrate, ledger, now: clock.now });
    const spec = {
      ...SAMPLE_SPEC,
      budget: { tokens: 1 },
      tasks: [],
      edges: [
        { from: 'lead', to: 'a', mode: 'notify', wake: 'never', hopTTL: 2 },
        { from: 'lead', to: 'b', mode: 'notify', wake: 'on-reply', hopTTL: 2 },
      ],
    };
    service.create(spec);
    service.submit('demo');
    await service.approve('demo', { id: ROOT_AGENT_ID });

    // 2-token never 超过全局额度仍投递；全局余额与熔断状态不变。
    expect(
      service.send('demo', { from: 'lead', to: 'a', content: 'never-one' }, { id: ROOT_AGENT_ID }),
    ).toMatchObject({ outcome: 'deliver', wake: 'never' });
    expect(service.runtime('demo').budget.remainingGlobal()).toBe(1);
    expect(service.runtime('demo').budget.isGlobalFused()).toBe(false);

    // 唤醒投递触发全局熔断。
    expect(
      service.send('demo', { from: 'lead', to: 'b', content: 'wake-fuse' }, { id: ROOT_AGENT_ID }),
    ).toMatchObject({ outcome: 'reject', reason: 'FUSE_GLOBAL' });
    expect(service.runtime('demo').budget.remainingGlobal()).toBe(1);
    expect(service.runtime('demo').budget.isGlobalFused()).toBe(true);

    // 熔断后 never 仍可投递，且不改变全局账。
    expect(
      service.send('demo', { from: 'lead', to: 'a', content: 'never-two' }, { id: ROOT_AGENT_ID }),
    ).toMatchObject({ outcome: 'deliver', wake: 'never' });
    expect(service.runtime('demo').budget.remainingGlobal()).toBe(1);
    expect(service.runtime('demo').budget.isGlobalFused()).toBe(true);

    const events = store.load();
    expect(
      ledger
        .query({ kind: 'budget', action: 'consume' })
        .map((event) => event.detail['consumeGlobal']),
    ).toEqual([false, true, false]);

    const revived = replay(events).concourses[0];
    const liveBudget = service.runtime('demo').budget;
    expect(revived?.budget.remainingGlobal()).toBe(liveBudget.remainingGlobal());
    expect(revived?.budget.isGlobalFused()).toBe(liveBudget.isGlobalFused());
    expect(revived?.budget.remainingEdge('lead', 'a')).toBe(
      liveBudget.remainingEdge('lead', 'a'),
    );
  });

  it('旧 budget.consume 缺 consumeGlobal 时按旧口径计入全局账', () => {
    const oldEvents: LedgerEvent[] = [
      {
        seq: 1,
        at: 1,
        concourseId: 'old',
        kind: 'lifecycle',
        action: 'create',
        detail: {
          concourse: {
            ...SAMPLE_SPEC,
            id: 'old',
            budget: { tokens: 10 },
            edges: [{ from: 'lead', to: 'a', mode: 'notify', wake: 'never', hopTTL: 2 }],
          },
        },
      },
      {
        seq: 2,
        at: 2,
        concourseId: 'old',
        kind: 'budget',
        action: 'consume',
        detail: { from: 'lead', to: 'a', tokens: 3, result: 'ok' },
      },
    ];
    const revived = replay(oldEvents).concourses[0];
    expect(revived?.budget.remainingGlobal()).toBe(7);
    expect(revived?.budget.isGlobalFused()).toBe(false);
  });
});