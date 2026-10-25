/**
 * tools/team-status — concourse 状态查询：列表（缺省）或单实例详情（带 id）。
 * 详情含顶点/开放边 x/y、预算余量、回声计数（echoCounts）与熔断状态。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
import { TIER_LABELS } from '../kernel/topology/tier.js';
import type { Concourse } from '../kernel/topology/schema.js';
import { directedEdgeCapacity } from '../kernel/topology/edges.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, type TeamToolsDeps } from './deps.js';

/** 概要条目（列表与详情共用）。 */
function summaryOf(deps: TeamToolsDeps, id: string, c: Concourse, status: string) {
  const echo = deps.ledger.echoCounts(id);
  const n = c.vertices.length;
  return {
    id,
    tier: c.tier,
    status,
    vertexCount: n,
    openEdges: c.edges.length,
    totalEdges: directedEdgeCapacity(n),
    delivered: echo.delivered,
    rejected: echo.rejected,
    degraded: echo.degraded,
    fused: echo.fused,
  };
}

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    tier: { type: 'string', required: true },
    status: { type: 'string', required: true },
    vertexCount: { type: 'integer', required: true },
    openEdges: { type: 'integer', required: true },
    totalEdges: { type: 'integer', required: true },
    delivered: { type: 'integer', required: true },
    rejected: { type: 'integer', required: true },
    degraded: { type: 'integer', required: true },
    fused: { type: 'integer', required: true },
  },
} as const;

export function createTeamStatusTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_status',
    description: `查询 concourse 状态：不带 id 返回全部实例概要列表；带 id 返回单实例详情（顶点、开放边 x/y、预算余量、回声计数、熔断状态）。${BOUNDARY_NOTE}`,
    parameters: {
      id: { type: 'string', description: 'concourse id（缺省返回列表）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          count: { type: 'integer', required: true },
          concourses: { type: 'array', required: true, items: SUMMARY_SCHEMA },
          detail: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              tier: { type: 'string', required: true },
              tierLabel: { type: 'string', required: true },
              status: { type: 'string', required: true },
              vertices: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    layer: { type: 'integer', required: true },
                    origin: { type: 'string', required: true },
                    role: { type: 'string' },
                    model: { type: 'string' },
                    reasoningEffort: { type: 'string' },
                  },
                },
              },
              edges: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    from: { type: 'string', required: true },
                    to: { type: 'string', required: true },
                    mode: { type: 'string', required: true },
                    wake: { type: 'string', required: true },
                    hopTTL: { type: 'integer', required: true },
                  },
                },
              },
              budgetRemaining: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
              globalFused: { type: 'boolean', required: true },
              fusedEdges: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.ok) {
          return [{ type: 'text' as const, text: `状态查询失败（${value.code ?? '?'}）：${value.message ?? ''}` }];
        }
        if (value.detail !== undefined) {
          const d = value.detail;
          const lines = [
            `concourse「${d.id}」 ${d.tierLabel} · ${d.status}`,
            `顶点 ${d.vertices.length} · 开放边 ${d.edges.length}`,
            `预算余量：${d.budgetRemaining === null ? '（未设）' : `${d.budgetRemaining} tokens`} · 全局熔断：${d.globalFused ? '是' : '否'}`,
          ];
          if (d.fusedEdges.length > 0) lines.push(`熔断边：${d.fusedEdges.join('、')}`);
          return [{ type: 'text' as const, text: lines.join('\n') }];
        }
        const lines = [`concourse 列表（${value.count} 个）：`];
        for (const s of value.concourses) {
          lines.push(
            `  ${s.id} ${s.tier} ${s.status} · 顶点 ${s.vertexCount} · 开放边 ${s.openEdges}/${s.totalEdges} · 投递 ${s.delivered} 拒 ${s.rejected} 降 ${s.degraded} 熔 ${s.fused}`,
          );
        }
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    execute: async (args) => {
      assertKnownKeys(args, ['id'], 'team_status');
      if (args.id === undefined) {
        const concourses = deps.service
          .list()
          .map((rec) => summaryOf(deps, rec.concourse.id, rec.concourse, rec.status));
        return { ok: true, count: concourses.length, concourses };
      }
      let rec;
      try {
        rec = deps.service.get(args.id);
      } catch (err) {
        if (err instanceof ConcourseError) {
          return { ok: false, code: err.code, message: err.message, count: 0, concourses: [] };
        }
        throw err;
      }
      const c = rec.concourse;
      const rt = deps.service.runtime(args.id);
      const fusedEdges = c.edges.filter((e) => rt.budget.isFusedEdge(e.from, e.to)).map((e) => `${e.from}->${e.to}`);
      const remaining = rt.budget.remainingGlobal();
      const detail = {
        id: c.id,
        tier: c.tier,
        tierLabel: TIER_LABELS[c.tier],
        status: rec.status,
        vertices: c.vertices.map((v) => ({
          id: v.id,
          layer: v.layer,
          origin: v.origin,
          ...(v.role !== undefined ? { role: v.role } : {}),
          ...(v.model !== undefined ? { model: v.model } : {}),
          ...(v.reasoningEffort !== undefined ? { reasoningEffort: v.reasoningEffort } : {}),
        })),
        edges: c.edges.map((e) => ({ from: e.from, to: e.to, mode: e.mode, wake: e.wake, hopTTL: e.hopTTL })),
        budgetRemaining: remaining === undefined ? null : Math.ceil(remaining),
        globalFused: rt.budget.isGlobalFused(),
        fusedEdges,
      };
      return { ok: true, count: 1, concourses: [summaryOf(deps, c.id, c, rec.status)], detail };
    },
  });
}
