/**
 * tools/index — 工具组汇总与身份作用域分流（FR-2.4 能力剥夺）。
 *
 * 作用域：
 *   leader（根/领队会话）→ 全部 6 个 team_* 工具；
 *   member（concourse 子节点会话）→ 仅 team_send / team_status（子节点只需要
 *   汇报与自查状态；改拓扑、改计划、开闭边、拉起同侪均为领队能力）。
 *
 * 身份判定（resolveScope）为防御式探测，假设记录：
 *   · 显式字符串 'leader'/'member' 优先（宿主显式声明或测试注入）；
 *   · 对象带 parent / parentId / parentSessionId / parentAgentId 非空字段，
 *     或带 vertexId / concourseVertex 标记 → 判定为子节点会话（member）；
 *   · 其余（含 undefined）→ 根/领队会话（leader）。
 *   宿主后续若提供正式的会话身份面，替换本函数即可，工具组不动。
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { createTeamTopologyTool } from './team-topology.js';
import { createTeamPlanTool } from './team-plan.js';
import { createTeamAssignTool } from './team-assign.js';
import { createTeamLinkTool } from './team-link.js';
import { createTeamSendTool } from './team-send.js';
import { createTeamStatusTool } from './team-status.js';
import type { TeamToolsDeps } from './deps.js';

export type { TeamToolsDeps } from './deps.js';

export const ALL_TOOL_NAMES = [
  'team_topology',
  'team_plan',
  'team_assign',
  'team_link',
  'team_send',
  'team_status',
] as const;

/** 子节点最小集：汇报（send）+ 自查（status）。 */
export const MEMBER_TOOL_NAMES = ['team_send', 'team_status'] as const;

export type TeamScope = 'leader' | 'member';

/** 父引用字段：宿主 Agent 对象上可辨认子代理身份的常见字段名（防御式探测）。 */
const PARENT_MARKERS = ['parent', 'parentId', 'parentSessionId', 'parentAgentId'] as const;

export function resolveScope(identity: unknown): TeamScope {
  if (identity === 'leader') return 'leader';
  if (identity === 'member') return 'member';
  if (typeof identity === 'object' && identity !== null) {
    const o = identity as Record<string, unknown>;
    for (const k of PARENT_MARKERS) {
      if (o[k] !== undefined && o[k] !== null) return 'member';
    }
    if (typeof o['vertexId'] === 'string' || o['concourseVertex'] !== undefined) return 'member';
  }
  return 'leader';
}

/** 全部 6 个工具（不做作用域过滤；过滤在 registerTeamTools）。 */
export function createTeamTools(deps: TeamToolsDeps): ToolDefinition[] {
  return [
    createTeamTopologyTool(deps),
    createTeamPlanTool(deps),
    createTeamAssignTool(deps),
    createTeamLinkTool(deps),
    createTeamSendTool(deps),
    createTeamStatusTool(deps),
  ];
}

/**
 * 按身份分流注册；返回实际注册的工具名（leader 全量 / member 最小集）。
 * register 抛错不拦截（交由入口的 per-step try/catch 兜底）。
 */
export function registerTeamTools(
  register: (def: ToolDefinition) => unknown,
  deps: TeamToolsDeps,
  identity?: unknown,
): string[] {
  const scope = resolveScope(identity);
  const tools = createTeamTools(deps).filter(
    (t) => scope === 'leader' || (MEMBER_TOOL_NAMES as readonly string[]).includes(t.name),
  );
  const disposers: unknown[] = [];
  try {
    for (const t of tools) disposers.push(register(t));
  } catch (err) {
    // 同组注册是局部事务：中途失败时逆序撤销已成功的工具，避免半套能力。
    for (let i = disposers.length - 1; i >= 0; i -= 1) {
      const dispose = disposers[i];
      if (typeof dispose !== 'function') continue;
      try {
        dispose();
      } catch {
        // 清理失败不得覆盖原始注册错误；入口会记录原始失败。
      }
    }
    throw err;
  }
  return tools.map((t) => t.name);
}
