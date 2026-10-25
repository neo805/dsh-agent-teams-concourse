/**
 * client/PlanCard — 会话内计划审批卡（§7.6.3：唯一的审批界面，一次审批信息完备）。
 *
 * 五段齐全：拓扑建议（含依据）· 任务表（含依据列与总预算）· 通信边表（含关闭边计数）·
 * 审批策略 · 风险（无风险显式写「无」）。头部操作：批准并运行 / 改 / 弃。
 */
import type { PlanEdgeRow, PlanView, TierOption } from './types.js';

export interface PlanCardProps {
  readonly plan: PlanView;
  readonly onApprove?: () => void;
  readonly onRevise?: () => void;
  readonly onDiscard?: () => void;
}

/** 唤醒三态的中文视图（审批信息必须能区分 on-reply 与 never）。 */
const WAKE_LABEL: Record<PlanEdgeRow['wake'], string> = {
  always: '总是',
  'on-reply': '仅应答',
  never: '不唤醒',
};

/** 谱系选项行：选中 ● / 未选 ○ / 不可用 ─（形状承载选择态，不依赖颜色）。 */
function TierRow({ option }: { readonly option: TierOption }) {
  const shape = !option.available ? '─' : option.selected ? '●' : '○';
  return (
    <div className="concourse-plan-tier" data-tier={option.tier} data-selected={option.selected}>
      {shape} {option.tier} {option.label}
      {option.note !== undefined ? <span className="concourse-plan-tier-note">（{option.note}）</span> : null}
    </div>
  );
}

export function PlanCard({ plan, onApprove, onRevise, onDiscard }: PlanCardProps) {
  return (
    <section className="concourse-plan-card" data-testid="concourse-plan-card">
      <header className="concourse-plan-head">
        <span>
          计划审核 <strong>{plan.id}</strong>
        </span>
        <span className="concourse-plan-actions">
          <button type="button" onClick={() => onApprove?.()}>
            批准并运行
          </button>
          <button type="button" onClick={() => onRevise?.()}>
            改
          </button>
          <button type="button" onClick={() => onDiscard?.()}>
            弃
          </button>
        </span>
      </header>

      <section className="concourse-plan-section" data-section="tiers">
        <h4>拓扑建议</h4>
        {plan.tiers.map((t) => (
          <TierRow key={t.tier} option={t} />
        ))}
        <p className="concourse-plan-rationale">依据：{plan.tierRationale}</p>
      </section>

      <section className="concourse-plan-section" data-section="tasks">
        <h4>任务</h4>
        <table className="concourse-plan-tasks">
          <thead>
            <tr>
              <th>#</th>
              <th>任务</th>
              <th>依赖</th>
              <th>负责人</th>
              <th>模型</th>
              <th>强度</th>
              <th>预算</th>
              <th>依据</th>
            </tr>
          </thead>
          <tbody>
            {plan.tasks.map((t, i) => (
              <tr key={t.id}>
                <td>{i + 1}</td>
                <td>{t.subject}</td>
                <td>{t.dependencies.length > 0 ? t.dependencies.join(',') : '—'}</td>
                <td>{t.assignee}</td>
                <td>{t.model}</td>
                <td>{t.effort}</td>
                <td>{t.budget}</td>
                <td>{t.rationale}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>总预算</td>
              <td>{plan.totalBudget}</td>
              <td>{plan.costHint ?? ''}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="concourse-plan-section" data-section="edges">
        <h4>通信</h4>
        <table className="concourse-plan-edges">
          <thead>
            <tr>
              <th>从</th>
              <th>到</th>
              <th>类别</th>
              <th>跳数</th>
              <th>速率</th>
              <th>唤醒</th>
            </tr>
          </thead>
          <tbody>
            {plan.edges.map((e) => (
              <tr key={`${e.from}->${e.to}`}>
                <td>{e.from}</td>
                <td>{e.to}</td>
                <td>{e.kind}</td>
                <td>≤{e.hopTTL}</td>
                <td>{e.rate ?? '—'}</td>
                <td>{WAKE_LABEL[e.wake]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="concourse-plan-closed">其余 {plan.closedEdgeCount} 条边：已关闭</p>
      </section>

      <section className="concourse-plan-section" data-section="approval">
        <h4>审批策略</h4>
        <p>● {plan.approvalStrategy}</p>
        {(plan.approvalNotes ?? []).map((note) => (
          <p key={note} className="concourse-plan-note">
            {note}
          </p>
        ))}
      </section>

      <section className="concourse-plan-section" data-section="risks">
        <h4>风险</h4>
        {plan.risks.length === 0 ? (
          <p className="concourse-plan-no-risk">无</p>
        ) : (
          <ul>
            {plan.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
