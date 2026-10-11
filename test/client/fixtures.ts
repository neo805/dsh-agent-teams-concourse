/**
 * 客户端测试夹具：典型 T1b concourse 视图与计划视图。
 */
import type { ConcourseView, PlanView, PendingItem } from '../../src/client/types.js';

/** T1b：captain + sub-lead-A/B + w-1/w-2/w-3，共 6 顶点 4 条开放边。 */
export function sampleView(): ConcourseView {
  return {
    id: 'release-v3',
    tier: 'T1b',
    tierLabel: '多层领队',
    status: 'running',
    vertices: [
      { id: 'captain', status: 'active', parent: null, layer: 0, role: '领队', model: 'sonnet', reasoningEffort: 'mid' },
      { id: 'sub-lead-A', status: 'blocked', parent: 'captain', layer: 1, model: 'sonnet', reasoningEffort: 'mid' },
      { id: 'sub-lead-B', status: 'blocked', parent: 'captain', layer: 1, model: 'sonnet', reasoningEffort: 'mid' },
      { id: 'w-1', status: 'idle', parent: 'sub-lead-A', layer: 2, role: 'schema', model: 'flash', reasoningEffort: 'lo' },
      { id: 'w-2', status: 'active', parent: 'sub-lead-A', layer: 2, role: 'api', model: 'flash', reasoningEffort: 'lo' },
      { id: 'w-3', status: 'idle', parent: 'sub-lead-B', layer: 2, role: 'tests', model: 'flash', reasoningEffort: 'lo' },
    ],
    edges: [
      { from: 'captain', to: 'sub-lead-A', mode: 'request-reply', open: true },
      { from: 'captain', to: 'sub-lead-B', mode: 'request-reply', open: true },
      { from: 'sub-lead-A', to: 'w-1', mode: 'notify', open: true },
      { from: 'sub-lead-A', to: 'w-2', mode: 'notify', open: true },
    ],
    tasks: [
      { id: 'T-1', subject: '设计 schema', assignee: 'w-1', status: 'done', dependencies: [] },
      { id: 'T-2', subject: '实现 API', assignee: 'w-2', status: 'running', dependencies: ['T-1'] },
      { id: 'T-3', subject: '集成测试', assignee: 'w-3', status: 'pending', dependencies: ['T-2'] },
    ],
    budget: { used: 61000, total: 100000 },
    echo: { delivered: 12, rejected: 1, degraded: 2, fused: 0 },
    fused: false,
  };
}

export function samplePending(): PendingItem[] {
  return [
    {
      id: 'T-7',
      title: '修复范围超出 inScope',
      detail: '顶点 w-2 请求扩大修改范围',
      actions: ['允许', '改范围', '换人'],
    },
  ];
}

export function samplePlan(): PlanView {
  return {
    id: 'release-v3',
    tiers: [
      { tier: 'T1a', label: '单层', selected: false, available: true },
      { tier: 'T1b', label: '多层', selected: true, available: true },
      { tier: 'T1.5', label: '混合', selected: false, available: true },
      { tier: 'T2a', label: '并列', selected: false, available: false, note: '需你先加入其它已存在的会话' },
      { tier: 'T2b', label: '全扁平', selected: false, available: false, note: '本方案不提供' },
    ],
    tierRationale: '4 个独立子系统，且各子系统需再分解',
    tasks: [
      { id: 'T-1', subject: '设计 schema', dependencies: [], assignee: 'sub-A', model: 'sonnet-4.5', effort: 'mid', budget: '40k', rationale: '结构设计' },
      { id: 'T-2', subject: '实现 API', dependencies: ['T-1'], assignee: 'sub-A', model: 'sonnet-4.5', effort: 'mid', budget: '80k', rationale: '多文件改动' },
      { id: 'T-4', subject: '安全审计', dependencies: ['T-2'], assignee: 'sec', model: 'opus-4', effort: 'hi', budget: '50k', rationale: '高风险' },
    ],
    totalBudget: '170k',
    costHint: '≈ ¥1.6',
    edges: [
      { from: 'captain', to: 'sub-A', kind: '树边', hopTTL: 2, rate: '3/10min', wake: true },
      { from: 'sub-A', to: 'w-1', kind: '子团队内', hopTTL: 1, rate: '5/10min', wake: false },
    ],
    closedEdgeCount: 17,
    approvalStrategy: '一次批准，此后运行期零审批',
    approvalNotes: ['子节点不具备建队能力，因此运行期不会再有组队审批打断你。'],
    risks: ['T-4 安全审计使用高风险工具白名单'],
  };
}
