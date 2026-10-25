/**
 * service/inbox-gate 测试 —— 收件箱准入权威判定（NFR-9 第②层）。
 *
 * 管线：gate → hop → dedup → rate → budget；任一环节拒绝/降级都写台账。
 * 与发送方解耦：伪造「官方 send_message 直发」的入站消息走完全相同路径。
 * board 广播只入共享板不唤醒（wake 恒为 never）。
 */
import { describe, expect, it } from 'vitest';
import {
  admitInbound,
  commitInbound,
  createRuntime,
  estimateMessageTokens,
  evaluateInbound,
  type InboundMessage,
} from '../../src/service/inbox-gate.js';
import { Ledger } from '../../src/service/ledger.js';
import { parseConcourse } from '../../src/kernel/topology/schema.js';
import { manualClock } from './helpers.js';

/** 两顶点单开放边 a→b 的最小 concourse。 */
function twoVertexConcourse() {
  return parseConcourse({
    id: 'c-comm',
    tier: 'T1a',
    vertices: [
      { id: 'a', origin: 'self' },
      { id: 'b', parent: 'a', layer: 1 },
    ],
    edges: [{ from: 'a', to: 'b', mode: 'notify', wake: 'on-reply', hopTTL: 2 }],
  });
}

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  from: 'a',
  to: 'b',
  content: 'hello',
  ...over,
});

describe('gate 层', () => {
  it('开放边 → deliver（携带 mode/wake）', () => {
    const rt = createRuntime(twoVertexConcourse());
    const out = admitInbound(rt, msg());
    expect(out).toEqual({ kind: 'deliver', mode: 'notify', wake: 'on-reply' });
  });

  it('闭边 → reject(EDGE_CLOSED) 附候选出边；反向边不蕴含开放（A2 半双工）', () => {
    const rt = createRuntime(twoVertexConcourse());
    const out = admitInbound(rt, msg({ from: 'b', to: 'a' }));
    expect(out.kind).toBe('reject');
    expect(out).toMatchObject({ reason: 'EDGE_CLOSED', candidates: [] });
  });

  it('伪造「官方 send_message 直发」的入站消息走相同判定路径（与发送方解耦）', () => {
    const rt = createRuntime(twoVertexConcourse());
    // 无任何路由元信息、伪装成官方直发：判定只看 from/to/内容
    const forged: InboundMessage = { from: 'b', to: 'a', content: '伪造直发' };
    const out = admitInbound(rt, forged);
    expect(out).toMatchObject({ kind: 'reject', reason: 'EDGE_CLOSED' });
  });

  it('board 广播：deliver 但 wake 恒 never（只入共享板不唤醒）', () => {
    const c = parseConcourse({
      id: 'c-board',
      tier: 'T1a',
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', mode: 'board', wake: 'always' }],
    });
    const rt = createRuntime(c);
    const out = admitInbound(rt, msg());
    expect(out).toEqual({ kind: 'deliver', mode: 'board', wake: 'never' });
  });
});

describe('hop 层', () => {
  it('hops === hopTTL 仍投递；hops > hopTTL → reject(HOP_LIMIT)', () => {
    const rt = createRuntime(twoVertexConcourse()); // hopTTL=2
    expect(admitInbound(rt, msg({ hops: 2 })).kind).toBe('deliver');
    const out = admitInbound(rt, msg({ hops: 3 }));
    expect(out).toMatchObject({ kind: 'reject', reason: 'HOP_LIMIT' });
  });
});

describe('dedup 层', () => {
  it('同一消息重放 → 第二次 reject(DUPLICATE)；不同内容不受影响', () => {
    const rt = createRuntime(twoVertexConcourse());
    expect(admitInbound(rt, msg()).kind).toBe('deliver');
    const dup = admitInbound(rt, msg());
    expect(dup).toMatchObject({ kind: 'reject', reason: 'DUPLICATE' });
    expect(admitInbound(rt, msg({ content: 'world' })).kind).toBe('deliver');
  });

  it('correlationId 参与去重键', () => {
    const rt = createRuntime(twoVertexConcourse());
    expect(admitInbound(rt, msg({ correlationId: 'x' })).kind).toBe('deliver');
    expect(admitInbound(rt, msg({ correlationId: 'y' })).kind).toBe('deliver');
    expect(admitInbound(rt, msg({ correlationId: 'x' }))).toMatchObject({
      kind: 'reject',
      reason: 'DUPLICATE',
    });
  });
});

