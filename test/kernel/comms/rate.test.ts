/**
 * kernel/comms/rate 测试 —— 速率降级（§7.5 B2）。
 * 滑动窗口内第 n+1 次起 degrade（调用方语义：降级为「投递不唤醒」并留痕）；
 * 窗口滑动后恢复 allow。注入时钟保证确定性，禁止真实计时器。
 */
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/kernel/comms/rate.js';

/** 可控假时钟。 */
const fakeClock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

describe('RateLimiter（B2 速率降级）', () => {
  it('窗口内前 n 次 allow，第 n+1 次起 degrade', () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ n: 3, perMs: 1000 }, clock.now);
    expect(rl.check()).toBe('allow');
    expect(rl.check()).toBe('allow');
    expect(rl.check()).toBe('allow');
    expect(rl.check()).toBe('degrade');
    expect(rl.check()).toBe('degrade');
  });

  it('窗口滑动（最早时间戳过期）后恢复 allow', () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ n: 2, perMs: 1000 }, clock.now);
    rl.check(); // t=0
    clock.advance(500);
    rl.check(); // t=500
    expect(rl.check()).toBe('degrade'); // t=500 窗口内第 3 次
    clock.advance(600); // t=1100，t=0 过期，但窗口内仍有 [500,500]（degrade 也计戳）
    expect(rl.check()).toBe('degrade');
    clock.advance(500); // t=1600，t=500 的两个戳过期，仅剩 t=1100
    expect(rl.check()).toBe('allow');
    expect(rl.check()).toBe('degrade');
  });

  it('reset 清空窗口', () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ n: 1, perMs: 1000 }, clock.now);
    rl.check();
    expect(rl.check()).toBe('degrade');
    rl.reset();
    expect(rl.check()).toBe('allow');
  });

  it('check(at) 显式传入时刻与注入时钟等价', () => {
    const rl = new RateLimiter({ n: 1, perMs: 1000 }, () => 0);
    expect(rl.check(0)).toBe('allow');
    expect(rl.check(1)).toBe('degrade');
    expect(rl.check(2000)).toBe('allow');
  });

  it('degrade 不计入额外消费语义由调用方决定；但窗口计数含被拒绝时刻戳（保守防风暴）', () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ n: 2, perMs: 1000 }, clock.now);
    rl.check(); // allow
    rl.check(); // allow
    expect(rl.check()).toBe('degrade');
    clock.advance(999);
    expect(rl.check()).toBe('degrade'); // 窗口未滑出
  });
});

/**
 * 旧实现作为行为参考：有界化后仍必须逐操作给出相同 verdict。
 * 只用于测试对拍，生产代码不得保留第二份实现。
 */
class ReferenceRateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly limit: { n: number; perMs: number },
  ) {}

  check(at: number): 'allow' | 'degrade' {
    const floor = at - this.limit.perMs;
    this.stamps = this.stamps.filter((s) => s > floor);
    this.stamps.push(at);
    return this.stamps.length <= this.limit.n ? 'allow' : 'degrade';
  }

  wouldDegrade(at: number): boolean {
    const floor = at - this.limit.perMs;
    return this.stamps.filter((s) => s > floor).length >= this.limit.n;
  }

  reset(): void {
    this.stamps = [];
  }
}

