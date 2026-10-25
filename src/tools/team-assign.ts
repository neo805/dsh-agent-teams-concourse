/**
 * tools/team-assign — 审批执行：approve(id, exec.agent)，返回逐顶点拉起结果
 * （childId + requested-vs-effective 定档对照；origin=self 顶点不拉起）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, type TeamToolsDeps } from './deps.js';

const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const;

export function createTeamAssignTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_assign',
    description: `审批并执行 concourse 计划（pending-approval→running）：按拓扑序拉起全部 spawned 顶点，返回逐顶点 childId 与 requested-vs-effective 模型/档位对照。${BOUNDARY_NOTE}`,
    parameters: {
      id: { type: 'string', required: true, description: 'concourse id（team_plan 返回的 id）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          status: { type: 'string' },
          vertices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                vertexId: { type: 'string', required: true },
                self: { type: 'boolean' },
                childId: { type: 'string' },
                requestedModel: NULLABLE_STRING,
                requestedEffort: NULLABLE_STRING,
                effectiveModel: { type: 'string' },
                effectiveEffort: { type: 'string' },
              },
            },
          },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.ok) {
          return [{ type: 'text' as const, text: `审批执行失败（${value.code ?? '?'}）：${value.message ?? ''}` }];
        }
        const lines = [`concourse「${value.id ?? '?'}」已拉起（${value.status ?? '?'}）：`];
        for (const v of value.vertices) {
          if (v.self === true) {
            lines.push(`  ${v.vertexId}：本会话顶点（不另起子代理）`);
          } else {
            const req = v.requestedModel ?? '（未声明）';
            const eff = v.effectiveModel ?? '?';
            lines.push(`  ${v.vertexId} → childId=${v.childId ?? '?'}（requested=${req} / effective=${eff}）`);
          }
        }
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    execute: async (args, exec) => {
      assertKnownKeys(args, ['id'], 'team_assign');
      try {
        // exec.agent 即调用方 Agent（宿主注入），作为拉起子代理的 parent
        const handles = await deps.service.approve(args.id, exec.agent, { signal: exec.signal });
        const rec = deps.service.get(args.id);
        const byVertex = new Map(handles.map((h) => [h.vertexId, h.childId]));
        const vertices = rec.concourse.vertices.map((v) => {
          const rve = deps.ledger.requestedVsEffective(v.id);
          const childId = byVertex.get(v.id);
          return {
            vertexId: v.id,
            ...(v.origin === 'self' ? { self: true } : {}),
            ...(childId !== undefined ? { childId } : {}),
            ...(rve != null
              ? {
                  requestedModel: rve.requested.model,
                  requestedEffort: rve.requested.reasoningEffort,
                  effectiveModel: rve.effective.model,
                  effectiveEffort: rve.effective.reasoningEffort,
                }
              : {}),
          };
        });
        return { ok: true, id: rec.concourse.id, status: rec.status, vertices };
      } catch (err) {
        if (err instanceof ConcourseError) {
          return { ok: false, code: err.code, message: err.message, vertices: [] };
        }
        throw err;
      }
    },
  });
}
