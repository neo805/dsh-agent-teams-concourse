/**
 * kernel/comms/dedup 测试 —— 幂等去重（§7.5.C3）。
 * dedupKey = hash(from|to|correlationId|digest)，correlationId 缺省用空串占位；
 * 重复消息丢弃并累计计数。哈希用纯 JS（FNV-1a），禁 node:crypto。
 */
import { describe, expect, it } from 'vitest';
import { DedupStore, contentDigest, dedupKey } from '../../../src/kernel/comms/dedup.js';

describe('contentDigest（纯 JS 哈希）', () => {
  it('确定性：同输入同输出，输出为 hex 字符串', () => {
    const a = contentDigest('回声风暴');
    expect(a).toBe(contentDigest('回声风暴'));
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it('不同内容一般产生不同摘要', () => {
    expect(contentDigest('a')).not.toBe(contentDigest('b'));
  });
});

describe('dedupKey', () => {
  it('确定性拼接，同 parts 同 key', () => {
    const p = { from: 'a', to: 'b', correlationId: 'c1', content: 'hello' };
    expect(dedupKey(p)).toBe(dedupKey({ ...p }));
  });

  it('correlationId 缺省与显式空串等价（空串占位）', () => {
    const p1 = dedupKey({ from: 'a', to: 'b', content: 'x' });
    const p2 = dedupKey({ from: 'a', to: 'b', correlationId: '', content: 'x' });
    expect(p1).toBe(p2);
  });

  it('字段不同则 key 不同', () => {
    const base = { from: 'a', to: 'b', correlationId: 'c', content: 'x' };
    const keys = new Set([
      dedupKey(base),
      dedupKey({ ...base, from: 'z' }),
      dedupKey({ ...base, to: 'z' }),
      dedupKey({ ...base, correlationId: 'c2' }),
      dedupKey({ ...base, content: 'y' }),
    ]);
    expect(keys.size).toBe(5);
  });
});

describe('DedupStore（C3 重复丢弃 + 计数）', () => {
  it('首次 record：duplicate=false, count=1', () => {
    const s = new DedupStore();
    expect(s.record('k1')).toEqual({ duplicate: false, count: 1 });
  });

  it('重复 record：duplicate=true 且计数累计', () => {
    const s = new DedupStore();
    s.record('k1');
    expect(s.record('k1')).toEqual({ duplicate: true, count: 2 });
    expect(s.record('k1')).toEqual({ duplicate: true, count: 3 });
  });

  it('count：未见过返回 0', () => {
    const s = new DedupStore();
    expect(s.count('nope')).toBe(0);
    s.record('k');
    expect(s.count('k')).toBe(1);
  });

  it('size 为已登记 key 数（重复不新增）', () => {
    const s = new DedupStore();
    s.record('a');
    s.record('a');
    s.record('b');
    expect(s.size).toBe(2);
  });

  it('回声风暴场景：同一条广播重放 100 次只算 1 条新消息', () => {
    const s = new DedupStore();
    const key = dedupKey({ from: 'a', to: 'b', correlationId: 'r1', content: 'ping' });
    for (let i = 0; i < 100; i += 1) s.record(key);
    expect(s.size).toBe(1);
    expect(s.count(key)).toBe(100);
  });
});
