/**
 * client/index — 客户端入口（浏览器侧独立 bundle，dist/client/index.cjs）。
 *
 * 注册右侧面板（调研结论见 BRIDGE.md，两阶段）：
 *   1. ctx.sidebarRightTabs.register(definition)：页型静态定义（kind=concourse），
 *      由 ctx.effect 托管 disposer；
 *   2. ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({...}, Component))：
 *      keyed/session 面板体，按页型定义 id 作为 slot key 派发。
 *
 * 纪律：防御式装配——宿主服务缺席时跳过；注册抛错不阻断宿主其它插件，
 * 但必须留下 warning，不能把契约漂移静默吞掉（NFR-2 + 可诊断性）。
 *
 * TODO(P7 数据桥)：面板体暂用空视图占位。宿主侧把 ConcourseService 快照登记为
 * 'concourse' 会话投影后，面板体改为从 ctx.sessions 投影读取并转配成
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

/** 空视图占位：数据桥接（P7）前面板体的默认渲染输入。 */
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

/** 面板体：TODO(P7) 从 ctx.sessions 的 'concourse' 会话投影读取真实视图。 */
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
  /** cordis effect：接收注册函数并返回其 disposer（随 caller ctx 卸载）。 */
  effect?(register: () => unknown): unknown;
  logger?: { warn?(message: string): void } | undefined;
}

export function apply(ctx?: unknown): void {
  const c = (ctx ?? {}) as ClientCtxLike;
  const warn = (step: string, err: unknown): void => {
    try {
      c.logger?.warn?.(
        `[concourse] 客户端 ${step} 注册失败（已降级，不阻断宿主）：${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      // logger 自身失败也绝不外抛
    }
  };

  // 阶段 1：页型定义。服务缺席时整体跳过，避免制造半注册。
  const tabs = c.sidebarRightTabs;
  if (tabs?.register === undefined) return;
  try {
    const registerTab = (): unknown =>
      tabs.register?.({
        id: TAB_DEFINITION_ID,
        kind: TAB_KIND,
        title: () => 'Concourse',
        priority: 'extension',
      });
    if (typeof c.effect === 'function') c.effect(registerTab);
    else registerTab();
  } catch (err) {
    warn('页型', err);
    return;
  }

  // 阶段 2：keyed 面板体。当前宿主契约必填 key（不是页型定义的 id 字段）。
  try {
    c.slots?.inject?.('sidebar.right.pane.tab', () => {
      try {
        return c.slots?.register?.(
          { name: 'sidebar.right.pane.tab', key: TAB_DEFINITION_ID },
          ConcoursePanelEntry,
        );
      } catch (err) {
        warn('面板体', err);
        return () => undefined;
      }
    });
  } catch (err) {
    warn('面板体', err);
  }
}
