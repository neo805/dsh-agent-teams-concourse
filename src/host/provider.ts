/**
 * host/provider — concourse 自有 subagent provider（路线 A）。
 *
 * 决议 D-P3：组织层不走 one-shot `ctx.subagents.start()`，逐顶点只经
 * `startContinuable` 拉起。本 provider 因此：
 *   · capabilities 声明 agentOptions/toolFilter/persona/depthLimit
 *     （continuable 路径由 continuation manager 读取 composition，声明保真）；
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

/** concourse provider 对象形态（镜像 dsh-subagent SubagentProvider 子集）。 */
export interface ConcourseProvider {
  readonly name: string;
  readonly capabilities: {
    readonly agentOptions: boolean;
    readonly outputSchema: boolean;
    readonly depthLimit: boolean;
    readonly toolFilter: boolean;
    readonly persona: boolean;
  };
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
      outputSchema: false,
      depthLimit: true,
      toolFilter: true,
      persona: true,
    },
    // spawn 语义：子代理不继承父已完成轮次前缀
    inheritsParentContext: false,
    start(_request: unknown): Promise<never> {
      return Promise.reject(
        new ProviderError(
          'CONTINUABLE_ONLY',
          'concourse 路线 A 只支持 continuable 子代理（startContinuable）；one-shot start 不可用。',
        ),
      );
    },
    prepareContinuable(_request: ContinuableCreateRequestLike): Promise<ContinuableCreateSpecLike> {
      // MVP spawn：每次返回独立的空 spec（无 seed = 全新子代理），零共享可变状态。
      return Promise.resolve({});
    },
  };
}
