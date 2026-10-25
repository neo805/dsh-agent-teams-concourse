/**
 * kernel/topology/edges — 开放边集的纯函数操作（报告 §7.2.1）。
 *
 * 底座物理上是完全图，这里只操作「开放边集」；未声明即关闭
 * （deny-by-default）。所有更新函数不可变：返回新数组，不改入参。
 */
import type { Edge, Vertex } from './schema.js';

/** 有向完全图的边容量 n(n-1)；UI 与工具的“开放边 x/y”统一使用本口径。 */
export function directedEdgeCapacity(vertexCount: number): number {
  return Math.max(0, vertexCount) * Math.max(0, vertexCount - 1);
}

/** n(n-1) 个有序对，按输入顺序稳定枚举（先行后列）。 */
export function completeGraphPairs(ids: string[]): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (const from of ids) {
    for (const to of ids) {
      if (from !== to) pairs.push({ from, to });
    }
  }
  return pairs;
}

/** 精确匹配有向边；A→B 不蕴含 B→A（A2 半双工）。 */
export function findEdge(edges: Edge[], from: string, to: string): Edge | undefined {
  return edges.find((e) => e.from === from && e.to === to);
}

/** deny-by-default：只在开放边集中显式声明的边才开放。 */
export function isOpen(edges: Edge[], from: string, to: string): boolean {
  return findEdge(edges, from, to) !== undefined;
}

/** 不可变开边：同 (from,to) 已存在则替换，否则追加。 */
export function openEdge(edges: Edge[], edge: Edge): Edge[] {
  const idx = edges.findIndex((e) => e.from === edge.from && e.to === edge.to);
  if (idx === -1) return [...edges, edge];
  return edges.map((e, i) => (i === idx ? edge : e));
}

/** 不可变闭边：删除同 (from,to) 的边（不存在则返回内容相同的新数组）。 */
export function closeEdge(edges: Edge[], from: string, to: string): Edge[] {
  return edges.filter((e) => !(e.from === from && e.to === to));
}

/**
 * request-reply 的反向应答绑定（§7.2.1/A2）：
 * 应答边 wake=never（投递不唤醒，最强防回声手段），hopTTL 与正向相同。
 * 其他模式原样返回。
 */
export function withReverseAck(edge: Edge): Edge[] {
  if (edge.mode !== 'request-reply') return [edge];
  const ack: Edge = {
    from: edge.to,
    to: edge.from,
    mode: 'request-reply',
    wake: 'never',
    hopTTL: edge.hopTTL,
  };
  return [edge, ack];
}

/**
 * 按树形默认开边：每个非根顶点生成 parent→child 请求边
 * （mode=request-reply, wake=on-reply, hopTTL=2）及反向应答边。
 */
export function treeEdges(vertices: Vertex[]): Edge[] {
  const edges: Edge[] = [];
  for (const v of vertices) {
    if (v.parent === null) continue;
    edges.push(
      ...withReverseAck({
        from: v.parent,
        to: v.id,
        mode: 'request-reply',
        wake: 'on-reply',
        hopTTL: 2,
      }),
    );
  }
  return edges;
}
