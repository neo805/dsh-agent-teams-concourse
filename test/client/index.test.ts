// @vitest-environment jsdom
/**
 * 客户端入口 apply(ctx)：注册 sidebar.right.pane.tab 页型 + keyed 面板体。
 * 防御式：宿主服务缺席时不抛错（NFR-2 同款纪律）。
 */
import { describe, expect, it, vi } from 'vitest';
import { apply, inject, name, TAB_DEFINITION_ID, TAB_KIND } from '../../src/client/index.js';

/** 严格模拟宿主 keyed slot：缺 key 必须装载期抛错。 */
function strictRegisterSlot(
  definition: { name?: string; key?: string; id?: string },
  _component: unknown,
) {
  if (definition.name === 'sidebar.right.pane.tab' && typeof definition.key !== 'string') {
    throw new Error('keyed slot "sidebar.right.pane.tab" requires key');
  }
  return vi.fn();
}

describe('client/index apply', () => {
  it('声明 cordis inject：sidebarRightTabs + slots + sidebarRight', () => {
    expect(inject).toEqual(['sidebarRightTabs', 'slots', 'sidebarRight']);
    expect(name).toBe('dsh-agent-teams-concourse-client');
  });

  it('页型注册进 ctx.effect；keyed 面板体使用 key 且与页型 id 一致', () => {
    const tabDisposer = vi.fn();
    const registerTab = vi.fn((_definition: unknown) => tabDisposer);
    const slotDisposer = vi.fn();
    const registerSlot = vi.fn((_definition: unknown, _component: unknown) => slotDisposer);
    const cleanups: unknown[] = [];
    const effect = vi.fn((fn: () => unknown) => {
      const cleanup = fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const injectSlot = vi.fn((slotName: string, factory: () => unknown) => {
      factory();
      return undefined;
    });
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const openTab = vi.fn();
    const sidebarRight = {
      openTab,
      mounted: {
        getSnapshot: () => 'session-1',
        subscribe,
      },
    };

    apply({
      effect,
      sidebarRightTabs: { register: registerTab },
      slots: { inject: injectSlot, register: registerSlot },
      sidebarRight,
    });

    // 页型与自动打开订阅各自由 effect 托管，卸载时调用 disposer。
    expect(effect).toHaveBeenCalledTimes(2);
    expect(registerTab).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith(TAB_KIND);
    const definition = registerTab.mock.calls[0]?.[0] as {
      id: string;
      kind: string;
      title: (address: string) => string;
      guide?: Array<{
        id: string;
        order: number;
        title: () => string;
        description?: () => string;
      }>;
    };
    expect(definition.id).toBe(TAB_DEFINITION_ID);
    expect(definition.kind).toBe(TAB_KIND);
    expect(typeof definition.title).toBe('function');
    expect(definition.title('sidebar://concourse')).toContain('Concourse');
    // 没有 guide 条目时，右侧栏“添加标签”无法发现这个页面类型。
    expect(definition.guide).toHaveLength(1);
    expect(definition.guide?.[0]).toMatchObject({ id: 'panel', order: 50 });
    expect(definition.guide?.[0]?.title()).toContain('Concourse');
    expect(definition.guide?.[0]?.description?.()).toBeTruthy();
    for (const cleanup of cleanups) {
      if (typeof cleanup === 'function') (cleanup as () => void)();
    }
    expect(tabDisposer).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    // keyed slot：必须传 key，不得沿用页型的 id 字段。
    expect(injectSlot).toHaveBeenCalledWith('sidebar.right.pane.tab', expect.any(Function));
    expect(registerSlot).toHaveBeenCalledTimes(1);
    const slotDef = registerSlot.mock.calls[0]?.[0] as { name: string; key: string; id?: string };
    expect(slotDef.name).toBe('sidebar.right.pane.tab');
    expect(slotDef.key).toBe(TAB_DEFINITION_ID);
    expect(slotDef.id).toBeUndefined();
  });

  it('自动打开只对每个已挂载会话执行一次；用户关闭后不反复抢回', () => {
    const openTab = vi.fn();
    const unsub = vi.fn();
    let listener: (() => void) | undefined;
    let sessionId: string | undefined = 'session-a';
    const subscribe = vi.fn((fn: () => void) => {
      listener = fn;
      return unsub;
    });
    apply({
      sidebarRightTabs: { register: vi.fn() },
      slots: { inject: (_name: string, factory: () => unknown) => factory(), register: vi.fn() },
      sidebarRight: {
        openTab,
        mounted: { getSnapshot: () => sessionId, subscribe },
      },
    });
    expect(openTab).toHaveBeenCalledTimes(1);
    sessionId = undefined;
    listener?.();
    expect(openTab).toHaveBeenCalledTimes(1);
    sessionId = 'session-a';
    listener?.();
    expect(openTab).toHaveBeenCalledTimes(1);
    sessionId = 'session-b';
    listener?.();
    expect(openTab).toHaveBeenCalledTimes(2);
  });

  it('严格 keyed 契约：缺 key 的注册会被拒绝，因此实现不得再传 id', () => {
    const registerSlot = vi.fn(strictRegisterSlot);
    const injectSlot = vi.fn((_slotName: string, factory: () => unknown) => factory());
    expect(() =>
      apply({
        sidebarRightTabs: { register: vi.fn() },
        slots: { inject: injectSlot, register: registerSlot },
      }),
    ).not.toThrow();
    expect(registerSlot).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sidebar.right.pane.tab', key: TAB_DEFINITION_ID }),
      expect.anything(),
    );
  });

  it('宿主服务缺席时不抛错（undefined / 空对象 / 半残对象）', () => {
    expect(() => apply(undefined)).not.toThrow();
    expect(() => apply({})).not.toThrow();
    expect(() => apply({ sidebarRightTabs: {} })).not.toThrow();
    expect(() => apply({ slots: {} })).not.toThrow();
  });

  it('页型注册失败：记录 warning、跳过半注册，但不阻断宿主其它插件', () => {
    const warn = vi.fn();
    const injectSlot = vi.fn();
    expect(() =>
      apply({
        logger: { warn },
        effect: (fn: () => unknown) => fn(),
        sidebarRightTabs: {
          register: () => {
            throw new Error('boom');
          },
        },
        slots: { inject: injectSlot, register: vi.fn() },
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(injectSlot).not.toHaveBeenCalled();
  });

  it('keyed body 注册失败：记录 warning，不静默吞掉契约漂移', () => {
    const warn = vi.fn();
    const registerSlot = vi.fn(() => {
      throw new Error('slot boom');
    });
    expect(() =>
      apply({
        logger: { warn },
        effect: (fn: () => unknown) => fn(),
        sidebarRightTabs: { register: vi.fn() },
        slots: {
          inject: (_slotName: string, factory: () => unknown) => factory(),
          register: registerSlot,
        },
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('slot boom'));
  });
});
