/**
 * kernel/comms/gate —— 开放边集准入判定（调研报告 §7.5 A 类 deny-by-default）。
 *
 * 防「回声风暴」第一道闸门：底座物理上是完全图，通信许可只看「开放边集」，
 * 未列出的边一律关闭。权威判定发生在「收件箱准入」路径，本模块提供该路径
 * 调用的纯判定函数；发送侧可用同一函数做「早失败」，两侧结果必然一致。
 *
 * 拒绝必须携带 from 当前所有开放出边的候选列表（FR-5.E2 留痕数据），
 * 让拒绝可行动（提示发送方可以发给谁），而不是一句空泛的「禁止」。
 */
import type { Edge } from '../topology/schema.js';

export interface GateInput {
  from: string;
  to: string;
}

export type GateVerdict =
  | { verdict: 'deliver'; edge: Edge }
  | { verdict: 'reject'; code: 'EDGE_CLOSED'; candidates: string[] };

/**
 * 判定一条消息可否经开放边集投递。
 * @param edges 当前 concourse 声明的开放边集（deny-by-default）
 * @param msg 消息方向
 */
export function admit(edges: Edge[], msg: GateInput): GateVerdict {
  const match = edges.find((e) => e.from === msg.from && e.to === msg.to);
  if (match !== undefined) return { verdict: 'deliver', edge: match };
  // candidates：from 的全部开放出边终点——留痕 + 可行动提示（A2 半双工，方向敏感）
  const candidates = edges.filter((e) => e.from === msg.from).map((e) => e.to);
  return { verdict: 'reject', code: 'EDGE_CLOSED', candidates };
}
