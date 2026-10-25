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
  /**
   * 只保留最大的 n 个时间戳，升序。
   *
   * 判定只取决于“窗口内有效戳数是否达到 n”。若保留 n 个最大值：
   *  · 最小值也大于 floor → 这 n 个全部有效，结论必为 degrade；
   *  · 最小值不大于 floor → 所有被丢弃的值更小，也全部过期。
   * 因而被丢弃的戳不可能改变今后任何 floor 的判定。空间上界为 n，
   * 不再随连续 degrade 的历史消息数增长。
   *
   * 额外保留 `purgeFloor`：旧实现对 check(at) 的过期剔除不可逆，即使未来 at
   * 回退，已被剔除的戳也不得复活。它是历史最大 floor，而非当前 at。
   */
  private stamps: number[] = [];
  private purgeFloor = Number.NEGATIVE_INFINITY;

  constructor(limit: Rate, now: () => number = () => Date.now()) {
    this.limit = limit;
    this.now = now;
  }

  /** 二分求第一个 > floor 的下标；stamps 始终升序。 */
  private firstAfter(floor: number): number {
    let lo = 0;
    let hi = this.stamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.stamps[mid]! <= floor) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 二分求第一个 >= value 的下标；用于稳定插入。 */
  private firstAtOrAfter(value: number): number {
    let lo = 0;
    let hi = this.stamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.stamps[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 记录一次调用并判定是否降级。 */
  check(at?: number): 'allow' | 'degrade' {
    const t = at ?? this.now();
    const floor = t - this.limit.perMs;
    // check 的过期剔除不可逆；只提升水位，时钟回退不能复活已剔除的戳。
    if (floor > this.purgeFloor) {
      this.stamps = this.stamps.slice(this.firstAfter(floor));
      this.purgeFloor = floor;
    }
    const valid = this.stamps.length - this.firstAfter(floor);
    const verdict = valid < this.limit.n ? 'allow' : 'degrade';

    // 二分插入，保持升序；只增一个元素，最多淘汰一个最小值。
    const insertAt = this.firstAtOrAfter(t);
    this.stamps.splice(insertAt, 0, t);
    if (this.stamps.length > this.limit.n) this.stamps.shift();
    return verdict;
  }

  /** 只读探测：不消耗窗口（投递前决定是否允许唤醒）。 */
  wouldDegrade(at?: number): boolean {
    const t = at ?? this.now();
    const floor = t - this.limit.perMs;
    return this.stamps.length - this.firstAfter(floor) >= this.limit.n;
  }

  /** 清空窗口（人工复位）。 */
  reset(): void {
    this.stamps = [];
    this.purgeFloor = Number.NEGATIVE_INFINITY;
  }
}
