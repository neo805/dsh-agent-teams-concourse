/**
 * service/concourse —— ConcourseService：concourse 生命周期领域服务（P3 簇 B）。
 *
 * 状态机：draft → pending-approval → running → archived
 *   · submit：draft → pending-approval
 *   · approve：pending-approval → running（按拓扑序逐顶点 substrate.startVertex；
 *     任一失败 → 已拉起顶点 interrupt 回滚 + typed error，状态停回 pending-approval）
 *   · reject：pending-approval → draft（可再次 submit）
 *   · archive：draft/pending-approval/running → archived（running 时尽力 interrupt）
 * 非法转换一律 throw ConcourseError(ILLEGAL_TRANSITION)。
 *
 * 依赖全部经构造器注入（substrate/ledger/now/idGen/snapshot），零宿主直接引用（R-1）。
 */
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Edge, parseConcourse, type Concourse, type Vertex } from '../kernel/topology/schema.js';
import { validateConcourse } from '../kernel/topology/validate.js';
import {
  findUnknownKeyIssues,
  zodErrorSummary,
  zodErrorToIssues,
  type SchemaIssue,
} from '../kernel/topology/issues.js';
import { normalizeConcourseBudgets } from '../kernel/budget/normalize.js';
import { BudgetBook } from '../kernel/comms/budget.js';
import type { Catalog, Substrate, VertexHandle, VertexStart } from '../host/contracts.js';
import type { EdgeMode, Wake } from '../kernel/topology/schema.js';
import type { Ledger } from './ledger.js';
import {
  commitInbound,
  commitReject,
  createRuntime,
  evaluateInbound,
  type AdmitOutcome,
  type ConcourseRuntime,
  type InboundMessage,
} from './inbox-gate.js';
import {
  applyEdgeLifecycleWithBudget,
  type ConcourseStatus,
  type ReplayState,
} from './persistence.js';

export type { ConcourseStatus } from './persistence.js';

export type ConcourseErrorCode =
  | 'INVALID_SPEC' // parse/validate 未过（issues 附语义校验清单）
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'APPROVAL_IN_PROGRESS'
  | 'CANCELLED'
  | 'IDENTITY_MISMATCH'
  | 'UNKNOWN_VERTEX'
  | 'NOT_STARTED'
  | 'TARGET_UNAVAILABLE'
  | 'APPROVE_FAILED'; // 拉起失败已回滚；causeCode 附基座错误码

export class ConcourseError extends Error {
  constructor(
    readonly code: ConcourseErrorCode,
    message: string,
    readonly issues?: readonly SchemaIssue[],
    readonly causeCode?: string,
  ) {
    super(message);
    this.name = 'ConcourseError';
  }
}

/** 对外返回的 concourse 记录（生命周期快照）。 */
export interface ConcourseRecord {
  readonly concourse: Concourse;
  readonly status: ConcourseStatus;
  readonly createdAt: number;
}

interface Entry {
  concourse: Concourse;
  status: ConcourseStatus;
  readonly createdAt: number;
  handles: VertexHandle[];
  runtime: ConcourseRuntime;
  /** origin=self 顶点的 durable 领队 session id。 */
  rootSessionId?: string;
  /** 进行中的 approve；存在时禁止第二次 approve 与竞争性转换。 */
  approval?: Promise<VertexHandle[]>;
}

export interface SendInput {
  readonly from: string;
  readonly to: string;
  readonly content: string;
  readonly correlationId?: string;
  readonly hops?: number;
}

export interface SendResult {
  readonly outcome: 'deliver' | 'degrade' | 'reject' | 'error';
  readonly reason?: string;
  readonly candidates?: readonly string[];
  readonly mode?: EdgeMode;
  readonly wake?: Wake;
  readonly childId?: string;
  readonly code?: string;
  readonly message?: string;
}

export interface EdgeChangeInput {
  readonly from: string;
  readonly to: string;
  readonly action: 'open' | 'close';
  readonly mode?: EdgeMode;
  readonly wake?: Wake;
  readonly hopTTL?: number;
}

export interface EdgeChangeResult {
  readonly concourse: Concourse;
  readonly openEdges: number;
}

