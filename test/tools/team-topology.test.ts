/**
 * test/tools/team-topology — 拓扑预览工具：解析/校验/谱系判定/建议，不落库。
 */
import { describe, expect, test } from 'vitest';
import { createTeamTopologyTool } from '../../src/tools/team-topology.js';
import { SAMPLE_SPEC, fakeExec, makeFixture } from './helpers.js';

interface TopologyOut {
  ok: boolean;
  stage: string;
  issues: Array<{ code: string; message: string; path?: string }>;
  tier?: string;
  tierLabel?: string;
  vertexCount?: number;
  edgeCount?: number;
  estimatedTokens?: number;
  suggestions: Array<{ taskId: string; provider: string; model: string; reasoningEffort: string; tokenTier: string }>;
}

describe('team_topology', () => {
  test('合法 spec（带 catalog）：ok + tier 判定 + 估算 + 逐任务建议', async () => {
    const fx = makeFixture({ withCatalog: true });
    const tool = createTeamTopologyTool(fx.deps);
    const out = (await tool.execute({ spec: SAMPLE_SPEC }, fakeExec())) as TopologyOut;
    expect(out.ok).toBe(true);
    expect(out.stage).toBe('validate');
    expect(out.tier).toBe('T1a');
    expect(out.tierLabel).toContain('T1a');
    expect(out.vertexCount).toBe(3);
    expect(out.edgeCount).toBe(4);
    expect(out.estimatedTokens).toBeGreaterThan(0);
    expect(out.issues).toEqual([]);
    expect(out.suggestions).toHaveLength(1); // 仅 t1 声明了 profile
    expect(out.suggestions[0]).toMatchObject({
      taskId: 't1',
      provider: 'p1',
      model: 'm-big',
      reasoningEffort: 'low',
      tokenTier: 'cheap',
    });
    // 纯预览：不落库
    expect(fx.service.list()).toHaveLength(0);
  });

  test('无 catalog：建议段为空（降级不崩溃）', async () => {
    const fx = makeFixture();
    const tool = createTeamTopologyTool(fx.deps);
    const out = (await tool.execute({ spec: SAMPLE_SPEC }, fakeExec())) as TopologyOut;
    expect(out.ok).toBe(true);
    expect(out.suggestions).toEqual([]);
  });

  test('结构非法（非对象）：stage=parse，SCHEMA issue', async () => {
    const fx = makeFixture();
    const tool = createTeamTopologyTool(fx.deps);
    const out = (await tool.execute({ spec: 42 }, fakeExec())) as TopologyOut;
    expect(out.ok).toBe(false);
    expect(out.stage).toBe('parse');
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.issues[0]?.code).toBe('SCHEMA');
  });

  test('语义非法（声明 tier 与实际形状不符）：issues 含 DECLARED_TIER_MISMATCH', async () => {
    const fx = makeFixture();
    const tool = createTeamTopologyTool(fx.deps);
    const out = (await tool.execute({ spec: { ...SAMPLE_SPEC, tier: 'T1b' } }, fakeExec())) as TopologyOut;
    expect(out.ok).toBe(false);
    expect(out.stage).toBe('validate');
    expect(out.issues.some((i) => i.code === 'DECLARED_TIER_MISMATCH')).toBe(true);
  });

  test('缺必填字段 spec：defineTool 入参校验拦截', async () => {
    const fx = makeFixture();
    const tool = createTeamTopologyTool(fx.deps);
    await expect(tool.execute({}, fakeExec())).rejects.toThrow();
  });

  test('输出 schema 为闭合对象；description 带 team_task_* 边界约定', () => {
    const fx = makeFixture();
    const tool = createTeamTopologyTool(fx.deps);
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.description).toContain('team_task_*');
  });

  test('F-1 回归：profile.signals 穿越 parseConcourse 边界不被 zod strip，confidence 随之抬升', async () => {
    const fx = makeFixture({ withCatalog: true });
    const tool = createTeamTopologyTool(fx.deps);
    const withSignals = {
      ...SAMPLE_SPEC,
      tasks: SAMPLE_SPEC.tasks.map((t) =>
        !('profile' in t)
          ? t
          : {
              ...t,
              profile: {
                ...t.profile,
                signals: ['s1', 's2', 's3', 's4'], // 4 条 → 置信 0.50 + 0.40 = 0.90
              },
            },
      ),
    };
    const out = (await tool.execute({ spec: withSignals }, fakeExec())) as TopologyOut & {
      suggestions: Array<{ confidence: number }>;
    };
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]?.confidence).toBeCloseTo(0.9, 5);
  });

  test('F-2 回归：render 展示 rationale 全文与 toolFilter 禁用清单', async () => {
    const fx = makeFixture({ withCatalog: true });
    const tool = createTeamTopologyTool(fx.deps);
    const securitySpec = {
      ...SAMPLE_SPEC,
      tasks: SAMPLE_SPEC.tasks.map((t) =>
        !('profile' in t) ? t : { ...t, profile: { ...t.profile, risk: 'security' } },
      ),
    };
    const out = (await tool.execute({ spec: securitySpec }, fakeExec())) as TopologyOut & {
      suggestions: Array<{ rationale: string[]; toolFilter?: { deny?: string[] } }>;
    };
    const s = out.suggestions[0];
    expect(s?.toolFilter?.deny).toEqual(['bash', 'write', 'edit']);
    expect(s?.rationale.length).toBeGreaterThan(0);
    const rendered = tool.output.render({ spec: securitySpec }, out as never);
    const text = rendered.map((r) => ('text' in r ? r.text : '')).join('\n');
    expect(text).toContain('工具过滤：禁用 bash/write/edit');
    expect(text).toContain('risk=security');
    expect(text).toContain('tier=premium');
  });
});
