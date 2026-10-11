/**
 * host/substrate — 官方基座薄适配（R-1 收口点）：Substrate 契约实现。
 *
 * 路线 A：startVertex 把 VertexStart 装配成 ctx.subagents.startContinuable
 * 调用，provider 固定为 CONCOURSE_PROVIDER_NAME，model/reasoningEffort 进
 * agentOptions，toolFilter/maxDepth 原样透传（缺席则不出现该键，
 * 遵守 exactOptionalPropertyTypes）。
 *
 * 宿主 API 假设（经运行时源码核验，见本文件尾部注记）：
 *   · sendText  → subagents.sendMessage(sender, targetId, content, { signal })
 *     sender 是 startVertex 时记录的 exact live parent Agent（宿主校验
 *     `ctx.agents.get(sender.id) === sender`），content 为 [{ type:'text', text }]。
 *   · interrupt → subagents.interrupt(childId, authority)（同步方法，
 *     authority 用同一 parent Agent）。
 * substrate 在 startVertex 成功时按 vertexId 记录 parent，供 send/interrupt 复用。
 *
 * degraded 模式（deps.subagents 缺席）：构造不崩溃，三方法全部 throw
 * SubstrateError(code='DEGRADED')（NFR 降级不崩溃）。
 */

import {
  CONCOURSE_PROVIDER_NAME,
  type Substrate,
  type SubstrateErrorCode,
  type VertexHandle,
  type VertexStart,
} from './contracts.js';

/** 基座 typed error：code 供台账与 UI 分类；vertexId 定位失败顶点；cause 保留宿主原始错误。 */
export class SubstrateError extends Error {
  readonly code: SubstrateErrorCode;
  readonly vertexId: string;
  constructor(code: SubstrateErrorCode, vertexId: string, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SubstrateError';
    this.code = code;
    this.vertexId = vertexId;
  }
}

/** startContinuable 的装配结果形态（镜像宿主 spec 子集）。 */
export interface ContinuableStartSpecLike {
  provider: string;
  label: string;
  request: {
    prompt: readonly { type: 'text'; text: string }[];
    parent: unknown;
    agentOptions?: { model?: string; reasoningEffort?: string };
    toolFilter?: { allow?: readonly string[]; deny?: readonly string[] };
    maxDepth?: number;
  };
  signal: AbortSignal;
}

/** 宿主 ctx.subagents 的结构性子集（本层唯一允许触碰的宿主面）。 */
export interface SubagentsLike {
  startContinuable(spec: ContinuableStartSpecLike): Promise<{ childId: string }>;
  sendMessage(
    sender: unknown,
    targetId: string,
    content: readonly { type: 'text'; text: string }[],
    options: { signal: AbortSignal },
  ): Promise<unknown>;
  interrupt(targetId: string, authority: unknown): void;
}

export interface SubstrateDeps {
  subagents?: SubagentsLike;
}

/** 永不 abort 的信号：基座自身不产生取消语义（取消由 interrupt 承担）。 */
const NEVER_SIGNAL = new AbortController().signal;

/** 提取宿主错误的原始 message（非 Error 值 String 化）。 */
function hostMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createSubstrate(deps: SubstrateDeps): Substrate {
  const subagents = deps.subagents;
  /** vertexId → startVertex 时记录的 parent（send/interrupt 的宿主授权需要 exact live Agent）。 */
  const parents = new Map<string, unknown>();

  if (subagents === undefined) {
    const degraded = <T>(vertexId: string, op: string): Promise<T> =>
      Promise.reject(
        new SubstrateError(
          'DEGRADED',
          vertexId,
          `基座降级：宿主 ctx.subagents 缺席，${op} 不可用（degraded 模式，不崩溃）。`,
        ),
      );
    return {
      mode: 'degraded',
      startVertex: <T>(spec: VertexStart, _parent: unknown): Promise<T> => degraded(spec.vertexId, 'startVertex'),
      sendText: <T>(handle: VertexHandle, _text: string): Promise<T> => degraded(handle.vertexId, 'sendText'),
      interrupt: <T>(handle: VertexHandle): Promise<T> => degraded(handle.vertexId, 'interrupt'),
    };
  }

  // 早期 return 后缩窄为在场（hoisted function 不保留闭包缩窄，显式落常量）
  const host: SubagentsLike = subagents;

  async function startVertex(spec: VertexStart, parent: unknown): Promise<VertexHandle> {
    // 逐字段条件装配：可选项缺席时对应键不出现
    let agentOptions: { model?: string; reasoningEffort?: string } | undefined;
    if (spec.model !== undefined || spec.reasoningEffort !== undefined) {
      agentOptions = {
        ...(spec.model !== undefined ? { model: spec.model } : {}),
        ...(spec.reasoningEffort !== undefined ? { reasoningEffort: spec.reasoningEffort } : {}),
      };
    }
    const call: ContinuableStartSpecLike = {
      provider: CONCOURSE_PROVIDER_NAME,
      label: spec.label,
      request: {
        prompt: [{ type: 'text', text: spec.prompt }],
        parent,
        ...(agentOptions !== undefined ? { agentOptions } : {}),
        ...(spec.toolFilter !== undefined ? { toolFilter: spec.toolFilter } : {}),
        ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
      },
      signal: NEVER_SIGNAL,
    };
    let childId: string;
    try {
      ({ childId } = await host.startContinuable(call));
    } catch (e) {
      throw new SubstrateError(
        'START_FAILED',
        spec.vertexId,
        `顶点 "${spec.vertexId}" 拉起失败：${hostMessage(e)}`,
        e,
      );
    }
    parents.set(spec.vertexId, parent);
    return { vertexId: spec.vertexId, childId };
  }

  /** 取回 startVertex 时记录的 parent；未知顶点 fail-loud。 */
  function requireParent(code: SubstrateErrorCode, handle: VertexHandle, op: string): unknown {
    const parent = parents.get(handle.vertexId);
    if (parent === undefined) {
      throw new SubstrateError(
        code,
        handle.vertexId,
        `顶点 "${handle.vertexId}" 非本基座拉起（无 parent 记录），${op} 拒绝执行。`,
      );
    }
    return parent;
  }

  async function sendText(handle: VertexHandle, text: string): Promise<void> {
    let parent: unknown;
    try {
      parent = requireParent('SEND_FAILED', handle, 'sendText');
    } catch (e) {
      return Promise.reject(e);
    }
    try {
      await host.sendMessage(parent, handle.childId, [{ type: 'text', text }], { signal: NEVER_SIGNAL });
    } catch (e) {
      throw new SubstrateError(
        'SEND_FAILED',
        handle.vertexId,
        `向顶点 "${handle.vertexId}" 投递失败：${hostMessage(e)}`,
        e,
      );
    }
  }

  function interrupt(handle: VertexHandle): Promise<void> {
    let parent: unknown;
    try {
      parent = requireParent('INTERRUPT_FAILED', handle, 'interrupt');
      host.interrupt(handle.childId, parent); // 宿主该方法为同步
    } catch (e) {
      if (e instanceof SubstrateError) return Promise.reject(e);
      return Promise.reject(
        new SubstrateError(
          'INTERRUPT_FAILED',
          handle.vertexId,
          `中断顶点 "${handle.vertexId}" 失败：${hostMessage(e)}`,
          e,
        ),
      );
    }
    return Promise.resolve();
  }

  return { mode: 'full', startVertex, sendText, interrupt };
}
