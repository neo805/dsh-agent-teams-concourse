/**
 * host/catalog — provider/model/effort 枚举 + fail-loud 白名单校验（FR-4.4）。
 *
 * 数据源是宿主 ctx.llm 的只读目录方法（结构性子集，见 LlmCatalogLike）：
 *   listProviders() → listModels(provider) → resolveModelInfo(provider, model)
 * 降级口径（NFR：能力探测缺席不崩溃）：
 *   · deps.llm 缺席 / listProviders 缺席 → 空表；
 *   · listModels 缺席 → 空表；单 provider 抛错 → 跳过该 provider；
 *   · resolveModelInfo 缺席/抛错 → 该模型 efforts 记空数组（未知/不支持）。
 * list() 带缓存：首次调用固化结果，之后不再触发宿主探测。
 */

import type { Catalog, ModelInfo } from './contracts.js';

/** catalog fail-loud typed error code。 */
export type CatalogErrorCode = 'UNSUPPORTED_MODEL' | 'UNSUPPORTED_EFFORT';

/** catalog typed error：code 供 service 层分类，message 必附完整可选值列表。 */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

/** 宿主 ctx.llm 能力探测面的结构性子集（全部可选，缺席即降级）。 */
export interface LlmCatalogLike {
  listProviders?(): { id: string }[];
  listModels?(provider: string): Promise<readonly { id: string }[]>;
  resolveModelInfo?(
    provider: string,
    model: string,
  ): Promise<{ reasoning?: { efforts?: readonly { id: string }[] } }>;
}

export interface CatalogDeps {
  llm?: LlmCatalogLike;
}

/** 把可选值列表格式化为 message 片段。 */
function formatOptions(entries: readonly ModelInfo[]): string {
  if (entries.length === 0) return '（空：宿主能力探测缺席或无可用模型）';
  return entries.map((e) => `${e.provider}/${e.model}`).join(', ');
}

export function createCatalog(deps: CatalogDeps): Catalog {
  let cache: Promise<readonly ModelInfo[]> | undefined;

  /** 枚举整表；任何单点失败局部降级，绝不向上抛。 */
  async function enumerate(): Promise<readonly ModelInfo[]> {
    const llm = deps.llm;
    if (llm === undefined || typeof llm.listProviders !== 'function') return [];
    let providers: { id: string }[];
    try {
      providers = llm.listProviders();
    } catch {
      return []; // listProviders 本身抛错：整表降级为空
    }
    if (typeof llm.listModels !== 'function') return [];
    const listModels = llm.listModels;
    const resolveModelInfo = llm.resolveModelInfo;
    const out: ModelInfo[] = [];
    for (const p of providers) {
      let models: readonly { id: string }[];
      try {
        models = await listModels.call(llm, p.id);
      } catch {
        continue; // 单 provider 探测失败：跳过，不拖垮整表
      }
      for (const m of models) {
        let efforts: readonly string[] = [];
        if (typeof resolveModelInfo === 'function') {
          try {
            const info = await resolveModelInfo.call(llm, p.id, m.id);
            efforts = info.reasoning?.efforts?.map((e) => e.id) ?? [];
          } catch {
            efforts = []; // effort 探测失败：记未知
          }
        }
        out.push({ provider: p.id, model: m.id, efforts });
      }
    }
    return out;
  }

  function list(): Promise<readonly ModelInfo[]> {
    cache ??= enumerate();
    return cache;
  }

  /** model 匹配：接受 bare model 或 'provider/model' 两种写法。 */
  function matches(entry: ModelInfo, model: string): boolean {
    return entry.model === model || `${entry.provider}/${entry.model}` === model;
  }

  async function assertSupported(model: string, effort?: string): Promise<void> {
    const entries = await list();
    const hit = entries.find((e) => matches(e, model));
    if (hit === undefined) {
      throw new CatalogError(
        'UNSUPPORTED_MODEL',
        `模型 "${model}" 不在可用白名单内。可选值：${formatOptions(entries)}`,
      );
    }
    if (effort !== undefined && !hit.efforts.includes(effort)) {
      const known = hit.efforts.length > 0 ? hit.efforts.join(', ') : '（该模型未声明可用档位）';
      throw new CatalogError(
        'UNSUPPORTED_EFFORT',
        `effort "${effort}" 不被模型 ${hit.provider}/${hit.model} 支持。该模型已知档位：${known}`,
      );
    }
  }

  return { list, assertSupported };
}
