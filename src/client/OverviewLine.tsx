/**
 * client/OverviewLine — L0 单行总览（P3：一行说清全局）。
 *
 * 字段：tier · 顶点数 · 活跃数 · 开放边 x/y · 预算条（▰▱ 文字条）· 回声计数 · 熔断标记。
 * 开放边总数口径：完全图无向边数 n*(n-1)/2（与 kernel schema 的 completeGraph 一致）。
 */
import type { ConcourseView } from './types.js';

export interface OverviewLineProps {
  readonly view: ConcourseView;
}

/** 预算文字条：10 格 ▰▱，四舍五入（与 kernel formatOverviewLine 同口径）。 */
export function budgetBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

/** 活跃数口径：active 与 running 都计为活跃。 */
function activeCount(view: ConcourseView): number {
  return view.vertices.filter((v) => v.status === 'active' || v.status === 'running').length;
}

export function OverviewLine({ view }: OverviewLineProps) {
  const n = view.vertices.length;
  const totalEdges = (n * (n - 1)) / 2;
  const openEdges = view.edges.filter((e) => e.open).length;
  const pct = view.budget.total > 0 ? Math.round((view.budget.used / view.budget.total) * 100) : 0;
  const tier = view.tierLabel !== undefined ? `${view.tier} ${view.tierLabel}` : view.tier;
  return (
    <div className="concourse-overview" data-testid="concourse-overview">
      <span>{tier}</span>
      {' · '}
      <span>{n} 顶点</span>
      {' · '}
      <span>{activeCount(view)} 活跃</span>
      {' · '}
      <span>
        开放边 {openEdges}/{totalEdges}
      </span>
      {' · '}
      <span>
        预算 <span aria-hidden="true">{budgetBar(pct)}</span> {pct}%
      </span>
      {' · '}
      <span>
        回声 {view.echo.delivered} · 拒 {view.echo.rejected} · 降 {view.echo.degraded}
      </span>
      {' · '}
      <span>熔断 {view.echo.fused}</span>
      {view.fused ? (
        <span data-fused="true" style={{ color: '#DC2626' }}>
          {' '}
          ◆ 已熔断
        </span>
      ) : null}
    </div>
  );
}
