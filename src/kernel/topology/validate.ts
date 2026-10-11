/**
 * kernel/topology/validate — concourse 语义校验（schema 之外的图规则）。
 *
 * 计划期权威校验（FR-2.6）：所有问题一次性返回，不 throw；
 * 空数组 = 通过。message 中文面向用户，path 给出定位。
 */
import type { Concourse, Vertex } from './schema.js';
import { classify } from './tier.js';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface CapacityLimits {
  maxVertices: number;
}

/** 默认容量：宿主 maxActiveSubagents 默认值（FR-2.6）。 */
const DEFAULT_LIMITS: CapacityLimits = { maxVertices: 8 };

export function validateConcourse(
  c: Concourse,
  limits: Partial<CapacityLimits> = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string, path?: string): void => {
    // exactOptionalPropertyTypes：path 缺省时不写该键
    issues.push(path === undefined ? { code, message } : { code, message, path });
  };
  const maxVertices = limits.maxVertices ?? DEFAULT_LIMITS.maxVertices;

  // ── 容量（计划期报错，而非运行时） ──
  if (c.vertices.length > maxVertices) {
    push(
      'TOO_MANY_VERTICES',
      `顶点数 ${c.vertices.length} 超过上限 ${maxVertices}（宿主 maxActiveSubagents 默认值）`,
      'vertices',
    );
  }

  // ── 顶点 id：重复检测 + 首个出现索引 ──
  const byId = new Map<string, Vertex>();
  c.vertices.forEach((v, i) => {
    if (byId.has(v.id)) {
      push('DUPLICATE_VERTEX_ID', `顶点 id「${v.id}」重复出现`, `vertices[${i}].id`);
    } else {
      byId.set(v.id, v);
    }
  });

  // ── 边：自环 / 重复 / 悬挂端点 ──
  const seenEdges = new Set<string>();
  c.edges.forEach((e, i) => {
    if (e.from === e.to) {
      push('SELF_LOOP', `边 ${e.from}→${e.to} 是自环，无意义`, `edges[${i}]`);
    }
    const key = `${e.from}→${e.to}`;
    if (seenEdges.has(key)) {
      push('DUPLICATE_EDGE', `边 ${key} 重复声明`, `edges[${i}]`);
    } else {
      seenEdges.add(key);
    }
    if (!byId.has(e.from)) {
      push('DANGLING_EDGE_ENDPOINT', `边起点「${e.from}」不存在于顶点集`, `edges[${i}].from`);
    }
    if (!byId.has(e.to)) {
      push('DANGLING_EDGE_ENDPOINT', `边终点「${e.to}」不存在于顶点集`, `edges[${i}].to`);
    }
  });

  // ── parent：悬挂引用 / 环 / layer 深度 ──
  c.vertices.forEach((v, i) => {
    if (v.parent !== null && !byId.has(v.parent)) {
      push(
        'DANGLING_PARENT',
        `顶点「${v.id}」的 parent「${v.parent}」不存在于顶点集`,
        `vertices[${i}].parent`,
      );
    }
  });

  /** 沿 parent 链到根的深度；悬挂或成环返回 null（已另行上报，跳过 layer 判定）。 */
  const parentDepth = (v: Vertex): number | null => {
    let depth = 0;
    let cur: Vertex = v;
    const seen = new Set<string>([v.id]);
    while (cur.parent !== null) {
      const p = byId.get(cur.parent);
      if (p === undefined) return null; // 悬挂
      if (seen.has(p.id)) return null; // 成环
      seen.add(p.id);
      depth += 1;
      cur = p;
    }
    return depth;
  };

  c.vertices.forEach((v, i) => {
    // 环检测：沿链回访到已见顶点
    const seen = new Set<string>([v.id]);
    let cur = v;
    while (cur.parent !== null) {
      const p = byId.get(cur.parent);
      if (p === undefined) break;
      if (seen.has(p.id)) {
        push('PARENT_CYCLE', `顶点「${v.id}」的 parent 链成环（回到「${p.id}」）`, `vertices[${i}].parent`);
        break;
      }
      seen.add(p.id);
      cur = p;
    }
    // layer 一致性：根 = 0
    const d = parentDepth(v);
    if (d !== null && d !== v.layer) {
      push(
        'LAYER_MISMATCH',
        `顶点「${v.id}」标注 layer=${v.layer}，但沿 parent 链到根的深度为 ${d}`,
        `vertices[${i}].layer`,
      );
    }
  });

  // ── origin 与根的一致性 ──
  const selfCount = c.vertices.filter((v) => v.origin === 'self').length;
  if (selfCount > 1) {
    push('MULTIPLE_SELF', `存在 ${selfCount} 个 origin=self 的顶点，一个 concourse 至多 1 个`, 'vertices');
  }
  c.vertices.forEach((v, i) => {
    if (v.origin === 'self' && v.parent !== null) {
      push('SELF_NOT_ROOT', `origin=self 的顶点「${v.id}」必须是根（parent 应为 null）`, `vertices[${i}].parent`);
    }
    if (v.origin === 'spawned' && v.parent === null) {
      push('SPAWNED_IS_ROOT', `origin=spawned 的顶点「${v.id}」必须有逻辑父（parent 不能为 null）`, `vertices[${i}].parent`);
    }
  });

  // ── 根数量与 tier 的匹配 ──
  const roots = c.vertices.filter((v) => v.parent === null);
  if (c.tier === 'T2a') {
    if (roots.length < 2) {
      push('ROOT_COUNT_MISMATCH', `tier T2a 要求至少 2 个根顶点，实际 ${roots.length} 个`, 'vertices');
    }
    // T2a 唯一来源是「加入已存在会话」（FR-2.3）
    for (const r of roots) {
      if (r.origin !== 'self' && r.origin !== 'joined') {
        push(
          'T2A_ROOT_NOT_JOINED',
          `T2a 中非 self 的根「${r.id}」必须 origin=joined（实际 ${r.origin}）`,
          'vertices',
        );
      }
    }
  } else if (roots.length !== 1) {
    push('ROOT_COUNT_MISMATCH', `tier ${c.tier} 要求恰好 1 个根顶点，实际 ${roots.length} 个`, 'vertices');
  }

  // ── 任务：assignee / 依赖 / 依赖环 ──
  const taskById = new Map(c.tasks.map((t) => [t.id, t]));
  c.tasks.forEach((t, i) => {
    if (!byId.has(t.assignee)) {
      push('DANGLING_ASSIGNEE', `任务「${t.id}」的 assignee「${t.assignee}」不存在于顶点集`, `tasks[${i}].assignee`);
    }
    t.dependencies.forEach((dep, j) => {
      if (!taskById.has(dep)) {
        push('DANGLING_DEPENDENCY', `任务「${t.id}」依赖的「${dep}」不存在于任务集`, `tasks[${i}].dependencies[${j}]`);
      }
    });
  });
  c.tasks.forEach((t, i) => {
    // 依赖环检测：沿 dependencies 回访到已见任务
    const seen = new Set<string>([t.id]);
    const stack = [...t.dependencies];
    let cyclic = false;
    // 深度优先遍历依赖闭包
    while (stack.length > 0 && !cyclic) {
      const depId = stack.pop();
      if (depId === undefined) break;
      if (seen.has(depId)) {
        if (depId === t.id) cyclic = true;
        continue;
      }
      seen.add(depId);
      const dep = taskById.get(depId);
      if (dep !== undefined) stack.push(...dep.dependencies);
    }
    if (cyclic) {
      push('DEPENDENCY_CYCLE', `任务「${t.id}」的依赖链成环`, `tasks[${i}].dependencies`);
    }
  });

  // ── 预算：顶点预算之和不得超过 concourse 预算 ──
  if (c.budget?.tokens !== undefined) {
    const total = c.vertices.reduce((sum, v) => sum + (v.budget?.tokens ?? 0), 0);
    if (total > c.budget.tokens) {
      push(
        'BUDGET_OVERFLOW',
        `各顶点预算之和 ${total} 超过 concourse 总预算 ${c.budget.tokens} tokens`,
        'budget.tokens',
      );
    }
  }

  // ── 声明 tier 与实际形状一致 ──
  const actual = classify(c.vertices, c.edges);
  if (actual !== c.tier) {
    push('DECLARED_TIER_MISMATCH', `声明 tier=${c.tier}，但实际拓扑形状为 ${actual}`, 'tier');
  }

  return issues;
}
