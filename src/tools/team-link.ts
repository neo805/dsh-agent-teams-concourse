/**
 * tools/team-link — 运行中开/闭通信边。
 *
 * 生效机制：边变更由 ConcourseService.link 统一执行；事件先落盘，再由同一
 * reducer 更新拓扑、速率/预算运行时，replay 识别同一事件。工具层只做入参校验。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
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
          openEdges: { type: 'integer' },
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
      try {
        const result = deps.service.link(args.id, {
          from: args.from,
          to: args.to,
          action: args.action,
          ...(args.mode !== undefined ? { mode: args.mode } : {}),
          ...(args.wake !== undefined ? { wake: args.wake } : {}),
          ...(args.hopTTL !== undefined ? { hopTTL: args.hopTTL } : {}),
        });
        return {
          ok: true,
          id: args.id,
          action: args.action,
          from: args.from,
          to: args.to,
          openEdges: result.openEdges,
        };
      } catch (err) {
        if (err instanceof ConcourseError) {
          return {
            ok: false,
            code: err.code,
            message: err.message,
          };
        }
        throw err;
      }
    },
  });
}
