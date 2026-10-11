/**
 * test/service/helpers — service 层测试的公共测试件。
 *
 * StubSubstrate：实现 host/contracts.ts 的 Substrate 接口的最小内存 stub
 *（簇 A 的 host/substrate.ts 并行开发中，测试不依赖它）。
 * 支持：记录启动顺序、按顶点注入失败、记录 interrupt 回滚。
 */
import type {
  Substrate,
  SubstrateMode,
  VertexHandle,
  VertexStart,
} from '../../src/host/contracts.js';

/** 带 code 的 typed error（模拟 host 层 SubstrateErrorCode）。 */
export class StubSubstrateError extends Error {
  constructor(
    readonly code: 'DEGRADED' | 'START_FAILED' | 'SEND_FAILED' | 'INTERRUPT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'StubSubstrateError';
  }
}

export class StubSubstrate implements Substrate {
  readonly mode: SubstrateMode = 'full';
  /** 已收到的启动规格（按调用顺序）。 */
  readonly started: VertexStart[] = [];
  /** 已请求中断的顶点 id（按调用顺序）。 */
  readonly interrupted: string[] = [];
  /** 注入：这些顶点 id 启动时抛 START_FAILED。 */
  readonly failOn = new Set<string>();

  startVertex(spec: VertexStart, _parent: unknown): Promise<VertexHandle> {
    if (this.failOn.has(spec.vertexId)) {
      return Promise.reject(new StubSubstrateError('START_FAILED', `stub 启动失败：${spec.vertexId}`));
    }
    this.started.push(spec);
    return Promise.resolve({ vertexId: spec.vertexId, childId: `child-${spec.vertexId}` });
  }

  sendText(_handle: VertexHandle, _text: string): Promise<void> {
    return Promise.resolve();
  }

  interrupt(handle: VertexHandle): Promise<void> {
    this.interrupted.push(handle.vertexId);
    return Promise.resolve();
  }
}

/** 确定性假时钟：每次调用 +1000ms（从 0 开始）。 */
export function fakeClock(): () => number {
  let t = 0;
  return () => {
    t += 1000;
    return t;
  };
}

/** 可控假时钟：手动推进，供速率窗口等场景。 */
export function manualClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}
