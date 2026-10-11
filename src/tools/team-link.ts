/**
 * tools/team-link — 运行中开/闭通信边。
 *
 * 生效机制：service 未提供边集更新 API；create 时 entry.concourse 与
 * runtime.concourse 是同一对象引用，这里用 kernel 的 openEdge/closeEdge
 * 不可变计算后整体替换其 edges 字段，收件箱准入（读同一对象）立即生效。
 * 台账留痕 edge-open / edge-close（lifecycle）。
 * 注：新建边不补建速率/预算登记（kernel 按边建表）——MVP 口径，注释记录。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
import { openEdge, closeEdge, withReverseAck } from '../kernel/topology/edges.js';
import type { Edge } from '../kernel/topology/schema.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, type TeamToolsDeps } from './deps.js';

export function createTeamLinkTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_link',
    description: `在 running 状态的 concourse 中开/闭一条通信边（立即生效于收件箱准入，台账留痕）。开 request-reply 边自动绑反向应答边（A2）。${BOUNDARY_NOTE}`,
    parameters: {
      id: { type: 'string', required: true, description: 'concourse id' },
      from: { type: 'string', required: true, description: '边起点顶点 id' },
      to: { type: 'string', required: true, description: '边终点顶点 id' },
      action: { type: 'string', enum: ['open', 'close'], required: true, description: 'open 开边 / close 闭边' },
      mode: { type: 'string', enum: ['request-reply', 'notify', 'board'], description: '开边时的通信模式（缺省 notify）' },
      wake: { type: 'string', enum: ['always', 'on-reply', 'never'], description: '开边时的唤醒策略（缺省 never）' },
      hopTTL: { type: 'integer', description: '开边时的 hop 上限（缺省 2）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          action: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          openEdges: { type: 'integer', required: true },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.ok) {
          return [{ type: 'text' as const, text: `边操作失败（${value.code ?? '?'}）：${value.message ?? ''}` }];
        }
        const verb = value.action === 'open' ? '已开边' : '已闭边';
        return [
          {
            type: 'text' as const,
            text: `${verb} ${value.from ?? '?'}→${value.to ?? '?'}（concourse「${value.id ?? '?'}」，当前开放边 ${value.openEdges} 条，台账已留痕）`,
          },
        ];
      },
    },
    execute: async (args) => {
      assertKnownKeys(args, ['id', 'from', 'to', 'action', 'mode', 'wake', 'hopTTL'], 'team_link');
      let rec;
      try {
        rec = deps.service.get(args.id);
      } catch (err) {
        if (err instanceof ConcourseError) {
          return { ok: false, code: err.code, message: err.message, openEdges: 0 };
        }
        throw err;
      }
      if (rec.status !== 'running') {
        return {
          ok: false,
          code: 'ILLEGAL_STATE',
          message: `team_link 要求 running 状态，当前为 ${rec.status}`,
          openEdges: rec.concourse.edges.length,
        };
      }
      const ids = new Set(rec.concourse.vertices.map((v) => v.id));
      if (!ids.has(args.from) || !ids.has(args.to)) {
        const missing = [args.from, args.to].filter((v) => !ids.has(v)).join(' / ');
        return {
          ok: false,
          code: 'UNKNOWN_VERTEX',
          message: `顶点不存在：${missing}`,
          openEdges: rec.concourse.edges.length,
        };
      }
      const rt = deps.service.runtime(args.id);
      let next: Edge[];
      if (args.action === 'open') {
        const edge: Edge = {
          from: args.from,
          to: args.to,
          mode: args.mode ?? 'notify',
          wake: args.wake ?? 'never',
          hopTTL: args.hopTTL ?? 2,
        };
        next = rec.concourse.edges;
        // A2：request-reply 自动绑反向应答边（ack 边 wake=never）
        for (const e of withReverseAck(edge)) next = openEdge(next, e);
        deps.ledger.append({
          concourseId: args.id,
          kind: 'lifecycle',
          action: 'edge-open',
          detail: { from: args.from, to: args.to, mode: edge.mode, wake: edge.wake, hopTTL: edge.hopTTL },
        });
      } else {
        next = closeEdge(rec.concourse.edges, args.from, args.to);
        deps.ledger.append({
          concourseId: args.id,
          kind: 'lifecycle',
          action: 'edge-close',
          detail: { from: args.from, to: args.to },
        });
      }
      // 整体替换边集（entry.concourse 与 runtime.concourse 同一引用，准入立即生效）
      (rt.concourse as { edges: Edge[] }).edges = next;
      return { ok: true, id: args.id, action: args.action, from: args.from, to: args.to, openEdges: next.length };
    },
  });
}
