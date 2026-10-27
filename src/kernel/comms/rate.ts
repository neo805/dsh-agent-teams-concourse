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
   * 每次 check 都按“当前 floor”清理现存戳，而不是只在水位前进时清理：
   *  · 历史 check 已删除的戳不在数组中，时钟回退不会让它们复活；
   *  · 水位之后插入的旧戳，会在下一次窗口重新覆盖它时被正常清掉。
   */
  private stamps: number[] = [];

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
    // 只清理“当前仍在数组中”的过期戳。历史上已删除的戳不会复活；
    // 这样即使 at 乱序回退，也不会把水位后插入的旧戳遗漏在窗口内。
    const expired = this.firstAfter(floor);
    if (expired > 0) this.stamps = this.stamps.slice(expired);
    const verdict = this.stamps.length < this.limit.n ? 'allow' : 'degrade';

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
  }
}
