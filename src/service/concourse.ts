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
import { ZodError } from 'zod';
import { parseConcourse, type Concourse, type Vertex } from '../kernel/topology/schema.js';
import { validateConcourse, type ValidationIssue } from '../kernel/topology/validate.js';
import {
  findUnknownKeyIssues,
  zodErrorSummary,
  zodErrorToIssues,
  type SchemaIssue,
} from '../kernel/topology/issues.js';
import { estimateConcourseBudget } from '../kernel/budget/tokens.js';
import type { Substrate, VertexHandle, VertexStart } from '../host/contracts.js';
import type { Ledger } from './ledger.js';
import { createRuntime, type ConcourseRuntime } from './inbox-gate.js';
import type { ConcourseStatus, ReplayState } from './persistence.js';

export type { ConcourseStatus } from './persistence.js';

export type ConcourseErrorCode =
  | 'INVALID_SPEC' // parse/validate 未过（issues 附语义校验清单）
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
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
  readonly concourse: Concourse;
  status: ConcourseStatus;
  readonly createdAt: number;
  handles: VertexHandle[];
  runtime: ConcourseRuntime;
}

export interface ConcourseServiceDeps {
  readonly substrate: Substrate;
  readonly ledger: Ledger;
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

const NEXT_STATUS: Record<'submit' | 'approve' | 'reject' | 'archive', ConcourseStatus> = {
  submit: 'pending-approval',
  approve: 'running',
  reject: 'draft',
  archive: 'archived',
};

export class ConcourseService {
  private readonly substrate: Substrate;
  private readonly ledger: Ledger;
  private readonly now: () => number;
  private readonly idGen: () => string;
  private readonly entries = new Map<string, Entry>();
  private readonly order: string[] = [];

