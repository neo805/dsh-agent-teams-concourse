import { describe, expect, it } from 'vitest';
import { FakeLLM } from './llm.js';

describe('test/fakes/llm（FakeLLM 可编程目录行为钉死）', () => {
  it('listProviders / listModels / resolveModelInfo 返回编程目录并计数', async () => {
    const llm = new FakeLLM({
      providers: [
        {
          id: 'deepseek',
          models: [
            { id: 'deepseek-chat', efforts: ['low', 'high'] },
            { id: 'deepseek-reasoner' },
          ],
        },
        { id: 'openai', models: [{ id: 'gpt-5', efforts: ['medium'] }] },
      ],
    });
    expect(llm.listProviders?.()).toEqual([{ id: 'deepseek' }, { id: 'openai' }]);
    expect(await llm.listModels?.('deepseek')).toEqual([
      expect.objectContaining({ provider: 'deepseek', id: 'deepseek-chat' }),
      expect.objectContaining({ provider: 'deepseek', id: 'deepseek-reasoner' }),
    ]);
    const info = await llm.resolveModelInfo?.('deepseek', 'deepseek-chat');
    expect(info?.reasoning?.efforts.map((e) => e.id)).toEqual(['low', 'high']);
    const noEffort = await llm.resolveModelInfo?.('deepseek', 'deepseek-reasoner');
    expect(noEffort?.reasoning).toBeUndefined();
    expect(llm.counters.listProviders).toBe(1);
    expect(llm.counters.listModels).toBe(1);
    expect(llm.counters.resolveModelInfo).toBe(2);
  });

  it('未知 provider/model fail-loud（抛错，便于测试目录装配错误尽早暴露）', async () => {
    const llm = new FakeLLM({ providers: [{ id: 'p', models: [{ id: 'm' }] }] });
    await expect(llm.listModels?.('nope')).rejects.toThrow('nope');
    await expect(llm.resolveModelInfo?.('p', 'nope')).rejects.toThrow('nope');
  });

  it('omit 选项可分别缺失 listModels / resolveModelInfo（模拟能力探测缺席）', () => {
    const a = new FakeLLM({ providers: [], omit: ['listModels'] });
    expect(a.listModels).toBeUndefined();
    expect(typeof a.resolveModelInfo).toBe('function');
    const b = new FakeLLM({ providers: [], omit: ['resolveModelInfo'] });
    expect(b.resolveModelInfo).toBeUndefined();
  });

  it('listProviders 可通过 omit 整体缺席', () => {
    const llm = new FakeLLM({ providers: [], omit: ['listProviders'] });
    expect(llm.listProviders).toBeUndefined();
  });
});
