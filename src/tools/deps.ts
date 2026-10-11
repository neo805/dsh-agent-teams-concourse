/**
 * tools/deps — 工具组共享依赖注入面与输出 schema 公共片段。
 */
import type { Catalog, Substrate } from '../host/contracts.js';
import type { ConcourseService } from '../service/concourse.js';
import type { Ledger } from '../service/ledger.js';

/** 六个 team_* 工具的共享依赖（apply 装配 / 测试注入 stub）。 */
export interface TeamToolsDeps {
  readonly service: ConcourseService;
  readonly ledger: Ledger;
  readonly substrate: Substrate;
  /** 模型目录；缺席时 team_topology 的派发建议段为空（降级不崩溃）。 */
  readonly catalog?: Catalog;
}

/** 统一 issue 形态（结构/语义校验共用）。 */
export interface ToolIssue {
  code: string;
  message: string;
  path?: string;
}

/** issues 输出 schema 片段（闭合对象数组；required 在使用点展开）。 */
export const ISSUE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true },
      message: { type: 'string', required: true },
      path: { type: 'string' },
    },
  },
} as const;

/** §7.8.3 边界约定文案：每个工具 description 必带，与官方 team_task_* 划清边界。 */
export const BOUNDARY_NOTE =
  '边界约定（§7.8.3）：concourse 工具管虚拟拓扑团队，官方 team_task_* 管官方实验任务板，两者互不通用。';
