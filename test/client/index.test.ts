// @vitest-environment jsdom
/**
 * 客户端入口 apply(ctx)：注册 sidebar.right.pane.tab 页型 + keyed 面板体。
 * 防御式：宿主服务缺席时不抛错（NFR-2 同款纪律）。
 */
import { describe, expect, it, vi } from 'vitest';
import { apply, inject, name } from '../../src/client/index.js';

describe('client/index apply', () => {
  it('声明 cordis inject：sidebarRightTabs + slots', () => {
    expect(inject).toEqual(['sidebarRightTabs', 'slots']);
    expect(name).toBe('dsh-agent-teams-concourse-client');
  });

  it('注册 concourse 页型（sidebarRightTabs.register）与 keyed 面板体（slots）', () => {
    const registerTab = vi.fn();
    const registerSlot = vi.fn();
    const injectSlot = vi.fn((slotName: string, factory: () => unknown) => {
      factory();
      return undefined;
    });
    apply({ sidebarRightTabs: { register: registerTab }, slots: { inject: injectSlot, register: registerSlot } });
    // 页型定义：kind + 标题
    expect(registerTab).toHaveBeenCalledTimes(1);
    const definition = registerTab.mock.calls[0]?.[0] as {
      id: string;
      kind: string;
      title: (address: string) => string;
    };
    expect(definition.kind).toBe('concourse');
    expect(typeof definition.title).toBe('function');
    expect(definition.title('sidebar://concourse')).toContain('Concourse');
    // keyed slot：sidebar.right.pane.tab 下按同一 id 注册
    expect(injectSlot).toHaveBeenCalledWith('sidebar.right.pane.tab', expect.any(Function));
    expect(registerSlot).toHaveBeenCalledTimes(1);
    const slotDef = registerSlot.mock.calls[0]?.[0] as { name: string; id: string };
    expect(slotDef.name).toBe('sidebar.right.pane.tab');
    expect(slotDef.id).toBe(definition.id);
  });

  it('宿主服务缺席时不抛错（undefined / 空对象 / 半残对象）', () => {
    expect(() => apply(undefined)).not.toThrow();
    expect(() => apply({})).not.toThrow();
    expect(() => apply({ sidebarRightTabs: {} })).not.toThrow();
    expect(() => apply({ slots: {} })).not.toThrow();
  });

  it('注册动作自身抛错被吞掉（不阻断宿主装配其它插件）', () => {
    expect(() =>
      apply({
        sidebarRightTabs: {
          register: () => {
            throw new Error('boom');
          },
        },
        slots: { inject: vi.fn(), register: vi.fn() },
      }),
    ).not.toThrow();
  });
});
