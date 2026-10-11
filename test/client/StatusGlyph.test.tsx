// @vitest-environment jsdom
/** 状态视觉双通道：形状 + 颜色同时具备；纯文本导出后仅凭形状可读。 */
import { describe, expect, it } from 'vitest';
import { STATUS } from '../../src/kernel/glyphs.js';
import { StatusGlyph, STATUS_COLORS } from '../../src/client/StatusGlyph.js';
import { render } from './helpers.js';

const EXPECTED_SHAPES: Record<string, string> = {
  active: '●',
  idle: '○',
  blocked: '◆',
  running: '▸',
  done: '✓',
  failed: '✗',
  pending: '·',
};

describe('StatusGlyph（状态双通道）', () => {
  it('七状态全部具备形状 + 颜色双通道', () => {
    for (const status of STATUS) {
      const r = render(<StatusGlyph status={status} />);
      const el = r.container.querySelector('[data-status]') as HTMLElement;
      expect(el).not.toBeNull();
      expect(el.dataset.status).toBe(status);
      // 形状通道（与 kernel GLYPHS 一致）
      expect(el.textContent).toContain(EXPECTED_SHAPES[status]);
      // 颜色通道（内联色值，色盲可辨配色）
      expect(el.style.color).not.toBe('');
      // 中文标签（第三重冗余）
      expect(el.textContent?.length).toBeGreaterThan(1);
      r.unmount();
    }
  });

  it('颜色表覆盖全部状态且为合法 hex 色值', () => {
    for (const status of STATUS) {
      expect(STATUS_COLORS[status]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('纯文本导出（textContent）仅凭形状字符可辨任意两状态', () => {
    // 灰度/纯文本可读性：形状字符两两不同，不依赖颜色
    const shapes = STATUS.map((s) => EXPECTED_SHAPES[s]);
    expect(new Set(shapes).size).toBe(STATUS.length);
    const r = render(
      <div>
        {STATUS.map((s) => (
          <StatusGlyph key={s} status={s} />
        ))}
      </div>,
    );
    for (const shape of shapes) {
      expect(r.text()).toContain(shape);
    }
    r.unmount();
  });
});
