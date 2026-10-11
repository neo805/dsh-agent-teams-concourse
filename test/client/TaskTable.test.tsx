// @vitest-environment jsdom
/** L3 任务表：任务 id / 主题 / 受托人 / 状态。 */
import { describe, expect, it } from 'vitest';
import { TaskTable } from '../../src/client/TaskTable.js';
import { render } from './helpers.js';
import { sampleView } from './fixtures.js';

describe('TaskTable（L3）', () => {
  it('表头四列齐全：任务 / 主题 / 受托人 / 状态', () => {
    const r = render(<TaskTable tasks={sampleView().tasks} />);
    const headers = [...r.container.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['任务', '主题', '受托人', '状态']);
    r.unmount();
  });

  it('每行渲染 id / 主题 / 受托人 / 状态（形状+文字双通道）', () => {
    const r = render(<TaskTable tasks={sampleView().tasks} />);
    const text = r.text();
    for (const [id, subject, assignee] of [
      ['T-1', '设计 schema', 'w-1'],
      ['T-2', '实现 API', 'w-2'],
      ['T-3', '集成测试', 'w-3'],
    ] as const) {
      expect(text).toContain(id);
      expect(text).toContain(subject);
      expect(text).toContain(assignee);
    }
    // 状态形状 + 中文标签都在纯文本里可读
    expect(text).toContain('✓');
    expect(text).toContain('完成');
    expect(text).toContain('▸');
    expect(text).toContain('运行中');
    expect(text).toContain('·');
    expect(text).toContain('待派');
    r.unmount();
  });

  it('空任务表显式空态', () => {
    const r = render(<TaskTable tasks={[]} />);
    expect(r.text()).toContain('无任务');
    r.unmount();
  });
});
