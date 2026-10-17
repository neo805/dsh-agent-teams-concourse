/**
 * kernel/topology/schema — concourse 数据模型（报告 §7.8.1）。
 *
 * 核心架构事实（§7.1.2 虚拟拓扑）：
 *  · 底座物理上是完全图（completeGraph），本模块只声明「开放边集」；
 *  · 执行底座深度恒为 1（depthAlwaysOne），layer/parent 仅是权限与可见性标注；
 *  · 未列出的边一律关闭（deny-by-default，§7.2.1 失败模式不对称分析）。
 *
 * 本模块是纯数据定义 + zod 校验，零宿主依赖（NFR-5）。
 */
import { z } from 'zod';

/** 拓扑谱系（§7.2.2）。T2b 全扁平不提供——在 schema 层即不可表达。 */
export const Tier = z.enum(['T0', 'T1a', 'T1b', 'T1.5', 'T2a']);
export type Tier = z.infer<typeof Tier>;

/** 顶点来源（§7.2.1）：self=用户直接对话的领队；spawned=本次任务派生；joined=用户中途拉入的已存在会话。 */
export const VertexOrigin = z.enum(['self', 'spawned', 'joined']);
export type VertexOrigin = z.infer<typeof VertexOrigin>;

export const Lifecycle = z.enum(['task', 'resident']);
export type Lifecycle = z.infer<typeof Lifecycle>;

export const ContextMode = z.enum(['spawn', 'fork']);
export type ContextMode = z.infer<typeof ContextMode>;

export const ToolFilter = z.object({
  allow: z.array(z.string().min(1)).optional(),
  deny: z.array(z.string().min(1)).optional(),
});
export type ToolFilter = z.infer<typeof ToolFilter>;

export const VertexBudget = z.object({
  tokens: z.number().int().positive().optional(),
  wallclockMs: z.number().int().positive().optional(),
});
export type VertexBudget = z.infer<typeof VertexBudget>;

export const Vertex = z.object({
  id: z.string().min(1),
  origin: VertexOrigin.default('spawned'),
  /** 逻辑父标注，不构成真实派生（所有顶点都是会话的直接子代理）。 */
  parent: z.string().min(1).nullable().default(null),
  /** 权限与可见性层标注：根 = 0。 */
  layer: z.number().int().min(0).default(0),
  /** 纯语义提示，不参与权限判定（§7.2.1）。 */
  role: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  lifecycle: Lifecycle.default('task'),
  contextMode: ContextMode.default('spawn'),
  maxDepth: z.number().int().min(0).default(0),
  toolFilter: ToolFilter.optional(),
  budget: VertexBudget.optional(),
});
export type Vertex = z.infer<typeof Vertex>;

export const EdgeMode = z.enum(['request-reply', 'notify', 'board']);
export type EdgeMode = z.infer<typeof EdgeMode>;

/** 唤醒策略（§7.5 B 类）：never 是最强防回声手段，必须保持默认值。 */
export const Wake = z.enum(['never', 'on-reply', 'always']);
export type Wake = z.infer<typeof Wake>;

export const Rate = z.object({
  n: z.number().int().positive(),
  perMs: z.number().int().positive(),
});
export type Rate = z.infer<typeof Rate>;

/** 开放边（§7.2.1 边属性表）。有向：A→B 不蕴含 B→A（A2 半双工）。 */
export const Edge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  mode: EdgeMode.default('notify'),
  wake: Wake.default('never'),
  hopTTL: z.number().int().min(1).default(2),
  rate: Rate.optional(),
  budget: z.object({ tokens: z.number().int().positive() }).optional(),
});
export type Edge = z.infer<typeof Edge>;

/** 任务难度画像 7 维（§7.4.2）——自动建议的输入。 */
export const DifficultyProfile = z.object({
  cognitive: z.number().int().min(1).max(5).default(3),
  breadth: z.number().int().min(1).max(5).default(2),
  contextTokens: z.number().int().min(0).default(0),
  toolCalls: z.number().int().min(0).default(0),
  determinism: z.enum(['low', 'mid', 'high']).default('mid'),
  risk: z.enum(['readonly', 'reversible', 'destructive', 'security']).default('reversible'),
  parallelism: z.enum(['serial', 'parallel']).default('serial'),
  // profiler 附带的可解释性信号（FR-4 画像依据，非 7 维之一）。
  // 必须显式声明：zod 默认 strip 未知键，不声明则 signals 在 parse 边界被剥离，
  // suggest 的 confidence = 0.5 + 0.1×signals.length 会恒为 0.50（2026-10-17 真机实测实证）。
  signals: z.array(z.string()).optional(),
});
export type DifficultyProfile = z.infer<typeof DifficultyProfile>;

export const TaskSpec = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  assignee: z.string().min(1),
  dependencies: z.array(z.string().min(1)).default([]),
  profile: DifficultyProfile.partial().optional(),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

export const Substrate = z.object({
  depthAlwaysOne: z.literal(true),
  completeGraph: z.literal(true),
});

/** concourse 定义（§7.8.1 JSON 模型）。 */
export const Concourse = z.object({
  id: z.string().min(1),
  tier: Tier,
  substrate: Substrate.default({ depthAlwaysOne: true, completeGraph: true }),
  budget: z.object({ tokens: z.number().int().positive() }).optional(),
  /** 固定 once：一次计划审批，运行期零审批（FR-2.4 / P5）。 */
  approval: z.literal('once').default('once'),
  vertices: z.array(Vertex).min(1),
  /** 开放边集；未列出者一律关闭。 */
  edges: z.array(Edge).default([]),
  tasks: z.array(TaskSpec).default([]),
});
export type Concourse = z.infer<typeof Concourse>;

/** 输入类型（默认值未填充前的用户输入形态）。 */
export type ConcourseInput = z.input<typeof Concourse>;

/** 解析并填充默认值；结构之外的语义校验见 validate.ts。 */
export function parseConcourse(input: unknown): Concourse {
  return Concourse.parse(input);
}
