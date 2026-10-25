// @vitest-environment jsdom
/** 计划审批卡：§7.6.3 五段齐全 + 风险显式列出。 */
import { describe, expect, it } from 'vitest';
import { PlanCard } from '../../src/client/PlanCard.js';
import { render } from './helpers.js';
import { samplePlan } from './fixtures.js';

describe('PlanCard（计划审批卡）', () => {
  it('五段齐全：拓扑建议 / 任务表 / 通信边表 / 审批策略 / 风险', () => {
    const r = render(<PlanCard plan={samplePlan()} />);
    const text = r.text();
    expect(text).toContain('计划审核');
    expect(text).toContain('release-v3');
    // 段一：拓扑建议（谱系选项 + 依据）
    expect(text).toContain('拓扑建议');
    expect(text).toContain('T1b');
    expect(text).toContain('多层');
    expect(text).toContain('依据：4 个独立子系统，且各子系统需再分解');
    // 段二：任务表（含列头与依据列 + 总预算）
    for (const col of ['任务', '依赖', '负责人', '模型', '强度', '预算', '依据']) {
      expect(text).toContain(col);
    }
    expect(text).toContain('sonnet-4.5');
    expect(text).toContain('总预算');
    expect(text).toContain('170k');
    expect(text).toContain('≈ ¥1.6');
    // 段三：通信边表（开放边 + 关闭边显式计数）
    expect(text).toContain('通信');
    expect(text).toContain('captain');
    expect(text).toContain('其余 17 条边：已关闭');
    // 段四：审批策略
    expect(text).toContain('审批策略');
    expect(text).toContain('一次批准，此后运行期零审批');
    // 段五：风险显式列出
    expect(text).toContain('风险');
    expect(text).toContain('T-4 安全审计使用高风险工具白名单');
    r.unmount();
  });

  it('操作按钮：批准并运行 / 改 / 弃', () => {
    const r = render(<PlanCard plan={samplePlan()} />);
    const labels = [...r.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('批准并运行');
    expect(labels).toContain('改');
    expect(labels).toContain('弃');
    r.unmount();
  });

  it('按钮回调：onApprove / onRevise / onDiscard', () => {
    const fired: string[] = [];
    const r = render(
      <PlanCard
        plan={samplePlan()}
        onApprove={() => fired.push('approve')}
        onRevise={() => fired.push('revise')}
        onDiscard={() => fired.push('discard')}
      />,
    );
    const buttons = [...r.container.querySelectorAll('button')];
    for (const b of buttons) {
      if (b.textContent === '批准并运行') b.click();
      if (b.textContent === '改') b.click();
      if (b.textContent === '弃') b.click();
    }
    expect(fired).toEqual(['approve', 'revise', 'discard']);
    r.unmount();
  });

  it('无风险时显式写「无」（不把风险段留空）', () => {
    const plan = { ...samplePlan(), risks: [] };
    const r = render(<PlanCard plan={plan} />);
    const text = r.text();
    expect(text).toContain('风险');
    expect(text).toContain('无');
    r.unmount();
  });

  it('不可选谱系显式标注原因（T2a / T2b）', () => {
    const r = render(<PlanCard plan={samplePlan()} />);
    const text = r.text();
    expect(text).toContain('需你先加入其它已存在的会话');
    expect(text).toContain('本方案不提供');
    r.unmount();
  });

  it('唤醒策略保留三态语义（on-reply 与 never 不再压成 boolean）', () => {
    const r = render(<PlanCard plan={samplePlan()} />);
    const text = r.text();
    expect(text).toContain('仅应答');
    expect(text).toContain('不唤醒');
    r.unmount();
  });

  it('选中谱系用 ●、未选用 ○、不可用用 ─（形状承载选择态）', () => {
    const r = render(<PlanCard plan={samplePlan()} />);
    const text = r.text();
    expect(text).toContain('● T1b');
    expect(text).toContain('○ T1a');
    expect(text).toContain('─ T2a');
    expect(text).toContain('─ T2b');
    r.unmount();
  });
});
