/**
 * client/TaskTable — L3 任务表：任务 id / 主题 / 受托人 / 状态（双通道 StatusGlyph）。
 */
import { StatusGlyph } from './StatusGlyph.js';
import type { TaskView } from './types.js';

export interface TaskTableProps {
  readonly tasks: readonly TaskView[];
}

export function TaskTable({ tasks }: TaskTableProps) {
  if (tasks.length === 0) {
    return <p className="concourse-tasks-empty">无任务</p>;
  }
  return (
    <table className="concourse-tasks">
      <thead>
        <tr>
          <th>任务</th>
          <th>主题</th>
          <th>受托人</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>{t.id}</td>
            <td>{t.subject}</td>
            <td>{t.assignee}</td>
            <td>
              <StatusGlyph status={t.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
