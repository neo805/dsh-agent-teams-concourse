/**
 * test/tools/entry — src/index.ts cordis 入口接线测试。
 *
 * NFR-1：enabled 缺省/false 时零副作用；NFR-2：单步失败只 warn 不 throw、不拖垮其余步骤。
 */
import { describe, expect, test } from 'vitest';
import { apply, inject, name } from '../../src/index.js';
import { CONCOURSE_PROVIDER_NAME } from '../../src/host/contracts.js';
import { FakeSubagents } from '../fakes/subagents.js';

interface FakeCtx {
  subagents: FakeSubagents;
  tools: {
    registered: unknown[];
    failOn?: string;
    register(def: { name: string }): () => void;
  };
  logger: { warns: string[]; warn(m: string): void };
}

function makeCtx(): FakeCtx {
  return {
    subagents: new FakeSubagents(),
    tools: {
      registered: [],
      register(def: { name: string }) {
        if (this.failOn === def.name) throw new Error(`register ${def.name} boom`);
        this.registered.push(def);
        return () => undefined;
      },
    },
    logger: {
      warns: [],
      warn(m: string) {
        this.warns.push(m);
      },
    },
  };
}

describe('cordis 入口', () => {
  test('导出契约：name + inject 声明所需服务', () => {
    expect(name).toBe('dsh-agent-teams-concourse');
    expect([...inject]).toEqual(expect.arrayContaining(['subagents', 'llm', 'tools']));
  });

  test('NFR-1：enabled 缺省 → 零副作用', async () => {
    const ctx = makeCtx();
    await apply(ctx, {});
    expect(ctx.subagents.registerCalls).toHaveLength(0);
    expect(ctx.tools.registered).toHaveLength(0);
    expect(ctx.logger.warns).toHaveLength(0);
  });

  test('NFR-1：enabled=false → 零副作用', async () => {
    const ctx = makeCtx();
    await apply(ctx, { enabled: false });
    expect(ctx.subagents.registerCalls).toHaveLength(0);
    expect(ctx.tools.registered).toHaveLength(0);
  });

  test('enabled=true：registerProvider(concourse) + 注册 6 个 team_* 工具 + 无 warn', async () => {
    const ctx = makeCtx();
    await apply(ctx, { enabled: true });
    expect(ctx.subagents.registerCalls).toHaveLength(1);
    expect((ctx.subagents.registerCalls[0] as { name: string }).name).toBe(CONCOURSE_PROVIDER_NAME);
    const toolNames = ctx.tools.registered.map((t) => (t as { name: string }).name).sort();
    expect(toolNames).toEqual(
      ['team_assign', 'team_link', 'team_plan', 'team_send', 'team_status', 'team_topology'],
    );
    expect(ctx.logger.warns).toHaveLength(0);
  });

  test('NFR-2：registerProvider 抛错 → 只 warn，工具照常注册', async () => {
    const ctx = makeCtx();
    ctx.subagents.registerProvider = () => {
      throw new Error('provider boom');
    };
    await apply(ctx, { enabled: true });
    expect(ctx.logger.warns.length).toBeGreaterThan(0);
    expect(ctx.logger.warns[0]).toContain('boom');
    // 其余步骤不受影响
    expect(ctx.tools.registered).toHaveLength(6);
  });

  test('NFR-2：tools.register 抛错 → apply 不 throw，provider 已注册', async () => {
    const ctx = makeCtx();
    ctx.tools.failOn = 'team_topology';
    await apply(ctx, { enabled: true });
    expect(ctx.subagents.registerCalls).toHaveLength(1);
    expect(ctx.logger.warns.some((w) => w.includes('boom'))).toBe(true);
  });

  test('NFR-2：ctx 整体为 null → 不 throw（全降级）', async () => {
    await apply(null, { enabled: true });
  });

  test('回归（真机冒烟实证）：cordis 对未声明 inject 的属性取值抛错 → 装配仍完整', async () => {
    // cordis context 对未在 inject 声明的属性（如 storageDir）取值直接 throw；
    // 探测失败必须只降级内存存储，不得拖垮 ledger/service/tools 步骤。
    const ctx = makeCtx();
    const guarded = new Proxy(ctx as object, {
      get(target, prop, receiver) {
        if (prop === 'storageDir') throw new Error('cannot get property without inject');
        return Reflect.get(target, prop, receiver);
      },
    });
    await apply(guarded, { enabled: true });
    expect(ctx.subagents.registerCalls).toHaveLength(1);
    expect(ctx.tools.registered).toHaveLength(6);
  });
});
