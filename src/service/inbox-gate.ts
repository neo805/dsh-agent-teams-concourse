/**
 * service/inbox-gate —— 收件箱准入（权威判定，NFR-9 第②层）。
 *
 * 两阶段：evaluateInbound 只读预检（闸门/跳数/去重/速率/预算），commitInbound
 * 在真实消息写入目标 inbox 之后才扣账并留痕。这样“投递失败”不会留下 deliver，
 * 也允许发送侧先决定是否唤醒目标而不提前消费预算。
 */
import { admit } from '../kernel/comms/gate.js';
import { checkHop } from '../kernel/comms/hop.js';
import { DedupStore, dedupKey } from '../kernel/comms/dedup.js';
import { RateLimiter } from '../kernel/comms/rate.js';
import { BudgetBook, budgetBookFromConcourse } from '../kernel/comms/budget.js';
import type { Concourse, EdgeMode, Wake } from '../kernel/topology/schema.js';
import type { Ledger } from './ledger.js';

/** 单个 concourse 的通信运行时状态（service 持有，随生命周期存活）。 */
export interface ConcourseRuntime {
  readonly concourse: Concourse;
  readonly dedup: DedupStore;
  /** edgeKey（from->to）→ 限流器；仅为声明了 rate 的边创建。 */
  readonly rate: ReadonlyMap<string, RateLimiter>;
  readonly budget: BudgetBook;
  /** 已由 team_send 提交、等待 pre-step 消费的准入票据。 */
  readonly admissions: Map<string, 'deliver' | 'degrade'>;
  /** 运行时时钟：准入预检与提交共用同一时间读数。 */
  readonly now: () => number;
}