type MessageLike = {
  readonly content: readonly { readonly type?: string; readonly text?: string }[];
  readonly source?: unknown;
};

export interface ConcourseServiceDeps {
  readonly substrate: Substrate;
  readonly ledger: Ledger;
  /** 可选模型目录；存在时 approve 在写 intent/拉起前对全部显式定档做白名单预检。 */
  readonly catalog?: Catalog;
  readonly now?: () => number;
  /** id 生成（默认计数器式可读 id：concourse-1、concourse-2…，禁 Math.random）。 */
  readonly idGen?: () => string;
  /** 启动回放恢复的状态（persistence.replay 输出）。 */
  readonly snapshot?: ReplayState;
}

/** 合法转换表：action → 允许的前置状态。 */
const ALLOWED_FROM: Record<'submit' | 'approve' | 'reject' | 'archive', readonly ConcourseStatus[]> = {
  submit: ['draft'],
  approve: ['pending-approval'],
  reject: ['pending-approval'],
  archive: ['draft', 'pending-approval', 'running'],
};

export class ConcourseService {
  private readonly substrate: Substrate;
  private readonly ledger: Ledger;
  private readonly catalog: Catalog | undefined;
  private readonly now: () => number;
  private readonly idGen: () => string;
  private readonly entries = new Map<string, Entry>();

  constructor(deps: ConcourseServiceDeps) {
    this.substrate = deps.substrate;
    this.ledger = deps.ledger;
    this.catalog = deps.catalog;
    this.now = deps.now ?? (() => Date.now());
    let counter = 0;
    this.idGen = deps.idGen ?? (() => `concourse-${(counter += 1)}`);
    // 启动回放：从 snapshot 恢复生命周期 + 顶点句柄 + 预算台账
    for (const rc of deps.snapshot?.concourses ?? []) {
      this.entries.set(rc.concourse.id, {
        concourse: rc.concourse,
        status: rc.status,
        createdAt: rc.createdAt,
        handles: [...rc.handles],
        ...(rc.rootSessionId !== undefined ? { rootSessionId: rc.rootSessionId } : {}),
        runtime: { ...createRuntime(rc.concourse, { now: this.now }), budget: rc.budget },
      });
    }
    // F5（2026-10-18 真机测试）：计数器在进程内从 0 起，回放不播种 → 重启后首个
    // 缺 id 的 create 必生成已被占用的 concourse-1。这里以回放条目中形如
    // `concourse-<n>` 的最大序号播种计数器；其余命名（如用户手工 id）由 ensureId
    // 的撞号跳过兜底，不依赖命名规整。
    for (const rc of deps.snapshot?.concourses ?? []) {
      const m = /^concourse-(\d+)$/.exec(rc.concourse.id);
      if (m !== null) counter = Math.max(counter, Number(m[1]));
    }
  }

  /**
   * 创建 concourse（draft）：
   * parseConcourse 结构解析 → 共享预算规范化 → validateConcourse 语义校验
   * （有 issue 即 throw ConcourseError(INVALID_SPEC) 附 issue 列表）→ 落库。
   */
  create(spec: unknown): ConcourseRecord {
    // spec 缺 id 时由注入 idGen 生成（zod 要求 id 非空，先补后解析）
    const withId = this.ensureId(spec);
    // F2（2026-10-18 真机测试）：zod 默认 strip 未知键，spec 内笔误会静默丢字段；
    // parse 前逐层扫描未知键，命中即并入 issues fail-loud（附 did-you-mean）。
    const unknownKeyIssues = findUnknownKeyIssues(withId);
    let concourse: Concourse;
    try {
      concourse = parseConcourse(withId);
    } catch (err) {
      if (err instanceof ZodError) {
        // F4：不再把 ZodError.message（多行 JSON）拼进中文句子，结构化 issues 返回
        // F2：未知字段与结构错误一并返回（笔误往往同时导致「缺必填」）
        throw new ConcourseError(
          'INVALID_SPEC',
          `concourse 结构非法：${zodErrorSummary(err)}`,
          [...unknownKeyIssues, ...zodErrorToIssues(err)],
        );
      }
      throw err;
    }
    concourse = normalizeConcourseBudgets(concourse);
    const issues = [...unknownKeyIssues, ...validateConcourse(concourse)];
    if (issues.length > 0) {
      throw new ConcourseError(
        'INVALID_SPEC',
        `concourse 语义校验未过（${issues.length} 个问题）`,
        issues,
      );
    }
    if (this.entries.has(concourse.id)) {
      throw new ConcourseError('INVALID_SPEC', `concourse id「${concourse.id}」已存在`);
    }
    // 先落盘，再发布内存状态：sink 失败时调用方看到失败且 service 不变。
    this.ledger.append({
      concourseId: concourse.id,
      kind: 'lifecycle',
      action: 'create',
      detail: { concourse },
    });
    const entry: Entry = {
      concourse,
      status: 'draft',
      createdAt: this.now(),
      handles: [],
      runtime: createRuntime(concourse, { now: this.now }),
    };
    this.entries.set(concourse.id, entry);
    return this.recordOf(entry);
  }

