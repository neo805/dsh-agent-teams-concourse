/**
 * kernel/comms/budget —— 预算熔断（调研报告 §7.5 D1 边熔断 + D2 全局熔断）。
 *
 * D1：某条边 tokens 超边预算 → 只熔断该边（之后该边 consume 一律 fuse-edge），
 *     不殃及团队其他边；人工 resumeEdge 恢复。
 * D2：全局 tokens 超全局预算 → 全局熔断，语义 = 暂停所有 wake≠never 的投递；
 *     仅人工 resumeGlobal 恢复（自动恢复会让风暴死灰复燃）。
 *
 * 一切熔断与恢复都应由调用方留痕（E2）；本类只提供纯判定与账目。
 * 无预算登记的边 consume 只记全局账。
 */

export class BudgetBook {
  /** 各边剩余预算（edgeKey → remaining）。 */
  private readonly edgeRemaining = new Map<string, number>();
  /** 已熔断边集合。 */
  private readonly fusedEdges = new Set<string>();
  private globalRemaining: number | undefined;
  private globalFused = false;

  constructor(opts: { edgeBudgets?: Record<string, number>; globalBudget?: number } = {}) {
    for (const [key, budget] of Object.entries(opts.edgeBudgets ?? {})) {
      this.edgeRemaining.set(key, budget);
    }
    if (opts.globalBudget !== undefined) this.globalRemaining = opts.globalBudget;
  }

  /** 边键：`${from}->${to}`（有向）。 */
  static edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  /** 只读判定：当前是否还能在该边消费 tokens（不改变账目）。 */
  canConsume(from: string, to: string, tokens: number): 'ok' | 'fuse-edge' | 'fuse-global' {
    this.assertPositive(tokens);
    if (this.globalFused) return 'fuse-global';
    const key = BudgetBook.edgeKey(from, to);
    if (this.fusedEdges.has(key)) return 'fuse-edge';
    if (this.globalRemaining !== undefined && tokens > this.globalRemaining) return 'fuse-global';
    const edgeRem = this.edgeRemaining.get(key);
    if (edgeRem !== undefined && tokens > edgeRem) return 'fuse-edge';
    return 'ok';
  }

  /**
   * 尝试在 from→to 边上消费 tokens。
   * @throws RangeError tokens 为非正数（非法输入，计划期就该拦下）
   */
  consumeEdge(from: string, to: string, tokens: number): 'ok' | 'fuse-edge' | 'fuse-global' {
    this.assertPositive(tokens);
    if (this.globalFused) return 'fuse-global';
    const key = BudgetBook.edgeKey(from, to);
    if (this.fusedEdges.has(key)) return 'fuse-edge';

    // D2 全局账先算：超全局预算 → 全局熔断（本次消费不入账）
    if (this.globalRemaining !== undefined && tokens > this.globalRemaining) {
      this.globalFused = true;
      return 'fuse-global';
    }

    // D1 边账：仅对已登记预算的边
    const edgeRem = this.edgeRemaining.get(key);
    if (edgeRem !== undefined && tokens > edgeRem) {
      this.fusedEdges.add(key);
      return 'fuse-edge';
    }

    if (edgeRem !== undefined) this.edgeRemaining.set(key, edgeRem - tokens);
    if (this.globalRemaining !== undefined) this.globalRemaining -= tokens;
    return 'ok';
  }

  /** 复制账本并把边预算表替换为新边集（保留未变边的剩余、全局账与熔断标记）。 */
  withEdgeBudgets(edgeBudgets: Record<string, number>): BudgetBook {
    const next = new BudgetBook(
      this.globalRemaining !== undefined ? { globalBudget: this.globalRemaining } : {},
    );
    for (const [key, budget] of Object.entries(edgeBudgets)) {
      const prior = this.edgeRemaining.get(key);
      next.edgeRemaining.set(key, prior ?? budget);
    }
    for (const key of this.fusedEdges) next.fusedEdges.add(key);
    next.globalFused = this.globalFused;
    return next;
  }

  private assertPositive(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) {
      throw new RangeError(`tokens 必须为正数，收到 ${String(tokens)}`);
    }
  }

  /** 该边是否已熔断。 */
  isFusedEdge(from: string, to: string): boolean {
    return this.fusedEdges.has(BudgetBook.edgeKey(from, to));
  }

  /** 是否已全局熔断（D2）。 */
  isGlobalFused(): boolean {
    return this.globalFused;
  }

  /** 边剩余预算；未登记预算的边返回 undefined。 */
  remainingEdge(from: string, to: string): number | undefined {
    return this.edgeRemaining.get(BudgetBook.edgeKey(from, to));
  }

  /** 全局剩余预算；未设全局预算返回 undefined。 */
  remainingGlobal(): number | undefined {
    return this.globalRemaining;
  }

  /** 人工恢复某条熔断边；未熔断返回 false。注意：只解除熔断标记，不回补预算。 */
  resumeEdge(from: string, to: string): boolean {
    return this.fusedEdges.delete(BudgetBook.edgeKey(from, to));
  }

  /** 人工恢复全局熔断（D2：唯一恢复途径）。不回补预算。 */
  resumeGlobal(): void {
    this.globalFused = false;
  }
}
