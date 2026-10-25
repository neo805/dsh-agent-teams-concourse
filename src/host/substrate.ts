/**
 * host/substrate — 官方基座薄适配（R-1 收口点）：Substrate 契约实现。
 *
 * 路线 A：startVertex 把 VertexStart 装配成 ctx.subagents.startActivation
 * 调用（DSH 0.2.1-rc.2 起替代 0.2.0 的 startContinuable），provider 固定为
 * CONCOURSE_PROVIDER_NAME，model/reasoningEffort 进 agentOptions，maxDepth 原样
 * 透传（缺席则不出现该键，遵守 exactOptionalPropertyTypes）。
 *
 * 0.2.1-rc.2 API 差异（经 dsh-subagent 0.2.1-rc.2 类型与实现核验）：
 *   · startActivation(spec) → SubagentActivation{ childId, result, dispose }
 *     取代 startContinuable(spec) → { childId }；activation 是本层持有的
 *     生命周期句柄（interrupt 时经 dispose 停止并释放）。
 *   · interrupt(childId, authority)：authority 从裸 Agent 改为结构化
 *     `{ kind:'ancestor', agent }`（另一形态 `{ kind:'user', parentSessionId }`）。
 *   · toolFilter 不再是 start 期公开参数（只剩冷恢复 descriptor 重放）；
 *     本层用「拉起后立即对子 Agent 作用域调 ctx.tools.restrict(restriction)」
 *     还原逐顶点工具面收口，失败即 fail-loud（V-2 不静默降级）。
 *   · delivery='parent'：子代理终态结果投递给父模型（与官方 subagent 工具一致）。
 *
 * 宿主 API 假设：
 *   · deliver  → ctx.agents.get(childId).send(message, 'next-turn', wakeup)
 *     消息来源使用宿主 durable `agent-message` 归因（senderSessionId），并附带
 *     concourse 准入票据；wakeup=false 实现“投递但不唤醒”。目标 Agent 不在线时
 *     fail-loud TARGET_UNAVAILABLE，不伪造成功。
 *
 * degraded 模式（deps.subagents 缺席）：构造不崩溃，三方法全部 throw
 * SubstrateError(code='DEGRADED')（NFR 降级不崩溃）。
 */

