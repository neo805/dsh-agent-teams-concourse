/**
 * client/types — UI 视图模型（纯类型，零依赖声明）。
 *
 * 字段与 service 的 ConcourseRecord / Ledger.echoCounts 对齐，但独立声明：
 * client 是浏览器侧独立 bundle，不允许 import service（依赖方向门禁）。
 * 宿主侧（src/index.ts）把领域快照登记为会话投影后，由面板体转配成本类型（P5 接线，见 BRIDGE.md）。
 */
import type { Status } from '../kernel/glyphs.js';

export type { Status };

/** concourse 生命周期状态（与 service/persistence 的 ConcourseStatus 对齐）。 */
export type ConcourseStatus = 'draft' | 'pending-approval' | 'running' | 'archived';

/** 顶点视图。 */
export interface VertexView {
  readonly id: string;
  readonly status: Status;
  /** 逻辑父标注（执行底座深度恒 1，仅展示用）。 */
  readonly parent: string | null;
  readonly layer: number;
  readonly role?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
}

/** 通信边视图。开放边才进入视图（deny-by-default，未列出即关闭）。 */
export interface EdgeView {
  readonly from: string;
  readonly to: string;
  readonly mode: 'request-reply' | 'notify' | 'board';
  readonly open: boolean;
}

/** 任务视图（L3 任务表行）。 */
export interface TaskView {
  readonly id: string;
  readonly subject: string;
  readonly assignee: string;
  readonly status: Status;
  readonly dependencies: readonly string[];
}

/** 回声计数（与 Ledger.echoCounts 对齐：投递 / 拒收 / 降级 / 熔断）。 */
export interface EchoCountsView {
  readonly delivered: number;
  readonly rejected: number;
  readonly degraded: number;
  readonly fused: number;
}

/** 预算视图（token 口径）。 */
export interface BudgetView {
  readonly used: number;
  readonly total: number;
}

/** concourse 总览视图（L0-L3 的输入）。 */
export interface ConcourseView {
  readonly id: string;
  readonly tier: string;
  /** 谱系中文标签（如「多层领队」），缺省只显示 tier 代号。 */
  readonly tierLabel?: string;
  readonly status: ConcourseStatus;
  readonly vertices: readonly VertexView[];
  readonly edges: readonly EdgeView[];
  readonly tasks: readonly TaskView[];
  readonly budget: BudgetView;
  readonly echo: EchoCountsView;
  /** 是否存在熔断边（L0 熔断标记）。 */
  readonly fused: boolean;
}

/** 待决事项（L1 决策优先队列条目）。 */
export interface PendingItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  /** 可选动作（渲染为按钮，回调传出 id + 动作名）。 */
  readonly actions?: readonly string[];
}

/** 谱系选项（计划审批卡段一）。 */
export interface TierOption {
  readonly tier: string;
  readonly label: string;
  readonly selected: boolean;
  /** 不可选时显式标注原因（如 T2a 需已存在会话 / T2b 本方案不提供）。 */
  readonly available: boolean;
  readonly note?: string;
}

/** 计划任务行（§7.6.3 任务表列：# 任务 依赖 负责人 模型 强度 预算 依据）。 */
export interface PlanTaskRow {
  readonly id: string;
  readonly subject: string;
  readonly dependencies: readonly string[];
  readonly assignee: string;
  readonly model: string;
  readonly effort: string;
  readonly budget: string;
  readonly rationale: string;
}

/** 计划通信边行（§7.6.3 通信表）。 */
export interface PlanEdgeRow {
  readonly from: string;
  readonly to: string;
  /** 边类别标注（树边 / 子团队内…）。 */
  readonly kind: string;
  readonly hopTTL: number;
  readonly rate?: string;
  readonly wake: boolean;
}

/** 计划审批视图（§7.6.3 唯一审批界面，一次审批信息完备）。 */
export interface PlanView {
  readonly id: string;
  readonly tiers: readonly TierOption[];
  /** 自动建议的依据（FR-4.3 可解释）。 */
  readonly tierRationale: string;
  readonly tasks: readonly PlanTaskRow[];
  readonly totalBudget: string;
  readonly costHint?: string;
  readonly edges: readonly PlanEdgeRow[];
  /** 已关闭边计数（显式声明，不隐藏）。 */
  readonly closedEdgeCount: number;
  readonly approvalStrategy: string;
  readonly approvalNotes?: readonly string[];
  /** 风险显式列出；无风险传空数组，UI 显式写「无」。 */
  readonly risks: readonly string[];
}
