/**
 * kernel/topology/analyze —— preview 与 create 共用的唯一 spec 分析管线。
 * 结构解析 → 未知字段扫描 → 预算规范化 → 语义校验 → 一次估算。
 */
import { describe, expect, it } from 'vitest';
import { analyzeConcourse } from '../../../src/kernel/topology/analyze.js';

function input() {
  return {
    id: 'c-analyze',
    tier: 'T1a',
    vertices: [
      { id: 'a', origin: 'self' },
      { id: 'b', parent: 'a', layer: 1, reasoningEffort: 'low' },
    ],
    edges: [{ from: 'a', to: 'b' }],
    tasks: [{ id: 't1', subject: '分析', assignee: 'b' }],
  };
}

describe('analyzeConcourse', () => {
  it('合法 spec：stage=validate，返回规范化 concourse 与本次预算估算', () => {
    const out = analyzeConcourse(input());
    expect(out.stage).toBe('validate');
    expect(out.concourse).toBeDefined();
    expect(out.issues).toEqual([]);
    expect(out.estimate?.total).toBeGreaterThan(0);
    expect(out.concourse?.budget?.tokens).toBe(Math.ceil(out.estimate?.total ?? 0));
  });

  it('结构非法：stage=parse，无 concourse/estimate，issues 均为 SCHEMA', () => {
    const out = analyzeConcourse({ id: 'bad', tier: 'T9', vertices: [] });
    expect(out.stage).toBe('parse');
    expect(out.concourse).toBeUndefined();
    expect(out.estimate).toBeUndefined();
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.issues.every((i) => i.code === 'SCHEMA')).toBe(true);
    expect(out.issues.some((i) => i.path === 'tier' || i.path === 'vertices')).toBe(true);
  });

  it('未知字段与语义错误：stage=validate 且合并进同一 issues 列表', () => {
    const out = analyzeConcourse({
      ...input(),
      vertces: [],
      vertices: [
        { id: 'a', origin: 'self' },
        { id: 'b', parent: 'ghost', layer: 1 },
      ],
    });
    expect(out.stage).toBe('validate');
    expect(out.concourse).toBeDefined();
    expect(out.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['UNKNOWN_FIELD', 'DANGLING_PARENT']),
    );
  });
});
