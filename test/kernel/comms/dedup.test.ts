/**
 * kernel/comms/dedup 测试 —— 幂等去重（§7.5.C3）。
 * dedupKey = 完整 (from,to,correlationId,content) 的 JSON tuple；
 * correlationId 缺省用空串占位；重复消息丢弃并累计计数。
 * contentDigest 仅是诊断工具，永不作为消息身份。
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

  it('字段边界不可通过分隔符碰撞', () => {
    const k1 = dedupKey({ from: 'a', to: 'b\u001fc', correlationId: 'd', content: 'x' });
    const k2 = dedupKey({ from: 'a\u001fb', to: 'c', correlationId: 'd', content: 'x' });
    expect(k1).not.toBe(k2);
  });

  it('内容摘要碰撞的不同正文仍必须产生不同 dedupKey（摘要不得作为唯一身份）', () => {
    // FNV-1a 32 位已知碰撞：两者 contentDigest 相同，但正文不同。
    expect(contentDigest('costarring')).toBe(contentDigest('liquid'));
    const a = dedupKey({ from: 'a', to: 'b', content: 'costarring' });
    const b = dedupKey({ from: 'a', to: 'b', content: 'liquid' });
    expect(a).not.toBe(b);
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

  it('小字母表穷举：所有不同 tuple 必须得到不同 key（单射不变量）', () => {
    const values = ['', 'a', 'b', 'a\u001f', '\u001f', '中', 'x y', 'costarring'];
    const keys = new Set<string>();
    let tuples = 0;
    for (const from of values) {
      for (const to of values) {
        for (const correlationId of values) {
          for (const content of values) {
            keys.add(dedupKey({ from, to, correlationId, content }));
            tuples += 1;
          }
        }
      }
    }
    expect(keys.size).toBe(tuples);
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
