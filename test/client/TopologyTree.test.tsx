// @vitest-environment jsdom
/** L2 文字拓扑树：kernel renderTree 渲染 + 折叠处显式声明隐藏内容（P4 原则）。 */
import { describe, expect, it } from 'vitest';
import { TopologyTree } from '../../src/client/TopologyTree.js';
import { render } from './helpers.js';
import { sampleView } from './fixtures.js';

describe('TopologyTree（L2）', () => {
  it('完整展开：kernel 树线（├ └）+ 形状 glyph 齐全', () => {
    const view = sampleView();
    const r = render(<TopologyTree vertices={view.vertices} />);
    const text = r.text();
    // 树线符号（来自 kernel renderTree）
    expect(text).toContain('├─');
    expect(text).toContain('└─');
    // 形状：active ● / blocked ◆ / idle ○
    expect(text).toContain('● captain');
    expect(text).toContain('◆ sub-lead-A');
    expect(text).toContain('○ w-1');
    // 角色标注
    expect(text).toContain('schema');
    r.unmount();
  });

  it('折叠处显式声明隐藏内容：「▸ N 个顶点已折叠」（规避"成员消失"缺陷）', () => {
    const view = sampleView();
    // 折叠 sub-lead-A：其子孙 w-1、w-2 共 2 个顶点被隐藏
    const r = render(<TopologyTree vertices={view.vertices} collapsedIds={['sub-lead-A']} />);
    const text = r.text();
    expect(text).toContain('▸ 2 个顶点已折叠');
    // 被折叠的顶点本身仍可见，其子孙消失
    expect(text).toContain('sub-lead-A');
    expect(text).not.toContain('w-1');
    expect(text).not.toContain('w-2');
    // 未折叠分支不受影响
    expect(text).toContain('w-3');
    r.unmount();
  });

  it('多级折叠计数为全部后代（含间接后代）', () => {
    const view = sampleView();
    // 折叠 captain：隐藏其余 5 个顶点
    const r = render(<TopologyTree vertices={view.vertices} collapsedIds={['captain']} />);
    const text = r.text();
    expect(text).toContain('▸ 5 个顶点已折叠');
    expect(text).toContain('captain');
    expect(text).not.toContain('sub-lead-A');
    r.unmount();
  });

  it('被折叠顶点的子孙若恰为另一折叠点的祖先，父指针重映射到最近可见祖先', () => {
    const view = sampleView();
    // 折叠 sub-lead-B（无下游折叠嵌套场景的对照：w-3 被隐藏，树其余结构完整）
    const r = render(<TopologyTree vertices={view.vertices} collapsedIds={['sub-lead-B']} />);
    const text = r.text();
    expect(text).toContain('▸ 1 个顶点已折叠');
    expect(text).toContain('w-2');
    r.unmount();
  });
});
