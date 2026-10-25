/**
 * kernel/comms/dedup —— 幂等去重（调研报告 §7.5.C3 / FR-5.C3）。
 *
 * 回声风暴里同一消息可能被重放多次（重试、广播回环、多路径转发）。
 * 收件箱准入路径以 dedupKey 幂等：hash(from|to|correlationId|内容摘要)。
 * correlationId 缺省时以空串占位（保证键形稳定）。
 *
 * kernel 是纯函数内核：哈希用纯 JS FNV-1a（32 位），禁 node:crypto；
 * DedupStore 是内存计数器，持久化由宿主 service 层负责（kernel 零宿主依赖）。
 */
import { encodeTuple } from '../keys.js';

/** FNV-1a 32 位哈希（纯 JS 实现），输出 8 位小写 hex。 */
export function contentDigest(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i);
    // h *= 16777619，用位运算保持 32 位无符号
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 生成稳定去重键：hash(tuple(from,to,correlationId?,digest))。
 * correlationId 缺省用空串占位——显式空串与缺省等价（文档承诺）。
 */
export function dedupKey(parts: {
  from: string;
  to: string;
  correlationId?: string;
  content: string;
}): string {
  const corr = parts.correlationId ?? '';
  return contentDigest(
    encodeTuple([parts.from, parts.to, corr, contentDigest(parts.content)]),
  );
}

/** 内存去重计数器：record 幂等登记，重复返回 duplicate=true 并累计。 */
export class DedupStore {
  private readonly counts = new Map<string, number>();

  constructor() {}

  /** 登记一次出现；首次 duplicate=false count=1，重复 duplicate=true 并累计。 */
  record(key: string): { duplicate: boolean; count: number } {
    const prev = this.counts.get(key);
    const next = (prev ?? 0) + 1;
    this.counts.set(key, next);
    return { duplicate: prev !== undefined, count: next };
  }

  /** 已见次数；未见过返回 0。 */
  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  /** 只读探测：不登记本次出现（用于投递前预检）。 */
  has(key: string): boolean {
    return this.counts.has(key);
  }

  /** 已登记的不同 key 数。 */
  get size(): number {
    return this.counts.size;
  }
}
