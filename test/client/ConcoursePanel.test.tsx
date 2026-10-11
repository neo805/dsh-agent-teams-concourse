// @vitest-environment jsdom
/** ConcoursePanel：L0-L3 纵向组装。 */
import { describe, expect, it } from 'vitest';
import { ConcoursePanel } from '../../src/client/ConcoursePanel.js';
import { render } from './helpers.js';
import { samplePending, sampleView } from './fixtures.js';

describe('ConcoursePanel（面板组装）', () => {
  it('L0-L3 四层按序出现：总览 → 待决 → 拓扑 → 任务', () => {
    const view = sampleView();
    const r = render(
      <ConcoursePanel view={view} pending={samplePending()} collapsedIds={['sub-lead-A']} />,
    );
    const text = r.text();
    // L0
    expect(text).toContain('T1b');
    expect(text).toContain('开放边 4/15');
    // L1
    expect(text).toContain('待你决定');
    expect(text).toContain('T-7');
    // L2（折叠声明也在）
    expect(text).toContain('拓扑');
    expect(text).toContain('▸ 2 个顶点已折叠');
    // L3
    expect(text).toContain('受托人');
    expect(text).toContain('集成测试');
    // 顺序：L0 在 L1 前，L1 在 L2 前，L2 在 L3 前
    const i0 = text.indexOf('T1b');
    const i1 = text.indexOf('待你决定');
    const i2 = text.indexOf('拓扑');
    const i3 = text.indexOf('受托人');
    expect(i0).toBeGreaterThanOrEqual(0);
    expect(i0).toBeLessThan(i1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    r.unmount();
  });

  it('待决计数随列表变化；空列表显示「待你决定 (0)」且队列空态', () => {
    const r = render(<ConcoursePanel view={sampleView()} pending={[]} />);
    const text = r.text();
    expect(text).toContain('待你决定 (0)');
    expect(text).toContain('无待决事项');
    r.unmount();
  });
});
