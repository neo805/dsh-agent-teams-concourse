// docs/spikes/probe — R-9 运行时探针插件（最小、自包含、一次性）。
//
// 用途（对应 docs/spikes/R-9-provider-hook.md §5）：
//   探针甲：注册 provider `concourse-probe`，prepareContinuable 把入参键集落盘 →
//           证实官方 spawnTeammate 路径上 provider 只能贡献 seed，无法注入 agentOptions。
//   探针乙：工具 probe_start 直接 ctx.subagents.startContinuable({...agentOptions, toolFilter})
//           → 证实路线 A 下逐顶点 model / reasoningEffort / toolFilter 真实生效。
//
// 落盘：%TEMP%/concourse-probe.jsonl（探针只写这一个文件）。
// 本文件不进 npm 包（files 清单不含 docs/）。
import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'dsh-concourse-probe';

export const inject = ['subagents', 'tools'];

const LOG = join(tmpdir(), 'concourse-probe.jsonl');

function record(kind, data) {
  try {
    mkdirSync(tmpdir(), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ t: Date.now(), kind, ...data }) + '\n');
  } catch {
    // 探针自身失败不阻断宿主（NFR-2 同款纪律）
  }
}

export async function apply(ctx) {
  // ── 探针甲：provider 注册与 prepareContinuable 入参记录 ──────────────────
  ctx.subagents.registerProvider({
    name: 'concourse-probe',
    capabilities: { outputSchema: false, depthLimit: true, toolFilter: true, persona: true, agentOptions: true },
    inheritsParentContext: false,
    start: async (request) => {
      record('provider.start', { keys: Object.keys(request ?? {}) });
      throw new Error('concourse-probe: one-shot start 不属于本探针（请用 probe_start 工具走 continuable 路径）');
    },
    prepareContinuable: async (request) => {
      record('provider.prepareContinuable', {
        keys: Object.keys(request ?? {}),
        hasAgentOptions: 'agentOptions' in (request ?? {}),
        hasToolFilter: 'toolFilter' in (request ?? {}),
      });
      return {}; // 与 subagent-profile 相同：continuable 路径 provider 只能贡献空 seed
    },
  });
  record('provider.registered', {});

  // ── 探针乙：路线 A 直发起点 ─────────────────────────────────────────────
  try {
  ctx.tools.register(defineTool({
    name: 'probe_start',
    description: 'R-9 探针乙：以指定 model/reasoningEffort/toolFilter 直起一个 continuable 子代理，回读其 childId。',
    parameters: {
      model: { type: 'string' },
      reasoningEffort: { type: 'string' },
      denyTools: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: { type: 'object', properties: { childId: { type: 'string' } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: `childId: ${value?.childId ?? '(none)'}` }],
    },
    async execute(args, exec) {
      const parent = exec.agent;
      const { childId } = await ctx.subagents.startContinuable({
        provider: 'concourse-probe',
        label: 'r9-probe-b',
        request: {
          prompt: [{ type: 'text', text: '探针：回复 OK 两个字即可。' }],
          parent,
          agentOptions: {
            ...(args.model ? { model: args.model } : {}),
            ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
          },
          ...(args.denyTools?.length ? { toolFilter: { deny: args.denyTools } } : {}),
        },
        signal: exec.signal,
      });
      record('probe.startContinuable.ok', { childId, model: args.model, effort: args.reasoningEffort });
      return { childId };
    },
  }));
  record('tool.registered', { tool: 'probe_start' });
  } catch (error) {
    record('tool.register.error', { message: String(error && error.message ? error.message : error) });
    throw error;
  }
}
