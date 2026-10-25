/**
 * kernel/profile/suggest — 由难度画像生成派发建议（FR-4.2/4.3/4.4）。
 *
 * 纯函数、确定性：同画像 + 同 catalog → 同 Suggestion。
 * validateChoice 为 fail-loud 校验（FR-4.4）：绝不静默降级。
 */
import type { DifficultyProfile } from '../topology/schema.js';
import { EFFORT_ORDER, effortIndex, normalizeEffort } from './effort.js';

export interface ModelInfo {
  provider: string;
  model: string;
  efforts: string[];
  defaultEffort?: string;
  contextWindow?: number;
  tier?: 'cheap' | 'balanced' | 'premium';
}

export interface Suggestion {
  provider: string;
  model: string;
  reasoningEffort: string;
  tokenTier: 'cheap' | 'balanced' | 'premium';
  toolFilter?: { allow?: string[]; deny?: string[] };
  maxDepth: number;
  rationale: string[];
  signals: string[];
  confidence: number;
}

export interface ChoiceError {
  code: 'UNKNOWN_PROVIDER' | 'UNKNOWN_MODEL' | 'UNSUPPORTED_EFFORT';
  candidates: string[];
}

/** cognitive → 目标 effort。 */
function wantedEffort(cognitive: number): string {
  if (cognitive <= 2) return 'low';
  if (cognitive === 3) return 'default';
  return 'high';
}

/** 目标档不在 efforts 时取最近邻；等距取较低档（确定性）。 */
function nearestEffort(efforts: string[], wanted: string): string {
  if (efforts.length === 0) return wanted;
  const wi = effortIndex(wanted);
  let best: string | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of efforts) {
    const d = Math.abs(effortIndex(e) - wi);
    if (d < bestDist || (d === bestDist && best !== undefined && effortIndex(e) < effortIndex(best))) {
      best = e;
      bestDist = d;
    }
  }
  return best ?? wanted;
}

/** 由画像与模型目录生成建议。catalog 为空 → throw。 */
export function suggest(profile: DifficultyProfile, catalog: ModelInfo[]): Suggestion {
  if (catalog.length === 0) throw new Error('catalog 为空，无法建议');

  const signals = profile.signals ?? [];
  const rationale: string[] = [];

  // —— tier 决策 ——
  let tier: 'cheap' | 'balanced' | 'premium';
  let toolFilter: Suggestion['toolFilter'];
  if (profile.risk === 'security') {
    tier = 'premium';
    toolFilter = { deny: ['bash', 'write', 'edit'] };
    rationale.push(`risk=security → tier=premium，禁用 bash/write/edit；高风险：建议强制挂验证者`);
  } else if (profile.cognitive <= 2 && profile.risk === 'readonly') {
    tier = 'cheap';
    rationale.push(`cognitive=${profile.cognitive}≤2 且 risk=readonly → tier=cheap`);
  } else {
    tier = 'balanced';
    rationale.push(`risk=${profile.risk}, cognitive=${profile.cognitive} → tier=balanced（常规档位）`);
  }
  if (profile.breadth >= 4 && tier === 'cheap') {
    tier = 'balanced';
    rationale.push(`breadth=${profile.breadth}≥4 → tier 至少 balanced（广度抬档）`);
  } else if (profile.breadth >= 4) {
    rationale.push(`breadth=${profile.breadth}≥4 → 广度较大，确认 tier=${tier} 满足下限`);
  }

  // —— 候选过滤：上下文窗口 ——
  const fit = catalog.filter(
    (m) => m.contextWindow === undefined || !(profile.contextTokens > m.contextWindow * 0.5),
  );
  for (const m of catalog) {
    if (!fit.includes(m)) {
      rationale.push(`contextTokens=${profile.contextTokens} > ${m.model} contextWindow×0.5 → 排除该模型`);
    }
  }
  if (fit.length === 0) throw new Error('所有模型均因 contextTokens 超过 contextWindow×0.5 被排除，无法建议');

  // —— tier 内取候选；该 tier 无合格候选时回退到全体合格候选（确定性，注明） ——
  let pool = fit.filter((m) => (m.tier ?? 'balanced') === tier);
  if (pool.length === 0) {
    pool = fit;
    rationale.push(`tier=${tier} 在窗口约束下无候选 → 回退到全部合格候选`);
  }
  pool = [...pool].sort((a, b) => {
    const wa = a.contextWindow ?? Number.POSITIVE_INFINITY;
    const wb = b.contextWindow ?? Number.POSITIVE_INFINITY;
    if (wa !== wb) return wa - wb;
    return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
  });
  const chosen = pool[0];
  if (chosen === undefined) throw new Error('候选池为空，无法建议');
  rationale.push(`tier=${tier} 内按 (contextWindow 升序, model 字典序) 取第一 → ${chosen.provider}/${chosen.model}`);
  const actualTier = chosen.tier ?? 'balanced';
  if (actualTier !== tier) {
    rationale.push(`目标 tier=${tier} 无候选，实际选中 tier=${actualTier} → ${chosen.model}`);
  }

  // —— effort 决策 ——
  const wanted = wantedEffort(profile.cognitive);
  rationale.push(`cognitive=${profile.cognitive} → 目标推理档位 ${wanted}`);
  let reasoningEffort = wanted;
  if (!chosen.efforts.includes(wanted)) {
    reasoningEffort = nearestEffort(chosen.efforts, wanted);
    const normalized = normalizeEffort(reasoningEffort);
    const aliasNote =
      normalized !== reasoningEffort
        ? `（原生档位 ${reasoningEffort} 按 ${normalized} 参与比较）`
        : '';
    rationale.push(
      `effort 降级：${chosen.model} 不支持 ${wanted}，按 ${EFFORT_ORDER.join('<')} 取最近邻 ${reasoningEffort}${aliasNote}`,
    );
  }

  // —— maxDepth ——
  const maxDepth = profile.breadth >= 4 ? 2 : 1;
  rationale.push(`breadth=${profile.breadth} → maxDepth=${maxDepth}`);

  const confidence = Math.min(0.95, Math.round((0.5 + 0.1 * signals.length) * 100) / 100);

  return {
    provider: chosen.provider,
    model: chosen.model,
    reasoningEffort,
    tokenTier: actualTier,
    ...(toolFilter !== undefined ? { toolFilter } : {}),
    maxDepth,
    rationale,
    signals,
    confidence,
  };
}

/** fail-loud 校验用户显式选择；绝不静默降级。 */
export function validateChoice(
  catalog: ModelInfo[],
  sel: { provider: string; model: string; reasoningEffort: string },
): { ok: true } | { ok: false; error: ChoiceError } {
  const providers = catalog.filter((m) => m.provider === sel.provider);
  if (providers.length === 0) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_PROVIDER', candidates: [...new Set(catalog.map((m) => m.provider))] },
    };
  }
  const model = providers.find((m) => m.model === sel.model);
  if (model === undefined) {
    return { ok: false, error: { code: 'UNKNOWN_MODEL', candidates: providers.map((m) => m.model) } };
  }
  if (!model.efforts.includes(sel.reasoningEffort)) {
    return { ok: false, error: { code: 'UNSUPPORTED_EFFORT', candidates: [...model.efforts] } };
  }
  return { ok: true };
}
