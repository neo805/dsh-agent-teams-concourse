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
 *   2. Ledger + 事件存储（config.storagePath → JSONL；宿主 storage 目录探测为
 *      防御式假设 ctx.storageDir，缺席降级内存存储）
 *   3. ConcourseService（snapshot 来自 store 事件回放）
 *   4. 注册 team_* 工具（经 registerTeamTools 按身份作用域分流；根/领队上下文
 *      注册全量。子节点会话的 per-child 分流注册待宿主提供身份面后接线，
 *      resolveScope 的单测已覆盖 member 最小集）
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { createCatalog, type LlmCatalogLike } from './host/catalog.js';
import { createSubstrate, type SubagentsLike } from './host/substrate.js';
import { createConcourseProvider } from './host/provider.js';
import type { Catalog, Substrate } from './host/contracts.js';
import { ConcourseService } from './service/concourse.js';
import { Ledger } from './service/ledger.js';
import { createJsonlStore, createMemoryStore, replay, type EventStore } from './service/persistence.js';
import { registerTeamTools, type TeamToolsDeps } from './tools/index.js';

export const name = 'dsh-agent-teams-concourse';

/** cordis 依赖注入声明：所需宿主服务。 */
export const inject = ['subagents', 'llm', 'tools'];

export interface ConcourseConfig {
  /** 总开关。缺省 false：插件完全惰性。 */
  enabled?: boolean;
  /** 台账事件存储路径（JSONL）。缺省探测宿主 storage 目录，再缺席降级内存存储。 */
  storagePath?: string;
}

/** 宿主上下文最小结构面（防御式：任何字段缺席都降级而非崩溃）。 */
interface CtxLike {
  subagents?: (SubagentsLike & { registerProvider?(provider: unknown): unknown }) | undefined;
  llm?: LlmCatalogLike | undefined;
  tools?: { register(definition: ToolDefinition): unknown } | undefined;
  logger?: { warn?(message: string): void } | undefined;
  /** 防御式探测：宿主 storage 目录（假设字段名，缺席则降级内存存储）。 */
  storageDir?: unknown;
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
    substrate = createSubstrate(c.subagents !== undefined ? { subagents: c.subagents } : {});
    const provider = createConcourseProvider({});
    c.subagents?.registerProvider?.(provider);
  } catch (err) {
    warn('provider', err);
  }

  // 步骤 2：台账 + 事件存储
  try {
    const probed = typeof c.storageDir === 'string' ? c.storageDir : undefined;
    const path = config.storagePath ?? probed;
    store = path !== undefined ? createJsonlStore(path) : createMemoryStore();
    const s = store;
    ledger = new Ledger({ sink: (e) => s.append(e) });
  } catch (err) {
    warn('ledger', err);
  }

  // 步骤 3：领域服务（事件回放恢复台账历史）
  try {
    if (substrate === undefined || ledger === undefined) {
      throw new Error('前序步骤缺席（substrate/ledger），跳过 service 装配');
    }
    service = new ConcourseService({
      substrate,
      ledger,
      ...(store !== undefined ? { snapshot: replay(store.load()) } : {}),
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
}
