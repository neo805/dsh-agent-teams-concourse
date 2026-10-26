/**
 * service/persistence —— JSONL 追加日志 + 启动回放（NFR-4，MVP 极简口径）。
 *
 *  · createJsonlStore(path) 与 createMemoryStore() 同构：{ append(event), load() }；
 *    JSONL 一行一事件，append 追加写，load 全量读（MVP 不做快照压缩）。
 *  · replay(events) 是纯函数：从台账事件流重建 service 状态——
 *    concourse 生命周期状态机 + 顶点句柄 + 预算台账（BudgetBook 确定性重演）。
 *  · 事件源：Ledger 的 sink；service 的全部状态变更都以台账事件落盘。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BudgetBook,
  budgetBookFromConcourse,
  edgeBudgetsOf,
} from '../kernel/comms/budget.js';
import { closeEdge, openEdge, withReverseAck } from '../kernel/topology/edges.js';
import { parseConcourse, type Concourse, type Edge } from '../kernel/topology/schema.js';
import type { VertexHandle } from '../host/contracts.js';
import type { LedgerEvent } from './ledger.js';

/** concourse 生命周期状态机（draft→pending-approval→running→archived）。 */
export type ConcourseStatus = 'draft' | 'pending-approval' | 'running' | 'archived';

/** 事件存储同构接口（JSONL 落盘 / 内存实现互换）。 */
export interface EventStore {
  append(event: LedgerEvent): void;
  load(): LedgerEvent[];
}

/** 内存事件存储（测试与内嵌场景）。 */
export function createMemoryStore(): EventStore {
  const events: LedgerEvent[] = [];
  return {
    append(event) {
      events.push(event);
    },
    load() {
      return [...events];
    },
  };
}

/** JSONL 追加日志存储；path 是台账文件本身，父目录按需创建。 */
export function createJsonlStore(path: string): EventStore {
  let directoryReady = false;
  return {
    append(event) {
      if (!directoryReady) {
        mkdirSync(dirname(path), { recursive: true });
        directoryReady = true;
      }
      appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
    },
    load() {
      if (!existsSync(path)) return [];
      const text = readFileSync(path, 'utf8');
      return text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as LedgerEvent);
    },
  };
}

/** replay 重建出的单个 concourse 状态。 */
export interface ReplayConcourse {
  readonly concourse: Concourse;
  readonly status: ConcourseStatus;
  /** create 事件时刻（重启前后快照等价）。 */
  readonly createdAt: number;
  readonly handles: readonly VertexHandle[];
  /** 领队/self 顶点的 durable session id；用于重启后的身份映射。 */
  readonly rootSessionId?: string;
  /** 预算台账（从 create 事件的预算声明初始化，consume 事件确定性重演）。 */
  readonly budget: BudgetBook;
}

/** 把运行期 edge-open / edge-close 事件归约到拓扑（live 与 replay 共用同一语义）。 */
export function applyEdgeLifecycle(
  concourse: Concourse,
  action: string,
  detail: Readonly<Record<string, unknown>>,
): Concourse {
  if (action === 'edge-open') {
    const from = String(detail['from'] ?? '');
    const to = String(detail['to'] ?? '');
    if (from.length === 0 || to.length === 0) return concourse;
    const edge = {
      from,
      to,
      mode: detail['mode'] === 'request-reply' || detail['mode'] === 'board' ? detail['mode'] : 'notify',
      wake: detail['wake'] === 'always' || detail['wake'] === 'on-reply' ? detail['wake'] : 'never',
      hopTTL: typeof detail['hopTTL'] === 'number' ? detail['hopTTL'] : 2,
    } as Edge;
    let edges = concourse.edges;
    for (const item of withReverseAck(edge)) edges = openEdge(edges, item);
    return { ...concourse, edges };
  }
  if (action === 'edge-close') {
    const from = String(detail['from'] ?? '');
    const to = String(detail['to'] ?? '');
    return { ...concourse, edges: closeEdge(concourse.edges, from, to) };
  }
  return concourse;
}

/** replay 输出：可直接注入 ConcourseService 构造器（snapshot）恢复运行。 */
export interface ReplayState {
  readonly concourses: readonly ReplayConcourse[];
}

/**
 * live 改边与 replay 共用的唯一 reducer：先归约拓扑，再按新边集重建边预算表。
 * 分开实现会让 close/open 后的 remaining/fuse 在重启前后漂移。
 */
export function applyEdgeLifecycleWithBudget(
  concourse: Concourse,
  budget: BudgetBook,
  action: string,
  detail: Readonly<Record<string, unknown>>,
): { concourse: Concourse; budget: BudgetBook } {
  const next = applyEdgeLifecycle(concourse, action, detail);
  return { concourse: next, budget: budget.withEdgeBudgets(edgeBudgetsOf(next)) };
}

/**
 * 从台账事件流重建 service 状态（纯函数，同输入必同输出）。
 * 识别的事件：lifecycle(create/submit/approve/reject/archive) 与 budget(consume)；
 * 其余事件（vertex-start/comm 等）为留痕，不参与状态重建。
 */
export function replay(events: readonly LedgerEvent[]): ReplayState {
  interface Mutable {
    concourse: Concourse;
    status: ConcourseStatus;
    createdAt: number;
    handles: VertexHandle[];
    rootSessionId?: string;
    budget: BudgetBook;
  }
  const byId = new Map<string, Mutable>();
  const order: string[] = [];

  for (const e of events) {
    if (e.kind === 'lifecycle' && e.action === 'create') {
      const concourse = parseConcourse(e.detail['concourse']);
      byId.set(e.concourseId, {
        concourse,
        status: 'draft',
        createdAt: e.at,
        handles: [],
        budget: budgetBookFromConcourse(concourse),
      });
      order.push(e.concourseId);
      continue;
    }
    const cur = byId.get(e.concourseId);
    if (cur === undefined) continue; // 无 create 的孤儿事件：跳过（容错口径）
    if (e.kind === 'lifecycle') {
      if (e.action === 'submit') cur.status = 'pending-approval';
      else if (e.action === 'approve') {
        cur.status = 'running';
        cur.handles = [...(e.detail['handles'] as VertexHandle[] | undefined ?? [])];
        if (typeof e.detail['rootSessionId'] === 'string') cur.rootSessionId = e.detail['rootSessionId'];
      } else if (e.action === 'edge-open' || e.action === 'edge-close') {
        const next = applyEdgeLifecycleWithBudget(cur.concourse, cur.budget, e.action, e.detail);
        cur.concourse = next.concourse;
        cur.budget = next.budget;
      } else if (e.action === 'reject') cur.status = 'draft';
      else if (e.action === 'archive') cur.status = 'archived';
    } else if (e.kind === 'budget' && e.action === 'consume') {
      // 确定性重演：同一 consume 序列必然重建同一账目状态
      cur.budget.consumeEdge(
        e.detail['from'] as string,
        e.detail['to'] as string,
        e.detail['tokens'] as number,
        // rc.7 起写 consumeGlobal；旧事件缺字段时沿用“所有消费都计全局账”的旧口径。
        { consumeGlobal: e.detail['consumeGlobal'] !== false },
      );
    }
  }

  return {
    concourses: order.map((id) => {
      const cur = byId.get(id)!;
      return {
        concourse: cur.concourse,
        status: cur.status,
        createdAt: cur.createdAt,
        handles: cur.handles,
        ...(cur.rootSessionId !== undefined ? { rootSessionId: cur.rootSessionId } : {}),
        budget: cur.budget,
      };
    }),
  };
}
