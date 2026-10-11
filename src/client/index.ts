/**
 * client/index — 客户端入口（浏览器侧独立 bundle，dist/client/index.js）。
 *
 * 注册右侧面板（调研结论见 BRIDGE.md，两阶段）：
 *   1. ctx.sidebarRightTabs.register(definition)：页型静态定义（kind=concourse）；
 *   2. ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({...}, Component))：
 *      keyed/session 面板体，按定义 id 派发。
 *
 * 纪律：防御式装配——宿主服务缺席或注册抛错一律吞掉（NFR-2：客户端异常永不阻断宿主）。
 *
 * TODO(P5 数据桥)：面板体暂用空视图占位。宿主侧（src/index.ts）把 ConcourseService
 * 快照登记为 'concourse' 会话投影后，面板体改为从 ctx.sessions 投影读取并转配成
 * ConcourseView（见 BRIDGE.md「本项目 MVP 口径」）。
 */
import { createElement } from 'react';
import { ConcoursePanel } from './ConcoursePanel.js';
import type { ConcourseView } from './types.js';

export const name = 'dsh-agent-teams-concourse-client';

/** cordis 依赖注入声明（web 平台服务名）。 */
export const inject = ['sidebarRightTabs', 'slots'];

/** 页型定义 id / kind（sidebar.right.pane.tab 的 keyed 派发键）。 */
export const TAB_DEFINITION_ID = 'dsh-agent-teams-concourse';
export const TAB_KIND = 'concourse';

/** 空视图占位：数据桥接（P5）前面板体的默认渲染输入。 */
const EMPTY_VIEW: ConcourseView = {
  id: '—',
  tier: '—',
  status: 'draft',
  vertices: [],
  edges: [],
  tasks: [],
  budget: { used: 0, total: 0 },
  echo: { delivered: 0, rejected: 0, degraded: 0, fused: 0 },
  fused: false,
};

/** 面板体：TODO(P5) 从 ctx.sessions 的 'concourse' 会话投影读取真实视图。 */
export function ConcoursePanelEntry() {
  return createElement(ConcoursePanel, { view: EMPTY_VIEW, pending: [] });
}

/** 宿主上下文最小结构面（防御式：任何字段缺席都跳过该注册步骤）。 */
interface ClientCtxLike {
  sidebarRightTabs?: { register?(definition: unknown): unknown } | undefined;
  slots?:
    | {
        inject?(slotName: string, factory: () => unknown): unknown;
        register?(definition: unknown, component: unknown): unknown;
      }
    | undefined;
}

export function apply(ctx?: unknown): void {
  const c = (ctx ?? {}) as ClientCtxLike;
  // 阶段 1：页型定义（静态：kind / 标题）
  try {
    c.sidebarRightTabs?.register?.({
      id: TAB_DEFINITION_ID,
      kind: TAB_KIND,
      title: () => 'Concourse',
      priority: 'extension',
    });
  } catch {
    // 注册失败不阻断：面板缺席优于宿主崩溃
  }
  // 阶段 2：keyed 面板体
  try {
    c.slots?.inject?.('sidebar.right.pane.tab', () =>
      c.slots?.register?.(
        { name: 'sidebar.right.pane.tab', id: TAB_DEFINITION_ID },
        ConcoursePanelEntry,
      ),
    );
  } catch {
    // 同上：静默降级
  }
}
