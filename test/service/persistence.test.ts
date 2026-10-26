/**
 * service/persistence 测试 —— JSONL 追加日志 + 启动回放（NFR-4，MVP 极简口径）。
 *
 * round-trip：操作序列 → 落盘 → 重放 → 状态等价；
 * 模拟重启后续跑：approve 之后 archive，重放再 list。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createJsonlStore,
  createMemoryStore,
  replay,
} from '../../src/service/persistence.js';
import { ConcourseService } from '../../src/service/concourse.js';
import { Ledger, type LedgerEvent } from '../../src/service/ledger.js';
import { parseConcourse, type ConcourseInput } from '../../src/kernel/topology/schema.js';
import { StubSubstrate, fakeClock } from './helpers.js';

function t1aInput(): ConcourseInput {
  return {
    id: 'c-persist',
    tier: 'T1a',
    vertices: [
      { id: 'captain', origin: 'self' },
      { id: 'w-1', parent: 'captain', layer: 1 },
    ],
    edges: [{ from: 'captain', to: 'w-1' }],
    tasks: [{ id: 't1', subject: '写周报', assignee: 'w-1' }],
  };
}

/** 建一个以 sink 接线 store 的 service（台账事件即持久化事件流）。 */
function makeWiredService(store: { append: (e: LedgerEvent) => void }) {
  const ledger = new Ledger({ now: fakeClock(), sink: (e) => store.append(e) });
  const substrate = new StubSubstrate();
  const service = new ConcourseService({ substrate, ledger, now: fakeClock() });
  return { service, ledger, substrate };
}

describe('createMemoryStore / createJsonlStore 同构接口', () => {
  it('memory store：append 后 load 全量返回', () => {
    const store = createMemoryStore();
    const e: LedgerEvent = { seq: 1, at: 1000, concourseId: 'c', kind: 'lifecycle', action: 'create', detail: {} };
    store.append(e);
    store.append({ ...e, seq: 2, action: 'submit' });
    expect(store.load()).toHaveLength(2);
    expect(store.load()[1]?.action).toBe('submit');
  });

  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('jsonl store：父目录不存在时按需创建（storagePath 是文件路径）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'concourse-persist-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'deeper', 'events.jsonl');
    const store = createJsonlStore(path);
    store.append({ seq: 1, at: 1, concourseId: 'c', kind: 'lifecycle', action: 'create', detail: {} });
    expect(store.load()).toHaveLength(1);
  });

  it('jsonl store：追加写盘 + load 回放；文件不存在 → 空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'concourse-persist-'));
    dirs.push(dir);
    const path = join(dir, 'events.jsonl');
    const store = createJsonlStore(path);
    expect(store.load()).toEqual([]);
    const e: LedgerEvent = { seq: 1, at: 1, concourseId: 'c', kind: 'comm', action: 'deliver', detail: { from: 'a', to: 'b' } };
    store.append(e);
    store.append({ ...e, seq: 2 });
    // 新实例读同一文件（模拟另一进程）
    const store2 = createJsonlStore(path);
    const loaded = store2.load();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(e);
  });
});

describe('replay：纯函数重建状态', () => {
  it('操作序列 → 事件流 → replay → 生命周期 + 顶点句柄等价', async () => {
    const store = createMemoryStore();
    const { service } = makeWiredService(store);
    service.create(t1aInput());
    service.submit('c-persist');
    const handles = await service.approve('c-persist', null);

    const state = replay(store.load());
    expect(state.concourses).toHaveLength(1);
    const rc = state.concourses[0]!;
    expect(rc.status).toBe('running');
    expect(rc.concourse.id).toBe('c-persist');
    expect(rc.handles).toEqual(handles);
    // 预算台账重建：边 captain->w-1 无预算登记，仅全局账（回填估算）
    expect(rc.budget.remainingGlobal()).toBe(rc.concourse.budget?.tokens ?? 0);
  });

  it('budget consume 事件回放后预算台账等价', () => {
    const c = parseConcourse({
      id: 'c-b',
      tier: 'T1a',
      budget: { tokens: 100 },
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', budget: { tokens: 40 } }],
    });
    const events: LedgerEvent[] = [
      { seq: 1, at: 1, concourseId: 'c-b', kind: 'lifecycle', action: 'create', detail: { concourse: c } },
      { seq: 2, at: 2, concourseId: 'c-b', kind: 'budget', action: 'consume', detail: { from: 'a', to: 'b', tokens: 15, result: 'ok' } },
    ];
    const state = replay(events);
    const rc = state.concourses[0]!;
    expect(rc.budget.remainingEdge('a', 'b')).toBe(25);
    expect(rc.budget.remainingGlobal()).toBe(85);
  });
});

