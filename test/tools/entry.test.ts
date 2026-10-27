/**
 * test/tools/entry — src/index.ts cordis 入口接线测试。
 *
 * NFR-1：enabled 缺省/false 时零副作用；NFR-2：单步失败只 warn 不 throw、不拖垮其余步骤。
 */
import { describe, expect, test } from 'vitest';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { apply, inject, name } from '../../src/index.js';
import { CONCOURSE_PROVIDER_NAME } from '../../src/host/contracts.js';
import { FakeSubagents } from '../fakes/subagents.js';
import { SAMPLE_SPEC, fakeExec } from './helpers.js';

type Listener = (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>;

interface FakeCtx {
  subagents: FakeSubagents;
  tools: {
    registered: ToolDefinition[];
    active: Set<string>;
    failOn?: string;
    register(def: ToolDefinition): () => void;
  };
  logger: { warns: string[]; warn(m: string): void };
  listeners: { event: string; listener: Listener }[];
  on(event: string, listener: Listener): () => void;
}

function makeCtx(): FakeCtx {
  const listeners: { event: string; listener: Listener }[] = [];
  return {
    subagents: new FakeSubagents(),
    tools: {
      registered: [],
      active: new Set<string>(),
      register(def: ToolDefinition) {
        if (this.failOn === def.name) throw new Error(`register ${def.name} boom`);
        this.registered.push(def);
        this.active.add(def.name);
        return () => {
          this.active.delete(def.name);
        };
      },
    },
    logger: {
      warns: [],
      warn(m: string) {
        this.warns.push(m);
      },
    },
    listeners,
    on(event, listener) {
      listeners.push({ event, listener });
      return () => undefined;
    },
  };
}

describe('cordis 入口', () => {
  test('导出契约：name + inject 声明所需服务（含 0.2.1 起的 agents）', () => {
    expect(name).toBe('dsh-agent-teams-concourse');
    expect([...inject]).toEqual(expect.arrayContaining(['subagents', 'agents', 'llm', 'tools']));
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
    expect(ctx.listeners.map((l) => l.event)).toContain('agent/pre-step');
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

  test('NFR-2：工具组中途注册失败 → 已注册项全部回滚，provider 与 pre-step 继续装配', async () => {
    const ctx = makeCtx();
    ctx.tools.failOn = 'team_assign';
    await apply(ctx, { enabled: true });
    expect(ctx.tools.active.size).toBe(0);
    expect(ctx.subagents.registerCalls).toHaveLength(1);
    expect(ctx.listeners.map((l) => l.event)).toContain('agent/pre-step');
    expect(ctx.logger.warns.some((w) => w.includes('team_assign') && w.includes('boom'))).toBe(true);
  });

  test('NFR-2：ctx 整体为 null → 不 throw（全降级）', async () => {
    await apply(null, { enabled: true });
  });

  test('真实入口接线：agent/pre-step 过滤官方闭边 agent-message', async () => {
    const ctx = makeCtx();
    await apply(ctx, { enabled: true });
    const tool = (toolName: string): ToolDefinition => {
      const found = ctx.tools.registered.find((d) => d.name === toolName);
      if (found === undefined) throw new Error(`missing tool ${toolName}`);
      return found;
    };
    await tool('team_plan').execute({ spec: SAMPLE_SPEC }, fakeExec());
    await tool('team_assign').execute({ id: 'demo' }, fakeExec({ id: 'root-agent' }));

    const gate = ctx.listeners.find((l) => l.event === 'agent/pre-step');
    expect(gate).toBeDefined();
    const message = createUserMessage({
      content: [{ type: 'text', text: 'official bypass' }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: 'child-1' } as never,
    });
    const decision = (await gate!.listener(
      { agent: { id: 'child-2' } },
      async () => ({ kind: 'enter', messages: [message] }),
    )) as { kind: string; messages?: unknown[] };
    expect(decision.kind === 'reject' || (decision.messages?.length ?? 0) === 0).toBe(true);

    // 混合批：用户消息保留，闭边 agent-message 被移除（走 filtered>0 分支）。
    const userMessage = createUserMessage({
      content: [{ type: 'text', text: 'human input' }],
      source: { kind: 'user' } as never,
    });
    const mixed = (await gate!.listener(
      { agent: { id: 'child-2' } },
      async () => ({ kind: 'enter', messages: [userMessage, message] }),
    )) as { kind: string; messages?: unknown[] };
    expect(mixed.kind).toBe('enter');
    expect(mixed.messages).toEqual([userMessage]);

    // 上游已拒绝 / 无 agent / 空消息：原样返回，不重复判定。
    const rejected = { kind: 'reject' as const };
    await expect(gate!.listener({ agent: { id: 'child-2' } }, async () => rejected)).resolves.toBe(rejected);
    await expect(gate!.listener({}, async () => ({ kind: 'enter', messages: [message] }))).resolves.toMatchObject({
      kind: 'enter',
    });
    await expect(
      gate!.listener({ agent: { id: 'child-2' } }, async () => ({ kind: 'enter', messages: [] })),
    ).resolves.toMatchObject({ kind: 'enter' });
  });

  test('RC8-1 真实入口：官方 never 消息重排到目标 inbox，下一轮凭票据进入模型', async () => {
    const ctx = makeCtx();
    await apply(ctx, { enabled: true });
    const tool = (toolName: string): ToolDefinition => {
      const found = ctx.tools.registered.find((d) => d.name === toolName);
      if (found === undefined) throw new Error(`missing tool ${toolName}`);
      return found;
    };
    const neverSpec = {
      ...SAMPLE_SPEC,
      edges: [{ from: 'lead', to: 'a', mode: 'notify', wake: 'never', hopTTL: 2 }],
    };
    await tool('team_plan').execute({ spec: neverSpec }, fakeExec());
    await tool('team_assign').execute({ id: 'demo' }, fakeExec({ id: 'root-agent' }));

    const gate = ctx.listeners.find((l) => l.event === 'agent/pre-step');
    expect(gate).toBeDefined();
    const appended: { target: string; message: unknown }[] = [];
    const targetAgent = {
      id: 'child-1',
      inbox: {
        append(t: string, message: unknown) {
          appended.push({ target: t, message });
        },
      },
    };
    const raw = createUserMessage({
      content: [{ type: 'text', text: 'official never' }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: 'root-agent' } as never,
    });
    const first = (await gate!.listener(
      { agent: targetAgent },
      async () => ({ kind: 'enter', messages: [raw] }),
    )) as { kind: string; messages?: unknown[] };
    expect(first.kind).toBe('reject');
    expect(appended).toHaveLength(1);
    expect(appended[0]?.target).toBe('next-turn');
    const ticketed = appended[0]?.message as {
      source?: { kind?: string; concourse?: { id?: string; admissionId?: string } };
    };
    expect(ticketed.source?.kind).toBe('agent-message');
    expect(ticketed.source?.concourse?.id).toBe('demo');
    expect(ticketed.source?.concourse?.admissionId).toMatch(/^[0-9a-f-]{36}$/);

    const second = (await gate!.listener(
      { agent: targetAgent },
      async () => ({ kind: 'enter', messages: [ticketed] }),
    )) as { kind: string; messages?: unknown[] };
    expect(second.kind).toBe('enter');
    expect(second.messages).toEqual([ticketed]);
    expect(appended).toHaveLength(1);
  });

  test('宿主 ctx.on 缺席：跳过 inbound gate 分支，不产生 warn', async () => {
    const ctx = makeCtx();
    ctx.on = undefined as never;
    await apply(ctx, { enabled: true });
    expect(ctx.tools.registered).toHaveLength(6);
    expect(ctx.logger.warns).toHaveLength(0);
  });

  test('NFR-2：agent/pre-step 注册抛错 → 只 warn，provider 与工具仍完整', async () => {
    const ctx = makeCtx();
    ctx.on = () => {
      throw new Error('pre-step registration boom');
    };
    await apply(ctx, { enabled: true });
    expect(ctx.subagents.registerCalls).toHaveLength(1);
    expect(ctx.tools.registered).toHaveLength(6);
    expect(ctx.logger.warns.some((w) => w.includes('inbound-gate'))).toBe(true);
  });
});