import { createUserMessage, type MessageSource } from '@deepseek-ai/dsh-llm';
import {
  CONCOURSE_PROVIDER_NAME,
  type DeliveryRequest,
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

/** startActivation 返回的激活句柄形态（镜像宿主 SubagentActivation 子集）。 */
export interface ActivationLike {
  childId: string;
  /** 停止并释放该激活（含其拥有的后代）。 */
  dispose(): Promise<void>;
}

/** startActivation 的装配形态（镜像宿主 SubagentActivationSpec 子集）。 */
export interface ActivationStartSpecLike {
  provider: string;
  label: string;
  request: {
    prompt: readonly { type: 'text'; text: string }[];
    parent: unknown;
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    maxDepth?: number;
  };
  signal: AbortSignal;
  /** parent：终态结果投递给父模型（与官方 subagent 工具一致）。 */
  delivery: 'parent' | 'caller';
}

/** 宿主 live Agent 的最小子集：工具面收口 + 无唤醒投递。 */
export interface AgentRuntimeLike {
  readonly id: string;
  readonly ctx?: { tools?: { restrict?: (filter: unknown) => unknown } };
  send?(message: unknown, target: 'next-turn' | 'next-step', wakeup: boolean): void;
}

/** 宿主 ctx.agents 的结构性子集：按 id 取 live Agent。 */
export interface AgentsLike {
  get(id: string): AgentRuntimeLike | undefined;
}

/** 宿主 ctx.subagents 的结构性子集（本层唯一允许触碰的宿主面）。 */
export interface SubagentsLike {
  startActivation(spec: ActivationStartSpecLike): Promise<ActivationLike>;
  sendMessage(
    sender: unknown,
    targetId: string,
    content: readonly { type: 'text'; text: string }[],
    options: { signal: AbortSignal },
  ): Promise<unknown>;
  /** 0.2.1：authority 为结构化对象 `{ kind:'ancestor', agent }`。 */
  interrupt(targetId: string, authority: unknown): void;
}

export interface SubstrateDeps {
  subagents?: SubagentsLike;
  agents?: AgentsLike;
}

/** 永不 abort 的信号：基座自身不产生取消语义（取消由 interrupt 承担）。 */
const NEVER_SIGNAL = new AbortController().signal;

/** 提取宿主错误的原始 message（非 Error 值 String 化）。 */
function hostMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createSubstrate(deps: SubstrateDeps): Substrate {
  const subagents = deps.subagents;
  const agents = deps.agents;
  /**
   * childId → startVertex 时记录的 parent（interrupt 的宿主授权需要 exact live Agent）。
   * vertexId 只在单个 concourse 内唯一；跨团队安全必须使用宿主分配的全局 childId。
   */
  const parents = new Map<string, unknown>();
  /** childId → activation 句柄（interrupt 时停止并释放）。 */
  const activations = new Map<string, ActivationLike>();
  /**
   * 已成功释放的 childId 轻量 tombstone：重复 interrupt 保持 no-op。
   * 有界存储，避免长驻进程因历史顶点无限增长；授权 parent 不进入该集合。
   */
  const released = new Set<string>();
  const RELEASED_LIMIT = 1024;
  function markReleased(childId: string): void {
    released.add(childId);
    if (released.size > RELEASED_LIMIT) {
      const oldest = released.values().next().value;
      if (oldest !== undefined) released.delete(oldest);
    }
  }

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
      deliver: (request: DeliveryRequest): void => {
        throw new SubstrateError(
          'DEGRADED',
          request.target.vertexId,
          '基座降级：宿主 ctx.subagents 缺席，deliver 不可用（degraded 模式，不崩溃）。',
        );
      },
      interrupt: <T>(handle: VertexHandle): Promise<T> => degraded(handle.vertexId, 'interrupt'),
    };
  }

  // 早期 return 后缩窄为在场（hoisted function 不保留闭包缩窄，显式落常量）
  const host: SubagentsLike = subagents;

  /**
   * 逐顶点工具面收口（V-2）：0.2.1 起 start 期不接受 toolFilter，改为对已发布
   * 子 Agent 的 scoped ctx 调 tools.restrict。无法应用时 fail-loud（不静默降级）。
   */
  function applyToolFilter(childId: string, spec: VertexStart): void {
    if (spec.toolFilter === undefined) return;
    const agent = agents?.get(childId) as
      | { ctx?: { tools?: { restrict?: (f: unknown) => unknown } } }
      | undefined;
    const restrict = agent?.ctx?.tools?.restrict;
    if (typeof restrict !== 'function' || agent?.ctx?.tools === undefined) {
      throw new Error(
        '宿主 ctx.agents 注册表不可达或子 Agent 缺少 tools.restrict，toolFilter 无法应用（fail-loud）',
      );
    }
    const filter = {
      ...(spec.toolFilter.allow !== undefined ? { allow: [...spec.toolFilter.allow] } : {}),
      ...(spec.toolFilter.deny !== undefined ? { deny: [...spec.toolFilter.deny] } : {}),
    };
    restrict.call(agent.ctx.tools, filter);
  }

  async function startVertex(spec: VertexStart, parent: unknown, signal?: AbortSignal): Promise<VertexHandle> {
    // 逐字段条件装配：可选项缺席时对应键不出现
    let agentOptions: { provider?: string; model?: string; reasoningEffort?: string } | undefined;
    if (
      spec.provider !== undefined ||
      spec.model !== undefined ||
      spec.reasoningEffort !== undefined
    ) {
      agentOptions = {
        ...(spec.provider !== undefined ? { provider: spec.provider } : {}),
        ...(spec.model !== undefined ? { model: spec.model } : {}),
        ...(spec.reasoningEffort !== undefined ? { reasoningEffort: spec.reasoningEffort } : {}),
      };
    }
    const call: ActivationStartSpecLike = {
      provider: CONCOURSE_PROVIDER_NAME,
      label: spec.label,
      request: {
        prompt: [{ type: 'text', text: spec.prompt }],
        parent,
        ...(agentOptions !== undefined ? { agentOptions } : {}),
        ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
      },
      signal: signal ?? NEVER_SIGNAL,
      delivery: 'parent',
    };
    let activation: ActivationLike;
    try {
      activation = await host.startActivation(call);
    } catch (e) {
      throw new SubstrateError(
        'START_FAILED',
        spec.vertexId,
        `顶点 "${spec.vertexId}" 拉起失败：${hostMessage(e)}`,
        e,
      );
    }
    // 工具面收口失败：释放刚拉起的激活后 fail-loud（不留下无约束顶点）
    try {
      applyToolFilter(activation.childId, spec);
    } catch (e) {
      await Promise.resolve(activation.dispose()).catch(() => undefined);
      throw new SubstrateError(
        'START_FAILED',
        spec.vertexId,
        `顶点 "${spec.vertexId}" 工具面收口失败：${hostMessage(e)}`,
        e,
      );
    }
    parents.set(activation.childId, parent);
    activations.set(activation.childId, activation);
    return { vertexId: spec.vertexId, childId: activation.childId };
  }

  /** 取回 startVertex 时记录的 parent；未知 childId fail-loud。 */
  function requireParent(code: SubstrateErrorCode, handle: VertexHandle, op: string): unknown {
    const parent = parents.get(handle.childId);
    if (parent === undefined) {
      throw new SubstrateError(
        code,
        handle.vertexId,
        `顶点 "${handle.vertexId}"（child ${handle.childId}）非本基座拉起（无 parent 记录），${op} 拒绝执行。`,
      );
    }
    return parent;
  }

  /** 把一条已准入消息直接写入目标 live Agent 的 inbox，并显式控制是否唤醒。 */
  function deliver(request: DeliveryRequest): void {
    request.signal?.throwIfAborted();
    const target = agents?.get(request.target.childId);
    if (target === undefined || typeof target.send !== 'function') {
      throw new SubstrateError(
        'TARGET_UNAVAILABLE',
        request.target.vertexId,
        `顶点 "${request.target.vertexId}" 的 live Agent 不可达，消息未投递（需恢复或重新拉起）。`,
      );
    }
    // agent-message 是宿主的 durable 归因来源；concourse 扩展仅由本插件受理。
    const source = {
      kind: 'agent-message',
      form: 'relay',
      senderSessionId: request.senderId,
      concourse: { id: request.concourseId, admissionId: request.admissionId },
    } as unknown as MessageSource;
    const message = createUserMessage({
      content: [
        { type: 'text', text: `Agent ${request.senderId} sent a message: ` },
        { type: 'text', text: request.content },
      ],
      source,
    });
    try {
      target.send(message, 'next-turn', request.wakeup);
    } catch (e) {
      throw new SubstrateError(
        'SEND_FAILED',
        request.target.vertexId,
        `向顶点 "${request.target.vertexId}" 投递失败：${hostMessage(e)}`,
        e,
      );
    }
  }

  async function interrupt(handle: VertexHandle): Promise<void> {
    if (released.has(handle.childId)) return;
    let parent: unknown;
    try {
      parent = requireParent('INTERRUPT_FAILED', handle, 'interrupt');
    } catch (e) {
      return Promise.reject(e);
    }
    try {
      // 0.2.1：authority 结构化（ancestor = exact live parent Agent）
      host.interrupt(handle.childId, { kind: 'ancestor', agent: parent });
    } catch (e) {
      throw new SubstrateError(
        'INTERRUPT_FAILED',
        handle.vertexId,
        `中断顶点 "${handle.vertexId}" 失败：${hostMessage(e)}`,
        e,
      );
    }
    // 停止信号已发出；再经 activation.dispose 等待静默并释放资源（尽力而为）。
    const activation = activations.get(handle.childId);
    if (activation !== undefined) {
      try {
        await activation.dispose();
      } catch (e) {
        // 释放失败不得提前遗忘 activation/parent：保留句柄，允许修复环境后重试。
        throw new SubstrateError(
          'INTERRUPT_FAILED',
          handle.vertexId,
          `顶点 "${handle.vertexId}"（child ${handle.childId}）释放失败：${hostMessage(e)}`,
          e,
        );
      }
      activations.delete(handle.childId);
    }
    // 成功释放后不再持有 parent Agent 强引用；幂等性由轻量 tombstone 承担。
    parents.delete(handle.childId);
    markReleased(handle.childId);
  }

  return { mode: 'full', startVertex, deliver, interrupt };
}
