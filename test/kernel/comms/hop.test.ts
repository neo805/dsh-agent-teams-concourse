/**
 * kernel/comms/hop 测试 —— 跳数 TTL（§7.5.C1）。
 * hops > edge.hopTTL → record-only（只记录不投递，板上标 HOP_LIMIT）；等于 TTL 仍投递。
 */
import { describe, expect, it } from 'vitest';
import type { Edge } from '../../../src/kernel/topology/schema.js';
import { checkHop } from '../../../src/kernel/comms/hop.js';

const edge = (hopTTL: number): Edge => ({
  from: 'a',
  to: 'b',
  mode: 'notify',
  wake: 'never',
  hopTTL,
});

describe('checkHop（C1 跳数熔断）', () => {
  it('hops < ttl 投递', () => {
    expect(checkHop(1, edge(2))).toEqual({ verdict: 'deliver' });
  });

  it('hops = ttl 仍投递（边界）', () => {
    expect(checkHop(2, edge(2))).toEqual({ verdict: 'deliver' });
  });

  it('hops > ttl 只记录不投递，标记 HOP_LIMIT', () => {
    expect(checkHop(3, edge(2))).toEqual({ verdict: 'record-only', code: 'HOP_LIMIT' });
  });

  it('ttl=1 的边：第 1 跳投递，第 2 跳 record-only', () => {
    const e = edge(1);
    expect(checkHop(1, e)).toEqual({ verdict: 'deliver' });
    expect(checkHop(2, e)).toEqual({ verdict: 'record-only', code: 'HOP_LIMIT' });
  });
});
