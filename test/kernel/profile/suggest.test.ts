/**
 * kernel/profile/suggest 测试（先写测试，TDD）。
 */
import { describe, expect, it } from 'vitest';
import { suggest, validateChoice, type ModelInfo } from '../../../src/kernel/profile/suggest.js';
import type { DifficultyProfile } from '../../../src/kernel/topology/schema.js';

/** 与 scripts/corpus-regression.mjs 内置的 mock catalog 保持一致。 */
const CATALOG: ModelInfo[] = [
  { provider: 'deepseek', model: 'deepseek-chat', efforts: ['low', 'default', 'high'], contextWindow: 128000, tier: 'cheap' },
  { provider: 'deepseek', model: 'deepseek-reasoner', efforts: ['low', 'default', 'high'], contextWindow: 128000, tier: 'balanced' },
  { provider: 'anthropic', model: 'claude-opus', efforts: ['low', 'default', 'high'], contextWindow: 200000, tier: 'premium' },
];

function baseProfile(patch: Partial<DifficultyProfile> = {}): DifficultyProfile {
  return {
    cognitive: 3,
    breadth: 2,
    contextTokens: 0,
    toolCalls: 0,
    determinism: 'mid',
    risk: 'reversible',
    parallelism: 'serial',
    ...patch,
  };
}

describe('suggest · effort 映射', () => {
  it.each([
    [1, 'low'],
    [2, 'low'],
    [3, 'default'],
    [4, 'high'],
    [5, 'high'],
  ] as const)('cognitive=%i → %s', (cognitive, effort) => {
    expect(suggest(baseProfile({ cognitive }), CATALOG).reasoningEffort).toBe(effort);
  });

  it('目标模型缺所需档 → 取最近邻并在 rationale 注明降级（low<default<high）', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'm', efforts: ['low'], contextWindow: 999999, tier: 'balanced' },
    ];
    const s = suggest(baseProfile({ cognitive: 5 }), catalog);
    expect(s.reasoningEffort).toBe('low');
    expect(s.rationale.some((r) => r.includes('降级'))).toBe(true);
  });

  it('等距时取较低档（确定性）', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'm', efforts: ['low', 'high'], contextWindow: 999999, tier: 'balanced' },
    ];
    const s = suggest(baseProfile({ cognitive: 3 }), catalog); // 想要 default，等距
    expect(s.reasoningEffort).toBe('low');
  });

  it('F-4 回归：off 显式位于 low 之下——想要 default 时 off 不得直接胜出', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'm', efforts: ['off', 'low', 'high'], contextWindow: 999999, tier: 'balanced' },
    ];
    const s = suggest(baseProfile({ cognitive: 3 }), catalog); // 想要 default：low/high 等距取低 → low，绝不选 off
    expect(s.reasoningEffort).toBe('low');
  });

  it('F-4 回归：仅有 off 时才允许退化到 off', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'm', efforts: ['off'], contextWindow: 999999, tier: 'balanced' },
    ];
    const s = suggest(baseProfile({ cognitive: 3 }), catalog);
    expect(s.reasoningEffort).toBe('off');
  });

  it('F1 回归（2026-10-18 真机）：原生档名 max 归一化为 high，不再按 default 位次零距离胜出', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'deepseek-flash', efforts: ['off', 'max'], contextWindow: 999999, tier: 'balanced' },
    ];
    // wanted=default：off 距离 2、max→high 距离 1 → 选 max（旧行为是 max 距离 0 必然胜出）
    const s = suggest(baseProfile({ cognitive: 3 }), catalog);
    expect(s.reasoningEffort).toBe('max');
    expect(s.rationale.some((r) => r.includes('off<low<default<high'))).toBe(true);
    expect(s.rationale.some((r) => r.includes('原生档位 max'))).toBe(true);
  });

  it('F1 回归：原生档名 medium 归一化为 default，直接命中目标档', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'm', efforts: ['low', 'medium', 'high'], contextWindow: 999999, tier: 'balanced' },
    ];
    const s = suggest(baseProfile({ cognitive: 3 }), catalog);
    expect(s.reasoningEffort).toBe('medium');
  });
});