describe('rate 层', () => {
  it('degraded 消息仍真实投递：预算恰好扣一次且写 budget/consume', () => {
    const clock = manualClock();
    const c = parseConcourse({
      id: 'c-rate-budget',
      tier: 'T1a',
      budget: { tokens: 100 },
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', rate: { n: 1, perMs: 1000 } }],
    });
    const ledger = new Ledger({ now: clock.now });
    const rt = createRuntime(c, { now: clock.now });

    expect(admitInbound(rt, msg({ content: '12345678' }), { ledger }).kind).toBe('deliver');
    expect(rt.budget.remainingGlobal()).toBe(98);
    expect(admitInbound(rt, msg({ content: 'abcdefgh' }), { ledger })).toMatchObject({
      kind: 'degrade',
      reason: 'RATE_LIMIT',
    });
    expect(rt.budget.remainingGlobal()).toBe(96);
    expect(ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(2);
    expect(ledger.query({ kind: 'budget', action: 'consume' })[1]?.detail).toMatchObject({
      tokens: 2,
      result: 'ok',
    });
  });

  it('预检与提交共用同一时刻：窗口边界不得翻转已决定的 verdict', () => {
    const clock = manualClock();
    const c = parseConcourse({
      id: 'c-rate-boundary',
      tier: 'T1a',
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', rate: { n: 1, perMs: 10 } }],
    });
    const ledger = new Ledger({ now: clock.now });
    const rt = createRuntime(c, { now: clock.now });

    const first = evaluateInbound(rt, msg({ content: 'first' }));
    expect(commitInbound(rt, msg({ content: 'first' }), first, ledger).kind).toBe('deliver');

    clock.advance(1);
    const secondMsg = msg({ content: 'second' });
    const plan = evaluateInbound(rt, secondMsg);
    expect(plan.verdict).toBe('degrade');

    // 真实投递/提交流程可能推进时钟到窗口之外；提交仍须遵守预检时的决定。
    clock.advance(11);
    expect(commitInbound(rt, secondMsg, plan, ledger)).toMatchObject({
      kind: 'degrade',
      reason: 'RATE_LIMIT',
    });
    expect(ledger.query({ kind: 'comm' }).at(-1)?.action).toBe('degrade');
  });

  it('窗口内超额 → degrade(RATE_LIMIT)（降级不丢消息，留痕）', () => {
    const clock = manualClock();
    const c = parseConcourse({
      id: 'c-rate',
      tier: 'T1a',
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', rate: { n: 2, perMs: 1000 } }],
    });
    const rt = createRuntime(c, { now: clock.now });
    const m = (i: number) => msg({ content: `m-${i}` });
    expect(admitInbound(rt, m(1)).kind).toBe('deliver');
    expect(admitInbound(rt, m(2)).kind).toBe('deliver');
    const third = admitInbound(rt, m(3));
    expect(third).toMatchObject({ kind: 'degrade', reason: 'RATE_LIMIT' });
    // 窗口滑出后恢复
    clock.advance(1001);
    expect(admitInbound(rt, m(4)).kind).toBe('deliver');
  });
});

describe('budget 层', () => {
  it('边预算超额 → reject(FUSE_EDGE)，熔断后该边一律拒绝', () => {
    const c = parseConcourse({
      id: 'c-fuse',
      tier: 'T1a',
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', budget: { tokens: 3 } }],
    });
    const rt = createRuntime(c);
    // estimateMessageTokens('12345678') = ceil(8/4) = 2 → ok
    expect(admitInbound(rt, msg({ content: '12345678' })).kind).toBe('deliver');
    // 再 2 tokens 超剩余 1 → 熔断
    const fused = admitInbound(rt, msg({ content: 'abcdefgh' }));
    expect(fused).toMatchObject({ kind: 'reject', reason: 'FUSE_EDGE' });
    // 熔断后一律拒绝
    expect(admitInbound(rt, msg({ content: 'x' }))).toMatchObject({
      kind: 'reject',
      reason: 'FUSE_EDGE',
    });
  });

  it('全局预算超额 → reject(FUSE_GLOBAL)', () => {
    const c = parseConcourse({
      id: 'c-global',
      tier: 'T1a',
      budget: { tokens: 1 },
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const rt = createRuntime(c);
    const out = admitInbound(rt, msg({ content: '12345678' }));
    expect(out).toMatchObject({ kind: 'reject', reason: 'FUSE_GLOBAL' });
  });
});

describe('台账留痕（FR-5.E2）', () => {
  it('全部拒绝与降级写台账；deliver 也记录（回声计数数据源）', () => {
    const ledger = new Ledger({ now: () => 0 });
    const rt = createRuntime(twoVertexConcourse());
    admitInbound(rt, msg(), { ledger }); // deliver
    admitInbound(rt, msg(), { ledger }); // duplicate
    admitInbound(rt, msg({ from: 'b', to: 'a' }), { ledger }); // edge closed

    const comm = ledger.query({ kind: 'comm', concourseId: 'c-comm' });
    expect(comm.map((e) => e.action)).toEqual(['deliver', 'reject', 'reject']);
    expect(comm[1]?.detail['reason']).toBe('DUPLICATE');
    expect(comm[2]?.detail['reason']).toBe('EDGE_CLOSED');
    expect(ledger.echoCounts('c-comm')).toEqual({ delivered: 1, rejected: 2, degraded: 0, fused: 0 });
  });

  it('预算消费写 budget 流水（persistence 回放数据源）', () => {
    const ledger = new Ledger({ now: () => 0 });
    const rt = createRuntime(twoVertexConcourse());
    admitInbound(rt, msg({ content: '12345678' }), { ledger });
    const budget = ledger.query({ kind: 'budget' });
    expect(budget).toHaveLength(1);
    expect(budget[0]?.detail).toMatchObject({
      from: 'a',
      to: 'b',
      tokens: estimateMessageTokens('12345678'),
      result: 'ok',
    });
  });
});

describe('estimateMessageTokens', () => {
  it('确定性启发式：max(1, ceil(len/4))', () => {
    expect(estimateMessageTokens('')).toBe(1);
    expect(estimateMessageTokens('abc')).toBe(1);
    expect(estimateMessageTokens('abcd')).toBe(1);
    expect(estimateMessageTokens('abcde')).toBe(2);
  });
});