  constructor(deps: ConcourseServiceDeps) {
    this.substrate = deps.substrate;
    this.ledger = deps.ledger;
    this.now = deps.now ?? (() => Date.now());
    let counter = 0;
    this.idGen = deps.idGen ?? (() => `concourse-${(counter += 1)}`);
    // 启动回放：从 snapshot 恢复生命周期 + 顶点句柄 + 预算台账
    for (const rc of deps.snapshot?.concourses ?? []) {
      this.entries.set(rc.concourse.id, {
        concourse: rc.concourse,
        status: rc.status,
        createdAt: 0,
        handles: [...rc.handles],
        runtime: { ...createRuntime(rc.concourse, { now: this.now }), budget: rc.budget },
      });
      this.order.push(rc.concourse.id);
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
   * parseConcourse 结构解析 → validateConcourse 语义校验（有 issue 即 throw
   * ConcourseError(INVALID_SPEC) 附 issue 列表）→ kernel tokens 估算回填预算。
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
    const issues = [...unknownKeyIssues, ...validateConcourse(concourse)];
    if (issues.length > 0) {
      throw new ConcourseError(
        'INVALID_SPEC',
        `concourse 语义校验未过（${issues.length} 个问题）`,
        issues,
      );
    }
    concourse = this.backfillBudget(concourse);
    if (this.entries.has(concourse.id)) {
      throw new ConcourseError('INVALID_SPEC', `concourse id「${concourse.id}」已存在`);
    }
    const entry: Entry = {
      concourse,
      status: 'draft',
      createdAt: this.now(),
      handles: [],
      runtime: createRuntime(concourse, { now: this.now }),
    };
    this.entries.set(concourse.id, entry);
    this.order.push(concourse.id);
    this.ledger.append({
      concourseId: concourse.id,
      kind: 'lifecycle',
      action: 'create',
      detail: { concourse },
    });
    return this.recordOf(entry);
  }

  /** draft → pending-approval。 */
  submit(id: string): ConcourseRecord {
    const entry = this.transition(id, 'submit');
    this.ledger.append({ concourseId: id, kind: 'lifecycle', action: 'submit', detail: {} });
    return this.recordOf(entry);
  }

  /**
   * pending-approval → running：按拓扑序（layer 升序，父先于子）逐顶点拉起。
   * 任一失败 → 已拉起顶点 interrupt 回滚 + ConcourseError(APPROVE_FAILED)，
   * 状态停回 pending-approval；台账记录 requested vs effective 与回滚留痕。
   */
  async approve(id: string, parent: unknown): Promise<VertexHandle[]> {
    // 先校验不提交：拉起全部成功后才落 running（失败回滚停回 pending-approval）
    const entry = this.checkTransition(id, 'approve');
    const ordered = [...entry.concourse.vertices].sort((a, b) => a.layer - b.layer);
    const started: VertexHandle[] = [];
    for (const v of ordered) {
      // origin='self' 顶点即领队会话本身（parent），不再拉起子代理，台账显式留痕
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
      let handle: VertexHandle;
      try {
        handle = await this.substrate.startVertex(spec, parent);
      } catch (err) {
        // 回滚：按拉起顺序 interrupt（尽力而为，单点失败不中断回滚）
        const interrupted: string[] = [];
        for (const h of started) {
          try {
            await this.substrate.interrupt(h);
            interrupted.push(h.vertexId);
          } catch {
            // 尽力而为：中断失败不覆盖主错误
          }
        }
        this.ledger.append({
          concourseId: id,
          kind: 'lifecycle',
          action: 'rollback',
          detail: { interrupted, failedVertex: v.id },
        });
        this.ledger.append({
          concourseId: id,
          kind: 'lifecycle',
          action: 'approve-failed',
          detail: { failedVertex: v.id },
        });
        const causeCode =
          typeof (err as { code?: unknown }).code === 'string'
            ? (err as { code: string }).code
            : 'START_FAILED';
        throw new ConcourseError(
          'APPROVE_FAILED',
          `顶点「${v.id}」拉起失败，已回滚 ${interrupted.length} 个顶点：${(err as Error).message}`,
          undefined,
          causeCode,
        );
      }
      started.push(handle);
      // 台账：请求档位 vs 生效档位（未声明 → effective='inherit'，inherit 可辨）
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
    entry.handles = started;
    entry.status = 'running';
    this.ledger.append({
      concourseId: id,
      kind: 'lifecycle',
      action: 'approve',
      detail: { handles: started },
    });
    return started;
  }

  /** pending-approval → draft。 */
  reject(id: string): ConcourseRecord {
    const entry = this.transition(id, 'reject');
    this.ledger.append({ concourseId: id, kind: 'lifecycle', action: 'reject', detail: {} });
    return this.recordOf(entry);
  }

  /** → archived；running 时已拉起顶点尽力 interrupt（fire-and-forget）。 */
  archive(id: string): ConcourseRecord {
    const entry = this.transition(id, 'archive');
    for (const h of entry.handles) {
      void Promise.resolve(this.substrate.interrupt(h)).catch(() => undefined);
    }
    this.ledger.append({ concourseId: id, kind: 'lifecycle', action: 'archive', detail: {} });
    return this.recordOf(entry);
  }

  get(id: string): ConcourseRecord {
    return this.recordOf(this.mustGet(id));
  }

  list(): ConcourseRecord[] {
    return this.order.map((id) => this.recordOf(this.entries.get(id)!));
  }

  /** 通信运行时（收件箱准入 inbox-gate 的输入；随生命周期存活）。 */
  runtime(id: string): ConcourseRuntime {
    return this.mustGet(id).runtime;
  }

  // ── 内部 ──

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

  /** 状态转换闸门：非法转换 throw ILLEGAL_TRANSITION，合法则落新状态。 */
  private transition(id: string, op: keyof typeof ALLOWED_FROM): Entry {
    const entry = this.checkTransition(id, op);
    entry.status = NEXT_STATUS[op];
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

  /**
   * 预算回填（仅补缺省）：顶点无 budget.tokens 且有任务估算 → 回填；
   * concourse 未声明总预算且估算总和 > 0 → 回填。
   */
  private backfillBudget(c: Concourse): Concourse {
    const est = estimateConcourseBudget(c);
    const vertices = c.vertices.map((v) => {
      const per = est.perVertex[v.id];
      if (v.budget?.tokens !== undefined || per === undefined || per <= 0) return v;
      return { ...v, budget: { ...v.budget, tokens: Math.ceil(per) } };
    });
    const budget =
      c.budget?.tokens !== undefined || est.total <= 0
        ? c.budget
        : { tokens: Math.ceil(est.total) };
    return { ...c, vertices, ...(budget !== undefined ? { budget } : {}) };
  }

  /** 顶点 → VertexStart（未声明的定档键不写入 = 继承父代理）。 */
  private vertexStartOf(v: Vertex, c: Concourse): VertexStart {
    return {
      vertexId: v.id,
      label: v.role ?? v.id,
      prompt: this.promptOf(v, c),
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
