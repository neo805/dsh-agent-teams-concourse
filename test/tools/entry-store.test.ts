/**
 * 启动只读取一次事件存储：Ledger 与 replay 必须复用同一快照。
 */
import { describe, expect, test, vi } from 'vitest';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { LedgerEvent } from '../../src/service/ledger.js';
import { FakeSubagents } from '../fakes/subagents.js';

const storeSpy = vi.hoisted(() => ({
  load: vi.fn((): LedgerEvent[] => []),
  append: vi.fn(),
}));

vi.mock('../../src/service/persistence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/service/persistence.js')>();
  return {
    ...actual,
    createMemoryStore: () => ({ load: storeSpy.load, append: storeSpy.append }),
  };
});

import { apply } from '../../src/index.js';

describe('入口启动 I/O', () => {
  test('enabled=true 时全量事件只 load 一次', async () => {
    storeSpy.load.mockClear();
    storeSpy.append.mockClear();
    const registered: ToolDefinition[] = [];
    const ctx = {
      subagents: new FakeSubagents(),
      tools: {
        register(definition: ToolDefinition) {
          registered.push(definition);
          return () => undefined;
        },
      },
      logger: { warn: vi.fn() },
    };

    await apply(ctx, { enabled: true });

    expect(registered).toHaveLength(6);
    expect(storeSpy.load).toHaveBeenCalledTimes(1);
  });
});
