/**
 * test/tools/keys — 未知字段检测 + Levenshtein did-you-mean 的单元测试，
 * 以及六个工具「未知字段一律报错附建议」的矩阵测试。
 */
import { describe, expect, test } from 'vitest';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { assertKnownKeys, didYouMean, levenshtein } from '../../src/tools/keys.js';
import { createTeamTopologyTool } from '../../src/tools/team-topology.js';
import { createTeamPlanTool } from '../../src/tools/team-plan.js';
import { createTeamAssignTool } from '../../src/tools/team-assign.js';
import { createTeamLinkTool } from '../../src/tools/team-link.js';
import { createTeamSendTool } from '../../src/tools/team-send.js';
import { createTeamStatusTool } from '../../src/tools/team-status.js';
import { SAMPLE_SPEC, fakeExec, makeFixture } from './helpers.js';

describe('levenshtein', () => {
  test('基本距离', () => {
    expect(levenshtein('from', 'form')).toBe(2); // 换位 = 两次编辑
    expect(levenshtein('spec', 'spec')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('didYouMean', () => {
  test('近距离候选按距离排序给出', () => {
    expect(didYouMean('frm', ['from', 'to', 'id'])).toEqual(['from']);
    expect(didYouMean('specc', ['spec'])).toEqual(['spec']);
  });
  test('距离过远不给建议', () => {
    expect(didYouMean('zzzzzz', ['from', 'to'])).toEqual([]);
  });
});

describe('assertKnownKeys', () => {
  test('非对象入参直接放行', () => {
    expect(() => assertKnownKeys(42, ['a'], 'tool')).not.toThrow();
    expect(() => assertKnownKeys(null, ['a'], 'tool')).not.toThrow();
  });
  test('未知字段报错附 did you mean 与允许字段清单', () => {
    expect(() => assertKnownKeys({ frm: 'x' }, ['from', 'to'], 'team_send')).toThrow(
      /team_send 收到未知字段 "frm"。did you mean "from"/,
    );
  });
});

describe('六工具未知字段矩阵', () => {
  const fx = makeFixture();
  const cases: Array<[string, (fx2: typeof fx) => ToolDefinition, Record<string, unknown>]> = [
    ['team_topology', (f) => createTeamTopologyTool(f.deps), { spec: SAMPLE_SPEC, specc: 1 }],
    ['team_plan', (f) => createTeamPlanTool(f.deps), { spec: SAMPLE_SPEC, specc: 1 }],
    ['team_assign', (f) => createTeamAssignTool(f.deps), { id: 'x', idd: 1 }],
    ['team_link', (f) => createTeamLinkTool(f.deps), { id: 'x', from: 'a', to: 'b', action: 'open', frm: 'x' }],
    ['team_send', (f) => createTeamSendTool(f.deps), { id: 'x', from: 'a', to: 'b', content: 'c', frm: 'x' }],
    ['team_status', (f) => createTeamStatusTool(f.deps), { idd: 'x' }],
  ];
  for (const [toolName, make, args] of cases) {
    test(`${toolName}：未知字段报错附 did you mean`, async () => {
      const tool = make(fx);
      await expect(tool.execute(args, fakeExec())).rejects.toThrow(/未知字段.*did you mean/);
    });
  }
});
