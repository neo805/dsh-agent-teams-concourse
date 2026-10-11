/**
 * tools/team-topology — 拓扑预览：结构解析 + 语义校验 + 谱系判定 + 逐任务派发建议。
 * 纯预览，不落库（不调 ConcourseService）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ZodError } from 'zod';
import { DifficultyProfile, parseConcourse, type Concourse } from '../kernel/topology/schema.js';
import { validateConcourse } from '../kernel/topology/validate.js';
import { classify, TIER_LABELS } from '../kernel/topology/tier.js';
import { estimateConcourseBudget } from '../kernel/budget/tokens.js';
import { suggest } from '../kernel/profile/suggest.js';
import { assertKnownKeys } from './keys.js';
import { BOUNDARY_NOTE, ISSUE_SCHEMA, type TeamToolsDeps } from './deps.js';

interface SuggestionItem {
  taskId: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  tokenTier: string;
  maxDepth: number;
  confidence: number;
  rationale: string[];
}

/** 逐任务派发建议：catalog 缺席/为空 → 空数组；单任务失败不拖垮整体预览。 */
async function buildSuggestions(deps: TeamToolsDeps, c: Concourse): Promise<SuggestionItem[]> {
  const catalog = deps.catalog;
  if (catalog === undefined) return [];
  const entries = await catalog.list();
  if (entries.length === 0) return [];
  // host ModelInfo → kernel ModelInfo（efforts 只读数组拷贝为可变；tier/contextWindow 缺席即缺省）
  const models = entries.map((e) => ({ provider: e.provider, model: e.model, efforts: [...e.efforts] }));
  const out: SuggestionItem[] = [];
  for (const t of c.tasks) {
    if (t.profile === undefined) continue;
    try {
      const s = suggest(DifficultyProfile.parse(t.profile), models);
      out.push({
        taskId: t.id,
        provider: s.provider,
        model: s.model,
        reasoningEffort: s.reasoningEffort,
        tokenTier: s.tokenTier,
        maxDepth: s.maxDepth,
        confidence: s.confidence,
        rationale: s.rationale,
      });
    } catch {
      // 单任务建议失败（如 catalog 全排除）不拖垮整体预览
    }
  }
  return out;
}

export function createTeamTopologyTool(deps: TeamToolsDeps) {
  return defineTool({
    name: 'team_topology',
    description: `预览 concourse 虚拟拓扑团队：结构解析 + 语义校验 + 谱系（T1a–T4）判定 + 逐任务模型/档位派发建议。纯预览，不落库、不提交审批。${BOUNDARY_NOTE}`,
    parameters: {
      spec: { type: 'json', required: true, description: 'concourse spec（JSON 对象，见 §7.8.1 数据模型）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          stage: { type: 'string', enum: ['parse', 'validate'], required: true },
          issues: { ...ISSUE_SCHEMA, required: true },
          tier: { type: 'string' },
          tierLabel: { type: 'string' },
          vertexCount: { type: 'integer' },
          edgeCount: { type: 'integer' },
          estimatedTokens: { type: 'integer' },
          suggestions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                taskId: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                model: { type: 'string', required: true },
                reasoningEffort: { type: 'string', required: true },
                tokenTier: { type: 'string', required: true },
                maxDepth: { type: 'integer', required: true },
                confidence: { type: 'number', required: true },
                rationale: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.stage === 'parse') {
          const lines = value.issues.map((i) => `  ✗ ${i.path ?? ''} ${i.message}`.trim());
          return [{ type: 'text' as const, text: ['拓扑预览失败（结构解析）：', ...lines].join('\n') }];
        }
        const lines = [
          `谱系判定：${value.tier ?? '?'}（${value.tierLabel ?? ''}）`,
          `顶点 ${value.vertexCount ?? 0} · 开放边 ${value.edgeCount ?? 0} · 预算估算 ${value.estimatedTokens ?? 0} tokens`,
        ];
        if (value.issues.length > 0) {
          lines.push('校验问题：');
          for (const i of value.issues) lines.push(`  ✗ [${i.code}] ${i.message}`);
        } else {
          lines.push('校验：通过');
        }
        if (value.suggestions.length > 0) {
          lines.push('派发建议：');
          for (const s of value.suggestions) {
            lines.push(`  ${s.taskId} → ${s.provider}/${s.model} effort=${s.reasoningEffort} tier=${s.tokenTier}（置信 ${s.confidence.toFixed(2)}）`);
          }
        }
        return [{ type: 'text' as const, text: lines.join('\n') }];
      },
    },
    execute: async (args) => {
      assertKnownKeys(args, ['spec'], 'team_topology');
      let c: Concourse;
      try {
        c = parseConcourse(args.spec);
      } catch (err) {
        if (err instanceof ZodError) {
          const issues = err.issues.map((i) => ({
            code: 'SCHEMA',
            message: i.message,
            path: i.path.join('.'),
          }));
          return { ok: false, stage: 'parse' as const, issues, suggestions: [] };
        }
        throw err;
      }
      const issues = validateConcourse(c);
      const est = estimateConcourseBudget(c);
      const suggestions = await buildSuggestions(deps, c);
      const tier = classify(c.vertices, c.edges);
      return {
        ok: issues.length === 0,
        stage: 'validate' as const,
        issues,
        tier,
        tierLabel: TIER_LABELS[tier],
        vertexCount: c.vertices.length,
        edgeCount: c.edges.length,
        estimatedTokens: Math.ceil(est.total),
        suggestions,
      };
    },
  });
}
