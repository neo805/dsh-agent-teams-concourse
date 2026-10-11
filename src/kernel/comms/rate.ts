/**
 * kernel/comms/rate —— 速率降级（调研报告 §7.5.B2）。
 *
 * 滑动窗口限流：窗口内第 n+1 次起返回 degrade。
 * 调用方语义：degrade ≠ 丢弃，而是「投递不唤醒」并留痕（消息照常进收件箱/共享板，
 * 只是不再唤醒目标顶点）——削峰而不丢消息，正是防回声风暴的降级手段。
 *
 * 时钟可注入（now?: () => number），测试用假时钟保证确定性，禁真实计时器。
 */
import type { Rate } from '../topology/schema.js';

export class RateLimiter {
  private readonly limit: Rate;
  private readonly now: () => number;
  /** 窗口内保留的调用时间戳（升序）。 */
  private stamps: number[] = [];

  constructor(limit: Rate, now: () => number = () => Date.now()) {
    this.limit = limit;
    this.now = now;
  }

  /**
   * 记录一次调用并判定是否降级。
   * @param at 显式时刻（缺省用注入时钟）
   */
  check(at?: number): 'allow' | 'degrade' {
    const t = at ?? this.now();
    // 剔除滑出窗口的时间戳：保留 (t - perMs, t] 内的戳
    const floor = t - this.limit.perMs;
    this.stamps = this.stamps.filter((s) => s > floor);
    this.stamps.push(t);
    return this.stamps.length <= this.limit.n ? 'allow' : 'degrade';
  }

  /** 清空窗口（人工复位）。 */
  reset(): void {
    this.stamps = [];
  }
}
