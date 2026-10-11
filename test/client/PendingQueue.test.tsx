// @vitest-environment jsdom
/** L1 待决队列：空态显式 + 列表渲染。 */
import { describe, expect, it } from 'vitest';
import { PendingQueue } from '../../src/client/PendingQueue.js';
import { render } from './helpers.js';
import { samplePending } from './fixtures.js';

describe('PendingQueue（L1）', () => {
  it('空态显式显示「无待决事项」（P2 原则：通常为空也要说出来）', () => {
    const r = render(<PendingQueue items={[]} />);
    expect(r.text()).toContain('无待决事项');
    r.unmount();
  });

  it('渲染待决事项：标题 + 详情 + 动作按钮', () => {
    const r = render(<PendingQueue items={samplePending()} />);
    const text = r.text();
    expect(text).toContain('T-7');
    expect(text).toContain('修复范围超出 inScope');
    expect(text).toContain('顶点 w-2 请求扩大修改范围');
    for (const action of ['允许', '改范围', '换人']) {
      expect(text).toContain(action);
    }
    expect(text).not.toContain('无待决事项');
    // 动作必须是可点按钮
    expect(r.container.querySelectorAll('button').length).toBe(3);
    r.unmount();
  });

  it('动作回调把事项 id 与动作名传出', () => {
    const calls: Array<[string, string]> = [];
    const r = render(
      <PendingQueue items={samplePending()} onAction={(id, action) => calls.push([id, action])} />,
    );
    const buttons = r.container.querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).click();
    expect(calls).toEqual([['T-7', '改范围']]);
    r.unmount();
  });

  it('无详情的待决事项不渲染详情段', () => {
    const r = render(<PendingQueue items={[{ id: 'T-9', title: '预算超限待批' }]} />);
    expect(r.text()).toContain('预算超限待批');
    r.unmount();
  });
});
