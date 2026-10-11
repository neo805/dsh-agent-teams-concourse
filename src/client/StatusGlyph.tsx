/**
 * client/StatusGlyph — 状态视觉双通道：形状 + 颜色同时具备（§7.6.1）。
 *
 * 形状是语义唯一载体（kernel GLYPHS，灰度/纯文本可辨）；颜色是加速器，
 * client 侧用内联色值补齐第二通道，配色避开红/绿相邻（色盲可辨）：
 * 蓝(活跃/运行) · 灰(空闲/待派) · 橙(阻塞) · 绿(完成) · 红(失败)。
 */
import { GLYPHS, type Status } from '../kernel/glyphs.js';

/** 状态 → 内联色值（hex，不依赖宿主主题变量，保证灰度对比与可测试性）。 */
export const STATUS_COLORS: Record<Status, string> = {
  active: '#2563EB', // 蓝
  idle: '#6B7280', // 灰
  blocked: '#D97706', // 橙
  running: '#2563EB', // 蓝（形状 ▸ 与 ● 区分）
  done: '#16A34A', // 绿
  failed: '#DC2626', // 红
  pending: '#9CA3AF', // 浅灰
};

export interface StatusGlyphProps {
  readonly status: Status;
  /** 是否渲染中文标签（默认 true，第三重冗余）。 */
  readonly withLabel?: boolean;
}

/** 形状 + 颜色 + 标签三通道状态标记。零图片资产。 */
export function StatusGlyph({ status, withLabel = true }: StatusGlyphProps) {
  const glyph = GLYPHS[status];
  return (
    <span
      className={`concourse-status concourse-status--${status}`}
      data-status={status}
      style={{ color: STATUS_COLORS[status] }}
    >
      <span aria-hidden="true">{glyph.shape}</span>
      {withLabel ? ` ${glyph.label}` : ''}
    </span>
  );
}