describe('改边后的预算回放等价', () => {
  it('预算边 close/open 后 live 与 replay 的 remaining/fuse/后续 consume 完全一致', async () => {
    const store = createMemoryStore();
    const { service, ledger, substrate } = makeWiredService(store);
    service.create({
      id: 'c-edge-budget',
      tier: 'T1a',
      budget: { tokens: 200 },
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'a', layer: 1 },
      ],
      edges: [{ from: 'a', to: 'b', wake: 'on-reply', budget: { tokens: 40 } }],
    });
    service.submit('c-edge-budget');
    await service.approve('c-edge-budget', { id: 'root' });

    const first = service.send(
      'c-edge-budget',
      { from: 'a', to: 'b', content: '12345678' }, // 2 tokens
      { id: 'root' },
    );
    expect(first.outcome).toBe('deliver');
    expect(service.runtime('c-edge-budget').budget.remainingEdge('a', 'b')).toBe(38);

    service.link('c-edge-budget', { from: 'a', to: 'b', action: 'close' });
    service.link('c-edge-budget', {
      from: 'a',
      to: 'b',
      action: 'open',
      wake: 'on-reply',
    });
    expect(service.runtime('c-edge-budget').budget.remainingEdge('a', 'b')).toBeUndefined();

    // 40 tokens：live 重开后该边无预算，只能走全局账；replay 若保留旧边预算会误判 FUSE_EDGE。
    const second = service.send(
      'c-edge-budget',
      { from: 'a', to: 'b', content: 'x'.repeat(160) },
      { id: 'root' },
    );
    expect(second.outcome).toBe('deliver');
    expect(service.runtime('c-edge-budget').budget.remainingGlobal()).toBe(158);

    const state = replay(store.load());
    const revived = new ConcourseService({
      substrate,
      ledger: new Ledger({ snapshot: store.load() }),
      now: fakeClock(),
      snapshot: state,
    });
    const liveBudget = service.runtime('c-edge-budget').budget;
    const replayBudget = revived.runtime('c-edge-budget').budget;
    expect({
      edge: replayBudget.remainingEdge('a', 'b'),
      global: replayBudget.remainingGlobal(),
      fused: replayBudget.isFusedEdge('a', 'b'),
    }).toEqual({
      edge: liveBudget.remainingEdge('a', 'b'),
      global: liveBudget.remainingGlobal(),
      fused: liveBudget.isFusedEdge('a', 'b'),
    });
    expect(replayBudget.remainingGlobal()).toBe(158);
    expect(ledger.query({ kind: 'budget', action: 'consume' })).toHaveLength(2);
  });

  it('createdAt 跨 replay 保持 create 事件的时刻', () => {
    const store = createMemoryStore();
    const { service } = makeWiredService(store);
    const created = service.create(t1aInput());
    expect(created.createdAt).toBe(1000);
    const revived = new ConcourseService({
      substrate: new StubSubstrate(),
      ledger: new Ledger({ snapshot: store.load() }),
      now: fakeClock(),
      snapshot: replay(store.load()),
    });
    expect(revived.get('c-persist').createdAt).toBe(created.createdAt);
  });
});

describe('改边后的熔断状态恢复', () => {
  it('熔断边 close→open 后清除 fuse，live 与 replay 均可恢复投递', async () => {
    const store = createMemoryStore();
    const { service, substrate } = makeWiredService(store);
    service.create({
      ...t1aInput(),
      edges: [
        {
          from: 'captain',
          to: 'w-1',
          mode: 'notify',
          wake: 'on-reply',
          hopTTL: 2,
          budget: { tokens: 1 },
        },
      ],
    });
    service.submit('c-persist');
    await service.approve('c-persist', { id: 'root' });

    expect(
      service.send('c-persist', { from: 'captain', to: 'w-1', content: '12345678' }, { id: 'root' }),
    ).toMatchObject({ outcome: 'reject', reason: 'FUSE_EDGE' });
    expect(service.runtime('c-persist').budget.isFusedEdge('captain', 'w-1')).toBe(true);

    service.link('c-persist', { from: 'captain', to: 'w-1', action: 'close' });
    service.link('c-persist', { from: 'captain', to: 'w-1', action: 'open' });
    expect(service.runtime('c-persist').budget.remainingEdge('captain', 'w-1')).toBeUndefined();
    expect(service.runtime('c-persist').budget.isFusedEdge('captain', 'w-1')).toBe(false);
    expect(
      service.send('c-persist', { from: 'captain', to: 'w-1', content: 'abcdefgh' }, { id: 'root' }),
    ).toMatchObject({ outcome: 'deliver' });

    const revived = new ConcourseService({
      substrate,
      ledger: new Ledger({ snapshot: store.load() }),
      now: fakeClock(),
      snapshot: replay(store.load()),
    });
    expect(revived.runtime('c-persist').budget.isFusedEdge('captain', 'w-1')).toBe(false);
    expect(
      revived.send('c-persist', { from: 'captain', to: 'w-1', content: 'after-restart' }, { id: 'root' }),
    ).toMatchObject({ outcome: 'deliver' });
  });
});

describe('模拟重启后续跑', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('approve 后落盘 → 重启（replay 注入新 service）→ archive → 重放再 list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'concourse-restart-'));
    dirs.push(dir);
    const path = join(dir, 'events.jsonl');

    // 第一世：create → submit → approve，落盘
    const store1 = createJsonlStore(path);
    const gen1 = makeWiredService(store1);
    gen1.service.create(t1aInput());
    gen1.service.submit('c-persist');
    await gen1.service.approve('c-persist', null);

    // 重启：新 service 从 replay(落盘事件) 恢复
    const store2 = createJsonlStore(path);
    const state = replay(store2.load());
    const gen2 = makeWiredService(store2);
    const revived = new ConcourseService({
      substrate: gen2.substrate,
      ledger: gen2.ledger,
      now: fakeClock(),
      snapshot: state,
    });
    expect(revived.list().map((r) => [r.concourse.id, r.status])).toEqual([['c-persist', 'running']]);

    // 重启后续跑：archive
    revived.archive('c-persist');
    expect(revived.get('c-persist').status).toBe('archived');
    // 已拉起的句柄在新 substrate 上被 interrupt（尽力而为）
    expect(gen2.substrate.interrupted).toEqual(['w-1']);

    // 再次重放：archived 稳定重建
    const state2 = replay(createJsonlStore(path).load());
    expect(state2.concourses[0]?.status).toBe('archived');
    expect(state2.concourses[0]?.handles).toHaveLength(1); // self 顶点不拉起，仅 w-1 有句柄
  });

  it('空事件流 replay → 空状态', () => {
    expect(replay([]).concourses).toEqual([]);
  });
});
