/**
 * service/persistence —— JSONL 追加日志 + 启动回放（NFR-4，MVP 极简口径）。
 *
 *  · createJsonlStore(path) 与 createMemoryStore() 同构：{ append(event), load() }；
 *    JSONL 一行一事件，append 追加写，load 全量读（MVP 不做快照压缩）。
 *  · replay(events) 是纯函数：从台账事件流重建 service 状态——
 *    concourse 生命周期状态机 + 顶点句柄 + 预算台账（BudgetBook 确定性重演）。
 *  · 事件源：Ledger 的 sink；service 的全部状态变更都以台账事件落盘。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { BudgetBook } from '../kernel/comms/budget.js';
import { parseConcourse, type Concourse } from '../kernel/topology/schema.js';
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

/** JSONL 追加日志存储（node:fs；service 层允许 node:* 用于落盘）。 */
export function createJsonlStore(path: string): EventStore {
  return {
    append(event) {
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
  readonly handles: readonly VertexHandle[];
  /** 预算台账（从 create 事件的预算声明初始化，consume 事件确定性重演）。 */
  readonly budget: BudgetBook;
}

/** replay 输出：可直接注入 ConcourseService 构造器（snapshot）恢复运行。 */
export interface ReplayState {
  readonly concourses: readonly ReplayConcourse[];
}

function bookFromConcourse(c: Concourse): BudgetBook {
  const edgeBudgets: Record<string, number> = {};
  for (const e of c.edges) {
    if (e.budget?.tokens !== undefined) edgeBudgets[BudgetBook.edgeKey(e.from, e.to)] = e.budget.tokens;
  }
  return new BudgetBook({
    edgeBudgets,
    ...(c.budget?.tokens !== undefined ? { globalBudget: c.budget.tokens } : {}),
  });
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
    handles: VertexHandle[];
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
        handles: [],
        budget: bookFromConcourse(concourse),
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
      } else if (e.action === 'reject') cur.status = 'draft';
      else if (e.action === 'archive') cur.status = 'archived';
    } else if (e.kind === 'budget' && e.action === 'consume') {
      // 确定性重演：同一 consume 序列必然重建同一账目状态
      cur.budget.consumeEdge(
        e.detail['from'] as string,
        e.detail['to'] as string,
        e.detail['tokens'] as number,
      );
    }
  }

  return {
    concourses: order.map((id) => {
      const cur = byId.get(id)!;
      return {
        concourse: cur.concourse,
        status: cur.status,
        handles: cur.handles,
        budget: cur.budget,
      };
    }),
  };
}
