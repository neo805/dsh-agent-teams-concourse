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
