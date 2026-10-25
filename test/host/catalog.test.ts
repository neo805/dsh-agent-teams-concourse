import { describe, expect, it } from 'vitest';
import { CatalogError, createCatalog } from '../../src/host/catalog.js';
import { FakeLLM } from '../fakes/llm.js';

/** 标准编程目录：两个 provider、三个模型、两档 effort。 */
function stdLlm(): FakeLLM {
  return new FakeLLM({
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
}

describe('host/catalog（FR-4.4 枚举 + fail-loud + 缓存 + 缺席降级）', () => {
  it('list() 枚举 provider/model/effort，按目录序展开为 ModelInfo', async () => {
    const catalog = createCatalog({ llm: stdLlm() });
    const list = await catalog.list();
    expect(list).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat', efforts: ['low', 'high'] },
      { provider: 'deepseek', model: 'deepseek-reasoner', efforts: [] },
      { provider: 'openai', model: 'gpt-5', efforts: ['medium'] },
    ]);
  });

  it('list() 带缓存：重复调用不再触发宿主探测', async () => {
    const llm = stdLlm();
    const catalog = createCatalog({ llm });
    await catalog.list();
    await catalog.list();
    await catalog.assertSupported('deepseek-chat');
    expect(llm.counters.listProviders).toBe(1);
  });

  it('assertSupported：已知 model（bare 与 provider/model 两种写法）与已知 effort 均通过', async () => {
    const catalog = createCatalog({ llm: stdLlm() });
    await expect(catalog.assertSupported('deepseek-chat')).resolves.toBeUndefined();
    await expect(catalog.assertSupported('deepseek/deepseek-chat')).resolves.toBeUndefined();
    await expect(catalog.assertSupported('deepseek-chat', 'high')).resolves.toBeUndefined();
  });

  it('assertSupported：指定 provider 时按 provider+model 路由，同名模型不串档', async () => {
    const catalog = createCatalog({
      llm: new FakeLLM({
        providers: [
          { id: 'p1', models: [{ id: 'shared-model', efforts: ['low'] }] },
          { id: 'p2', models: [{ id: 'shared-model', efforts: ['high'] }] },
        ],
      }),
    });
    await expect(catalog.assertSupported('shared-model', 'high', 'p2')).resolves.toBeUndefined();
    const err = await catalog.assertSupported('shared-model', 'high', 'p1').catch((e: unknown) => e);
    expect((err as CatalogError).code).toBe('UNSUPPORTED_EFFORT');
    const missing = await catalog.assertSupported('shared-model', undefined, 'ghost').catch((e: unknown) => e);
    expect((missing as CatalogError).code).toBe('UNSUPPORTED_MODEL');
  });

  it('assertSupported：未知 model fail-loud，message 附完整可选值列表', async () => {
    const catalog = createCatalog({ llm: stdLlm() });
    const err = await catalog.assertSupported('no-such-model').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogError);
    expect((err as CatalogError).code).toBe('UNSUPPORTED_MODEL');
    const msg = (err as Error).message;
    expect(msg).toContain('no-such-model');
    expect(msg).toContain('deepseek/deepseek-chat');
    expect(msg).toContain('deepseek/deepseek-reasoner');
    expect(msg).toContain('openai/gpt-5');
  });

  it('assertSupported：未知 effort fail-loud，message 附该模型已知档位', async () => {
    const catalog = createCatalog({ llm: stdLlm() });
    const err = await catalog.assertSupported('deepseek-chat', 'extreme').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogError);
    expect((err as CatalogError).code).toBe('UNSUPPORTED_EFFORT');
    const msg = (err as Error).message;
    expect(msg).toContain('extreme');
    expect(msg).toContain('low');
    expect(msg).toContain('high');
  });

  it('assertSupported：模型未声明 effort 档位时给定 effort 亦 fail-loud', async () => {
    const catalog = createCatalog({ llm: stdLlm() });
    const err = await catalog.assertSupported('deepseek-reasoner', 'low').catch((e: unknown) => e);
    expect((err as CatalogError).code).toBe('UNSUPPORTED_EFFORT');
  });

  it('缺席降级：deps.llm 缺席 → list() 空表，不崩溃；assertSupported 仍 fail-loud', async () => {
    const catalog = createCatalog({});
    await expect(catalog.list()).resolves.toEqual([]);
    const err = await catalog.assertSupported('anything').catch((e: unknown) => e);
    expect((err as CatalogError).code).toBe('UNSUPPORTED_MODEL');
  });

  it('缺席降级：listProviders / listModels / resolveModelInfo 缺失均不崩溃', async () => {
    const bare = createCatalog({ llm: new FakeLLM({ providers: [], omit: ['listProviders'] }) });
    await expect(bare.list()).resolves.toEqual([]);

    const noListModels = createCatalog({
      llm: new FakeLLM({ providers: [{ id: 'p', models: [{ id: 'm' }] }], omit: ['listModels'] }),
    });
    await expect(noListModels.list()).resolves.toEqual([]);

    const noResolve = createCatalog({
      llm: new FakeLLM({ providers: [{ id: 'p', models: [{ id: 'm', efforts: ['x'] }] }], omit: ['resolveModelInfo'] }),
    });
    // resolveModelInfo 缺席 → efforts 未知（空数组），模型仍可枚举
    await expect(noResolve.list()).resolves.toEqual([{ provider: 'p', model: 'm', efforts: [] }]);
  });

  it('单 provider 探测抛错不拖垮整表（跳过该 provider）', async () => {
    const llm = new FakeLLM({
      providers: [
        { id: 'bad', models: [{ id: 'x' }] },
        { id: 'good', models: [{ id: 'y', efforts: ['a'] }] },
      ],
    });
    llm.failListModelsFor = new Set(['bad']);
    const catalog = createCatalog({ llm });
    await expect(catalog.list()).resolves.toEqual([{ provider: 'good', model: 'y', efforts: ['a'] }]);
  });
});
