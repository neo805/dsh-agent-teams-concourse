/**
 * host/provider — concourse 自有 subagent provider（路线 A）。
 *
 * 决议 D-P3：组织层不走 one-shot `ctx.subagents.start()`，逐顶点只经
 * `startActivation`（0.2.1-rc.2 起；0.2.0 为 startContinuable）拉起。
 * 本 provider 因此：
 *   · capabilities 按 0.2.1-rc.2 契约声明 { agentOptions, agentPreset,
 *     outputSchema, depthLimit }（旧的 toolFilter/persona 位已从公开契约移除，
 *     工具面收口改由 substrate 在挂载后调 ctx.tools.restrict 完成）；
 *   · start（one-shot）直接抛 ProviderError(code='CONTINUABLE_ONLY')；
 *   · prepareContinuable 只贡献 spawn seed —— MVP 仅 spawn 语义（全新子代理，
 *     无父历史 seed）；fork（带父 seed）推迟到 P5。
 *
 * provider 对象形态镜像 dsh-subagent SubagentProvider（结构性子集），
 * 由插件入口经 ctx.subagents.registerProvider 注册（本层是库，不含入口）。
 */

import { CONCOURSE_PROVIDER_NAME } from './contracts.js';

/** provider typed error code。 */
export type ProviderErrorCode = 'CONTINUABLE_ONLY';

/** provider typed error：one-shot 路径在路线 A 下永远 fail-loud。 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

/** prepareContinuable 请求的形态（镜像 dsh-subagent ContinuableCreateRequest 子集）。 */
export interface ContinuableCreateRequestLike {
  sessionId: string;
  parent: unknown;
  signal: AbortSignal;
}

/** prepareContinuable 返回值（镜像 ContinuableCreateSpec）：纯数据 seed，无生命周期句柄。 */
export interface ContinuableCreateSpecLike {
  /** 父历史 seed；spawn 语义下缺席（全新子代理）。 */
  seed?: readonly unknown[];
}

/** 0.2.1-rc.2 的 SubagentCapabilities 字段集（启动期能力声明）。 */
export interface ConcourseProviderCapabilities {
  readonly agentOptions: boolean;
  readonly agentPreset: boolean;
  readonly outputSchema: boolean;
  readonly depthLimit: boolean;
}

/** concourse provider 对象形态（镜像 dsh-subagent SubagentProvider 子集）。 */
export interface ConcourseProvider {
  readonly name: string;
  readonly capabilities: ConcourseProviderCapabilities;
  readonly inheritsParentContext: boolean;
  start(request: unknown): Promise<never>;
  prepareContinuable(request: ContinuableCreateRequestLike): Promise<ContinuableCreateSpecLike>;
}

export interface ConcourseProviderDeps {
  /** 预留：P5 fork 语义需要读父历史时注入；MVP 不使用。 */
}

export function createConcourseProvider(_deps: ConcourseProviderDeps): ConcourseProvider {
  return {
    name: CONCOURSE_PROVIDER_NAME,
    capabilities: {
      agentOptions: true,
      agentPreset: false,
      outputSchema: false,
      depthLimit: true,
    },
    // spawn 语义：子代理不继承父已完成轮次前缀
    inheritsParentContext: false,
    start(_request: unknown): Promise<never> {
      return Promise.reject(
        new ProviderError(
          'CONTINUABLE_ONLY',
          'concourse 路线 A 只支持 continuable 子代理（startActivation）；one-shot start 不可用。',
        ),
      );
    },
    prepareContinuable(_request: ContinuableCreateRequestLike): Promise<ContinuableCreateSpecLike> {
      // MVP spawn：每次返回独立的空 spec（无 seed = 全新子代理），零共享可变状态。
      return Promise.resolve({});
    },
  };
}
