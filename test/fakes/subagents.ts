/**
 * test/fakes/subagents — FakeSubagents：宿主 ctx.subagents 的可编程伪实现。
 *
 * 用途：host 层 L2 契约测试。记录 registerProvider / startContinuable /
 * sendMessage / interrupt 全部调用；可编程子代理行为（成功按序分配确定性
 * childId，或抛出指定的 startError / sendError / interruptError）。
 *
 * 形态镜像宿主 dsh-subagent 公共门面（结构性子集，非官方类型）：
 *   registerProvider(provider) → dispose
 *   startContinuable(spec)     → { childId }
 *   sendMessage(sender, targetId, content, options) → messageId（fake 固定 'msg-N'）
 *   interrupt(targetId, authority) → void（同步，与宿主一致）
 */

/** startContinuable 的最小请求形态（仅 fake 记录用）。 */
export interface FakeContinuableRequest {
  prompt: readonly unknown[];
  parent: unknown;
  agentOptions?: { model?: string; reasoningEffort?: string };
  toolFilter?: { allow?: readonly string[]; deny?: readonly string[] };
  maxDepth?: number;
}

export interface FakeContinuableSpec {
  provider: string;
  label: string;
  request: FakeContinuableRequest;
  signal: AbortSignal;
}

export interface FakeStartCall {
  spec: FakeContinuableSpec;
}

export interface FakeSendCall {
  sender: unknown;
  targetId: string;
  content: readonly unknown[];
  options: { signal: AbortSignal };
}

export interface FakeInterruptCall {
  targetId: string;
  authority: unknown;
}

export class FakeSubagents {
  /** registerProvider 收到的 provider 对象（按调用序）。 */
  readonly registerCalls: unknown[] = [];
  /** startContinuable 收到的 spec（按调用序）。 */
  readonly startCalls: FakeStartCall[] = [];
  /** sendMessage 收到的调用（按调用序）。 */
  readonly sendCalls: FakeSendCall[] = [];
  /** interrupt 收到的调用（按调用序）。 */
  readonly interruptCalls: FakeInterruptCall[] = [];

  /** 设置后 startContinuable 抛出该错误（保持同一引用，便于 toBe 断言）。 */
  startError?: Error;
  /** 设置后 sendMessage 抛出该错误。 */
  sendError?: Error;
  /** 设置后 interrupt 抛出该错误（同步，与宿主一致）。 */
  interruptError?: Error;

  private childSeq = 0;
  private msgSeq = 0;

  /** 宿主 ctxLike 形态：`{ subagents: 本实例 }`。 */
  get ctxLike(): { subagents: FakeSubagents } {
    return { subagents: this };
  }

  registerProvider(provider: unknown): () => void {
    this.registerCalls.push(provider);
    return () => {
      /* dispose no-op：fake 不维护注册表生命周期 */
    };
  }

  async startContinuable(spec: FakeContinuableSpec): Promise<{ childId: string }> {
    this.startCalls.push({ spec });
    if (this.startError !== undefined) throw this.startError;
    this.childSeq += 1;
    return { childId: `child-${this.childSeq}` };
  }

  async sendMessage(
    sender: unknown,
    targetId: string,
    content: readonly unknown[],
    options: { signal: AbortSignal },
  ): Promise<string> {
    this.sendCalls.push({ sender, targetId, content, options });
    if (this.sendError !== undefined) throw this.sendError;
    this.msgSeq += 1;
    return `msg-${this.msgSeq}`;
  }

  interrupt(targetId: string, authority: unknown): void {
    this.interruptCalls.push({ targetId, authority });
    if (this.interruptError !== undefined) throw this.interruptError;
  }
}
