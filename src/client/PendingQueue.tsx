/**
 * client/PendingQueue — L1 待决队列（P2：决策优先，通常为空）。
 *
 * 空态必须显式显示「无待决事项」——队列空是常态，空而不说是信息缺失。
 */
import type { PendingItem } from './types.js';

export interface PendingQueueProps {
  readonly items: readonly PendingItem[];
  /** 动作回调：传出事项 id 与动作名。 */
  readonly onAction?: (id: string, action: string) => void;
}

export function PendingQueue({ items, onAction }: PendingQueueProps) {
  if (items.length === 0) {
    return <p className="concourse-pending-empty">无待决事项</p>;
  }
  return (
    <ul className="concourse-pending">
      {items.map((item) => (
        <li key={item.id} className="concourse-pending-item">
          <div className="concourse-pending-head">
            <strong>{item.id}</strong> {item.title}
          </div>
          {item.detail !== undefined ? <p className="concourse-pending-detail">{item.detail}</p> : null}
          {item.actions !== undefined && item.actions.length > 0 ? (
            <div className="concourse-pending-actions">
              {item.actions.map((action) => (
                <button key={action} type="button" onClick={() => onAction?.(item.id, action)}>
                  {action}
                </button>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
