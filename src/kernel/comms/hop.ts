/**
 * kernel/comms/hop —— 跳数 TTL（调研报告 §7.5.C1）。
 *
 * 每条开放边携带 hopTTL；消息每转发一跳 hops 递增。
 * hops > hopTTL 时不再投递，只在任务板上「只记录」并标 HOP_LIMIT——
 * 既掐断无限转发链（防回声风暴），又保留审计痕迹（E2）。
 * 边界语义：hops === hopTTL 仍投递。
 */
import type { Edge } from '../topology/schema.js';

export type HopVerdict = { verdict: 'deliver' } | { verdict: 'record-only'; code: 'HOP_LIMIT' };

/**
 * 判定第 hops 跳是否仍允许经 edge 投递。
 * @param hops 当前跳数（第 1 跳 = 1）
 * @param edge 候选开放边（携带 hopTTL）
 */
export function checkHop(hops: number, edge: Edge): HopVerdict {
  if (hops > edge.hopTTL) return { verdict: 'record-only', code: 'HOP_LIMIT' };
  return { verdict: 'deliver' };
}
