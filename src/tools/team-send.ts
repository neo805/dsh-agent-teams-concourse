/**
 * tools/team-send — 向 concourse 顶点发消息。
 *
 * 权威路径（NFR-9 核心）：先经 admitInbound 第②层判定（闸门/跳数/去重/速率/预算），
 * 判定与留痕全部在 inbox-gate 完成；deliver 才调 substrate.sendText 投递，
 * reject / degrade 原样返回（绝不投递）。
 * self 顶点（origin=self）即领队会话自身，不经 substrate（无 childId 概念）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
import { admitInbound } from '../service/inbox-gate.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, type TeamToolsDeps } from './deps.js';

export function createTeamSendTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_send',
    description: `向 concourse 顶点发送消息：先经收件箱准入权威判定（闸门/跳数/去重/速率/预算），deliver 才投递；拒绝（EDGE_CLOSED/HOP_LIMIT/DUPLICATE/FUSE_*）与降级（RATE_LIMIT）原样返回并留痕，绝不旁路。${BOUNDARY_NOTE}`,
    parameters: {
      id: { type: 'string', required: true, description: 'concourse id' },
      from: { type: 'string', required: true, description: '发送方顶点 id' },
      to: { type: 'string', required: true, description: '接收方顶点 id' },
      content: { type: 'string', required: true, description: '消息正文' },
      correlationId: { type: 'string', description: '关联 id（应答链追去重用）' },
      hops: { type: 'integer', description: '已跳数（中继转发时递增；缺省 0）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          outcome: { type: 'string', enum: ['deliver', 'reject', 'degrade', 'error'], required: true },
          reason: { type: 'string' },
          candidates: { type: 'array', items: { type: 'string' } },
          mode: { type: 'string' },
          wake: { type: 'string' },
          childId: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.outcome === 'deliver') {
          return [
            {
              type: 'text' as const,
              text: `已投递（mode=${value.mode ?? '?'} wake=${value.wake ?? '?'}，目标 ${value.childId ?? '?'}，台账已留痕）`,
            },
          ];
        }
        if (value.outcome === 'degrade') {
          return [{ type: 'text' as const, text: `已降级（${value.reason ?? '?'}）：投递不唤醒，削峰留痕` }];
        }
        if (value.outcome === 'reject') {
          const cand = (value.candidates ?? []).length > 0 ? `；${value.candidates?.join('、') ?? ''} 可达` : '';
          return [{ type: 'text' as const, text: `已拦截（${value.reason ?? '?'}${cand}）：消息未投递，台账已留痕` }];
        }
        return [{ type: 'text' as const, text: `发送失败（${value.code ?? '?'}）：${value.message ?? ''}` }];
      },
    },
    execute: async (args) => {
      assertKnownKeys(args, ['id', 'from', 'to', 'content', 'correlationId', 'hops'], 'team_send');
      let rt;
      try {
        rt = deps.service.runtime(args.id);
      } catch (err) {
        if (err instanceof ConcourseError) {
          return { ok: false, outcome: 'error' as const, code: err.code, message: err.message };
        }
        throw err;
      }
      // 第②层权威判定（判定与台账留痕在 inbox-gate 内完成）
      const outcome = admitInbound(
        rt,
        {
          from: args.from,
          to: args.to,
          content: args.content,
          ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
          ...(args.hops !== undefined ? { hops: args.hops } : {}),
        },
        { ledger: deps.ledger },
      );
      if (outcome.kind === 'reject') {
        return {
          ok: false,
          outcome: 'reject' as const,
          reason: outcome.reason,
          ...(outcome.candidates !== undefined ? { candidates: [...outcome.candidates] } : {}),
          message: `消息被收件箱准入拒绝：${outcome.reason}`,
        };
      }
      if (outcome.kind === 'degrade') {
        return { ok: true, outcome: 'degrade' as const, reason: 'RATE_LIMIT' };
      }
      // deliver：self 顶点即领队会话自身，不经 substrate
      const rec = deps.service.get(args.id);
      const target = rec.concourse.vertices.find((v) => v.id === args.to);
      if (target?.origin === 'self') {
        return { ok: true, outcome: 'deliver' as const, mode: outcome.mode, wake: outcome.wake, childId: 'self' };
      }
      // 从台账 vertex-start 事件反查 childId（approve 未拉起则无句柄）
      const start = [...deps.ledger.query({ concourseId: args.id, kind: 'lifecycle', action: 'vertex-start' })]
        .reverse()
        .find((e) => e.detail['vertexId'] === args.to);
      const childId = start?.detail['childId'];
      if (typeof childId !== 'string') {
        return {
          ok: false,
          outcome: 'error' as const,
          code: 'NOT_STARTED',
          message: `顶点「${args.to}」未拉起（先 team_assign 审批执行）`,
        };
      }
      try {
        await deps.substrate.sendText({ vertexId: args.to, childId }, args.content);
      } catch (err) {
        const code =
          typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : 'SEND_FAILED';
        return {
          ok: false,
          outcome: 'error' as const,
          code,
          message: err instanceof Error ? err.message : String(err),
        };
      }
      return { ok: true, outcome: 'deliver' as const, mode: outcome.mode, wake: outcome.wake, childId };
    },
  });
}
