/**
 * 拓扑样例矩阵（DEVELOPMENT_PLAN §4.3，≥8 例）。
 * 命名即内容：t0/t1a/t1b/t1.5/t2a 为合法样例，invalid-* 各命中一类语义错误。
 * 全部经 parseConcourse 填充默认值，类型为 Concourse（validate 的输入形态）。
 */
import { parseConcourse, type Concourse, type ConcourseInput } from '../../../src/kernel/topology/schema.js';
import { treeEdges } from '../../../src/kernel/topology/edges.js';

/** 解析并按树形默认开边（合法树形样例的公共构造）。 */
function withTreeEdges(input: ConcourseInput): Concourse {
  const base = parseConcourse(input);
  return { ...base, edges: treeEdges(base.vertices) };
}

/** 单点：仅一个 self 根，无边。 */
export const t0Single: Concourse = parseConcourse({
  id: 't0-single',
  tier: 'T0',
  vertices: [{ id: 'solo', origin: 'self' }],
});

/** 纯星型：1 根 3 子，只有树边。 */
export const t1aStar: Concourse = withTreeEdges({
  id: 't1a-star',
  tier: 'T1a',
  vertices: [
    { id: 'captain', origin: 'self' },
    { id: 'w-1', parent: 'captain', layer: 1 },
    { id: 'w-2', parent: 'captain', layer: 1 },
    { id: 'w-3', parent: 'captain', layer: 1 },
  ],
});

/** 三层树：captain → lead → {w-1, w-2}。 */
export const t1bTree: Concourse = withTreeEdges({
  id: 't1b-tree',
  tier: 'T1b',
  vertices: [
    { id: 'captain', origin: 'self' },
    { id: 'lead', parent: 'captain', layer: 1 },
    { id: 'w-1', parent: 'lead', layer: 2 },
    { id: 'w-2', parent: 'lead', layer: 2 },
  ],
});

/** 树 + 子团队内一条横向协商边（w-1 ↔ w-2 的共享板）。 */
const t15Base = parseConcourse({
  id: 't1.5-hybrid',
  tier: 'T1.5',
  vertices: [
    { id: 'captain', origin: 'self' },
    { id: 'w-1', parent: 'captain', layer: 1 },
    { id: 'w-2', parent: 'captain', layer: 1 },
  ],
});
export const t15Hybrid: Concourse = {
  ...t15Base,
  edges: [
    ...treeEdges(t15Base.vertices),
    { from: 'w-1', to: 'w-2', mode: 'board', wake: 'never', hopTTL: 2 },
  ],
};

/** 多领队并列：self 根 + 2 个 joined 根，根间开边。 */
export const t2aForest: Concourse = parseConcourse({
  id: 't2a-forest',
  tier: 'T2a',
  vertices: [
    { id: 'me', origin: 'self' },
    { id: 'alice', origin: 'joined' },
    { id: 'bob', origin: 'joined' },
  ],
  edges: [
    { from: 'me', to: 'alice', mode: 'request-reply', wake: 'on-reply' },
    { from: 'alice', to: 'me', mode: 'request-reply', wake: 'never' },
    { from: 'alice', to: 'bob', mode: 'board' },
  ],
});

/** 非法：w-1 的 parent 指向不存在的 ghost。 */
export const invalidDanglingParent: Concourse = parseConcourse({
  id: 'invalid-dangling-parent',
  tier: 'T1a',
  vertices: [
    { id: 'captain', origin: 'self' },
    { id: 'w-1', parent: 'ghost', layer: 1 },
  ],
});

/** 非法：captain→captain 自环边（声明 T1.5 以隔离 SELF_LOOP 单因）。 */
export const invalidSelfLoop: Concourse = parseConcourse({
  id: 'invalid-self-loop',
  tier: 'T1.5',
  vertices: [
    { id: 'captain', origin: 'self' },
    { id: 'w-1', parent: 'captain', layer: 1 },
  ],
  edges: [{ from: 'captain', to: 'captain' }],
});

/** 非法：声明 T1a，实际形状是 T1.5（树 + 横向边）。 */
export const invalidTierMismatch: Concourse = {
  ...t15Base,
  id: 'invalid-tier-mismatch',
  tier: 'T1a',
  edges: [
    ...treeEdges(t15Base.vertices),
    { from: 'w-1', to: 'w-2', mode: 'board', wake: 'never', hopTTL: 2 },
  ],
};

/** 全部合法样例（validate 应返回空数组）。 */
export const validFixtures: Concourse[] = [t0Single, t1aStar, t1bTree, t15Hybrid, t2aForest];
