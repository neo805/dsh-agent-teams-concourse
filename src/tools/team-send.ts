/**
 * tools/team-send — 向 concourse 顶点发消息。
 *
 * 权威路径（NFR-9 核心）：真实 exec.agent 作为身份凭据，service.send 完成
 * 闸门/跳数/去重/速率/预算预检后才写入目标 inbox；提交与留痕在投递成功后。
 * 官方 send_message 等旁路统一在 agent/pre-step 模型准入闸门收口。
 * self 顶点（origin=self）即领队会话自身，不经 substrate（无 childId 概念）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, type TeamToolsDeps } from './deps.js';

export function createTeamSendTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_send',
    description: `向 concourse 顶点发送消息：先经收件箱准入权威判定（闸门/跳数/去重/速率/预算）。仅 deliver/degrade 真实写入目标 inbox，degrade 不唤醒目标；reject 不投递。拒绝（EDGE_CLOSED/HOP_LIMIT/DUPLICATE/FUSE_*）与降级（RATE_LIMIT）原样返回并留痕，绝不旁路。${BOUNDARY_NOTE}`,
    parameters: {
      id: { type: 'string', required: true, description: 'concourse id' },
      from: { type: 'string', required: true, description: '发送方顶点 id' },
      to: { type: 'string', required: true, description: '接收方顶点 id' },
      content: { type: 'string', required: true, description: '消息正文' },
      correlationId: { type: 'string', description: '关联 id（应答链追去重用）' },
      hops: { type: 'integer', description: '已跳数（中继转发时递增；缺省按第 1 跳）' },
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
          return [{ type: 'text' as const, text: `已降级（${value.reason ?? '?'}）：消息已进收件箱、不唤醒目标，削峰留痕` }];
        }
        if (value.outcome === 'reject') {
          const cand = (value.candidates ?? []).length > 0 ? `；${value.candidates?.join('、') ?? ''} 可达` : '';
          return [{ type: 'text' as const, text: `已拦截（${value.reason ?? '?'}${cand}）：消息未投递，台账已留痕` }];
        }
        return [{ type: 'text' as const, text: `发送失败（${value.code ?? '?'}）：${value.message ?? ''}` }];
      },
    },
    execute: async (args, exec) => {
      assertKnownKeys(args, ['id', 'from', 'to', 'content', 'correlationId', 'hops'], 'team_send');
      try {
        const result = deps.service.send(
          args.id,
          {
            from: args.from,
            to: args.to,
            content: args.content,
            ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
            ...(args.hops !== undefined ? { hops: args.hops } : {}),
          },
          exec.agent,
          exec.signal,
        );
        if (result.outcome === 'error') {
          return {
            ok: false,
            outcome: 'error' as const,
            code: result.code ?? 'SEND_FAILED',
            message: result.message ?? '',
          };
        }
        if (result.outcome === 'reject') {
          return {
            ok: false,
            outcome: 'reject' as const,
            reason: result.reason ?? 'EDGE_CLOSED',
            ...(result.candidates !== undefined ? { candidates: [...result.candidates] } : {}),
            message: `消息被收件箱准入拒绝：${result.reason ?? 'EDGE_CLOSED'}`,
          };
        }
        return {
          ok: true,
          outcome: result.outcome,
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
          ...(result.mode !== undefined ? { mode: result.mode } : {}),
          ...(result.wake !== undefined ? { wake: result.wake } : {}),
          ...(result.childId !== undefined ? { childId: result.childId } : {}),
        };
      } catch (err) {
        if (err instanceof ConcourseError) {
          return { ok: false, outcome: 'error' as const, code: err.code, message: err.message };
        }
        throw err;
      }
    },
  });
}
