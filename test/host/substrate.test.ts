import { describe, expect, it } from 'vitest';
import { CONCOURSE_PROVIDER_NAME, type VertexStart } from '../../src/host/contracts.js';
import { createSubstrate, SubstrateError } from '../../src/host/substrate.js';
import { FakeAgent, FakeAgents, FakeSubagents } from '../fakes/subagents.js';

/** 伪 parent（宿主 Agent 对本层不透明）。 */
const parent = { id: 'parent-session-1' };

const fullSpec: VertexStart = {
  vertexId: 'v-1',
  label: 'worker-1',
  prompt: '实现任务 X',
  model: 'deepseek-chat',
  reasoningEffort: 'high',
  toolFilter: { deny: ['send_message'] },
  maxDepth: 3,
};

/** 配套的 ctx.agents：子 agent-1 带 scoped restrict。 */
function withAgents(_fake: FakeSubagents): FakeAgents {
  const agents = new FakeAgents();
  agents.agents.set('child-1', new FakeAgent());
  return agents;
}

describe('host/substrate（VertexStart → startActivation 装配透传，DSH 0.2.1-rc.2）', () => {
  it('mode：deps.subagents 在场为 full，缺席为 degraded', () => {
    expect(createSubstrate({ subagents: new FakeSubagents() }).mode).toBe('full');
    expect(createSubstrate({}).mode).toBe('degraded');
  });

  it('startVertex 全字段装配：provider/label/prompt/agentOptions/maxDepth/delivery 透传', async () => {
    const fake = new FakeSubagents();
    const agents = withAgents(fake);
    const substrate = createSubstrate({ subagents: fake, agents });
    const handle = await substrate.startVertex(fullSpec, parent);

    expect(handle).toEqual({ vertexId: 'v-1', childId: 'child-1' });
    expect(fake.startCalls).toHaveLength(1);
    const spec = fake.startCalls[0]?.spec;
    expect(spec?.provider).toBe(CONCOURSE_PROVIDER_NAME);
    expect(spec?.label).toBe('worker-1');
    expect(spec?.request.prompt).toEqual([{ type: 'text', text: '实现任务 X' }]);
    expect(spec?.request.parent).toBe(parent);
    expect(spec?.request.agentOptions).toEqual({ model: 'deepseek-chat', reasoningEffort: 'high' });
    expect(spec?.request.maxDepth).toBe(3);
    expect(spec?.delivery).toBe('parent');
    expect(spec?.signal.aborted).toBe(false);
    // 0.2.1：toolFilter 不再进 start spec，改为挂载后 scoped restrict
    expect(spec?.request && 'toolFilter' in spec.request).toBe(false);
    expect(agents.get('child-1')?.restrictCalls).toEqual([{ deny: ['send_message'] }]);
  });

  it('startVertex 最小规格：可选项缺席时 request 不带对应键，且不调 restrict', async () => {
    const fake = new FakeSubagents();
    const agents = withAgents(fake);
    const substrate = createSubstrate({ subagents: fake, agents });
    await substrate.startVertex({ vertexId: 'v-2', label: 'w', prompt: 'p' }, parent);
    const req = fake.startCalls[0]?.spec.request;
    expect(req).toBeDefined();
    expect(req && 'agentOptions' in req).toBe(false);
    expect(req && 'maxDepth' in req).toBe(false);
    expect(agents.get('child-1')?.restrictCalls).toEqual([]);
  });

  it('startVertex 仅 model：agentOptions 只含 model（exactOptionalPropertyTypes）', async () => {
    const fake = new FakeSubagents();
    const substrate = createSubstrate({ subagents: fake });
    await substrate.startVertex({ vertexId: 'v', label: 'w', prompt: 'p', model: 'm-1' }, parent);
    expect(fake.startCalls[0]?.spec.request.agentOptions).toEqual({ model: 'm-1' });
  });

  it('宿主 startActivation 抛错 → 包成 START_FAILED typed error，保留原始 message 与 cause', async () => {
    const fake = new FakeSubagents();
    const boom = new Error('subagent provider "concourse" does not support the "agentOptions" capability');
    fake.startError = boom;
    const substrate = createSubstrate({ subagents: fake });
    const err = await substrate.startVertex(fullSpec, parent).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubstrateError);
    expect((err as SubstrateError).code).toBe('START_FAILED');
    expect((err as SubstrateError).vertexId).toBe('v-1');
    expect((err as Error).message).toContain(boom.message);
    expect((err as { cause?: unknown }).cause).toBe(boom);
  });

  it('toolFilter 无法应用（ctx.agents 缺席）→ START_FAILED 并 dispose 已拉起激活', async () => {
    const fake = new FakeSubagents();
    const substrate = createSubstrate({ subagents: fake });
    const err = await substrate.startVertex(fullSpec, parent).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubstrateError);
    expect((err as SubstrateError).code).toBe('START_FAILED');
    expect((err as Error).message).toContain('toolFilter');
    expect(fake.disposeCalls).toEqual([{ childId: 'child-1' }]);
  });

  it('sendText 走宿主 sendMessage 语义：sender=startVertex 时的 parent，targetId=childId', async () => {
    const fake = new FakeSubagents();
    const agents = withAgents(fake);
    const substrate = createSubstrate({ subagents: fake, agents });
    const handle = await substrate.startVertex(fullSpec, parent);
    await substrate.sendText(handle, '继续任务');
    expect(fake.sendCalls).toHaveLength(1);
    const call = fake.sendCalls[0];
    expect(call?.sender).toBe(parent);
    expect(call?.targetId).toBe('child-1');
    expect(call?.content).toEqual([{ type: 'text', text: '继续任务' }]);
  });

  it('sendText 未知顶点（非本 substrate 拉起）→ SEND_FAILED', async () => {
    const substrate = createSubstrate({ subagents: new FakeSubagents() });
    const err = await substrate
      .sendText({ vertexId: 'ghost', childId: 'child-9' }, 'hi')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubstrateError);
    expect((err as SubstrateError).code).toBe('SEND_FAILED');
  });

  it('宿主 sendMessage 抛错 → SEND_FAILED 并保留原始 message', async () => {
    const fake = new FakeSubagents();
    fake.sendError = new Error('PARENT_UNAVAILABLE');
    const agents = withAgents(fake);
    const substrate = createSubstrate({ subagents: fake, agents });
    const handle = await substrate.startVertex(fullSpec, parent);
    const err = await substrate.sendText(handle, 'x').catch((e: unknown) => e);
    expect((err as SubstrateError).code).toBe('SEND_FAILED');
    expect((err as Error).message).toContain('PARENT_UNAVAILABLE');
  });

  it('interrupt 走宿主 interrupt(childId, {kind:ancestor}) 并 dispose 释放激活', async () => {
    const fake = new FakeSubagents();
    const agents = withAgents(fake);
    const substrate = createSubstrate({ subagents: fake, agents });
    const handle = await substrate.startVertex(fullSpec, parent);
    await substrate.interrupt(handle);
    expect(fake.interruptCalls).toEqual([
      { targetId: 'child-1', authority: { kind: 'ancestor', agent: parent } },
    ]);
    expect(fake.disposeCalls).toEqual([{ childId: 'child-1' }]);
  });

  it('dispose 失败 → INTERRUPT_FAILED；重复 interrupt 不再 dispose（句柄已释放）', async () => {
    const fake = new FakeSubagents();
    fake.disposeError = new Error('teardown failed');
    const agents = withAgents(fake);
    const substrate = createSubstrate({ subagents: fake, agents });
    const handle = await substrate.startVertex(fullSpec, parent);
    const err = await substrate.interrupt(handle).catch((e: unknown) => e);
    expect((err as SubstrateError).code).toBe('INTERRUPT_FAILED');
    expect((err as Error).message).toContain('teardown failed');

    // 首次 dispose 已把句柄从表中移除；第二次 interrupt 不再触发 dispose（幂等）
    const fake2 = new FakeSubagents();
    const substrate2 = createSubstrate({ subagents: fake2, agents: new FakeAgents() });
    const h2 = await substrate2.startVertex({ vertexId: 'v9', label: 'w', prompt: 'p' }, parent);
    await substrate2.interrupt(h2);
    await substrate2.interrupt(h2);
    expect(fake2.disposeCalls).toEqual([{ childId: 'child-1' }]);
  });

  it('宿主 interrupt 抛错 → INTERRUPT_FAILED；未知顶点 → INTERRUPT_FAILED', async () => {
    const fake = new FakeSubagents();
    fake.interruptError = new Error('UNAUTHORIZED');
    const substrate = createSubstrate({ subagents: fake, agents: withAgents(fake) });
    const handle = await substrate.startVertex(fullSpec, parent);
    const err = await substrate.interrupt(handle).catch((e: unknown) => e);
    expect((err as SubstrateError).code).toBe('INTERRUPT_FAILED');
    expect((err as Error).message).toContain('UNAUTHORIZED');

    const err2 = await substrate
      .interrupt({ vertexId: 'ghost', childId: 'child-9' })
      .catch((e: unknown) => e);
    expect((err2 as SubstrateError).code).toBe('INTERRUPT_FAILED');
  });

  it('degraded 模式：三方法全部 throw DEGRADED typed error，构造不崩溃', async () => {
    const substrate = createSubstrate({});
    expect(substrate.mode).toBe('degraded');
    const e1 = await substrate.startVertex(fullSpec, parent).catch((e: unknown) => e);
    expect((e1 as SubstrateError).code).toBe('DEGRADED');
    const e2 = await substrate
      .sendText({ vertexId: 'v-1', childId: 'child-1' }, 'x')
      .catch((e: unknown) => e);
    expect((e2 as SubstrateError).code).toBe('DEGRADED');
    const e3 = await substrate
      .interrupt({ vertexId: 'v-1', childId: 'child-1' })
      .catch((e: unknown) => e);
    expect((e3 as SubstrateError).code).toBe('DEGRADED');
  });
});
