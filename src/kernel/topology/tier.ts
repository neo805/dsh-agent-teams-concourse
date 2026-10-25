/**
 * kernel/topology/tier — 拓扑谱系判定（报告 §7.2.2）与决策树（§7.2.5）。
 *
 * classify 看「实际形状」：parent 关系构成逻辑树，开放边中不属于树边对的
 * 为横向边（子团队内协商信道）。decideTier 看「用户回答」：Q1–Q5 决策树。
 * 纯函数，零宿主依赖。
 */
import { undirectedPairKey } from '../keys.js';
import type { Edge, Tier, Vertex } from './schema.js';

/** 谱系中文标签（P6 形状语义的唯一文本载体）。 */
export const TIER_LABELS: Record<Tier, string> = {
  T0: 'T0 单体',
  T1a: 'T1a 单层领队',
  T1b: 'T1b 多层领队',
  'T1.5': 'T1.5 混合',
  T2a: 'T2a 多领队并列',
};

/**
 * 按实际形状分类：
 *  · ≤1 顶点 → T0；
 *  · 多个根（parent===null）→ T2a；
 *  · 否则有横向边 → T1.5；无横向边按最大 layer 分 T1a（≤1）/ T1b（≥2）。
 */
export function classify(vertices: Vertex[], edges: Edge[]): Tier {
  if (vertices.length <= 1) return 'T0';
  const roots = vertices.filter((v) => v.parent === null);
  if (roots.length > 1) return 'T2a';

  // 树边无序对集合（含双向：request-reply 的反向应答边同属树边，A2）
  const treePairs = new Set<string>();
  for (const v of vertices) {
    if (v.parent !== null) treePairs.add(undirectedPairKey(v.parent, v.id));
  }
  const hasLateral = edges.some((e) => !treePairs.has(undirectedPairKey(e.from, e.to)));
  if (hasLateral) return 'T1.5';

  const maxLayer = vertices.reduce((m, v) => Math.max(m, v.layer), 0);
  return maxLayer >= 2 ? 'T1b' : 'T1a';
}

/** §7.2.5 决策树的回答画像。 */
export interface TierAnswers {
  fitsInOneContext?: boolean; // Q1
  canDecomposeUpfront?: boolean; // Q2
  needsSubLayers?: boolean; // Q2.1
  subTeamNeedsConsensus?: boolean; // Q3
  hasExistingSessions?: boolean; // Q4
  joinRole?: 'child' | 'peer-leader'; // Q5
}

/**
 * 决策树（§7.2.5）：
 *  第一阶段 Q1 是→T0；Q2 是→(Q2.1 是→T1b，否→T1a)；
 *  Q2 否→(Q3 是→T1.5，否→按 needsSubLayers 取 T1b/T1a)。
 *  第二阶段（Q4/Q5）优先：hasExistingSessions 且给出 joinRole 时，
 *  child→T1.5，peer-leader→T2a，覆盖第一阶段结论。
 */
export function decideTier(a: TierAnswers): Tier {
  // 第二阶段优先：加入已存在会话的场景直接定谱系（FR-2.3）
  if (a.hasExistingSessions === true && a.joinRole !== undefined) {
    return a.joinRole === 'peer-leader' ? 'T2a' : 'T1.5';
  }
  if (a.fitsInOneContext === true) return 'T0';
  if (a.canDecomposeUpfront === true) {
    return a.needsSubLayers === true ? 'T1b' : 'T1a';
  }
  if (a.subTeamNeedsConsensus === true) return 'T1.5';
  // 决策树原文为回到 Q2.1 重新分解，此处取保守默认
  return a.needsSubLayers === true ? 'T1b' : 'T1a';
}
