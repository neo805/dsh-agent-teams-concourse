/**
 * client/TopologyTree — L2 文字拓扑树（kernel renderTree 渲染）。
 *
 * P4 原则：默认折叠处必须显式声明隐藏内容（「▸ N 个顶点已折叠」），
 * 直接规避"成员看起来消失了"的缺陷。
 *
 * 折叠语义：collapsedIds 中的顶点自身仍渲染（附折叠声明），其全部后代隐藏；
 * 隐藏顶点的可见后代（不存在于此模型——折叠即整支隐藏）父指针重映射到最近可见祖先。
 */
import { renderTree, type Status, type TreeVertex } from '../kernel/glyphs.js';
import type { VertexView } from './types.js';

export interface TopologyTreeProps {
  readonly vertices: readonly VertexView[];
  /** 折叠的顶点 id 集（自身可见，后代隐藏并显式声明计数）。 */
  readonly collapsedIds?: readonly string[];
}

/** id → 顶点索引。 */
function indexOf(vertices: readonly VertexView[]): Map<string, VertexView> {
  return new Map(vertices.map((v) => [v.id, v]));
}

/** 计算每个折叠顶点的后代总数（含间接后代）。 */
function descendantCounts(vertices: readonly VertexView[], collapsed: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  const byId = indexOf(vertices);
  const childrenOf = new Map<string, string[]>();
  for (const v of vertices) {
    if (v.parent !== null) {
      const list = childrenOf.get(v.parent) ?? [];
      list.push(v.id);
      childrenOf.set(v.parent, list);
    }
  }
  for (const id of collapsed) {
    if (!byId.has(id)) continue;
    let count = 0;
    const stack = [...(childrenOf.get(id) ?? [])];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      count += 1;
      stack.push(...(childrenOf.get(cur) ?? []));
    }
    counts.set(id, count);
  }
  return counts;
}

/** 顶点是否被某个折叠祖先隐藏。 */
function hiddenSet(vertices: readonly VertexView[], collapsed: ReadonlySet<string>): Set<string> {
  const byId = indexOf(vertices);
  const hidden = new Set<string>();
  for (const v of vertices) {
    let cur = v.parent;
    const guard = new Set<string>();
    while (cur !== null && !guard.has(cur)) {
      guard.add(cur);
      if (collapsed.has(cur)) {
        hidden.add(v.id);
        break;
      }
      cur = byId.get(cur)?.parent ?? null;
    }
  }
  return hidden;
}

export function TopologyTree({ vertices, collapsedIds = [] }: TopologyTreeProps) {
  const collapsed = new Set(collapsedIds);
  const hidden = hiddenSet(vertices, collapsed);
  const visible = vertices.filter((v) => !hidden.has(v.id));
  const visibleIds = new Set(visible.map((v) => v.id));
  const byId = indexOf(vertices);
  // 父指针重映射：若父被隐藏（理论上折叠即整支隐藏，防御父缺链），升到最近可见祖先
  const remapped: TreeVertex[] = visible.map((v) => {
    let parent = v.parent;
    const guard = new Set<string>();
    while (parent !== null && !visibleIds.has(parent) && !guard.has(parent)) {
      guard.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
    if (parent !== null && !visibleIds.has(parent)) parent = null;
    return {
      id: v.id,
      parent,
      ...(v.role !== undefined ? { role: v.role } : {}),
    };
  });
  const status: Record<string, Status> = {};
  for (const v of visible) status[v.id] = v.status;

  const lines = renderTree(remapped, { status });
  const counts = descendantCounts(vertices, collapsed);
  // 折叠声明：附在折叠顶点所在行末尾（行内含 `形状 id` 片段）
  const annotated = lines.map((line) => {
    for (const [id, count] of counts) {
      if (line.includes(` ${id}`)) {
        return `${line}（▸ ${count} 个顶点已折叠）`;
      }
    }
    return line;
  });

  return (
    <pre className="concourse-topology" data-testid="concourse-topology">
      {annotated.join('\n')}
    </pre>
  );
}
