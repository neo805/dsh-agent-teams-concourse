/**
 * topology 预览与 plan 创建必须经过同一预算规范化管线。
 * 回归：小 global budget + 缺省 vertex budget 不得出现“预览 ok、创建 BUDGET_OVERFLOW”。
 */
import { describe, expect, test } from 'vitest';
import { createTeamPlanTool } from '../../src/tools/team-plan.js';
import { createTeamTopologyTool } from '../../src/tools/team-topology.js';
import { SAMPLE_SPEC, fakeExec, makeFixture } from './helpers.js';

type Issue = { code: string; path?: string };

async function issuesOf(spec: unknown): Promise<{ preview: Issue[]; plan: Issue[] }> {
  const fx = makeFixture();
  const preview = (await createTeamTopologyTool(fx.deps).execute({ spec }, fakeExec())) as {
    issues: Issue[];
  };
  const plan = (await createTeamPlanTool(fx.deps).execute({ spec }, fakeExec())) as {
    issues: Issue[];
  };
  return { preview: preview.issues, plan: plan.issues };
}

const issueView = (issues: Issue[]) => issues.map((i) => [i.code, i.path ?? '']);

describe('topology / plan 分析管线一致性', () => {
  test.each([
    ['结构非法', { id: 'bad', tier: 'T9', vertices: [] }],
    [
      '未知字段',
      {
        ...SAMPLE_SPEC,
        vertces: [],
      },
    ],
    [
      '悬挂 parent',
      {
        id: 'dangling',
        tier: 'T1a',
        vertices: [
          { id: 'a', origin: 'self' },
          { id: 'b', parent: 'ghost', layer: 1 },
        ],
      },
    ],
  ])('%s：两入口 issue code/path 与顺序一致', async (_name, spec) => {
    const { preview, plan } = await issuesOf(spec);
    expect(preview.length).toBeGreaterThan(0);
    expect(issueView(plan)).toEqual(issueView(preview));
  });
});

describe('topology / plan 预算一致性', () => {
  test('同一小预算 spec 在两工具返回同码 BUDGET_OVERFLOW，且不落库', async () => {
    const fx = makeFixture();
    const spec = { ...SAMPLE_SPEC, budget: { tokens: 1 } };

    const preview = (await createTeamTopologyTool(fx.deps).execute(
      { spec },
      fakeExec(),
    )) as {
      ok: boolean;
      stage: string;
      issues: Array<{ code: string; message: string }>;
    };
    const plan = (await createTeamPlanTool(fx.deps).execute({ spec }, fakeExec())) as {
      ok: boolean;
      code?: string;
      issues: Array<{ code: string; message: string }>;
    };

    expect(preview.ok).toBe(false);
    expect(preview.stage).toBe('validate');
    expect(preview.issues.some((i) => i.code === 'BUDGET_OVERFLOW')).toBe(true);
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('INVALID_SPEC');
    expect(plan.issues.some((i) => i.code === 'BUDGET_OVERFLOW')).toBe(true);
    expect(fx.service.list()).toHaveLength(0);
  });
});