describe('suggest · tier 与 toolFilter', () => {
  it('risk=security → premium + deny bash/write/edit + 高风险 rationale', () => {
    const s = suggest(baseProfile({ cognitive: 4, risk: 'security' }), CATALOG);
    expect(s.tokenTier).toBe('premium');
    expect(s.model).toBe('claude-opus');
    expect(s.toolFilter?.deny).toEqual(['bash', 'write', 'edit']);
    expect(s.rationale.some((r) => r.includes('高风险：建议强制挂验证者'))).toBe(true);
  });

  it('cognitive≤2 且 risk=readonly → cheap', () => {
    const s = suggest(baseProfile({ cognitive: 2, risk: 'readonly', determinism: 'low' }), CATALOG);
    expect(s.tokenTier).toBe('cheap');
    expect(s.model).toBe('deepseek-chat');
  });

  it('breadth≥4 → tier 至少 balanced（readonly 小任务也被抬到 balanced）', () => {
    const s = suggest(baseProfile({ cognitive: 2, risk: 'readonly', breadth: 4 }), CATALOG);
    expect(s.tokenTier).toBe('balanced');
  });

  it('常规开发 → balanced', () => {
    const s = suggest(baseProfile({ cognitive: 3 }), CATALOG);
    expect(s.tokenTier).toBe('balanced');
    expect(s.model).toBe('deepseek-reasoner');
  });

  it('contextTokens > contextWindow×0.5 的模型被排除', () => {
    const s = suggest(baseProfile({ cognitive: 2, risk: 'readonly', contextTokens: 100000 }), CATALOG);
    // deepseek-chat 窗口 128000，一半 64000 < 100000 → 被排除；cheap 无候选 → 回退全体合格候选
    expect(s.model).not.toBe('deepseek-chat');
    // tokenTier 必须报告实际选中模型的档位，而不是最初目标档。
    // 128k 模型在 100k 上下文下均被排除，只剩 claude-opus（premium）。
    expect(s.tokenTier).toBe('premium');
  });

  it('tier 内按 (contextWindow 升序, model 字典序) 取第一', () => {
    const catalog: ModelInfo[] = [
      { provider: 'p', model: 'zeta', efforts: ['low', 'default', 'high'], contextWindow: 64000, tier: 'cheap' },
      { provider: 'p', model: 'alpha', efforts: ['low', 'default', 'high'], contextWindow: 64000, tier: 'cheap' },
      { provider: 'p', model: 'beta', efforts: ['low', 'default', 'high'], contextWindow: 32000, tier: 'cheap' },
    ];
    const s = suggest(baseProfile({ cognitive: 1, risk: 'readonly' }), catalog);
    expect(s.model).toBe('beta'); // 窗口最小
  });

  it('catalog 为空 → throw', () => {
    expect(() => suggest(baseProfile(), [])).toThrow('catalog 为空，无法建议');
  });
});

describe('suggest · 其他字段', () => {
  it('confidence = 0.5 + 0.1×signals 数，封顶 0.95', () => {
    const noSignals = suggest(baseProfile(), CATALOG);
    expect(noSignals.confidence).toBe(0.5);
    const withSignals = suggest({ ...baseProfile(), signals: ['a', 'b', 'c'] }, CATALOG);
    expect(withSignals.confidence).toBeCloseTo(0.8, 5);
    const many = suggest({ ...baseProfile(), signals: Array(20).fill('x') }, CATALOG);
    expect(many.confidence).toBe(0.95);
  });

  it('rationale 全中文且引用具体画像维度值', () => {
    const s = suggest(baseProfile({ cognitive: 4, risk: 'security' }), CATALOG);
    expect(s.rationale.length).toBeGreaterThan(0);
    expect(s.rationale.some((r) => r.includes('cognitive=4'))).toBe(true);
    expect(s.rationale.some((r) => r.includes('risk=security'))).toBe(true);
  });

  it('breadth≥4 → maxDepth=2，否则 1', () => {
    expect(suggest(baseProfile({ breadth: 4 }), CATALOG).maxDepth).toBe(2);
    expect(suggest(baseProfile({ breadth: 1 }), CATALOG).maxDepth).toBe(1);
  });

  it('确定性：同输入同输出', () => {
    const p = baseProfile({ cognitive: 4, risk: 'security', breadth: 4 });
    expect(suggest(p, CATALOG)).toEqual(suggest(p, CATALOG));
  });
});

describe('validateChoice · fail-loud', () => {
  it('合法选择 → ok', () => {
    expect(validateChoice(CATALOG, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' })).toEqual({ ok: true });
  });

  it('未知 provider → UNKNOWN_PROVIDER 附全部 provider 候选', () => {
    const r = validateChoice(CATALOG, { provider: 'openai', model: 'gpt', reasoningEffort: 'low' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNKNOWN_PROVIDER');
      expect(r.error.candidates).toEqual(['deepseek', 'anthropic']);
    }
  });

  it('未知 model → UNKNOWN_MODEL 附该 provider 全部 model', () => {
    const r = validateChoice(CATALOG, { provider: 'deepseek', model: 'nope', reasoningEffort: 'low' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNKNOWN_MODEL');
      expect(r.error.candidates).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    }
  });

  it('不支持 effort → UNSUPPORTED_EFFORT 附该模型 efforts[]', () => {
    const r = validateChoice(CATALOG, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'max' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNSUPPORTED_EFFORT');
      expect(r.error.candidates).toEqual(['low', 'default', 'high']);
    }
  });
});
