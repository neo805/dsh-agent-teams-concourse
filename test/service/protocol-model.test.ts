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
import { StubSubstrate, fakeClock, manualClock } from './helpers.js';
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
});