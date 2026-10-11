import { describe, expect, it } from 'vitest';
import {
  closeEdge,
  completeGraphPairs,
  findEdge,
  isOpen,
  openEdge,
  treeEdges,
  withReverseAck,
} from '../../../src/kernel/topology/edges.js';
import type { Edge } from '../../../src/kernel/topology/schema.js';
import { t1aStar, t1bTree } from '../../fixtures/topology/index.js';

const e = (from: string, to: string, over: Partial<Edge> = {}): Edge => ({
  from,
  to,
  mode: 'notify',
  wake: 'never',
  hopTTL: 2,
  ...over,
});

describe('kernel/topology/edges · completeGraphPairs（物理完全图，§7.1.2）', () => {
  it('n 个 id 产生 n(n-1) 个有序对', () => {
    expect(completeGraphPairs([])).toHaveLength(0);
    expect(completeGraphPairs(['a'])).toHaveLength(0);
    expect(completeGraphPairs(['a', 'b', 'c'])).toHaveLength(6);
    expect(completeGraphPairs(['a', 'b', 'c', 'd'])).toHaveLength(12);
  });

  it('有序对按输入顺序稳定枚举（先行后列）', () => {
    expect(completeGraphPairs(['a', 'b', 'c'])).toEqual([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'a' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
      { from: 'c', to: 'b' },
    ]);
  });
});

describe('kernel/topology/edges · findEdge / isOpen（deny-by-default，§7.2.1）', () => {
  const edges = [e('a', 'b')];

  it('未声明的边一律关闭', () => {
    expect(isOpen(edges, 'b', 'a')).toBe(false);
    expect(isOpen(edges, 'a', 'c')).toBe(false);
    expect(isOpen([], 'a', 'b')).toBe(false);
  });

  it('已声明的边开放；A→B 不蕴含 B→A（半双工）', () => {
    expect(isOpen(edges, 'a', 'b')).toBe(true);
    expect(findEdge(edges, 'a', 'b')).toEqual(e('a', 'b'));
    expect(findEdge(edges, 'b', 'a')).toBeUndefined();
  });
});

describe('kernel/topology/edges · openEdge / closeEdge（不可变更新）', () => {
  it('openEdge 追加新边，原数组不变', () => {
    const before = [e('a', 'b')];
    const after = openEdge(before, e('b', 'c'));
    expect(after).toHaveLength(2);
    expect(before).toHaveLength(1);
    expect(isOpen(after, 'b', 'c')).toBe(true);
  });

  it('openEdge 替换同 (from,to) 的旧边而不是重复追加', () => {
    const before = [e('a', 'b', { wake: 'never' })];
    const after = openEdge(before, e('a', 'b', { wake: 'always' }));
    expect(after).toHaveLength(1);
    expect(findEdge(after, 'a', 'b')?.wake).toBe('always');
    expect(before[0]?.wake).toBe('never');
  });

  it('closeEdge 删除已声明边，原数组不变', () => {
    const before = [e('a', 'b'), e('b', 'c')];
    const after = closeEdge(before, 'a', 'b');
    expect(after).toEqual([e('b', 'c')]);
    expect(before).toHaveLength(2);
  });

  it('closeEdge 关闭不存在的边 = 内容不变的新数组', () => {
    const before = [e('a', 'b')];
    const after = closeEdge(before, 'x', 'y');
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
  });
});

describe('kernel/topology/edges · withReverseAck（request-reply 反向应答绑定，§7.2.1/A2）', () => {
  it('非 request-reply 模式原样返回单元素数组', () => {
    const notify = e('a', 'b', { mode: 'notify' });
    expect(withReverseAck(notify)).toEqual([notify]);
    const board = e('a', 'b', { mode: 'board' });
    expect(withReverseAck(board)).toEqual([board]);
  });

  it('request-reply 生成反向应答边：wake=never（不唤醒，防回声）、hopTTL 相同', () => {
    const req = e('a', 'b', { mode: 'request-reply', wake: 'on-reply', hopTTL: 3 });
    const pair = withReverseAck(req);
    expect(pair).toHaveLength(2);
    expect(pair[0]).toEqual(req);
    expect(pair[1]).toEqual({
      from: 'b',
      to: 'a',
      mode: 'request-reply',
      wake: 'never',
      hopTTL: 3,
    });
  });
});

describe('kernel/topology/edges · treeEdges（按树形默认开边）', () => {
  it('每个非根顶点产生 parent→child 请求边 + child→parent 应答边', () => {
    const edges = treeEdges(t1aStar.vertices);
    // 3 个子顶点 × 2 条边
    expect(edges).toHaveLength(6);
    const req = findEdge(edges, 'captain', 'w-1');
    expect(req).toMatchObject({ mode: 'request-reply', wake: 'on-reply', hopTTL: 2 });
    const ack = findEdge(edges, 'w-1', 'captain');
    expect(ack).toMatchObject({ mode: 'request-reply', wake: 'never', hopTTL: 2 });
  });

  it('多层树同样只沿 parent 关系开边（t1b-tree：3 条父子关系 × 2）', () => {
    const edges = treeEdges(t1bTree.vertices);
    expect(edges).toHaveLength(6);
    expect(isOpen(edges, 'captain', 'lead')).toBe(true);
    expect(isOpen(edges, 'lead', 'w-2')).toBe(true);
    expect(isOpen(edges, 'captain', 'w-1')).toBe(false);
  });

  it('根顶点（parent=null）不产生边；空数组返回空', () => {
    expect(treeEdges([])).toEqual([]);
    expect(treeEdges(t1aStar.vertices.filter((v) => v.parent === null))).toEqual([]);
  });
});
