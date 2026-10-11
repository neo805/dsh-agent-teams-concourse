/**
 * client/ConcoursePanel — 右侧面板组装：L0-L3 纵向排列（§7.6.2）。
 *
 * L0 单行总览 → L1 待决队列（决策优先，置顶）→ L2 文字拓扑树 → L3 任务表。
 */
import { OverviewLine } from './OverviewLine.js';
import { PendingQueue } from './PendingQueue.js';
import { TopologyTree } from './TopologyTree.js';
import { TaskTable } from './TaskTable.js';
import type { ConcourseView, PendingItem } from './types.js';

export interface ConcoursePanelProps {
  readonly view: ConcourseView;
  readonly pending: readonly PendingItem[];
  readonly collapsedIds?: readonly string[];
  readonly onPendingAction?: (id: string, action: string) => void;
}

export function ConcoursePanel({ view, pending, collapsedIds, onPendingAction }: ConcoursePanelProps) {
  return (
    <div className="concourse-panel" data-testid="concourse-panel">
      <section className="concourse-panel-l0" aria-label="总览">
        <OverviewLine view={view} />
      </section>
      <section className="concourse-panel-l1" aria-label="待决">
        <h4>待你决定 ({pending.length})</h4>
        <PendingQueue items={pending} {...(onPendingAction !== undefined ? { onAction: onPendingAction } : {})} />
      </section>
      <section className="concourse-panel-l2" aria-label="拓扑">
        <h4>拓扑</h4>
        <TopologyTree vertices={view.vertices} {...(collapsedIds !== undefined ? { collapsedIds } : {})} />
      </section>
      <section className="concourse-panel-l3" aria-label="任务">
        <h4>任务</h4>
        <TaskTable tasks={view.tasks} />
      </section>
    </div>
  );
}
