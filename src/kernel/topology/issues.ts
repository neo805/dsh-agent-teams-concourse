/**
 * kernel/topology/issues — 结构问题的规范化输出（F4）与 spec 未知字段检测（F2）。
 *
 * 背景（2026-10-18 真机测试 session-69172a02）：
 *  · F4：team_plan 的 create 把 ZodError.message（多行 JSON）整段拼进中文句子，
 *    且 issues=[]；与 team_topology 的规范化 ISSUE_SCHEMA 不一致。本文件把
 *    ZodError → { code:'SCHEMA', message, path } 的映射收成 kernel 纯函数。
 *  · F2：assertKnownKeys 在真机上不可达（宿主按参数 schema 归一化，根层未知字段
 *    到不了 execute）。真正的笔误面在 spec 内部——zod 默认 strip 未知键，写错的
 *    字段被静默丢弃。findUnknownKeyIssues 在 parse 前扫描 spec 内部逐层已知键集，
 *    命中未知键即产出 issue（附 did-you-mean 建议），由工具层并入校验结果。
 *
 * 纯函数、零宿主依赖（kernel 层）。
 */
import { ZodError } from 'zod';

/** 规范化后的结构/语义问题（tools 层 ISSUE_SCHEMA 的 kernel 对应物）。 */
export interface SchemaIssue {
  code: string;
  message: string;
  path?: string;
}

/** 编辑距离（DP，滚动两行数组）——与 tools/keys.ts 同算法，kernel 层自带副本以保单向依赖。 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}

/** 距离阈值内（≤ max(2, ⌊len/2⌋)）的候选，按 (距离, 字典序) 排序。 */
function didYouMean(input: string, candidates: readonly string[]): string[] {
  const threshold = Math.max(2, Math.floor(input.length / 2));
  return candidates
    .map((c) => ({ c, d: levenshtein(input, c) }))
    .filter((x) => x.d <= threshold)
    .sort((x, y) => x.d - y.d || (x.c < y.c ? -1 : x.c > y.c ? 1 : 0))
    .map((x) => x.c);
}

/** 各层已知键集（与 schema.ts 保持一致；新增字段必须同步）。 */
const CONCOURSE_KEYS = ['id', 'tier', 'substrate', 'budget', 'approval', 'vertices', 'edges', 'tasks'] as const;
const VERTEX_KEYS = [
  'id',
  'origin',
  'parent',
  'layer',
  'role',
  'provider',
  'model',
  'reasoningEffort',
  'lifecycle',
  'contextMode',
  'maxDepth',
  'toolFilter',
  'budget',
] as const;
const EDGE_KEYS = ['from', 'to', 'mode', 'wake', 'hopTTL', 'rate', 'budget'] as const;
const TASK_KEYS = ['id', 'subject', 'assignee', 'dependencies', 'profile'] as const;
const PROFILE_KEYS = [
  'cognitive',
  'breadth',
  'contextTokens',
  'toolCalls',
  'determinism',
  'risk',
  'parallelism',
  'signals',
] as const;
const VERTEX_BUDGET_KEYS = ['tokens', 'wallclockMs'] as const;
const CONCOURSE_BUDGET_KEYS = ['tokens'] as const;
const EDGE_BUDGET_KEYS = ['tokens'] as const;
const TOOL_FILTER_KEYS = ['allow', 'deny'] as const;
const RATE_KEYS = ['n', 'perMs'] as const;
const SUBSTRATE_KEYS = ['depthAlwaysOne', 'completeGraph'] as const;

/** 检查一个对象层的未知键，追加 issue（含 did-you-mean）。 */
function checkObject(
  value: unknown,
  known: readonly string[],
  path: string,
  issues: SchemaIssue[],
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (known.includes(key)) continue;
    const hints = didYouMean(key, known);
    const hint = hints.length > 0 ? `，可能是 ${hints.map((h) => `"${h}"`).join(' / ')}` : '';
    issues.push({
      code: 'UNKNOWN_FIELD',
      message: `未知字段 "${key}"${hint}（允许：${known.join(', ')}）`,
      ...(path.length > 0 ? { path: `${path}.${key}` } : { path: key }),
    });
  }
}

/**
 * 扫描 spec 内部各层未知键。只检查对象/数组结构，不替代 zod 校验；
 * 非法结构（如 vertices 不是数组）留给 parseConcourse 报 SCHEMA。
 */
export function findUnknownKeyIssues(raw: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return issues;
  const c = raw as Record<string, unknown>;
  checkObject(c, CONCOURSE_KEYS, '', issues);
  checkObject(c['budget'], CONCOURSE_BUDGET_KEYS, 'budget', issues);
  checkObject(c['substrate'], SUBSTRATE_KEYS, 'substrate', issues);
  if (Array.isArray(c['vertices'])) {
    c['vertices'].forEach((v: unknown, i: number) => {
      checkObject(v, VERTEX_KEYS, `vertices[${i}]`, issues);
      if (typeof v === 'object' && v !== null) {
        const vo = v as Record<string, unknown>;
        checkObject(vo['toolFilter'], TOOL_FILTER_KEYS, `vertices[${i}].toolFilter`, issues);
        checkObject(vo['budget'], VERTEX_BUDGET_KEYS, `vertices[${i}].budget`, issues);
      }
    });
  }
  if (Array.isArray(c['edges'])) {
    c['edges'].forEach((e: unknown, i: number) => {
      checkObject(e, EDGE_KEYS, `edges[${i}]`, issues);
      if (typeof e === 'object' && e !== null) {
        const eo = e as Record<string, unknown>;
        checkObject(eo['rate'], RATE_KEYS, `edges[${i}].rate`, issues);
        checkObject(eo['budget'], EDGE_BUDGET_KEYS, `edges[${i}].budget`, issues);
      }
    });
  }
  if (Array.isArray(c['tasks'])) {
    c['tasks'].forEach((t: unknown, i: number) => {
      checkObject(t, TASK_KEYS, `tasks[${i}]`, issues);
      if (typeof t === 'object' && t !== null) {
        const to = t as Record<string, unknown>;
        checkObject(to['profile'], PROFILE_KEYS, `tasks[${i}].profile`, issues);
      }
    });
  }
  return issues;
}

/**
 * zod path → 统一 path 格式：数字段用 `[n]`，根级路径省略。
 * 例：['vertices', 0, 'id'] → `vertices[0].id`。
 */
export function formatIssuePath(path: readonly PropertyKey[]): string | undefined {
  if (path.length === 0) return undefined;
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out.length === 0 ? String(part) : `.${String(part)}`;
  }
  return out.length > 0 ? out : undefined;
}

/** ZodError → 规范化 issue 列表（code=SCHEMA，path 与语义 issue 同形）。 */
export function zodErrorToIssues(err: ZodError): SchemaIssue[] {
  return err.issues.map((i) => {
    const path = formatIssuePath(i.path);
    return { code: 'SCHEMA', message: i.message, ...(path !== undefined ? { path } : {}) };
  });
}

/** ZodError → 一行中文摘要（供 message 使用，不再拼整段 JSON）。 */
export function zodErrorSummary(err: ZodError): string {
  const issues = err.issues;
  const first = issues[0];
  if (first === undefined) return '结构非法（无详情）';
  const path = formatIssuePath(first.path);
  const more = issues.length > 1 ? `（等 ${issues.length} 处）` : '';
  return `${path !== undefined ? `${path}：` : ''}${first.message}${more}`;
}
