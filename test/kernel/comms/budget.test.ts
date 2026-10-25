/**
 * kernel/comms/budget 测试 —— 边熔断（D1）+ 全局熔断（D2）。
 * tokens 超边预算 → 该边熔断，不殃及团队其他边；
 * 超全局预算 → 全局熔断（语义=暂停所有 wake≠never 的投递），仅人工恢复。
 * tokens 为非正数 → RangeError（非法输入）。
 */
import { describe, expect, it } from 'vitest';
import { BudgetBook } from '../../../src/kernel/comms/budget.js';

const key = (from: string, to: string): string => BudgetBook.edgeKey(from, to);

describe('BudgetBook.edgeKey', () => {
  it('有向且使用无歧义 tuple framing', () => {
    expect(BudgetBook.edgeKey('a', 'b')).toBe(JSON.stringify(['a', 'b']));
    expect(BudgetBook.edgeKey('b', 'a')).toBe(JSON.stringify(['b', 'a']));
    expect(BudgetBook.edgeKey('a->b', 'c')).not.toBe(BudgetBook.edgeKey('a', 'b->c'));
  });
});

describe('边预算（D1）', () => {
  it('预算内 consume 返回 ok 并扣减余额', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 100 } });
    expect(b.consumeEdge('a', 'b', 40)).toBe('ok');
    expect(b.remainingEdge('a', 'b')).toBe(60);
  });

  it('恰好花光预算不熔断，超额才熔断', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 50 } });
    expect(b.consumeEdge('a', 'b', 50)).toBe('ok');
    expect(b.consumeEdge('a', 'b', 1)).toBe('fuse-edge');
  });

  it('超额消费触发熔断；熔断后该边一律 fuse-edge', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 100 } });
    expect(b.consumeEdge('a', 'b', 101)).toBe('fuse-edge');
    expect(b.isFusedEdge('a', 'b')).toBe(true);
    expect(b.consumeEdge('a', 'b', 1)).toBe('fuse-edge');
  });

  it('边熔断不殃及团队其他边（D1）', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 10, [key('a', 'c')]: 10 } });
    expect(b.consumeEdge('a', 'b', 11)).toBe('fuse-edge');
    expect(b.consumeEdge('a', 'c', 5)).toBe('ok');
    expect(b.isGlobalFused()).toBe(false);
  });

  it('字段边界不碰撞：带箭头的顶点 ID 不串边账', () => {
    const b = new BudgetBook({
      edgeBudgets: { [key('a->b', 'c')]: 10, [key('a', 'b->c')]: 20 },
    });
    expect(b.remainingEdge('a->b', 'c')).toBe(10);
    expect(b.remainingEdge('a', 'b->c')).toBe(20);
  });

  it('resumeEdge 人工恢复；未熔断返回 false', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 10 } });
    expect(b.resumeEdge('a', 'b')).toBe(false);
    b.consumeEdge('a', 'b', 11);
    expect(b.resumeEdge('a', 'b')).toBe(true);
    expect(b.isFusedEdge('a', 'b')).toBe(false);
  });

  it('无预算登记的边 consume 只记全局账，remainingEdge 为 undefined', () => {
    const b = new BudgetBook();
    expect(b.consumeEdge('x', 'y', 5)).toBe('ok');
    expect(b.remainingEdge('x', 'y')).toBeUndefined();
    expect(b.isFusedEdge('x', 'y')).toBe(false);
  });
});

describe('全局预算（D2）', () => {
  it('超全局预算 → fuse-global 且全局熔断', () => {
    const b = new BudgetBook({ globalBudget: 100 });
    expect(b.consumeEdge('a', 'b', 60)).toBe('ok');
    expect(b.remainingGlobal()).toBe(40);
    expect(b.consumeEdge('c', 'd', 41)).toBe('fuse-global');
    expect(b.isGlobalFused()).toBe(true);
  });

  it('全局熔断后所有边 consume 一律 fuse-global，仅人工恢复（D2）', () => {
    const b = new BudgetBook({ globalBudget: 10 });
    b.consumeEdge('a', 'b', 11);
    expect(b.consumeEdge('x', 'y', 1)).toBe('fuse-global');
    b.resumeGlobal();
    expect(b.isGlobalFused()).toBe(false);
    expect(b.consumeEdge('x', 'y', 1)).toBe('ok');
  });

  it('无全局预算时 remainingGlobal 为 undefined，永不全局熔断', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 1 } });
    expect(b.remainingGlobal()).toBeUndefined();
    b.consumeEdge('a', 'b', 1);
    expect(b.consumeEdge('a', 'b', 1)).toBe('fuse-edge'); // 只触发边熔断
  });
});

describe('只读预检与运行时重建', () => {
  it('canConsume 不改变账目；withEdgeBudgets 保留已用边与全局熔断状态', () => {
    const b = new BudgetBook({
      edgeBudgets: { [key('a', 'b')]: 10, [key('a', 'c')]: 5 },
      globalBudget: 100,
    });
    expect(b.canConsume('a', 'b', 11)).toBe('fuse-edge');
    expect(b.remainingEdge('a', 'b')).toBe(10);
    b.consumeEdge('a', 'b', 4);
    b.consumeEdge('a', 'c', 2);
    const next = b.withEdgeBudgets({ [key('a', 'b')]: 10, [key('b', 'c')]: 7 });
    expect(next.remainingEdge('a', 'b')).toBe(6);
    expect(next.remainingEdge('b', 'c')).toBe(7);
    expect(next.remainingEdge('a', 'c')).toBeUndefined();
    expect(next.remainingGlobal()).toBe(94);
    expect(next.isGlobalFused()).toBe(false);
  });

  it('withEdgeBudgets 删除已移除边的熔断标记，仅保留仍有预算登记的边', () => {
    const b = new BudgetBook({
      edgeBudgets: { [key('a', 'b')]: 1, [key('a', 'c')]: 1 },
    });
    expect(b.consumeEdge('a', 'b', 2)).toBe('fuse-edge');
    expect(b.consumeEdge('a', 'c', 2)).toBe('fuse-edge');

    const next = b.withEdgeBudgets({ [key('a', 'c')]: 1 });
    expect(next.isFusedEdge('a', 'b')).toBe(false);
    expect(next.canConsume('a', 'b', 1)).toBe('ok');
    expect(next.isFusedEdge('a', 'c')).toBe(true);
    expect(next.canConsume('a', 'c', 1)).toBe('fuse-edge');
  });

  it('预检覆盖全局熔断/边熔断/全局超额分支', () => {
    const b = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 5 }, globalBudget: 2 });
    expect(b.canConsume('a', 'b', 3)).toBe('fuse-global');
    b.consumeEdge('x', 'y', 3);
    expect(b.canConsume('a', 'b', 1)).toBe('fuse-global');
    const edge = new BudgetBook({ edgeBudgets: { [key('a', 'b')]: 1 } });
    edge.consumeEdge('a', 'b', 2);
    expect(edge.canConsume('a', 'b', 1)).toBe('fuse-edge');
  });
});

describe('非法输入', () => {
  it('tokens 为 0 或负数 → RangeError', () => {
    const b = new BudgetBook({ globalBudget: 100 });
    expect(() => b.consumeEdge('a', 'b', 0)).toThrow(RangeError);
    expect(() => b.consumeEdge('a', 'b', -5)).toThrow(RangeError);
  });
});
