/**
 * kernel/profile/effort — reasoningEffort 的单一归一化口径。
 *
 * 各 provider 原生档名不统一；suggest 与预算估算必须共用同一 alias 表，
 * 否则「建议 high、预算按 1 倍」这类跨模块漂移会直接低估计划预算。
 */

export const EFFORT_ORDER = ['off', 'low', 'default', 'high'] as const;

export type CanonicalEffort = (typeof EFFORT_ORDER)[number];

const EFFORT_ALIASES: ReadonlyMap<string, CanonicalEffort> = new Map([
  ['off', 'off'],
  ['none', 'off'],
  ['minimal', 'off'],
  ['low', 'low'],
  ['medium', 'default'],
  ['default', 'default'],
  ['high', 'high'],
  ['xhigh', 'high'],
  ['max', 'high'],
  ['maximum', 'high'],
]);

/** 原生档名 → 规范档位；未知档原样返回（由调用方决定回退）。 */
export function normalizeEffort(effort: string): string {
  return EFFORT_ALIASES.get(effort) ?? effort;
}

/** 规范档位索引；未知档按 default 位次参与确定性最近邻。 */
export function effortIndex(effort: string): number {
  const canonical = normalizeEffort(effort);
  const i = EFFORT_ORDER.indexOf(canonical as CanonicalEffort);
  return i === -1 ? EFFORT_ORDER.indexOf('default') : i;
}
