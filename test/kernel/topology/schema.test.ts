import { describe, expect, it } from 'vitest';
import { Concourse, Edge, parseConcourse, Vertex } from '../../../src/kernel/topology/schema.js';

describe('kernel/topology/schema（§7.8.1 数据模型）', () => {
  it('最小合法定义可解析并填充默认值', () => {
    const c = parseConcourse({
      id: 'demo',
      tier: 'T1a',
      vertices: [{ id: 'captain', origin: 'self' }],
    });
    expect(c.substrate).toEqual({ depthAlwaysOne: true, completeGraph: true });
    expect(c.approval).toBe('once');
    expect(c.edges).toEqual([]);
    expect(c.tasks).toEqual([]);
    expect(c.vertices[0]).toMatchObject({
      id: 'captain',
      origin: 'self',
      parent: null,
      layer: 0,
      lifecycle: 'task',
      contextMode: 'spawn',
      maxDepth: 0,
    });
  });

  it('边默认值：wake=never（最强防回声手段，§7.5.B1）、hopTTL=2', () => {
    const e = Edge.parse({ from: 'a', to: 'b' });
    expect(e).toMatchObject({ mode: 'notify', wake: 'never', hopTTL: 2 });
  });

  it('顶点默认值：origin=spawned、layer=0、maxDepth=0', () => {
    const v = Vertex.parse({ id: 'w-1' });
    expect(v).toMatchObject({ origin: 'spawned', parent: null, layer: 0, maxDepth: 0 });
  });

  it('T2b 全扁平不可表达（schema 层拒绝）', () => {
    expect(() =>
      parseConcourse({ id: 'x', tier: 'T2b', vertices: [{ id: 'a' }] }),
    ).toThrow();
  });

  it('拒绝非法取值：空 id / 负 layer / 非 once 审批 / 空顶点集', () => {
    expect(() => Vertex.parse({ id: '' })).toThrow();
    expect(() => Vertex.parse({ id: 'a', layer: -1 })).toThrow();
    expect(() =>
      Concourse.parse({ id: 'x', tier: 'T1a', approval: 'each', vertices: [{ id: 'a' }] }),
    ).toThrow();
    expect(() => Concourse.parse({ id: 'x', tier: 'T1a', vertices: [] })).toThrow();
  });

  it('substrate 事实不可篡改：depthAlwaysOne / completeGraph 必须为 true', () => {
    expect(() =>
      Concourse.parse({
        id: 'x',
        tier: 'T1a',
        substrate: { depthAlwaysOne: false, completeGraph: true },
        vertices: [{ id: 'a' }],
      }),
    ).toThrow();
  });

  it('任务画像接受部分维度，缺省维度填充默认值（suggester 永远拿到完整画像）', () => {
    const c = parseConcourse({
      id: 'x',
      tier: 'T1a',
      vertices: [{ id: 'a' }],
      tasks: [{ id: 'T-1', subject: '实现 API', assignee: 'a', profile: { cognitive: 4 } }],
    });
    expect(c.tasks[0]?.profile).toEqual({
      cognitive: 4,
      breadth: 2,
      contextTokens: 0,
      toolCalls: 0,
      determinism: 'mid',
      risk: 'reversible',
      parallelism: 'serial',
    });
  });
});
