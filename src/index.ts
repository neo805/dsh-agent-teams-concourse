/**
 * dsh-agent-teams-concourse 宿主入口（cordis 插件）。
 *
 * NFR-1 惰性安装：enabled !== true 时零行为变更、零监听器、零注册。
 * NFR-2 异常永不阻断对话：apply 内每个装配步骤独立 try/catch——
 *   任何失败只记 ctx.logger.warn 并跳过该步骤，绝不 throw（也避免宿主
 *   因 apply 抛错而整体回滚插件 effect）。
 *
 * 装配链（provider → ledger/store → service → tools），四步互相独立：
 *   1. createCatalog / createSubstrate / createConcourseProvider → ctx.subagents.registerProvider
 *      （0.2.1-rc.2：起点为 startActivation；工具面收口经 ctx.agents + ctx.tools.restrict）
 *   2. Ledger + 事件存储（config.storagePath 是 JSONL 文件；缺省内存存储）
 *   3. ConcourseService（snapshot 来自 store 事件回放）
 *   4. 注册 team_* 工具（经 registerTeamTools 按身份作用域分流；根/领队上下文
 *      注册全量。子节点会话的 per-child 分流注册待宿主提供身份面后接线，
 *      resolveScope 的单测已覆盖 member 最小集）
 *   5. 注册 agent/pre-step 模型准入闸门：真实 agent-message 按 senderSessionId
 *      映射到 concourse 顶点，闭边消息在进入模型前移除并留痕
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { createCatalog, type LlmCatalogLike } from './host/catalog.js';
import { createSubstrate, type AgentsLike, type SubagentsLike } from './host/substrate.js';
import { createConcourseProvider } from './host/provider.js';
import type { Catalog, Substrate } from './host/contracts.js';
import { ConcourseService } from './service/concourse.js';
import { Ledger } from './service/ledger.js';
import { createJsonlStore, createMemoryStore, replay, type EventStore } from './service/persistence.js';
import { registerTeamTools, type TeamToolsDeps } from './tools/index.js';

export const name = 'dsh-agent-teams-concourse';

/** cordis 依赖注入声明：所需宿主服务。agents 用于逐顶点 toolFilter 收口。 */
export const inject = ['subagents', 'agents', 'llm', 'tools'];

export interface ConcourseConfig {
  /** 总开关。缺省 false：插件完全惰性。 */
  enabled?: boolean;
  /** JSONL 台账文件路径。缺省使用内存存储；配置后父目录自动创建。 */
  storagePath?: string;
}

/** 宿主上下文最小结构面（防御式：任何字段缺席都降级而非崩溃）。 */
interface CtxLike {
  subagents?: (SubagentsLike & { registerProvider?(provider: unknown): unknown }) | undefined;
  /** 宿主 live Agent 注册表：逐顶点 toolFilter 收口（0.2.1 起经 ctx.tools.restrict）。 */
  agents?: AgentsLike | undefined;
  llm?: LlmCatalogLike | undefined;
  tools?: { register(definition: ToolDefinition): unknown } | undefined;
  logger?: { warn?(message: string): void } | undefined;
  /** 宿主事件注册；资源随插件 ctx 生命周期释放。 */
  on?(
    event: string,
    listener: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>,
  ): unknown;
}

export async function apply(ctx: unknown, config: ConcourseConfig = {}): Promise<void> {
  if (config.enabled !== true) return;
  const c = (ctx ?? {}) as CtxLike;
  const warn = (step: string, err: unknown): void => {
    try {
      c.logger?.warn?.(
        `[concourse] 装配步骤 ${step} 失败（已跳过，不阻断对话）：${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      // logger 自身失败也绝不外抛
    }
  };

  let catalog: Catalog | undefined;
  let substrate: Substrate | undefined;
  let ledger: Ledger | undefined;
  let store: EventStore | undefined;
  let service: ConcourseService | undefined;

  // 步骤 1：catalog / substrate / provider 注册
  try {
    catalog = createCatalog(c.llm !== undefined ? { llm: c.llm } : {});
    substrate = createSubstrate({
      ...(c.subagents !== undefined ? { subagents: c.subagents } : {}),
      ...(c.agents !== undefined ? { agents: c.agents } : {}),
    });
    const provider = createConcourseProvider({});
    c.subagents?.registerProvider?.(provider);
  } catch (err) {
    warn('provider', err);
  }

  // 步骤 2：台账 + 事件存储（显式文件路径；缺省内存，避免猜测宿主私有目录）
  try {
    store = config.storagePath !== undefined ? createJsonlStore(config.storagePath) : createMemoryStore();
    const events = store.load();
    const s = store;
    ledger = new Ledger({ sink: (e) => s.append(e), snapshot: events });
  } catch (err) {
    warn('ledger', err);
  }

  // 步骤 3：领域服务（事件回放恢复台账历史）
  try {
    if (substrate === undefined || ledger === undefined || store === undefined) {
      throw new Error('前序步骤缺席（substrate/ledger），跳过 service 装配');
    }
    service = new ConcourseService({
      substrate,
      ledger,
      snapshot: replay(store.load()),
    });
  } catch (err) {
    warn('service', err);
  }

  // 步骤 4：工具注册（根/领队上下文 → 全量）
  try {
    if (service === undefined || ledger === undefined || substrate === undefined) {
      throw new Error('service 装配缺席，跳过工具注册');
    }
    if (c.tools?.register === undefined) {
      throw new Error('宿主 ctx.tools.register 缺席，跳过工具注册');
    }
    const deps: TeamToolsDeps = {
      service,
      ledger,
      substrate,
      ...(catalog !== undefined ? { catalog } : {}),
    };
    registerTeamTools((def) => c.tools?.register(def), deps);
  } catch (err) {
    warn('tools', err);
  }

  // 步骤 5：真实模型准入闸门（agent/pre-step 在消息进入模型前执行收件侧判定）
  try {
    if (service === undefined) throw new Error('service 装配缺席，跳过 inbound gate');
    if (c.on === undefined) return;
    c.on('agent/pre-step', async (payload, next) => {
      const decision = (await next()) as {
        kind: 'reject' | 'enter';
        messages?: readonly {
          content: readonly { type?: string; text?: string }[];
          source?: unknown;
        }[];
        [key: string]: unknown;
      };
      if (decision.kind === 'reject') return decision;
      const p = payload as { agent?: { id?: unknown } };
      const agentId = p.agent?.id;
      const messages = decision.messages ?? [];
      if (typeof agentId !== 'string' || messages.length === 0) return decision;
      try {
        const filtered = service.filterInbound(agentId, messages);
        if (filtered.length === messages.length) return decision;
        if (filtered.length === 0) return { kind: 'reject' as const };
        return { ...decision, messages: filtered };
      } catch (err) {
        warn('inbound-gate', err);
        // 闸门自身异常时 fail-closed：不让未判定的 agent-message 进入模型
        return { kind: 'reject' as const };
      }
    });
  } catch (err) {
    warn('inbound-gate', err);
  }
}
