/**
 * test/fakes/llm — FakeLLM：宿主 ctx.llm 能力探测面的可编程伪实现。
 *
 * 形态镜像 dsh-llm LlmRuntime 的只读目录方法（结构性子集）：
 *   listProviders() → { id }[]
 *   listModels(provider) → { provider, id, name }[]
 *   resolveModelInfo(provider, model) → { ..., reasoning?: { efforts: { id, name }[] } }
 *
 * 可编程项：
 *   · providers 目录（provider → models → efforts）；
 *   · omit：让某个方法整体缺席（模拟能力探测方法缺失）；
 *   · failListModelsFor：指定 provider 的 listModels 抛错（单点失败不拖垮整表）。
 * 未编程的 provider/model 一律 fail-loud 抛错，尽早暴露测试目录装配错误。
 */

export interface FakeModelSpec {
  id: string;
  /** 官方目录支持的 reasoningEffort 档位；省略 = 未知/不支持。 */
  efforts?: readonly string[];
}

export interface FakeProviderSpec {
  id: string;
  models: readonly FakeModelSpec[];
}

export interface FakeLLMOptions {
  providers: readonly FakeProviderSpec[];
  /** 让指定方法缺席（不出现在实例上）。 */
  omit?: readonly ('listProviders' | 'listModels' | 'resolveModelInfo')[];
}

type MethodName = 'listProviders' | 'listModels' | 'resolveModelInfo';

export class FakeLLM {
  /** 各探测方法被调次数（缓存测试断言用）。 */
  readonly counters: Record<MethodName, number> = {
    listProviders: 0,
    listModels: 0,
    resolveModelInfo: 0,
  };

  /** 命中集合内 provider 时 listModels 抛错。 */
  failListModelsFor?: ReadonlySet<string>;

  private readonly providers: readonly FakeProviderSpec[];

  listProviders?(): { id: string }[];
  listModels?(provider: string): Promise<{ provider: string; id: string; name: string }[]>;
  resolveModelInfo?(
    provider: string,
    model: string,
  ): Promise<{
    provider: string;
    id: string;
    name: string;
    reasoning?: { efforts: { id: string; name: string }[] };
  }>;

  constructor(options: FakeLLMOptions) {
    this.providers = options.providers;
    const omit = new Set<MethodName>(options.omit ?? []);

    if (!omit.has('listProviders')) {
      this.listProviders = () => {
        this.counters.listProviders += 1;
        return this.providers.map((p) => ({ id: p.id }));
      };
    }

    if (!omit.has('listModels')) {
      this.listModels = (provider: string) => {
        this.counters.listModels += 1;
        if (this.failListModelsFor?.has(provider) === true) {
          return Promise.reject(new Error(`fake llm: listModels("${provider}") 探测失败（编程注入）`));
        }
        const p = this.providers.find((x) => x.id === provider);
        if (p === undefined) {
          return Promise.reject(new Error(`fake llm: 未编程的 provider "${provider}"`));
        }
        return Promise.resolve(p.models.map((m) => ({ provider: p.id, id: m.id, name: m.id })));
      };
    }

    if (!omit.has('resolveModelInfo')) {
      this.resolveModelInfo = (provider: string, model: string) => {
        this.counters.resolveModelInfo += 1;
        const p = this.providers.find((x) => x.id === provider);
        const m = p?.models.find((x) => x.id === model);
        if (p === undefined || m === undefined) {
          return Promise.reject(new Error(`fake llm: 未编程的模型 "${provider}/${model}"`));
        }
        return Promise.resolve({
          provider: p.id,
          id: m.id,
          name: m.id,
          ...(m.efforts !== undefined
            ? { reasoning: { efforts: m.efforts.map((e) => ({ id: e, name: e })) } }
            : {}),
        });
      };
    }
  }
}
