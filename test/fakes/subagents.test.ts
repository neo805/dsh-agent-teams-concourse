import { describe, expect, it } from 'vitest';
import { FakeSubagents } from './subagents.js';

/** 伪 parent（宿主 Agent 对测试不透明，只需可辨识身份）。 */
const parent = { id: 'parent-session-1' };

describe('test/fakes/subagents（FakeSubagents 行为钉死）', () => {
  it('registerProvider 记录全部调用并返回 dispose 函数', () => {
    const fake = new FakeSubagents();
    const p1 = { name: 'concourse' };
    const p2 = { name: 'spawn' };
    const d1 = fake.registerProvider(p1);
    fake.registerProvider(p2);
    expect(fake.registerCalls).toEqual([p1, p2]);
    expect(typeof d1).toBe('function');
    expect(() => d1()).not.toThrow();
  });

  it('startContinuable 记录 spec 并按序分配确定性 childId', async () => {
    const fake = new FakeSubagents();
    const signal = new AbortController().signal;
    const spec = {
      provider: 'concourse',
      label: 'v-1',
      request: { prompt: [{ type: 'text', text: 'hi' }], parent },
      signal,
    };
    const r1 = await fake.startContinuable(spec);
    const r2 = await fake.startContinuable(spec);
    expect(r1.childId).toBe('child-1');
    expect(r2.childId).toBe('child-2');
    expect(fake.startCalls).toHaveLength(2);
    expect(fake.startCalls[0]?.spec).toBe(spec);
  });

  it('startError 设置后 startContinuable 抛出指定错误（同一引用）', async () => {
    const fake = new FakeSubagents();
    const boom = new Error('宿主 fail-loud：model 不在白名单');
    fake.startError = boom;
    await expect(
      fake.startContinuable({
        provider: 'concourse',
        label: 'x',
        request: { prompt: [], parent },
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(boom);
    // 调用仍然被记录
    expect(fake.startCalls).toHaveLength(1);
  });

  it('sendMessage / interrupt 记录调用；sendError / interruptError 生效', async () => {
    const fake = new FakeSubagents();
    const opts = { signal: new AbortController().signal };
    await fake.sendMessage(parent, 'child-1', [{ type: 'text', text: 'go' }], opts);
    fake.interrupt('child-1', parent);
    expect(fake.sendCalls).toHaveLength(1);
    expect(fake.sendCalls[0]?.targetId).toBe('child-1');
    expect(fake.interruptCalls).toEqual([{ targetId: 'child-1', authority: parent }]);

    fake.sendError = new Error('send boom');
    await expect(fake.sendMessage(parent, 'child-1', [], opts)).rejects.toThrow('send boom');
    fake.interruptError = new Error('interrupt boom');
    expect(() => fake.interrupt('child-1', parent)).toThrow('interrupt boom');
  });

  it('ctxLike.subagents 形态：字段即 fake 自身', () => {
    const fake = new FakeSubagents();
    expect(fake.ctxLike.subagents).toBe(fake);
  });
});
