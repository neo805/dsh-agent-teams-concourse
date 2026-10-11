/**
 * dsh-agent-teams-concourse 宿主入口（P0 装配桩）。
 *
 * NFR-1 惰性安装：enabled !== true 时零行为变更、零监听器。
 * P3 将在此接线：substrate 适配器、concourse 领域服务、team_* 工具组。
 */
export const name = 'dsh-agent-teams-concourse';

export interface ConcourseConfig {
  /** 总开关。缺省 false：插件完全惰性。 */
  enabled?: boolean;
}

export async function apply(_ctx: unknown, config: ConcourseConfig = {}): Promise<void> {
  if (config.enabled !== true) return;
  // P0：尚无装配内容。
}
