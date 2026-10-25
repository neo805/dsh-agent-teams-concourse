/**
 * 工具 render 分支契约：模型卡片也是用户可见输出，不能只测 execute。
 */
import { describe, expect, test } from 'vitest';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createTeamAssignTool } from '../../src/tools/team-assign.js';
import { createTeamLinkTool } from '../../src/tools/team-link.js';
import { createTeamPlanTool } from '../../src/tools/team-plan.js';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { createTeamStatusTool } from '../../src/tools/team-status.js';
import { createTeamTopologyTool } from '../../src/tools/team-topology.js';
import { makeFixture } from './helpers.js';

function textOf(
  tool: { output: { render(args: unknown, value: never): readonly ContentBlock[] } },
  value: object,
): string {
  return tool.output
    .render({}, value as never)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

describe('team_* render 分支', () => {
  const fx = makeFixture();

  test('team_send 四种 outcome', () => {
    const tool = createTeamSendTool(fx.deps);
    expect(textOf(tool, { outcome: 'deliver', mode: 'notify', wake: 'never', childId: 'c' })).toContain('已投递');
    expect(textOf(tool, { outcome: 'degrade', reason: 'RATE_LIMIT' })).toContain('不唤醒');
    expect(textOf(tool, { outcome: 'reject', reason: 'EDGE_CLOSED', candidates: ['a'] })).toContain('可达');
    expect(textOf(tool, { outcome: 'error', code: 'X', message: 'boom' })).toContain('boom');
  });

  test('team_assign 成功/self/失败', () => {
    const tool = createTeamAssignTool(fx.deps);
    const ok = textOf(tool, {
      ok: true,
      id: 'c',
      status: 'running',
      vertices: [
        { vertexId: 'lead', self: true },
        { vertexId: 'a', childId: 'child-a', requestedModel: null, effectiveModel: 'inherit' },
      ],
    });
    expect(ok).toContain('本会话顶点');
    expect(ok).toContain('childId=child-a');
    expect(textOf(tool, { ok: false, code: 'X', message: 'bad', vertices: [] })).toContain('bad');
    // 可选字段缺席：不得输出 undefined 字面量
    const minimal = textOf(tool, { ok: true, vertices: [{ vertexId: 'a' }] });
    expect(minimal).toContain('未声明');
    expect(minimal).toContain('?');
    expect(textOf(tool, { ok: false, vertices: [] })).toContain('?');
  });

  test('team_link 开/闭/失败', () => {
    const tool = createTeamLinkTool(fx.deps);
    expect(textOf(tool, { ok: true, action: 'open', from: 'a', to: 'b', id: 'c', openEdges: 1 })).toContain('已开边');
    expect(textOf(tool, { ok: true, action: 'close', from: 'a', to: 'b', id: 'c', openEdges: 0 })).toContain('已闭边');
    expect(textOf(tool, { ok: false, code: 'X', message: 'bad', openEdges: 0 })).toContain('bad');
    expect(textOf(tool, { ok: true, openEdges: 0 })).toContain('?');
    expect(textOf(tool, { ok: false, openEdges: 0 })).toContain('?');
  });

  test('team_status 列表/详情/失败', () => {
    const tool = createTeamStatusTool(fx.deps);
    const list = textOf(tool, {
      ok: true,
      count: 1,
      concourses: [
        {
          id: 'c',
          tier: 'T1a',
          status: 'running',
          vertexCount: 2,
          openEdges: 1,
          totalEdges: 2,
          delivered: 1,
          rejected: 0,
          degraded: 0,
          fused: 0,
        },
      ],
    });
    expect(list).toContain('投递 1');
    const detail = textOf(tool, {
      ok: true,
      count: 1,
      concourses: [],
      detail: {
        id: 'c',
        tier: 'T1a',
        tierLabel: '星形',
        status: 'running',
        vertices: [],
        edges: [],
        budgetRemaining: null,
        globalFused: false,
        fusedEdges: ['a->b'],
      },
    });
    expect(detail).toContain('熔断边');
    expect(
      textOf(tool, {
        ok: true,
        count: 1,
        concourses: [],
        detail: {
          id: 'c',
          tier: 'T1a',
          tierLabel: '星形',
          status: 'running',
          vertices: [],
          edges: [],
          budgetRemaining: 5,
          globalFused: true,
          fusedEdges: [],
        },
      }),
    ).toContain('全局熔断：是');
    expect(textOf(tool, { ok: false, count: 0, concourses: [] })).toContain('?');
  });

  test('team_plan 成功/失败', () => {
    const tool = createTeamPlanTool(fx.deps);
    expect(
      textOf(tool, {
        ok: true,
        id: 'c',
        status: 'pending-approval',
        plan: 'plan',
        risks: ['risk'],
        issues: [],
      }),
    ).toContain('风险');
    expect(
      textOf(tool, { ok: false, code: 'INVALID_SPEC', message: 'bad', risks: [], issues: [] }),
    ).toContain('bad');
  });

  test('team_topology parse/validate + 建议渲染', () => {
    const tool = createTeamTopologyTool(fx.deps);
    expect(
      textOf(tool, { ok: false, stage: 'parse', issues: [{ code: 'SCHEMA', message: 'bad' }], suggestions: [] }),
    ).toContain('结构解析');
    expect(
      textOf(tool, {
        ok: false,
        stage: 'validate',
        issues: [{ code: 'SCHEMA', message: 'bad', path: 'vertices[0]' }],
        suggestions: [],
      }),
    ).toContain('vertices[0]');
    expect(
      textOf(tool, { ok: true, stage: 'validate', issues: [], suggestions: [] }),
    ).toContain('?');
    const validate = textOf(tool, {
      ok: true,
      stage: 'validate',
      issues: [],
      tier: 'T1a',
      tierLabel: '星形',
      vertexCount: 2,
      edgeCount: 1,
      estimatedTokens: 100,
      suggestions: [
        {
          taskId: 't1',
          provider: 'p',
          model: 'm',
          reasoningEffort: 'low',
          tokenTier: 'cheap',
          maxDepth: 1,
          confidence: 0.8,
          rationale: ['why'],
          toolFilter: { allow: ['read'], deny: ['write'] },
        },
      ],
    });
    expect(validate).toContain('工具过滤');
    expect(validate).toContain('why');
  });
});