/** 由 concourse 定义构建通信运行时（边预算/全局预算/速率声明接线）。 */
export function createRuntime(concourse: Concourse, deps: { now?: () => number } = {}): ConcourseRuntime {
  const now = deps.now ?? (() => Date.now());
  const rate = new Map<string, RateLimiter>();
  for (const e of concourse.edges) {
    if (e.rate !== undefined) {
      rate.set(BudgetBook.edgeKey(e.from, e.to), new RateLimiter(e.rate, now));
    }
  }
  return {
    concourse,
    dedup: new DedupStore(),
    rate,
    budget: budgetBookFromConcourse(concourse),
    admissions: new Map(),
    now,
  };
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

export type RejectReason =
  | 'EDGE_CLOSED'
  | 'HOP_LIMIT'
  | 'DUPLICATE'
  | 'FUSE_EDGE'
  | 'FUSE_GLOBAL'
  | 'UNKNOWN_VERTEX';

/** 统一 typed outcome：deliver / reject:reason / degrade。 */
export type AdmitOutcome =
  | { readonly kind: 'deliver'; readonly mode: EdgeMode; readonly wake: Wake }
  | { readonly kind: 'reject'; readonly reason: RejectReason; readonly candidates?: readonly string[] }
  | { readonly kind: 'degrade'; readonly reason: 'RATE_LIMIT' };

/** 无副作用预检结果；真实投递成功后再交给 commitInbound。 */
export interface AdmissionPlan {
  readonly verdict: 'deliver' | 'degrade' | 'reject';
  readonly reason?: RejectReason;
  readonly candidates?: readonly string[];
  readonly mode?: EdgeMode;
  readonly wake?: Wake;
  readonly tokens: number;
  readonly key: string;
  /** 预检时刻；提交必须沿用它记录限流窗口，不能重新翻转 verdict。 */
  readonly at: number;
}

export interface AdmitDeps {
  readonly ledger?: Ledger;
}

/**
 * 消息 token 估算（估算口径，非计费）：max(1, ceil(len/4))。
 * 确定性启发式，与 kernel/budget/tokens 同属估算族。
 */
export function estimateMessageTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function rejectPlan(
  reason: RejectReason,
  candidates: readonly string[] | undefined,
  at: number,
  tokens = 0,
  key = '',
): AdmissionPlan {
  return {
    verdict: 'reject',
    reason,
    ...(candidates !== undefined ? { candidates } : {}),
    tokens,
    key,
    at,
  };
}

/** 只读准入预检：不写台账、不扣预算、不消耗去重/速率窗口。 */
export function evaluateInbound(rt: ConcourseRuntime, msg: InboundMessage): AdmissionPlan {
  // 一次预检只读一次时钟；commit 沿用 plan.at，避免窗口边界翻转已执行的 verdict。
  const at = rt.now();
  const gate = admit(rt.concourse.edges, { from: msg.from, to: msg.to });
  if (gate.verdict === 'reject') return rejectPlan('EDGE_CLOSED', gate.candidates, at);
  const edge = gate.edge;

  const hop = checkHop(msg.hops ?? 1, edge);
  if (hop.verdict === 'record-only') return rejectPlan('HOP_LIMIT', undefined, at);

  const key = dedupKey({
    from: msg.from,
    to: msg.to,
    ...(msg.correlationId !== undefined ? { correlationId: msg.correlationId } : {}),
    content: msg.content,
  });
  if (rt.dedup.has(key)) return rejectPlan('DUPLICATE', undefined, at);

  const limiter = rt.rate.get(BudgetBook.edgeKey(msg.from, msg.to));
  const degraded = limiter?.wouldDegrade(at) === true;
  const tokens = estimateMessageTokens(msg.content);
  const budget = rt.budget.canConsume(msg.from, msg.to, tokens);
  if (budget === 'fuse-edge') return rejectPlan('FUSE_EDGE', undefined, at, tokens, key);
  if (budget === 'fuse-global') return rejectPlan('FUSE_GLOBAL', undefined, at, tokens, key);

  return {
    verdict: degraded ? 'degrade' : 'deliver',
    mode: edge.mode,
    wake: edge.mode === 'board' ? 'never' : edge.wake,
    tokens,
    key,
    at,
  };
}

/** 记录拒绝并返回统一 outcome。 */
export function commitReject(
  rt: ConcourseRuntime,
  msg: InboundMessage,
  reason: RejectReason,
  candidates: readonly string[] | undefined,
  ledger?: Ledger,
): AdmitOutcome {
  ledger?.append({
    concourseId: rt.concourse.id,
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
}

/**
 * 提交一次已真实交付的准入：扣预算、登记去重/速率，并写 deliver/degrade 台账。
 * reject 计划只写拒绝留痕，不会产生投递成功。
 */
export function commitInbound(
  rt: ConcourseRuntime,
  msg: InboundMessage,
  plan: AdmissionPlan,
  ledger?: Ledger,
): AdmitOutcome {
  if (plan.verdict === 'reject') {
    const reason = plan.reason ?? 'EDGE_CLOSED';
    if (reason === 'FUSE_EDGE' || reason === 'FUSE_GLOBAL') {
      // 预检只读；提交拒绝时执行一次真实 consume 以落下熔断标记并留预算痕。
      const consumed = rt.budget.consumeEdge(msg.from, msg.to, plan.tokens);
      ledger?.append({
        concourseId: rt.concourse.id,
        kind: 'budget',
        action: 'consume',
        detail: {
          from: msg.from,
          to: msg.to,
          tokens: plan.tokens,
          result: consumed,
        },
      });
    }
    return commitReject(rt, msg, reason, plan.candidates, ledger);
  }
  const key = plan.key;
  rt.dedup.record(key);
  const limiter = rt.rate.get(BudgetBook.edgeKey(msg.from, msg.to));
  // 只记录预检时刻的窗口；实际唤醒/结果已经由 plan.verdict 决定，不能事后翻转。
  limiter?.check(plan.at);

  // deliver 与 degrade 都是真实投递：共用同一段预算提交，恰好扣账一次。
  const consumed = rt.budget.consumeEdge(msg.from, msg.to, plan.tokens);
  ledger?.append({
    concourseId: rt.concourse.id,
    kind: 'budget',
    action: 'consume',
    detail: { from: msg.from, to: msg.to, tokens: plan.tokens, result: consumed },
  });
  if (consumed === 'fuse-edge') return commitReject(rt, msg, 'FUSE_EDGE', undefined, ledger);
  if (consumed === 'fuse-global') return commitReject(rt, msg, 'FUSE_GLOBAL', undefined, ledger);
  if (plan.verdict === 'degrade') {
    ledger?.append({
      concourseId: rt.concourse.id,
      kind: 'comm',
      action: 'degrade',
      detail: { from: msg.from, to: msg.to, reason: 'RATE_LIMIT' },
    });
    return { kind: 'degrade', reason: 'RATE_LIMIT' };
  }
  const mode = plan.mode ?? 'notify';
  const wake: Wake = mode === 'board' ? 'never' : (plan.wake ?? 'never');
  ledger?.append({
    concourseId: rt.concourse.id,
    kind: 'comm',
    action: 'deliver',
    detail: { from: msg.from, to: msg.to, mode, wake, tokens: plan.tokens },
  });
  return { kind: 'deliver', mode, wake };
}

/**
 * 兼容单步调用：预检 + 立即提交。生产投递使用 evaluate → send → commit 两步；
 * 本函数保留给纯判定测试与旧路径。
 */
export function admitInbound(
  rt: ConcourseRuntime,
  msg: InboundMessage,
  deps: AdmitDeps = {},
): AdmitOutcome {
  const plan = evaluateInbound(rt, msg);
  return commitInbound(rt, msg, plan, deps.ledger);
}
