import { describe, expect, it } from 'vitest';
import { CONCOURSE_PROVIDER_NAME } from '../../src/host/contracts.js';
import { createConcourseProvider, ProviderError } from '../../src/host/provider.js';

describe('host/provider（concourse 自有 provider，路线 A 仅 continuable）', () => {
  it('name 为 contracts 的 CONCOURSE_PROVIDER_NAME', () => {
    const p = createConcourseProvider({});
    expect(p.name).toBe(CONCOURSE_PROVIDER_NAME);
    expect(p.name).toBe('concourse');
  });

  it('capabilities 按 0.2.1-rc.2 契约声明 agentOptions/agentPreset/outputSchema/depthLimit', () => {
    const p = createConcourseProvider({});
    expect(p.capabilities).toEqual({
      agentOptions: true,
      agentPreset: false,
      outputSchema: false,
      depthLimit: true,
    });
  });

  it('inheritsParentContext 为 false（MVP spawn 语义：不继承父上下文）', () => {
    expect(createConcourseProvider({}).inheritsParentContext).toBe(false);
  });

  it('start（one-shot）抛 typed error：路线 A 只用 continuable', async () => {
    const p = createConcourseProvider({});
    const err = await p.start({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('CONTINUABLE_ONLY');
    expect((err as Error).message).toContain('continuable');
  });

  it('prepareContinuable 只贡献 spawn seed：无 seed（全新子代理）、无 Agent/run 字段', async () => {
    const p = createConcourseProvider({});
    const spec = await p.prepareContinuable?.({
      sessionId: 'child-1',
      parent: { id: 'parent-1' },
      signal: new AbortController().signal,
    });
    expect(spec).toBeDefined();
    expect(spec?.seed).toBeUndefined();
    // 纯数据：不携带任何生命周期句柄
    expect(Object.keys(spec ?? {}).every((k) => k === 'seed')).toBe(true);
  });

  it('prepareContinuable 每次返回独立对象（detached，零共享可变状态）', async () => {
    const p = createConcourseProvider({});
    const req = { sessionId: 'c', parent: { id: 'p' }, signal: new AbortController().signal };
    const a = await p.prepareContinuable?.(req);
    const b = await p.prepareContinuable?.(req);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
