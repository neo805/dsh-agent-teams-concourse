/**
 * host/contracts — host 层对 service 层暴露的共享契约（P3，决议 D-P3 的一部分）。
 *
 * 本文件只含类型与常量，零实现、零宿主依赖（保持 host→kernel 单向）。
 * 实现在 substrate.ts / catalog.ts / provider.ts；service 层只准依赖本文件的类型。
 */

/** 单个顶点的拉起规格（路线 A：经 ctx.subagents.startActivation）。 */
export interface VertexStart {
  /** concourse 内的顶点 id（账本/边引用用）。 */
  readonly vertexId: string;
  /** 子代理展示 label。 */
  readonly label: string;
  /** 首条任务提示词（纯文本）。 */
  readonly prompt: string;
  /** 逐顶点模型定档；省略 = 继承父代理。 */
  readonly model?: string;
  /** 逐顶点推理档位；省略 = 继承父代理。 */
  readonly reasoningEffort?: string;
  /** 工具面收口（第①层）：deny 含官方 send_message 等。 */
  readonly toolFilter?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
  /** 绝对递归深度上限（per-vertex 覆盖）。 */
  readonly maxDepth?: number;
}

/** 成功拉起的顶点句柄。 */
export interface VertexHandle {
  readonly vertexId: string;
  /** 宿主分配的子代理 session id。 */
  readonly childId: string;
}

/** 拉起失败 typed error：code 供台账与 UI 分类。 */
export type SubstrateErrorCode =
  | 'DEGRADED' // 降级模式：ctx.subagents 缺席
  | 'START_FAILED' // startActivation 抛错（含模型 fail-loud）
  | 'SEND_FAILED'
  | 'TARGET_UNAVAILABLE'
  | 'INTERRUPT_FAILED';

/** 一次已通过准入、要投递给真实 Agent 的消息。 */
export interface DeliveryRequest {
  readonly concourseId: string;
  readonly admissionId: string;
  readonly target: VertexHandle;
  /** 真实发送方的 durable session id（来自 exec.agent）。 */
  readonly senderId: string;
  readonly content: string;
  /** false = 只入收件箱，不唤醒目标 Agent。 */
  readonly wakeup: boolean;
  readonly signal?: AbortSignal;
}

/** 基座能力模式：full = ctx.subagents 可用；degraded = 缺席（不崩溃，NFR）。 */
export type SubstrateMode = 'full' | 'degraded';

/**
 * 官方基座薄适配（R-1 收口点）：全仓库对 ctx.subagents / ctx.llm 的引用
 * 只允许出现在 host/ 层；service 经本接口间接使用。
 * parent 为宿主 Agent 对象，对 service 不透明（由 tools 层从 exec.agent 传入）。
 */
export interface Substrate {
  readonly mode: SubstrateMode;
  /** 拉起一个顶点；degraded 下 throw typed error（code DEGRADED）。 */
  startVertex(spec: VertexStart, parent: unknown, signal?: AbortSignal): Promise<VertexHandle>;
  /** 把已准入消息投递给真实 live Agent；wakeup=false 时不触发新一轮推理。 */
  deliver(request: DeliveryRequest): void;
  /** 请求中断顶点（尽力而为，不保证静默）。 */
  interrupt(handle: VertexHandle): Promise<void>;
}

/** catalog 的模型信息条目（FR-4.4 白名单校验的数据源）。 */
export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
  /** 该模型官方目录支持的 reasoningEffort 档位；空数组 = 未知/不支持。 */
  readonly efforts: readonly string[];
}

/** provider/model/effort 枚举 + fail-loud 校验（FR-4.4）。 */
export interface Catalog {
  /** 枚举当前可用的模型清单（带缓存，能力探测缺席时返回空表）。 */
  list(): Promise<readonly ModelInfo[]>;
  /**
   * 校验 model（+可选 effort）在白名单内；不在则 throw typed error，
   * message 附完整可选值列表（fail-loud， FR-4.4）。
   */
  assertSupported(model: string, effort?: string): Promise<void>;
}

/** concourse 自有 provider 名（路线 A 注册用，P2 探针同名族）。 */
export const CONCOURSE_PROVIDER_NAME = 'concourse';
