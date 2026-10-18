/**
 * tools/team-plan — 计划工具：create + submit，返回 §7.6.3 口径计划全文供用户审批。
 * 只到 pending-approval，不拉起任何顶点（拉起走 team_assign）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ConcourseError } from '../service/concourse.js';
import type { Concourse } from '../kernel/topology/schema.js';
import { TIER_LABELS } from '../kernel/topology/tier.js';
import { renderTree } from '../kernel/glyphs.js';
import { estimateConcourseBudget } from '../kernel/budget/tokens.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, ISSUE_SCHEMA, type TeamToolsDeps, type ToolIssue } from './deps.js';

/** 风险显式列出（§7.6.3 口径：宁可啰嗦，不可省略）。 */
function risksOf(c: Concourse): string[] {
  const risks: string[] = [];
  for (const e of c.edges) {
    if (e.wake === 'always') {
      risks.push(`边 ${e.from}→${e.to} wake=always：投递即唤醒，存在回声风暴风险（建议 on-reply/never）`);
    }
    if (e.mode === 'board') {
      risks.push(`边 ${e.from}→${e.to} 为 board 广播：扇出面大，注意速率与预算`);
    }
  }
  if (c.budget === undefined) {
    risks.push('无预算声明且无任务可估算：预算熔断（D2）不可用');
  }
  const busy = new Set(c.tasks.map((t) => t.assignee));
  for (const v of c.vertices) {
    if (v.origin !== 'self' && !busy.has(v.id)) {
      risks.push(`顶点「${v.id}」名下无任务：拉起后空闲`);
    }
  }
  if (risks.length === 0) risks.push('（无显著风险）');
  return risks;
}

/** §7.6.3 计划全文：拓扑建议 + 任务表 + 通信边表 + 审批策略 + 预算估算。 */
function renderPlanText(c: Concourse): string {
  const est = estimateConcourseBudget(c);
  const lines: string[] = [];
  lines.push(`concourse「${c.id}」计划（${TIER_LABELS[c.tier]}）`, '', '拓扑：');
  // Vertex → TreeVertex（exactOptionalPropertyTypes：role 缺席时不带该键）
  const tree = c.vertices.map((v) => ({
    id: v.id,
    parent: v.parent,
    ...(v.role !== undefined ? { role: v.role } : {}),
  }));
  lines.push(...renderTree(tree).map((l) => `  ${l}`));
  lines.push('', '任务表：');
  if (c.tasks.length === 0) lines.push('  （无任务）');
  for (const t of c.tasks) {
    const depsNote = t.dependencies.length > 0 ? `（依赖 ${t.dependencies.join(', ')}）` : '';
    lines.push(`  ${t.id} → ${t.assignee}：${t.subject}${depsNote}`);
  }
  lines.push('', '通信边表：');
  if (c.edges.length === 0) lines.push('  （无开放边）');
  for (const e of c.edges) {
    lines.push(`  ${e.from}→${e.to} mode=${e.mode} wake=${e.wake} hopTTL=${e.hopTTL}`);
  }
  lines.push(
    '',
    `审批策略：${c.approval}（一次计划审批，运行期零审批）`,
    `预算估算：${Math.ceil(est.total)} tokens（估算口径，非计费）`,
  );
  return lines.join('\n');
}

export function createTeamPlanTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_plan',
    description: `创建并提交 concourse 团队计划（draft→pending-approval），返回拓扑建议、任务表、通信边表、审批策略与显式风险全文，供用户审批；不拉起任何顶点（审批执行用 team_assign）。${BOUNDARY_NOTE}`,
    parameters: {
      spec: { type: 'json', required: true, description: 'concourse spec（JSON 对象）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          status: { type: 'string' },
          plan: { type: 'string' },
          risks: { type: 'array', required: true, items: { type: 'string' } },
          issues: { ...ISSUE_SCHEMA, required: true },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.ok) {
          const lines = [`计划创建失败（${value.code ?? '?'}）：${value.message ?? ''}`];
          for (const i of value.issues) {
            // F4：结构错误也带 path（与 team_topology 一致）
            const p = i.path !== undefined && i.path.length > 0 ? `${i.path}：` : '';
            lines.push(`  ✗ [${i.code}] ${p}${i.message}`);
          }
          return [{ type: 'text' as const, text: lines.join('\n') }];
        }
        const lines = [value.plan ?? '', '', '风险：'];
        for (const r of value.risks) lines.push(`  · ${r}`);
        lines.push('', `（计划 ${value.id ?? '?'} 已提交为 ${value.status ?? '?'}，确认后用 team_assign 审批执行）`);
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    execute: async (args) => {
      assertKnownKeys(args, ['spec'], 'team_plan');
      try {
        const rec = deps.service.create(args.spec);
        deps.service.submit(rec.concourse.id);
        return {
          ok: true,
          id: rec.concourse.id,
          status: 'pending-approval',
          plan: renderPlanText(rec.concourse),
          risks: risksOf(rec.concourse),
          issues: [],
        };
      } catch (err) {
        if (err instanceof ConcourseError) {
          const issues: ToolIssue[] = [...(err.issues ?? [])];
          return { ok: false, code: err.code, message: err.message, risks: [], issues };
        }
        throw err;
      }
    },
  });
}