  /** draft → pending-approval。 */
  submit(id: string): ConcourseRecord {
    const entry = this.assertTransitionAllowed(id, 'submit');
    this.ledger.append({ concourseId: id, kind: 'lifecycle', action: 'submit', detail: {} });
    entry.status = 'pending-approval';
    return this.recordOf(entry);
  }

  /**
   * pending-approval → running：按拓扑序逐顶点拉起。
   * 同一 concourse 同时只允许一个 approve；取消/失败均复用完整回滚。
   */
  async approve(
    id: string,
    parent: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<VertexHandle[]> {
    const entry = this.checkTransition(id, 'approve');
    if (entry.approval !== undefined) {
      throw new ConcourseError('APPROVAL_IN_PROGRESS', `concourse「${id}」已有审批执行在进行中`);
    }
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted === true) forwardAbort();
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const work = this.runApprove(entry, parent, controller.signal);
    entry.approval = work;
    try {
      return await work;
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort);
      if (entry.approval === work) delete entry.approval;
    }
  }

  private async runApprove(
    entry: Entry,
    parent: unknown,
    signal: AbortSignal,
  ): Promise<VertexHandle[]> {
    const id = entry.concourse.id;
    // 全顶点定档预检必须先于 intent/start：后面的非法顶点不能造成先拉起再回滚。
    await this.preflightModels(entry.concourse);
    const rootSessionId = agentIdOf(parent);
    // 先落 approve-intent：写盘失败时不拉起任何顶点。
    this.ledger.append({
      concourseId: id,
      kind: 'lifecycle',
      action: 'approve-intent',
      detail: rootSessionId !== undefined ? { rootSessionId } : {},
    });
    const ordered = [...entry.concourse.vertices].sort((a, b) => a.layer - b.layer);
    const started: VertexHandle[] = [];
    try {
      for (const v of ordered) {
        signal.throwIfAborted();
        if (v.origin === 'self') {
          this.ledger.append({
            concourseId: id,
            kind: 'lifecycle',
            action: 'vertex-self',
            detail: { vertexId: v.id },
          });
          continue;
        }
        const spec = this.vertexStartOf(v, entry.concourse);
        const handle = await this.substrate.startVertex(spec, parent, signal);
        started.push(handle);
        this.ledger.append({
          concourseId: id,
          kind: 'lifecycle',
          action: 'vertex-start',
          detail: {
            vertexId: v.id,
            childId: handle.childId,
            requested: { model: v.model ?? null, reasoningEffort: v.reasoningEffort ?? null },
            effective: { model: v.model ?? 'inherit', reasoningEffort: v.reasoningEffort ?? 'inherit' },
          },
        });
      }
      signal.throwIfAborted();
      this.ledger.append({
        concourseId: id,
        kind: 'lifecycle',
        action: 'approve',
        detail: { handles: started, ...(rootSessionId !== undefined ? { rootSessionId } : {}) },
      });
      entry.handles = started;
      if (rootSessionId !== undefined) entry.rootSessionId = rootSessionId;
      entry.status = 'running';
      return started;
    } catch (err) {
      const interrupted: string[] = [];
      for (const h of started) {
        try {
          await this.substrate.interrupt(h);
          interrupted.push(h.vertexId);
        } catch {
          // 尽力而为：中断失败不覆盖主错误
        }
      }
      this.safeAppend({
        concourseId: id,
        kind: 'lifecycle',
        action: 'rollback',
        detail: { interrupted },
      });
      const cancelled = signal.aborted;
      this.safeAppend({
        concourseId: id,
        kind: 'lifecycle',
        action: cancelled ? 'approve-cancelled' : 'approve-failed',
        detail: {},
      });
      if (cancelled) {
        throw new ConcourseError('CANCELLED', `concourse「${id}」审批已取消，已回滚 ${interrupted.length} 个顶点`);
      }
      const causeCode =
        typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : 'START_FAILED';
      throw new ConcourseError(
        'APPROVE_FAILED',
        `顶点拉起失败，已回滚 ${interrupted.length} 个顶点：${errorMessage(err)}`,
        undefined,
        causeCode,
      );
    }
  }

  /** pending-approval → draft。 */
  reject(id: string): ConcourseRecord {
    const entry = this.assertTransitionAllowed(id, 'reject');
    this.ledger.append({ concourseId: id, kind: 'lifecycle', action: 'reject', detail: {} });
    entry.status = 'draft';
    return this.recordOf(entry);
  }

  /** → archived；running 时已拉起顶点尽力 interrupt（fire-and-forget）。 */
  archive(id: string): ConcourseRecord {
    const entry = this.assertTransitionAllowed(id, 'archive');
    this.ledger.append({ concourseId: id, kind: 'lifecycle', action: 'archive', detail: {} });
    entry.status = 'archived';
    for (const h of entry.handles) {
      void Promise.resolve(this.substrate.interrupt(h)).catch(() => undefined);
    }
    return this.recordOf(entry);
  }

  /**
   * 发送一条 team 消息：真实 sender 身份 → 预检 → 写入目标 inbox → 提交扣账。
   * 投递失败不产生 deliver/预算消费；降级消息以 wakeup=false 投递。
   */
  send(id: string, input: SendInput, senderAgent: unknown, signal?: AbortSignal): SendResult {
    const entry = this.mustGet(id);
    const senderId = agentIdOf(senderAgent);
    if (senderId === undefined) {
      return { outcome: 'error', code: 'IDENTITY_MISMATCH', message: 'team_send 需要真实调用方 Agent 作为身份凭据' };
    }
    let fromVertex = this.vertexOfAgent(entry, senderId);
    // 审批前领队首次派活：上下文里只有它自己的 live Agent，可据此绑定 self 顶点。
    if (fromVertex === undefined && entry.rootSessionId === undefined && entry.handles.length === 0) {
      const requested = entry.concourse.vertices.find((v) => v.id === input.from);
      if (requested?.origin === 'self') {
        entry.rootSessionId = senderId;
        fromVertex = requested.id;
      }
    }
    if (fromVertex !== input.from) {
      return {
        outcome: 'error',
        code: 'IDENTITY_MISMATCH',
        message: `发送方身份与 from 不一致：Agent ${senderId} 对应 ${fromVertex ?? '未知顶点'}，请求为 ${input.from}`,
      };
    }
    const target = entry.concourse.vertices.find((v) => v.id === input.to);
    if (target === undefined) return { outcome: 'error', code: 'UNKNOWN_VERTEX', message: `顶点「${input.to}」不存在` };
    const targetId = this.agentIdOfVertex(entry, target.id);
    if (targetId === undefined) {
      return { outcome: 'error', code: 'NOT_STARTED', message: `顶点「${target.id}」尚未拉起` };
    }
    const handle: VertexHandle = { vertexId: target.id, childId: targetId };
    const msg: InboundMessage = {
      from: input.from,
      to: input.to,
      content: input.content,
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      ...(input.hops !== undefined ? { hops: input.hops } : {}),
    };
    const plan = evaluateInbound(entry.runtime, msg);
    if (plan.verdict === 'reject') {
      const out = commitInbound(entry.runtime, msg, plan, this.ledger);
      return fromOutcome(out);
    }
    const admissionId = randomUUID();
    this.ledger.append({
      concourseId: id,
      kind: 'comm',
      action: 'admit',
      detail: { from: input.from, to: input.to, tokens: plan.tokens, admissionId },
    });
    try {
      this.substrate.deliver({
        concourseId: id,
        admissionId,
        target: handle,
        senderId,
        content: input.content,
        wakeup: plan.verdict === 'deliver',
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      this.safeAppend({
        concourseId: id,
        kind: 'comm',
        action: 'delivery-failed',
        detail: { from: input.from, to: input.to, admissionId, code: errorCode(err), message: errorMessage(err) },
      });
      return {
        outcome: 'error',
        code: errorCode(err),
        message: errorMessage(err),
      };
    }
    const out = commitInbound(entry.runtime, msg, plan, this.ledger);
    if (out.kind === 'deliver' || out.kind === 'degrade') {
      entry.runtime.admissions.set(admissionId, out.kind);
    }
    return { ...fromOutcome(out), childId: targetId };
  }

  /**
   * 模型准入闸门：对真实 agent-message 按 durable senderSessionId 判定。
   * team_send 已提交的 admissionId 只消费票据；官方 send_message 等外部路径
   * 在此执行同一 open-edge 判定，闭边消息从本轮 messages 中移除并留痕。
   */
  filterInbound<T extends MessageLike>(targetAgentId: string, messages: readonly T[]): readonly T[] {
    // 同一领队可拥有多个 concourse：目标 root id 会重合，必须用唯一 sender
    // 反查所属 concourse；target 只用于构造候选集。
    const candidates = [...this.entries.values()].filter(
      (entry) => this.vertexOfAgent(entry, targetAgentId) !== undefined,
    );
    if (candidates.length === 0) return messages;
    const kept: T[] = [];
    for (const message of messages) {
      const source = message.source;
      if (typeof source !== 'object' || source === null || (source as { kind?: unknown }).kind !== 'agent-message') {
        kept.push(message);
        continue;
      }
      const senderId = (source as { senderSessionId?: unknown }).senderSessionId;
      if (typeof senderId !== 'string') continue;
      const entry = candidates.find((candidate) => this.vertexOfAgent(candidate, senderId) !== undefined);
      if (entry === undefined) {
        const fallback = candidates[0]!;
        const targetVertex = this.vertexOfAgent(fallback, targetAgentId)!;
        commitReject(fallback.runtime, { from: senderId, to: targetVertex, content: '' }, 'UNKNOWN_VERTEX', undefined, this.ledger);
        continue;
      }
      const from = this.vertexOfAgent(entry, senderId)!;
      const to = this.vertexOfAgent(entry, targetAgentId)!;
      const concourseMeta = (source as { concourse?: unknown }).concourse;
      const admissionId =
        typeof concourseMeta === 'object' && concourseMeta !== null
          ? (concourseMeta as { admissionId?: unknown }).admissionId
          : undefined;
      if (typeof admissionId === 'string' && entry.runtime.admissions.delete(admissionId)) {
        kept.push(message);
        continue;
      }
      const content = message.content.map((b) => b.text ?? '').join('');
      const msg: InboundMessage = { from, to, content };
      const plan = evaluateInbound(entry.runtime, msg);
      const out = commitInbound(entry.runtime, msg, plan, this.ledger);
      if (out.kind !== 'reject') kept.push(message);
    }
    return kept;
  }

  /** 运行期开/闭边：事件先落盘，再由同一 reducer 更新拓扑与预算运行时。 */
  link(id: string, input: EdgeChangeInput): EdgeChangeResult {
    const entry = this.mustGet(id);
    if (entry.status !== 'running') {
      throw new ConcourseError('ILLEGAL_TRANSITION', `team_link 要求 running 状态，当前为 ${entry.status}`);
    }
    const ids = new Set(entry.concourse.vertices.map((v) => v.id));
    if (!ids.has(input.from) || !ids.has(input.to)) {
      throw new ConcourseError('UNKNOWN_VERTEX', `顶点不存在：${[input.from, input.to].filter((v) => !ids.has(v)).join(' / ')}`);
    }
    let detail: Record<string, unknown>;
    if (input.action === 'open') {
      try {
        // 与计划期同一条 Edge schema：非法参数在写台账、改拓扑之前 fail-loud。
        detail = Edge.parse({
          from: input.from,
          to: input.to,
          mode: input.mode ?? 'notify',
          wake: input.wake ?? 'never',
          hopTTL: input.hopTTL ?? 2,
        }) as unknown as Record<string, unknown>;
      } catch (err) {
        if (err instanceof ZodError) {
          throw new ConcourseError(
            'INVALID_SPEC',
            `边参数非法：${zodErrorSummary(err)}`,
            zodErrorToIssues(err),
          );
        }
        throw err;
      }
    } else {
      detail = { from: input.from, to: input.to };
    }
    this.ledger.append({
      concourseId: id,
      kind: 'lifecycle',
      action: input.action === 'open' ? 'edge-open' : 'edge-close',
      detail,
    });
    const nextState = applyEdgeLifecycleWithBudget(
      entry.concourse,
      entry.runtime.budget,
      input.action === 'open' ? 'edge-open' : 'edge-close',
      detail,
    );
    const next = nextState.concourse;
    const runtime = createRuntime(next, { now: this.now });
    // 只重建新增/配置变化的边限流器；未变边的滑动窗口必须继续有效。
    const previousEdges = new Map(
      entry.runtime.concourse.edges.map((edge) => [BudgetBook.edgeKey(edge.from, edge.to), edge]),
    );
    const nextEdges = new Map(next.edges.map((edge) => [BudgetBook.edgeKey(edge.from, edge.to), edge]));
    const rate = new Map(runtime.rate);
    for (const [key, limiter] of entry.runtime.rate) {
      const before = previousEdges.get(key)?.rate;
      const after = nextEdges.get(key)?.rate;
      if (before !== undefined && after !== undefined && before.n === after.n && before.perMs === after.perMs) {
        rate.set(key, limiter);
      }
    }
    entry.concourse = next;
    entry.runtime = {
      ...runtime,
      rate,
      dedup: entry.runtime.dedup,
      admissions: entry.runtime.admissions,
      budget: nextState.budget,
    };
    return { concourse: next, openEdges: next.edges.length };
  }

  get(id: string): ConcourseRecord {
    return this.recordOf(this.mustGet(id));
  }

  list(): ConcourseRecord[] {
    // Map 保证插入序，无需另维护 order 数组（create/replay 顺序即声明序）。
    return [...this.entries.values()].map((entry) => this.recordOf(entry));
  }

  /** 通信运行时（收件箱准入 inbox-gate 的输入；随生命周期存活）。 */
  runtime(id: string): ConcourseRuntime {
    return this.mustGet(id).runtime;
  }

  // ── 内部 ──

  /** 对全部显式 model(+effort) 做白名单预检；任一失败即 typed error，零副作用。 */
  private async preflightModels(c: Concourse): Promise<void> {
    if (this.catalog === undefined) return;
    for (const v of c.vertices) {
      if (v.model === undefined) continue; // effort-only 继承父模型，无法独立判档
      try {
        await this.catalog.assertSupported(v.model, v.reasoningEffort, v.provider);
      } catch (err) {
        throw new ConcourseError(
          'APPROVE_FAILED',
          `模型/档位预检失败（未拉起任何顶点）：${errorMessage(err)}`,
          undefined,
          errorCode(err),
        );
      }
    }
  }

  private mustGet(id: string): Entry {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      throw new ConcourseError('NOT_FOUND', `concourse「${id}」不存在`);
    }
    return entry;
  }

  private recordOf(entry: Entry): ConcourseRecord {
    return { concourse: entry.concourse, status: entry.status, createdAt: entry.createdAt };
  }

  /** 状态转换闸门：非法转换 throw ILLEGAL_TRANSITION；进行中的 approve 阻塞竞争转换。 */
  private assertTransitionAllowed(id: string, op: keyof typeof ALLOWED_FROM): Entry {
    const entry = this.checkTransition(id, op);
    if (entry.approval !== undefined) {
      throw new ConcourseError('APPROVAL_IN_PROGRESS', `concourse「${id}」审批执行中，暂不允许 ${op}`);
    }
    return entry;
  }

  /** 仅校验转换合法性（approve 需要先拉起后提交状态）。 */
  private checkTransition(id: string, op: keyof typeof ALLOWED_FROM): Entry {
    const entry = this.mustGet(id);
    if (!ALLOWED_FROM[op].includes(entry.status)) {
      throw new ConcourseError(
        'ILLEGAL_TRANSITION',
        `concourse「${id}」当前为 ${entry.status}，不允许 ${op}（要求 ${ALLOWED_FROM[op].join(' / ')}）`,
      );
    }
    return entry;
  }

  /** 事件尽力写入：用于失败/回滚留痕，不覆盖主错误。 */
  private safeAppend(input: Parameters<Ledger['append']>[0]): void {
    try {
      this.ledger.append(input);
    } catch {
      // 磁盘失败时主错误已存在；保留原始失败语义。
    }
  }

  private agentIdOfVertex(entry: Entry, vertexId: string): string | undefined {
    const vertex = entry.concourse.vertices.find((v) => v.id === vertexId);
    if (vertex === undefined) return undefined;
    if (vertex.origin === 'self') return entry.rootSessionId;
    return [...entry.handles].reverse().find((h) => h.vertexId === vertexId)?.childId;
  }

  private vertexOfAgent(entry: Entry, agentId: string): string | undefined {
    if (entry.rootSessionId === agentId) {
      return entry.concourse.vertices.find((v) => v.origin === 'self')?.id;
    }
    return [...entry.handles].reverse().find((h) => h.childId === agentId)?.vertexId;
  }

  /**
   * spec 为对象且 id 缺失/空串时注入 idGen 生成的 id。
   * F5（2026-10-18 真机测试）：生成前对照已存在 id 撞号跳过——即使 idGen 的
   * 计数器未播种（自定义 idGen、或回放里含手工命名的 concourse-N），也不会
   * 把「自动生成」变成「必撞号」。
   */
  private ensureId(spec: unknown): unknown {
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return spec;
    const obj = spec as Record<string, unknown>;
    if (typeof obj['id'] === 'string' && obj['id'].length > 0) return spec;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const id = this.idGen();
      if (!this.entries.has(id)) return { ...obj, id };
    }
    throw new ConcourseError('INVALID_SPEC', 'concourse id 自动生成失败：连续 1000 次撞号');
  }

  /** 顶点 → VertexStart（未声明的定档键不写入 = 继承父代理）。 */
  private vertexStartOf(v: Vertex, c: Concourse): VertexStart {
    return {
      vertexId: v.id,
      label: v.role ?? v.id,
      prompt: this.promptOf(v, c),
      ...(v.provider !== undefined ? { provider: v.provider } : {}),
      ...(v.model !== undefined ? { model: v.model } : {}),
      ...(v.reasoningEffort !== undefined ? { reasoningEffort: v.reasoningEffort } : {}),
      ...(v.toolFilter !== undefined ? { toolFilter: this.toolFilterOf(v.toolFilter) } : {}),
      ...(v.maxDepth > 0 ? { maxDepth: v.maxDepth } : {}),
    };
  }

  /** kernel ToolFilter → contracts VertexStart.toolFilter（exactOptionalPropertyTypes 对齐）。 */
  private toolFilterOf(tf: NonNullable<Vertex['toolFilter']>): NonNullable<VertexStart['toolFilter']> {
    return {
      ...(tf.allow !== undefined ? { allow: tf.allow } : {}),
      ...(tf.deny !== undefined ? { deny: tf.deny } : {}),
    };
  }

  /** 首条任务提示词：该顶点名下任务主题汇总；无任务则待命提示。 */
  private promptOf(v: Vertex, c: Concourse): string {
    const subjects = c.tasks.filter((t) => t.assignee === v.id).map((t) => t.subject);
    return subjects.length > 0 ? `任务：${subjects.join('；')}` : `顶点「${v.id}」待命中`;
  }
}

function agentIdOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function errorCode(error: unknown): string {
  return typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'SEND_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fromOutcome(outcome: AdmitOutcome): SendResult {
  if (outcome.kind === 'deliver') {
    return { outcome: 'deliver', mode: outcome.mode, wake: outcome.wake };
  }
  if (outcome.kind === 'degrade') {
    return { outcome: 'degrade', reason: outcome.reason };
  }
  return {
    outcome: 'reject',
    reason: outcome.reason,
    ...(outcome.candidates !== undefined ? { candidates: outcome.candidates } : {}),
  };
}
