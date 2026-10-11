/**
 * service/inbox-gate —— 收件箱准入（权威判定，NFR-9 第②层）。
 *
 * 管线（顺序固定，前一环不过即短路）：
 *   gate（开放边集 deny-by-default）→ hop（跳数 TTL）→ dedup（幂等去重）
 *   → rate（速率降级）→ budget（预算熔断）
 *
 * 权威语义：与发送方解耦——伪造「官方 send_message 直发」的入站消息
 * 走完全相同的判定路径（判定只看 from/to/内容/跳数，不认任何路由元信息）。
 * 全部拒绝与降级必须写台账留痕（FR-5.E2）；deliver 同样记录（回声计数数据源）。
 * board 广播只入共享板不唤醒：deliver 时 wake 恒为 never。
 */
import { admit } from '../kernel/comms/gate.js';
import { checkHop } from '../kernel/comms/hop.js';
import { DedupStore, dedupKey } from '../kernel/comms/dedup.js';
import { RateLimiter } from '../kernel/comms/rate.js';
import { BudgetBook } from '../kernel/comms/budget.js';
import type { Concourse, EdgeMode, Wake } from '../kernel/topology/schema.js';
import type { Ledger } from './ledger.js';

/** 单个 concourse 的通信运行时状态（service 持有，随生命周期存活）。 */
export interface ConcourseRuntime {
  readonly concourse: Concourse;
  readonly dedup: DedupStore;
  /** edgeKey（from->to）→ 限流器；仅为声明了 rate 的边创建。 */
  readonly rate: ReadonlyMap<string, RateLimiter>;
  readonly budget: BudgetBook;
}

/** 由 concourse 定义构建通信运行时（边预算/全局预算/速率声明接线）。 */
export function createRuntime(concourse: Concourse, deps: { now?: () => number } = {}): ConcourseRuntime {
  const now = deps.now ?? (() => Date.now());
  const edgeBudgets: Record<string, number> = {};
  const rate = new Map<string, RateLimiter>();
  for (const e of concourse.edges) {
    const key = BudgetBook.edgeKey(e.from, e.to);
    if (e.budget?.tokens !== undefined) edgeBudgets[key] = e.budget.tokens;
    if (e.rate !== undefined) rate.set(key, new RateLimiter(e.rate, now));
  }
  const budget = new BudgetBook({
    edgeBudgets,
    ...(concourse.budget?.tokens !== undefined ? { globalBudget: concourse.budget.tokens } : {}),
  });
  return { concourse, dedup: new DedupStore(), rate, budget };
}

/** 入站消息（与发送方解耦：不含任何可信路由元信息）。 */
export interface InboundMessage {
  readonly from: string;
  readonly to: string;
  readonly content: string;
  readonly correlationId?: string;
  /** 当前跳数（第 1 跳 = 1，缺省按 1）。 */
  readonly hops?: number;
}

export type RejectReason = 'EDGE_CLOSED' | 'HOP_LIMIT' | 'DUPLICATE' | 'FUSE_EDGE' | 'FUSE_GLOBAL';

/** 统一 typed outcome：deliver / reject:reason / degrade。 */
export type AdmitOutcome =
  | { readonly kind: 'deliver'; readonly mode: EdgeMode; readonly wake: Wake }
  | { readonly kind: 'reject'; readonly reason: RejectReason; readonly candidates?: readonly string[] }
  | { readonly kind: 'degrade'; readonly reason: 'RATE_LIMIT' };

export interface AdmitDeps {
  readonly ledger?: Ledger;
  readonly now?: () => number;
}

/**
 * 消息 token 估算（估算口径，非计费）：max(1, ceil(len/4))。
 * 确定性启发式，与 kernel/budget/tokens 同属估算族。
 */
export function estimateMessageTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

/**
 * 收件箱准入权威判定。任一环节拒绝/降级 → 统一 typed outcome + 台账留痕。
 */
export function admitInbound(
  rt: ConcourseRuntime,
  msg: InboundMessage,
  deps: AdmitDeps = {},
): AdmitOutcome {
  const ledger = deps.ledger;
  const concourseId = rt.concourse.id;
  const reject = (reason: RejectReason, candidates?: readonly string[]): AdmitOutcome => {
    ledger?.append({
      concourseId,
      kind: 'comm',
      action: 'reject',
      detail: {
        from: msg.from,
        to: msg.to,
        reason,
        ...(candidates !== undefined ? { candidates: [...candidates] } : {}),
      },
    });
    return { kind: 'reject', reason, ...(candidates !== undefined ? { candidates } : {}) };
  };

  // ① gate：开放边集（deny-by-default；伪造直发同路径）
  const gate = admit(rt.concourse.edges, { from: msg.from, to: msg.to });
  if (gate.verdict === 'reject') return reject('EDGE_CLOSED', gate.candidates);
  const edge = gate.edge;

  // ② hop：跳数 TTL（hops > hopTTL 只记录不投递）
  const hop = checkHop(msg.hops ?? 1, edge);
  if (hop.verdict === 'record-only') return reject('HOP_LIMIT');

  // ③ dedup：幂等去重（重放/回环拦截）
  const key = dedupKey({
    from: msg.from,
    to: msg.to,
    ...(msg.correlationId !== undefined ? { correlationId: msg.correlationId } : {}),
    content: msg.content,
  });
  if (rt.dedup.record(key).duplicate) return reject('DUPLICATE');

  // ④ rate：速率降级（削峰不丢消息；降级也盖章——check 本身已计入窗口）
  const limiter = rt.rate.get(BudgetBook.edgeKey(msg.from, msg.to));
  if (limiter !== undefined && limiter.check() === 'degrade') {
    ledger?.append({
      concourseId,
      kind: 'comm',
      action: 'degrade',
      detail: { from: msg.from, to: msg.to, reason: 'RATE_LIMIT' },
    });
    return { kind: 'degrade', reason: 'RATE_LIMIT' };
  }

  // ⑤ budget：预算熔断（D1 边 / D2 全局；消费流水写 budget 台账供回放）
  const tokens = estimateMessageTokens(msg.content);
  const consumed = rt.budget.consumeEdge(msg.from, msg.to, tokens);
  ledger?.append({
    concourseId,
    kind: 'budget',
    action: 'consume',
    detail: { from: msg.from, to: msg.to, tokens, result: consumed },
  });
  if (consumed === 'fuse-edge') return reject('FUSE_EDGE');
  if (consumed === 'fuse-global') return reject('FUSE_GLOBAL');

  // deliver：board 广播只入共享板不唤醒（wake 恒 never）
  const wake: Wake = edge.mode === 'board' ? 'never' : edge.wake;
  ledger?.append({
    concourseId,
    kind: 'comm',
    action: 'deliver',
    detail: { from: msg.from, to: msg.to, mode: edge.mode, wake, tokens },
  });
  return { kind: 'deliver', mode: edge.mode, wake };
}
