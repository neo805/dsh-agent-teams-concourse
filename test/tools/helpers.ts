/**
 * test/tools/helpers — tools 层测试公共测试件。
 *
 * makeFixture：StubSubstrate + Ledger + ConcourseService（可选 FakeLLM catalog）；
 * SAMPLE_SPEC：合法 T1a 三顶点 spec（lead 为 origin=self 领队，a/b 为 spawned）；
 * fakeExec：最小 ToolRunContext 桩（可注入 agent 模拟调用方身份）。
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { ConcourseService } from '../../src/service/concourse.js';
import { Ledger } from '../../src/service/ledger.js';
import { createCatalog } from '../../src/host/catalog.js';
import { FakeLLM } from '../fakes/llm.js';
import { StubSubstrate } from '../service/helpers.js';
import type { TeamToolsDeps } from '../../src/tools/deps.js';

/** 合法 T1a spec：树边双向 request-reply，无横向边，maxLayer=1。 */
export const SAMPLE_SPEC = {
  id: 'demo',
  tier: 'T1a',
  vertices: [
    { id: 'lead', origin: 'self', parent: null, layer: 0, role: '领队' },
    { id: 'a', parent: 'lead', layer: 1 },
    { id: 'b', parent: 'lead', layer: 1 },
  ],
  edges: [
    { from: 'lead', to: 'a', mode: 'request-reply', wake: 'on-reply', hopTTL: 2 },
    { from: 'a', to: 'lead', mode: 'request-reply', wake: 'never', hopTTL: 2 },
    { from: 'lead', to: 'b', mode: 'request-reply', wake: 'on-reply', hopTTL: 2 },
    { from: 'b', to: 'lead', mode: 'request-reply', wake: 'never', hopTTL: 2 },
  ],
  tasks: [
    { id: 't1', subject: '调研', assignee: 'a', profile: { cognitive: 2, risk: 'readonly' } },
    { id: 't2', subject: '汇总', assignee: 'b' },
  ],
} as const;

export interface ToolsFixture {
  readonly deps: TeamToolsDeps;
  readonly service: ConcourseService;
  readonly ledger: Ledger;
  readonly substrate: StubSubstrate;
}

export function makeFixture(opts: { withCatalog?: boolean } = {}): ToolsFixture {
  const substrate = new StubSubstrate();
  const ledger = new Ledger();
  const service = new ConcourseService({ substrate, ledger });
  const catalog =
    opts.withCatalog === true
      ? createCatalog({
          llm: new FakeLLM({
            providers: [
              {
                id: 'p1',
                models: [
                  { id: 'm-big', efforts: ['low', 'default', 'high'] },
                  { id: 'm-cheap', efforts: ['low'] },
                ],
              },
            ],
          }),
        })
      : undefined;
  const deps: TeamToolsDeps = {
    service,
    ledger,
    substrate,
    ...(catalog !== undefined ? { catalog } : {}),
  };
  return { deps, service, ledger, substrate };
}

/** 测试用领队 Agent id（SAMPLE_SPEC 中 origin=self 的顶点）。 */
export const ROOT_AGENT_ID = 'lead-agent';

/** create + submit + approve 直达 running（parent 只暴露 id，stub 不校验宿主）。 */
export async function makeRunning(
  fx: ToolsFixture,
  spec: unknown = SAMPLE_SPEC,
  parent: unknown = { id: ROOT_AGENT_ID },
): Promise<void> {
  const rec = fx.service.create(spec);
  fx.service.submit(rec.concourse.id);
  await fx.service.approve(rec.concourse.id, parent);
}

/** 最小 ToolRunContext 桩；agent 缺席时该键不出现（对齐 exactOptionalPropertyTypes）。 */
export function fakeExec(agent?: unknown): ToolRunContext {
  const base = {
    callId: 'call-1',
    rootCallId: 'call-1',
    name: 'tool',
    arguments: {},
    token: Symbol('exec'),
    signal: new AbortController().signal,
    deferContext() {
      /* no-op */
    },
    concludeTurn() {
      /* no-op */
    },
  };
  return { ...base, ...(agent !== undefined ? { agent } : {}) } as unknown as ToolRunContext;
}
