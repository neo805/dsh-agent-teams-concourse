/**
 * kernel/glyphs — 形状符号体系（§7.6.1 形状承载语义，NFR-3 零美术资产）。
 *
 * 三个渲染层级：
 *  · GLYPHS            —— 7 状态 × (形状, 颜色, 标签)，任意两状态形状两两可辨（P6）；
 *  · formatOverviewLine —— L0 单行总览；
 *  · renderTree         —— L2 文字树（├ └ │ ─ 连线，DFS 按输入声明序）。
 *
 * 全部纯函数，零宿主依赖。
 */

export const STATUS = ['active', 'idle', 'blocked', 'running', 'done', 'failed', 'pending'] as const;
export type Status = (typeof STATUS)[number];

export const GLYPHS: Record<Status, { shape: string; color: string; label: string }> = {
  active: { shape: '●', color: 'blue', label: '活跃' },
  idle: { shape: '○', color: 'gray', label: '空闲' },
  blocked: { shape: '◆', color: 'orange', label: '阻塞' },
  running: { shape: '▸', color: 'blue', label: '运行中' },
  done: { shape: '✓', color: 'green', label: '完成' },
  failed: { shape: '✗', color: 'red', label: '失败' },
  pending: { shape: '·', color: 'faint-gray', label: '待派' },
};

export interface TreeVertex {
  id: string;
  parent: string | null;
  role?: string;
}

/**
 * L2 文字树。DFS，兄弟按输入数组声明序。
 * 行格式：根 `{形状} {id}`；子行 `{前缀}{├─|└─}{形状} {id}{ role ? '  '+role : ''}`。
 * 缩进规则：└ 分支的子行前缀补空格，├ 分支的子行前缀补 │。
 */
export function renderTree(vertices: TreeVertex[], opts?: { status?: Record<string, Status> }): string[] {
  const status = opts?.status ?? {};
  const glyphOf = (id: string): string => {
    const s = status[id];
    return (s !== undefined ? GLYPHS[s] : GLYPHS.idle).shape; // 缺省状态 ○
  };

  // 兄弟分组，保持声明序。
  const children = new Map<string, TreeVertex[]>();
  const roots: TreeVertex[] = [];
  for (const v of vertices) {
    if (v.parent === null) {
      roots.push(v);
    } else {
      const list = children.get(v.parent);
      if (list !== undefined) list.push(v);
      else children.set(v.parent, [v]);
    }
  }

  const lines: string[] = [];
  const walk = (v: TreeVertex, prefix: string, isRoot: boolean, isLast: boolean): void => {
    const role = v.role !== undefined ? `  ${v.role}` : '';
    if (isRoot) {
      lines.push(`${glyphOf(v.id)} ${v.id}${role}`);
    } else {
      lines.push(`${prefix}${isLast ? '└─' : '├─'}${glyphOf(v.id)} ${v.id}${role}`);
    }
    const kids = children.get(v.id) ?? [];
    const childPrefix = isRoot ? prefix : prefix + (isLast ? '   ' : '│  ');
    kids.forEach((k, i) => walk(k, childPrefix, false, i === kids.length - 1));
  };
  roots.forEach((r) => walk(r, '', true, true));
  return lines;
}

/** L0 单行总览。budgetPct 缺省时省略预算段；进度条 10 格 ▰▱，四舍五入。 */
export function formatOverviewLine(stats: {
  tier: string;
  tierLabel: string;
  vertices: number;
  depth: number;
  active: number;
  openEdges: number;
  totalEdges: number;
  budgetPct?: number;
  echo: number;
  fused: number;
}): string {
  const parts = [
    `${stats.tier} ${stats.tierLabel}`,
    `${stats.vertices} 顶点`,
    `深度 ${stats.depth}`,
    `${stats.active} 活跃`,
    `开放边 ${stats.openEdges}/${stats.totalEdges}`,
  ];
  if (stats.budgetPct !== undefined) {
    const filled = Math.round(stats.budgetPct / 10);
    const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);
    parts.push(`预算 ${bar} ${stats.budgetPct}%`);
  }
  parts.push(`回声 ${stats.echo}`, `熔断 ${stats.fused}`);
  return parts.join(' · ');
}
