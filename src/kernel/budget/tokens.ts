/**
 * kernel/budget/tokens —— 成本估算（估算口径，非计费）。
 *
 * 用途：计划期预算条展示 + FR-2.6 校验（预算总和溢出在计划期报错而非运行时）。
 *
 * 确定性启发式（同输入必同输出）：
 *   estimate = base 8000 + cognitive×4000 + contextTokens + toolCalls×2000
 *   顶点级再乘 effort 系数：low×0.6 / high×1.8 / 其他（含缺省）×1。
 * profile 缺省维度按 schema 默认（DifficultyProfile：cognitive=3, contextTokens=0, toolCalls=0）。
 * estimateTaskTokens 是单任务视角，不乘系数；estimateConcourseBudget 按任务 assignee
 * 查顶点 reasoningEffort 乘系数，perVertex 汇总，total 为总和。
 */
import type { Concourse, TaskSpec } from '../topology/schema.js';

const BASE = 8000;
const COGNITIVE_UNIT = 4000;
const TOOL_CALL_UNIT = 2000;

/** schema 默认画像维度（DifficultyProfile .default 值）。 */
const DEFAULT_COGNITIVE = 3;

/** reasoningEffort → 成本系数；未知/缺省一律 1（保守口径）。 */
const EFFORT_FACTOR: Record<string, number> = {
  low: 0.6,
  high: 1.8,
};

/**
 * 单任务 token 估算（单任务视角，不乘 effort 系数）。
 * 确定性：同输入必同输出。
 */
export function estimateTaskTokens(task: TaskSpec): number {
  const profile = task.profile ?? {};
  const cognitive = profile.cognitive ?? DEFAULT_COGNITIVE;
  const contextTokens = profile.contextTokens ?? 0;
  const toolCalls = profile.toolCalls ?? 0;
  return BASE + cognitive * COGNITIVE_UNIT + contextTokens + toolCalls * TOOL_CALL_UNIT;
}

/**
 * 整个 concourse 的预算估算：按任务 assignee 归到顶点，
 * 顶点 reasoningEffort 乘系数（low×0.6 / high×1.8 / 其他×1），
 * perVertex 为各顶点汇总，total 为总和。
 */
export function estimateConcourseBudget(c: Concourse): {
  total: number;
  perVertex: Record<string, number>;
} {
  const effortByVertex = new Map<string, string | undefined>(
    c.vertices.map((v) => [v.id, v.reasoningEffort]),
  );
  const perVertex: Record<string, number> = {};
  let total = 0;
  for (const task of c.tasks) {
    const effort = effortByVertex.get(task.assignee);
    const factor = (effort !== undefined ? EFFORT_FACTOR[effort] : undefined) ?? 1;
    const est = estimateTaskTokens(task) * factor;
    perVertex[task.assignee] = (perVertex[task.assignee] ?? 0) + est;
    total += est;
  }
  return { total, perVertex };
}
