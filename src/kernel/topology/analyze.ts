/**
 * kernel/topology/analyze — preview 与 create 共用的唯一 spec 分析管线。
 *
 * parseConcourse 前先扫描未知键（zod 默认 strip，不能静默丢字段），随后
 * normalizeConcourseBudgetsWithEstimate 一次产出预算规范化结果与估算，
 * 最后执行 validateConcourse。工具层与 service 层只投影该结果，不各写一套。
 */
import type { EstimateResult } from '../budget/tokens.js';
import { normalizeConcourseBudgetsWithEstimate } from '../budget/normalize.js';
import { findUnknownKeyIssues, zodErrorToIssues, type SchemaIssue } from './issues.js';
import { parseConcourse, type Concourse } from './schema.js';
import { validateConcourse } from './validate.js';
import { ZodError } from 'zod';

export interface ConcourseAnalysis {
  readonly stage: 'parse' | 'validate';
  /** parse 失败时缺席。 */
  readonly concourse?: Concourse;
  /** validate 阶段与 concourse 同时返回；parse 阶段缺席。 */
  readonly estimate?: EstimateResult;
  readonly issues: readonly SchemaIssue[];
}

/** 分析一份原始 spec：结构 → 未知字段 → 预算规范化 → 语义；不落库。 */
export function analyzeConcourse(input: unknown): ConcourseAnalysis {
  const unknownKeyIssues = findUnknownKeyIssues(input);
  let parsed: Concourse;
  try {
    parsed = parseConcourse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        stage: 'parse',
        issues: [...unknownKeyIssues, ...zodErrorToIssues(err)],
      };
    }
    throw err;
  }
  const { concourse, estimate } = normalizeConcourseBudgetsWithEstimate(parsed);
  return {
    stage: 'validate',
    concourse,
    estimate,
    issues: [...unknownKeyIssues, ...validateConcourse(concourse)],
  };
}
