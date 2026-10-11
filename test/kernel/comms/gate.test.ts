/**
 * kernel/comms/gate 测试 —— 开放边集准入（§7.5 A 类 deny-by-default，FR-5.E2 留痕）。
 *
 * 权威判定在「收件箱准入」路径；本模块是该路径调用的纯判定函数：
 * 未列出的边一律关闭；拒绝必须携带当前开放出边候选列表，让拒绝可行动。
 */
import { describe, expect, it } from 'vitest';
import type { Edge } from '../../../src/kernel/topology/schema.js';
import { admit } from '../../../src/kernel/comms/gate.js';

const edge = (from: string, to: string): Edge => ({
  from,
  to,
  mode: 'notify',
  wake: 'never',
  hopTTL: 2,
});

describe('admit（A 类 deny-by-default）', () => {
  it('开放边 deliver，并返回匹配的边对象', () => {
    const e = edge('captain', 'worker');
    const v = admit([e], { from: 'captain', to: 'worker' });
    expect(v).toEqual({ verdict: 'deliver', edge: e });
  });

  it('闭边 reject：EDGE_CLOSED 且附开放出边候选列表（E2 留痕数据）', () => {
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('d', 'e')];
    const v = admit(edges, { from: 'a', to: 'e' });
    expect(v).toEqual({ verdict: 'reject', code: 'EDGE_CLOSED', candidates: ['b', 'c'] });
  });

  it('方向性：A→B 开放不蕴含 B→A（A2 半双工）', () => {
    const edges = [edge('a', 'b')];
    expect(admit(edges, { from: 'b', to: 'a' })).toEqual({
      verdict: 'reject',
      code: 'EDGE_CLOSED',
      candidates: [],
    });
  });

  it('无任何出边时候选列表为空', () => {
    const v = admit([edge('x', 'y')], { from: 'z', to: 'y' });
    expect(v).toEqual({ verdict: 'reject', code: 'EDGE_CLOSED', candidates: [] });
  });

  it('空边集一切拒绝（deny-by-default）', () => {
    const v = admit([], { from: 'a', to: 'b' });
    expect(v).toEqual({ verdict: 'reject', code: 'EDGE_CLOSED', candidates: [] });
  });

  it('发送侧早失败与收件侧权威判定结果一致（同一纯函数）', () => {
    const edges = [edge('a', 'b')];
    const early = admit(edges, { from: 'a', to: 'c' });
    const inbox = admit(edges, { from: 'a', to: 'c' });
    expect(early).toEqual(inbox);
  });
});
