/**
 * service/ledger —— 决策台账 + 通信流水 + 回声计数（FR-4.7 / FR-5.E1）。
 *
 * 设计口径：
 *  · append-only 内存结构；seq/at 由台账统一盖章（时钟注入，测试确定性）；
 *  · 可选注入 sink：每事件回调，persistence 层借此接线落盘（台账是事件源）；
 *  · echoCounts 四指标：投递数 / 拒收数 / 降级数 / 熔断数（按 concourseId 聚合）；
 *  · requestedVsEffective：顶点拉起时的请求档位与生效档位对照——
 *    requested=null ↔ effective='inherit'，inherit_ratio=100% 时亦可辨。
 */
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
}

export class Ledger {
  private readonly events: LedgerEvent[] = [];
  private readonly now: () => number;
  private readonly sink: LedgerSink | undefined;
  private seq = 0;

  constructor(opts: LedgerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.sink = opts.sink;
  }

  /** 追加事件：盖 seq/at 章后入库并回调 sink。 */
  append(input: LedgerEventInput): LedgerEvent {
    this.seq += 1;
    const event: LedgerEvent = { ...input, seq: this.seq, at: this.now() };
    this.events.push(event);
    this.sink?.(event);
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
   * 顶点拉起时的请求档位 vs 生效档位对照（取该顶点最近一次 vertex-start 事件）。
   * 未拉起过的顶点返回 undefined。
   */
  requestedVsEffective(vertexId: string): RequestedVsEffective | undefined {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i];
      if (e === undefined || e.action !== 'vertex-start') continue;
      if (e.detail['vertexId'] !== vertexId) continue;
      return {
        requested: e.detail['requested'] as RequestedVsEffective['requested'],
        effective: e.detail['effective'] as RequestedVsEffective['effective'],
      };
    }
    return undefined;
  }

  /**
   * 回声计数（FR-5.E1）：投递 / 拒收 / 降级 / 熔断。
   * 数据源为 kind='comm' 事件；fused 统计 reason 为 FUSE_EDGE / FUSE_GLOBAL 的拒收。
   * 不传 concourseId 时全量聚合。
   */
  echoCounts(concourseId?: string): EchoCounts {
    let delivered = 0;
    let rejected = 0;
    let degraded = 0;
    let fused = 0;
    for (const e of this.events) {
      if (e.kind !== 'comm') continue;
      if (concourseId !== undefined && e.concourseId !== concourseId) continue;
      if (e.action === 'deliver') delivered += 1;
      else if (e.action === 'reject') {
        rejected += 1;
        const reason = e.detail['reason'];
        if (reason === 'FUSE_EDGE' || reason === 'FUSE_GLOBAL') fused += 1;
      } else if (e.action === 'degrade') degraded += 1;
    }
    return { delivered, rejected, degraded, fused };
  }
}
