/**
 * test/fakes/subagents — FakeSubagents：宿主 ctx.subagents 的可编程伪实现。
 *
 * 镜像 DSH 0.2.1-rc.2 的 dsh-subagent 公共门面（结构性子集，非官方类型）：
 *   registerProvider(provider) → dispose
 *   startActivation(spec)      → SubagentActivation{ childId, dispose }
 *   sendMessage(sender, targetId, content, options) → messageId（fake 固定 'msg-N'）
 *   interrupt(targetId, authority) → void（同步，与宿主一致）
 * 另配 FakeAgents：ctx.agents.get(id) → 带 scoped tools.restrict 的伪 Agent，
 * 用于逐顶点工具面收口断言（0.2.1 起 toolFilter 经 restrict 应用）。
 */

/** startActivation 的最小请求形态（仅 fake 记录用）。 */
export interface FakeActivationRequest {
  prompt: readonly unknown[];
  parent: unknown;
  agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
  maxDepth?: number;
}

export interface FakeActivationSpec {
  provider: string;
  label: string;
  request: FakeActivationRequest;
  signal: AbortSignal;
  delivery: 'parent' | 'caller';
}

export interface FakeStartCall {
  spec: FakeActivationSpec;
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

export interface FakeDisposeCall {
  childId: string;
}

/** 伪激活句柄：dispose 记录调用顺序。 */
export class FakeActivation {
  constructor(
    readonly childId: string,
    private readonly log: FakeDisposeCall[],
    /** 延迟读取故障：允许测试在失败后清除错误并验证同一句柄可重试。 */
    private readonly failure?: () => Error | undefined,
  ) {}
  async dispose(): Promise<void> {
    this.log.push({ childId: this.childId });
    const err = this.failure?.();
    if (err !== undefined) throw err;
  }
}

/** 伪 Agent：scoped tools.restrict + inbox send（可验证 wakeup=false）。 */
export class FakeAgent {
  readonly restrictCalls: unknown[] = [];
  readonly sendCalls: { message: unknown; target: string; wakeup: boolean }[] = [];
  sendError?: Error;

  constructor(readonly id: string = 'child-1') {}
  readonly ctx = {
    tools: {
      restrict: (filter: unknown): (() => void) => {
        this.restrictCalls.push(filter);
        return () => undefined;
      },
    },
  };

  send(message: unknown, target: 'next-turn' | 'next-step', wakeup: boolean): void {
    if (this.sendError !== undefined) throw this.sendError;
    this.sendCalls.push({ message, target, wakeup });
  }
}

/** 伪 ctx.agents：按 childId 分配 FakeAgent（未知 id 返回 undefined）。 */
export class FakeAgents {
  readonly agents = new Map<string, FakeAgent>();
  get(id: string): FakeAgent | undefined {
    return this.agents.get(id);
  }
}

export class FakeSubagents {
  /** registerProvider 收到的 provider 对象（按调用序）。 */
  readonly registerCalls: unknown[] = [];
  /** startActivation 收到的 spec（按调用序）。 */
  readonly startCalls: FakeStartCall[] = [];
  /** sendMessage 收到的调用（按调用序）。 */
  readonly sendCalls: FakeSendCall[] = [];
  /** interrupt 收到的调用（按调用序）。 */
  readonly interruptCalls: FakeInterruptCall[] = [];
  /** activation.dispose 调用（按调用序）。 */
  readonly disposeCalls: FakeDisposeCall[] = [];

  /** 设置后 startActivation 抛出该错误（保持同一引用，便于 toBe 断言）。 */
  startError?: Error;
  /** 设置后 sendMessage 抛出该错误。 */
  sendError?: Error;
  /** 设置后 interrupt 抛出该错误（同步，与宿主一致）。 */
  interruptError?: Error;
  /** 设置后 activation.dispose 抛出该错误。 */
  disposeError?: Error;

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

  async startActivation(spec: FakeActivationSpec): Promise<FakeActivation> {
    this.startCalls.push({ spec });
    if (this.startError !== undefined) throw this.startError;
    this.childSeq += 1;
    return new FakeActivation(`child-${this.childSeq}`, this.disposeCalls, () => this.disposeError);
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
