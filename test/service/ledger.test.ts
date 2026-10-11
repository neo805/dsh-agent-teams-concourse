/**
 * service/ledger 测试 —— 决策台账 + 通信流水 + 回声计数（FR-4.7 / FR-5.E1）。
 *
 * 口径：append-only；seq/at 由台账盖章（注入时钟）；sink 每事件回调；
 * echoCounts 四指标（投递/拒收/降级/熔断，按 concourseId 聚合）；
 * requestedVsEffective 在 inherit_ratio=100% 时可辨（requested=null ↔ effective='inherit'）。
 */
import { describe, expect, it } from 'vitest';
import { Ledger, type LedgerEvent } from '../../src/service/ledger.js';
import { fakeClock } from './helpers.js';

describe('Ledger.append', () => {
  it('追加事件并盖 seq/at 章（注入时钟，确定性）', () => {
    const ledger = new Ledger({ now: fakeClock() });
    const e1 = ledger.append({ concourseId: 'c1', kind: 'lifecycle', action: 'create', detail: {} });
    const e2 = ledger.append({ concourseId: 'c1', kind: 'comm', action: 'deliver', detail: {} });
    expect(e1.seq).toBe(1);
    expect(e1.at).toBe(1000);
    expect(e2.seq).toBe(2);
    expect(e2.at).toBe(2000);
    expect(ledger.all()).toHaveLength(2);
  });

  it('sink 每事件回调（persistence 接线点）', () => {
    const seen: LedgerEvent[] = [];
    const ledger = new Ledger({ now: fakeClock(), sink: (e) => seen.push(e) });
    ledger.append({ concourseId: 'c1', kind: 'lifecycle', action: 'create', detail: {} });
    ledger.append({ concourseId: 'c1', kind: 'comm', action: 'reject', detail: { reason: 'EDGE_CLOSED' } });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.action).toBe('reject');
  });

  it('append-only：all() 返回的数组不可写穿台账', () => {
    const ledger = new Ledger({ now: fakeClock() });
    ledger.append({ concourseId: 'c1', kind: 'lifecycle', action: 'create', detail: {} });
    const snapshot = ledger.all();
    expect(snapshot).toHaveLength(1);
    // 台账自身不受外部持有快照影响（再追加后旧快照不变）
    ledger.append({ concourseId: 'c1', kind: 'lifecycle', action: 'submit', detail: {} });
    expect(snapshot).toHaveLength(1);
    expect(ledger.all()).toHaveLength(2);
  });
});

describe('Ledger.query', () => {
  it('按 kind / concourseId / 时间窗过滤', () => {
    let t = 0;
    const ledger = new Ledger({ now: () => t });
    t = 10;
    ledger.append({ concourseId: 'a', kind: 'lifecycle', action: 'create', detail: {} });
    t = 20;
    ledger.append({ concourseId: 'a', kind: 'comm', action: 'deliver', detail: {} });
    t = 30;
    ledger.append({ concourseId: 'b', kind: 'comm', action: 'reject', detail: {} });
    t = 40;
    ledger.append({ concourseId: 'a', kind: 'comm', action: 'degrade', detail: {} });

    expect(ledger.query({ kind: 'comm' })).toHaveLength(3);
    expect(ledger.query({ concourseId: 'a' })).toHaveLength(3);
    expect(ledger.query({ concourseId: 'a', kind: 'comm' })).toHaveLength(2);
    // 时间窗 [sinceMs, untilMs] 闭区间
    expect(ledger.query({ sinceMs: 20, untilMs: 30 })).toHaveLength(2);
    expect(ledger.query({ sinceMs: 30 })).toHaveLength(2);
    expect(ledger.query({ untilMs: 20 })).toHaveLength(2);
    expect(ledger.query({ kind: 'comm', concourseId: 'a', sinceMs: 40 })).toHaveLength(1);
  });
});

describe('Ledger.requestedVsEffective', () => {
  it('返回请求档位与生效档位对照；inherit_ratio=100% 时可辨', () => {
    const ledger = new Ledger({ now: fakeClock() });
    // 顶点显式定档
    ledger.append({
      concourseId: 'c1',
      kind: 'lifecycle',
      action: 'vertex-start',
      detail: {
        vertexId: 'w-1',
        requested: { model: 'kimi-k3', reasoningEffort: 'high' },
        effective: { model: 'kimi-k3', reasoningEffort: 'high' },
      },
    });
    // 顶点全继承（inherit_ratio=100%）
    ledger.append({
      concourseId: 'c1',
      kind: 'lifecycle',
      action: 'vertex-start',
      detail: {
        vertexId: 'w-2',
        requested: { model: null, reasoningEffort: null },
        effective: { model: 'inherit', reasoningEffort: 'inherit' },
      },
    });

    const rve1 = ledger.requestedVsEffective('w-1');
    expect(rve1?.requested).toEqual({ model: 'kimi-k3', reasoningEffort: 'high' });
    expect(rve1?.effective).toEqual({ model: 'kimi-k3', reasoningEffort: 'high' });

    const rve2 = ledger.requestedVsEffective('w-2');
    expect(rve2?.requested).toEqual({ model: null, reasoningEffort: null });
    expect(rve2?.effective).toEqual({ model: 'inherit', reasoningEffort: 'inherit' });

    expect(ledger.requestedVsEffective('ghost')).toBeUndefined();
  });
});

describe('Ledger.echoCounts', () => {
  it('四指标按 concourseId 聚合：投递/拒收/降级/熔断', () => {
    const ledger = new Ledger({ now: fakeClock() });
    const comm = (concourseId: string, action: string, detail: Record<string, unknown> = {}) =>
      ledger.append({ concourseId, kind: 'comm', action, detail });

    comm('c1', 'deliver');
    comm('c1', 'deliver');
    comm('c1', 'reject', { reason: 'EDGE_CLOSED' });
    comm('c1', 'reject', { reason: 'FUSE_EDGE' });
    comm('c1', 'degrade', { reason: 'RATE_LIMIT' });
    comm('c2', 'deliver');
    comm('c2', 'reject', { reason: 'FUSE_GLOBAL' });
    // 生命周期事件不计入回声指标
    ledger.append({ concourseId: 'c1', kind: 'lifecycle', action: 'create', detail: {} });

    expect(ledger.echoCounts('c1')).toEqual({ delivered: 2, rejected: 2, degraded: 1, fused: 1 });
    expect(ledger.echoCounts('c2')).toEqual({ delivered: 1, rejected: 1, degraded: 0, fused: 1 });
    // 不传 concourseId = 全局聚合
    expect(ledger.echoCounts()).toEqual({ delivered: 3, rejected: 3, degraded: 1, fused: 2 });
    expect(ledger.echoCounts('ghost')).toEqual({ delivered: 0, rejected: 0, degraded: 0, fused: 0 });
  });
});
