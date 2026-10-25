/**
 * kernel/budget/normalize — 计划期预算规范化（preview 与 create 的唯一入口）。
 *
 * 规则：
 *  · 顶点未声明 tokens 且有任务估算 → 回填该顶点估算；
 *  · concourse 未声明总预算且有任务可估算 → 回填 max(total, 顶点预算合计)，
 *    避免逐顶点向上取整后反而超过自动生成的总预算；
 *  · 显式声明的一切预算原样保留，由 validate 统一检查 overflow。
 *
 * 纯函数、零宿主依赖；team_topology 预览与 ConcourseService.create 必须共用。
 */
import type { Concourse } from '../topology/schema.js';
import { estimateConcourseBudget, type EstimateResult } from './tokens.js';

export interface NormalizedConcourse {
  readonly concourse: Concourse;
  readonly estimate: EstimateResult;
}

/**
 * 规范化预算并返回本次估算，供 preview/plan 复用同一个结果，避免二次全量扫描。
 */
export function normalizeConcourseBudgetsWithEstimate(c: Concourse): NormalizedConcourse {
  const estimate = estimateConcourseBudget(c);
  const vertices = c.vertices.map((v) => {
    if (v.budget?.tokens !== undefined) return v;
    const per = estimate.perVertex[v.id];
    if (per === undefined || per <= 0) return v;
    return { ...v, budget: { ...v.budget, tokens: Math.ceil(per) } };
  });

  let budget = c.budget;
  if (budget?.tokens === undefined && estimate.total > 0) {
    const vertexTotal = vertices.reduce((sum, v) => sum + (v.budget?.tokens ?? 0), 0);
    budget = { tokens: Math.max(Math.ceil(estimate.total), vertexTotal) };
  }

  return { concourse: { ...c, vertices, ...(budget !== undefined ? { budget } : {}) }, estimate };
}

/** 兼容旧调用：只取规范化后的 concourse。 */
export function normalizeConcourseBudgets(c: Concourse): Concourse {
  return normalizeConcourseBudgetsWithEstimate(c).concourse;
}