describe('RateLimiter 参考对拍与有界性', () => {
  it('任意乱序/重复/负时刻序列的 verdict 与旧实现一致', () => {
    const sequences = [
      [0, 0, 1, 500, 400, -100, 1000, 1001, 5000, 0, 3000],
      [0, 999, 1000, 1001, 2000, 1999, 0, 500],
      [-5000, 0, 250, 250, 251, 100000, 99999],
    ];
    for (const n of [1, 2, 3, 5]) {
      for (const perMs of [1, 10, 1000]) {
        for (const ats of sequences) {
          const actual = new RateLimiter({ n, perMs }, () => 0);
          const reference = new ReferenceRateLimiter({ n, perMs });
          for (const at of ats) {
            expect(actual.wouldDegrade(at), `wouldDegrade n=${n} perMs=${perMs} at=${at}`).toBe(
              reference.wouldDegrade(at),
            );
            expect(actual.check(at), `check n=${n} perMs=${perMs} at=${at}`).toBe(
              reference.check(at),
            );
            expect(actual.wouldDegrade(at), `post-check n=${n} perMs=${perMs} at=${at}`).toBe(
              reference.wouldDegrade(at),
            );
          }
          actual.reset();
          reference.reset();
          expect(actual.wouldDegrade(ats[0] ?? 0)).toBe(reference.wouldDegrade(ats[0] ?? 0));
        }
      }
    }
  });

  it('wouldDegrade 只读：探测不消耗窗口', () => {
    const rl = new RateLimiter({ n: 2, perMs: 1000 }, () => 0);
    expect(rl.wouldDegrade(0)).toBe(false);
    expect(rl.wouldDegrade(0)).toBe(false);
    expect(rl.check(0)).toBe('allow');
    expect(rl.check(0)).toBe('allow');
    expect(rl.wouldDegrade(0)).toBe(true);
    expect(rl.check(0)).toBe('degrade');
  });

  it('连续降级一万次后内部窗口仍受 n 约束，不保留全历史', () => {
    const n = 3;
    const rl = new RateLimiter({ n, perMs: 1_000_000 }, () => 0);
    for (let i = 0; i < 10_000; i += 1) rl.check(i);
    const internal = rl as unknown as { stamps: number[] };
    expect(internal.stamps.length).toBeLessThanOrEqual(n);
  });

  it('RC8-2 原始最小反例：回退后插入的旧戳不得造成虚假 degrade', () => {
    const actual = new RateLimiter({ n: 3, perMs: 1 }, () => 0);
    const reference = new ReferenceRateLimiter({ n: 3, perMs: 1 });
    for (const at of [-2, 0, -2, 0, -2]) {
      expect(actual.check(at), `check at=${at}`).toBe(reference.check(at));
    }
  });

  it('RC8-2 第二反例：简单的 > → >= 仍会发散', () => {
    const actual = new RateLimiter({ n: 3, perMs: 1 }, () => 0);
    const reference = new ReferenceRateLimiter({ n: 3, perMs: 1 });
    for (const at of [-2, 1, -2, 0, -2]) {
      expect(actual.wouldDegrade(at), `pre-would at=${at}`).toBe(reference.wouldDegrade(at));
      expect(actual.check(at), `check at=${at}`).toBe(reference.check(at));
      expect(actual.wouldDegrade(at), `post-would at=${at}`).toBe(reference.wouldDegrade(at));
    }
  });

  it('RC8-2 有界穷举：短乱序序列逐操作对拍且窗口始终 ≤ n', () => {
    const values = [-2, 0, 1, 3];
    for (const n of [1, 2, 3]) {
      for (const perMs of [1, 3]) {
        for (let code = 0; code < values.length ** 4; code += 1) {
          let rest = code;
          const ats: number[] = [];
          for (let i = 0; i < 4; i += 1) {
            ats.push(values[rest % values.length]!);
            rest = Math.floor(rest / values.length);
          }
          const actual = new RateLimiter({ n, perMs }, () => 0);
          const reference = new ReferenceRateLimiter({ n, perMs });
          for (const at of ats) {
            const context = `n=${n} perMs=${perMs} seq=${ats.join(',')} at=${at}`;
            expect(actual.wouldDegrade(at), `pre-would ${context}`).toBe(reference.wouldDegrade(at));
            expect(actual.check(at), `check ${context}`).toBe(reference.check(at));
            expect(actual.wouldDegrade(at), `post-would ${context}`).toBe(reference.wouldDegrade(at));
            const internal = actual as unknown as { stamps: number[] };
            expect(internal.stamps.length, `bound ${context}`).toBeLessThanOrEqual(n);
          }
        }
      }
    }
  });
});
