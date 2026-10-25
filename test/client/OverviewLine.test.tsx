// @vitest-environment jsdom
/** L0 单行总览：字段齐全断言（§4.3 client 清单）。 */
import { describe, expect, it } from 'vitest';
import { OverviewLine } from '../../src/client/OverviewLine.js';
import { render } from './helpers.js';
import { sampleView } from './fixtures.js';

describe('OverviewLine（L0）', () => {
  it('单行包含全部字段：tier / 顶点数 / 活跃数 / 开放边 x/y / 预算条 / 回声 / 熔断', () => {
    const view = sampleView();
    const r = render(<OverviewLine view={view} />);
    const text = r.text();
    // tier 与谱系标签
    expect(text).toContain('T1b');
    expect(text).toContain('多层领队');
    // 顶点数与活跃数（active 2：captain + w-2）
    expect(text).toContain('6 顶点');
    expect(text).toContain('2 活跃');
    // 开放边 x/y：4 条开放，y = 6*(6-1) = 30（有向完全图口径）
    expect(text).toContain('开放边 4/30');
    // 预算条：61% → ▰×6 + ▱×4
    expect(text).toContain('▰▰▰▰▰▰▱▱▱▱');
    expect(text).toContain('61%');
    // 回声计数（投递/拒/降）与熔断数
    expect(text).toContain('回声 12');
    expect(text).toContain('拒 1');
    expect(text).toContain('降 2');
    expect(text).toContain('熔断 0');
    // 单行：不换行元素（无 <br>，无块级子节）
    expect(r.container.querySelectorAll('br')).toHaveLength(0);
    r.unmount();
  });

  it('熔断标记：fused=true 时显式展示「已熔断」且带颜色通道', () => {
    const view = { ...sampleView(), fused: true, echo: { delivered: 9, rejected: 0, degraded: 0, fused: 2 } };
    const r = render(<OverviewLine view={view} />);
    expect(r.text()).toContain('已熔断');
    const marker = r.container.querySelector('[data-fused="true"]');
    expect(marker).not.toBeNull();
    expect((marker as HTMLElement).style.color).not.toBe('');
    r.unmount();
  });

  it('预算用尽边界：used=total → 100% 全满条', () => {
    const view = { ...sampleView(), budget: { used: 100000, total: 100000 } };
    const r = render(<OverviewLine view={view} />);
    expect(r.text()).toContain('▰▰▰▰▰▰▰▰▰▰');
    expect(r.text()).toContain('100%');
    r.unmount();
  });

  it('零顶点边界：开放边 0/0 不崩溃', () => {
    const view = { ...sampleView(), vertices: [], edges: [] };
    const r = render(<OverviewLine view={view} />);
    expect(r.text()).toContain('开放边 0/0');
    r.unmount();
  });
});
