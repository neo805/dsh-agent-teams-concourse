/**
 * kernel/keys — 内部复合键的唯一 framing。
 *
 * 顶点 id / 边方向都是任意非空字符串，直接 `${a}->${b}` 或分隔符 join 会让
 * 合法字段边界产生确定性碰撞。内部键统一用 JSON tuple framing；显示文案仍可
 * 使用箭头等人类可读格式。
 */

/** 无歧义字段元组编码（JSON 字符串数组）。 */
export function encodeTuple(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

/** 有向边内部键：顺序敏感。 */
export function directedPairKey(from: string, to: string): string {
  return encodeTuple([from, to]);
}

/** 无序顶点对内部键（逻辑父子关系与方向无关）。 */
export function undirectedPairKey(a: string, b: string): string {
  return a <= b ? encodeTuple([a, b]) : encodeTuple([b, a]);
}
