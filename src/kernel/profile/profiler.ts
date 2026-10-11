/**
 * kernel/profile/profiler — 任务难度画像（§7.4.2 七维）。
 *
 * 纯函数、零宿主依赖（NFR-5）：同输入 → 完全同输出。
 *
 * 设计教训（auto-router R-5）：真实中文任务消息短、口语化
 * （"1做A 2做B"、"然后/另外/再把"）、少路径、少 markdown 列表。
 * 因此：
 *  · 关键词匹配一律用 includes / 无边界正则，禁止 \b（对 CJK 永不成立）；
 *  · 结构信号覆盖紧凑枚举、顿号并列、markdown 列表三种形态；
 *  · 每条命中都在 signals[] 留可解释条目（如 "security:命中[安全,审计]"）。
 */
import type { DifficultyProfile } from '../topology/schema.js';

export interface ProfileInput {
  text: string;
  fileCount?: number;
  pathTokens?: number;
}

export type ProfiledTask = DifficultyProfile & { signals: string[] };

/** 安全类：最高风险，优先于破坏/只读。 */
const SECURITY_WORDS = ['安全', '审计', '漏洞', '注入', '权限', '密钥', '脱敏', 'security', 'audit'];
/** 破坏类：不可逆操作的口语/英文说法。 */
const DESTRUCTIVE_WORDS = ['删除', '迁移', '重构', '重写', '批量', '清空', 'drop', 'migrate', 'rewrite'];
/** 只读类：不改状态的查看/理解类诉求。 */
const READONLY_WORDS = ['解释', '说明', '分析', '总结', '看一下', '读一下', '梳理', 'explain', 'analyze'];
/** 实施类：要动手产出/改动代码。 */
const IMPLEMENT_WORDS = ['实现', '开发', '修复', '接入', '做一', 'implement', 'fix', 'build'];
/** 口语并列连词：真实中文里最常见的多任务信号。 */
const ORAL_CONNECTORS = ['然后', '另外', '还有就是', '还要', '再把'];

/** 返回命中的词表（大小写不敏感；保序、去重）。 */
function matchWords(text: string, words: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase()));
}

/** 统计全局出现次数（用于口语连词计数）。 */
function countOccurrences(text: string, words: readonly string[]): number {
  let n = 0;
  for (const w of words) {
    let i = 0;
    while ((i = text.indexOf(w, i)) !== -1) {
      n += 1;
      i += w.length;
    }
  }
  return n;
}

/** 紧凑枚举："1做A 2做B 3做C" 式数字项（前面不能是数字，避免误吃 2026.10 这类日期）。 */
function countCompactEnum(text: string): number {
  return (text.match(/(?<!\d)\d{1,2}\s*[做：:、.．)）]/g) ?? []).length;
}

/** 顿号/分号并列计数。 */
function countParataxis(text: string): number {
  return (text.match(/[、；;]/g) ?? []).length;
}

/** markdown 列表行（"- xx" / "1. xx"）计数。 */
function countMarkdownListLines(text: string): number {
  return text.split('\n').filter((l) => /^\s*(?:[-*+]|\d{1,2}[.、)）])\s*\S/.test(l)).length;
}

/** 七维画像主入口。 */
export function profileTask(input: ProfileInput): ProfiledTask {
  const text = input.text;
  const signals: string[] = [];

  // —— 风险维度：security > destructive > readonly > reversible ——
  const securityHits = matchWords(text, SECURITY_WORDS);
  const destructiveHits = matchWords(text, DESTRUCTIVE_WORDS);
  const readonlyHits = matchWords(text, READONLY_WORDS);

  let risk: DifficultyProfile['risk'] = 'reversible';
  let determinism: DifficultyProfile['determinism'] = 'mid';
  if (securityHits.length > 0) {
    risk = 'security';
    determinism = 'high';
    signals.push(`security:命中[${securityHits.join(',')}]`);
  } else if (destructiveHits.length > 0) {
    risk = 'destructive';
    signals.push(`destructive:命中[${destructiveHits.join(',')}]`);
  } else if (readonlyHits.length > 0) {
    risk = 'readonly';
    determinism = 'low';
    signals.push(`readonly:命中[${readonlyHits.join(',')}]`);
  }

  // —— 认知维度：基准 2；实施 +1；长文本 +1；安全抬到 ≥4；封顶 5 ——
  let cognitive = 2;
  const implementHits = matchWords(text, IMPLEMENT_WORDS);
  if (implementHits.length > 0) {
    cognitive += 1;
    signals.push(`implement:命中[${implementHits.join(',')}]`);
  }

  // —— 广度与并行度 ——
  let breadth = 1;
  let parallelism: DifficultyProfile['parallelism'] = 'serial';
  let toolCalls = 0;

  const enumCount = countCompactEnum(text);
  const parataxisCount = countParataxis(text);
  const mdListCount = countMarkdownListLines(text);
  if (enumCount >= 3 || parataxisCount >= 3 || mdListCount >= 3) {
    breadth += 2;
    parallelism = 'parallel';
    toolCalls = Math.max(enumCount, mdListCount, 3);
    signals.push(
      `structure:紧凑枚举=${enumCount},顿号分号=${parataxisCount},markdown列表=${mdListCount} → breadth+2,parallelism=parallel`,
    );
  }
  const oralCount = countOccurrences(text, ORAL_CONNECTORS);
  if (oralCount >= 2) {
    breadth += 1;
    signals.push(`oral:口语并列连词×${oralCount}[${ORAL_CONNECTORS.filter((w) => text.includes(w)).join(',')}] → breadth+1`);
  }

  // —— 体量：长文本 / 文件数 / 路径 token ——
  let contextTokens = Math.ceil(text.length / 2);
  if (text.length > 200) {
    cognitive += 1;
    signals.push(`bulk:长文本${text.length}字 → contextTokens≈${contextTokens},cognitive+1`);
  }
  if (input.fileCount !== undefined && input.fileCount > 0) {
    contextTokens += input.fileCount * 2000;
    signals.push(`bulk:fileCount=${input.fileCount} → contextTokens+${input.fileCount * 2000}`);
  }
  if (input.pathTokens !== undefined && input.pathTokens > 0) {
    contextTokens += input.pathTokens * 500;
    signals.push(`bulk:pathTokens=${input.pathTokens} → contextTokens+${input.pathTokens * 500}`);
  }

  if (securityHits.length > 0) cognitive = Math.max(cognitive, 4);

  return {
    cognitive: Math.min(5, Math.max(1, cognitive)),
    breadth: Math.min(5, Math.max(1, breadth)),
    contextTokens,
    toolCalls,
    determinism,
    risk,
    parallelism,
    signals,
  };
}
