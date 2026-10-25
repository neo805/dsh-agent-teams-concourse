/**
 * service/ledger —— 决策台账 + 通信流水 + 回声计数（FR-4.7 / FR-5.E1）。
 *
 * 设计口径：
 *  · append-only 内存结构；seq/at 由台账统一盖章（时钟注入，测试确定性）；
 *  · 可选注入 sink：每事件回调，persistence 层借此接线落盘（台账是事件源）；
 *  · echoCounts 四指标：投递数 / 拒收数 / 降级数 / 熔断数（按 concourseId 增量聚合）；
 *  · requestedVsEffective：顶点拉起时的请求档位与生效档位对照——
 *    requested=null ↔ effective='inherit'，inherit_ratio=100% 时亦可辨。
 */
import { encodeTuple } from '../kernel/keys.js';

export type LedgerKind = 'lifecycle' | 'comm' | 'budget';

/** 台账事件（append-only；seq 单调递增，at 为注入时钟读数）。 */
export interface LedgerEvent {
  readonly seq: number;
  readonly at: number;
  readonly concourseId: string;
  readonly kind: LedgerKind;
  readonly action: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** append 的输入：seq/at 由台账盖章。 */
export type LedgerEventInput = Omit<LedgerEvent, 'seq' | 'at'>;

/** 每事件回调（persistence 接线点）。 */
export type LedgerSink = (event: LedgerEvent) => void;

export interface LedgerQuery {
  readonly kind?: LedgerKind;
  readonly concourseId?: string;
  readonly action?: string;
  /** 时间窗下界（闭区间，注入时钟读数）。 */
  readonly sinceMs?: number;
  /** 时间窗上界（闭区间）。 */
  readonly untilMs?: number;
}

/** 回声计数四指标（FR-5.E1）。 */
export interface EchoCounts {
  readonly delivered: number;
  readonly rejected: number;
  readonly degraded: number;
  readonly fused: number;
}

/** 顶点定档对照：requested 为 spec 声明（null=未声明），effective 为实际生效。 */
export interface RequestedVsEffective {
  readonly requested: { readonly model: string | null; readonly reasoningEffort: string | null };
  readonly effective: { readonly model: string; readonly reasoningEffort: string };
}

export interface LedgerOptions {
  readonly now?: () => number;
  readonly sink?: LedgerSink;
  /** 启动回放：恢复事件、查询投影与 seq（不会重复写 sink）。 */
  readonly snapshot?: readonly LedgerEvent[];
}

interface MutableEcho {
  delivered: number;
  rejected: number;
  degraded: number;
  fused: number;
}

export class Ledger {
  private readonly events: LedgerEvent[];
  private readonly now: () => number;
  private readonly sink: LedgerSink | undefined;
  private seq: number;
  /** 派生投影：事件仍是唯一权威，索引只加速状态查询。 */
  private readonly echoByConcourse = new Map<string, MutableEcho>();
  private readonly echoAll: MutableEcho = { delivered: 0, rejected: 0, degraded: 0, fused: 0 };
  private readonly latestVertexStart = new Map<string, RequestedVsEffective>();

  constructor(opts: LedgerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.sink = opts.sink;
    this.events = [...structuredClone(opts.snapshot ?? [])];
    this.seq = this.events.reduce((max, event) => Math.max(max, event.seq), 0);
    for (const event of this.events) this.indexDerived(event);
  }

  /**
   * 追加事件：先写 sink，成功后才发布到内存并推进 seq。
   * 写盘失败时 Ledger 保持不变，避免“调用报错但内存已提交”。
   */
  append(input: LedgerEventInput): LedgerEvent {
    const nextSeq = this.seq + 1;
    const event: LedgerEvent = {
      ...structuredClone(input),
      seq: nextSeq,
      at: this.now(),
    };
    this.sink?.(event);
    this.events.push(event);
    this.seq = nextSeq;
    this.indexDerived(event);
    return event;
  }

  /** 全量事件（只读快照副本）。 */
  all(): readonly LedgerEvent[] {
    return [...this.events];
  }

  /** 按 kind / concourseId / action / 时间窗过滤（全部条件 AND）。 */
  query(q: LedgerQuery): LedgerEvent[] {
    return this.events.filter((e) => {
      if (q.kind !== undefined && e.kind !== q.kind) return false;
      if (q.concourseId !== undefined && e.concourseId !== q.concourseId) return false;
      if (q.action !== undefined && e.action !== q.action) return false;
      if (q.sinceMs !== undefined && e.at < q.sinceMs) return false;
      if (q.untilMs !== undefined && e.at > q.untilMs) return false;
      return true;
    });
  }

  /**
   * 顶点拉起时的请求档位 vs 生效档位对照（按 concourseId + vertexId 取最近一次）。
   * vertexId 只在单个 concourse 内唯一；未拉起过的顶点返回 undefined。
   */
  requestedVsEffective(
    concourseId: string,
    vertexId: string,
  ): RequestedVsEffective | undefined {
    return this.latestVertexStart.get(encodeTuple([concourseId, vertexId]));
  }

  /**
   * 回声计数（FR-5.E1）：投递 / 拒收 / 降级 / 熔断。
   * 数据源为 kind='comm' 事件；fused 统计 reason 为 FUSE_EDGE / FUSE_GLOBAL 的拒收。
   * 不传 concourseId 时全量聚合。
   */
  echoCounts(concourseId?: string): EchoCounts {
    const counts =
      concourseId === undefined ? this.echoAll : this.echoByConcourse.get(concourseId);
    if (counts === undefined) return { delivered: 0, rejected: 0, degraded: 0, fused: 0 };
    return {
      delivered: counts.delivered,
      rejected: counts.rejected,
      degraded: counts.degraded,
      fused: counts.fused,
    };
  }

  /** 维护派生投影；只在 append/构造快照时执行，查询不再扫全事件。 */
  private indexDerived(e: LedgerEvent): void {
    if (e.kind === 'lifecycle' && e.action === 'vertex-start') {
      const vertexId = e.detail['vertexId'];
      if (typeof vertexId === 'string') {
        this.latestVertexStart.set(encodeTuple([e.concourseId, vertexId]), {
          requested: e.detail['requested'] as RequestedVsEffective['requested'],
          effective: e.detail['effective'] as RequestedVsEffective['effective'],
        });
      }
      return;
    }
    if (e.kind !== 'comm') return;

    const byConcourse = this.getEcho(e.concourseId);
    if (e.action === 'deliver') {
      byConcourse.delivered += 1;
      this.echoAll.delivered += 1;
    } else if (e.action === 'reject') {
      byConcourse.rejected += 1;
      this.echoAll.rejected += 1;
      const reason = e.detail['reason'];
      if (reason === 'FUSE_EDGE' || reason === 'FUSE_GLOBAL') {
        byConcourse.fused += 1;
        this.echoAll.fused += 1;
      }
    } else if (e.action === 'degrade') {
      byConcourse.degraded += 1;
      this.echoAll.degraded += 1;
    }
  }

  private getEcho(concourseId: string): MutableEcho {
    let counts = this.echoByConcourse.get(concourseId);
    if (counts === undefined) {
      counts = { delivered: 0, rejected: 0, degraded: 0, fused: 0 };
      this.echoByConcourse.set(concourseId, counts);
    }
    return counts;
  }
}
