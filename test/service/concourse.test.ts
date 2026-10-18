/**
 * service/concourse 测试 —— ConcourseService 生命周期状态机（TDD 先红后绿）。
 *
 * 覆盖：draft→pending-approval→running→archived 全转换、非法转换 typed error、
 * create 的 parse+validate+预算回填、approve 拓扑序拉起与失败回滚、台账留痕。
 */
import { describe, expect, it } from 'vitest';
import { ConcourseError, ConcourseService } from '../../src/service/concourse.js';
import { Ledger } from '../../src/service/ledger.js';
import { BudgetBook } from '../../src/kernel/comms/budget.js';
import { estimateConcourseBudget } from '../../src/kernel/budget/tokens.js';
import { parseConcourse, type ConcourseInput } from '../../src/kernel/topology/schema.js';
import { StubSubstrate, fakeClock } from './helpers.js';

/** 合法 T1b 样例输入（captain → lead → w-1），带一条任务用于预算回填。 */
function t1bInput(): ConcourseInput {
  return {
    id: 'c-t1b',
    tier: 'T1b',
    vertices: [
      { id: 'captain', origin: 'self' },
      { id: 'lead', parent: 'captain', layer: 1 },
      { id: 'w-1', parent: 'lead', layer: 2, reasoningEffort: 'low' },
    ],
    edges: [
      { from: 'captain', to: 'lead', mode: 'request-reply' },
      { from: 'lead', to: 'captain', mode: 'request-reply' },
      { from: 'lead', to: 'w-1' },
    ],
    tasks: [{ id: 't1', subject: '调研报告', assignee: 'w-1' }],
  };
}

function makeService(substrate = new StubSubstrate()) {
  const ledger = new Ledger({ now: fakeClock() });
  const service = new ConcourseService({ substrate, ledger, now: fakeClock() });
  return { service, ledger, substrate };
}

describe('ConcourseService.create', () => {
  it('合法 spec → draft；记录来自 spec 的 id', () => {
    const { service } = makeService();
    const rec = service.create(t1bInput());
    expect(rec.status).toBe('draft');
    expect(rec.concourse.id).toBe('c-t1b');
    expect(service.get('c-t1b').status).toBe('draft');
  });

  it('spec 缺 id → 注入 idGen 生成（默认计数器式可读 id，禁随机）', () => {
    const substrate = new StubSubstrate();
    const ledger = new Ledger({ now: fakeClock() });
    const ids: string[] = [];
    const service = new ConcourseService({
      substrate,
      ledger,
      now: fakeClock(),
      idGen: () => {
        const id = `gen-${ids.length + 1}`;
        ids.push(id);
        return id;
      },
    });
    const input = t1bInput() as Record<string, unknown>;
    delete input['id'];
    const rec = service.create(input);
    expect(rec.concourse.id).toBe('gen-1');
  });

  it('默认 idGen 为计数器式可读 id（concourse-1、concourse-2…）', () => {
    const { service } = makeService();
    const input = t1bInput() as Record<string, unknown>;
    delete input['id'];
    const r1 = service.create(input);
    const r2 = service.create({ ...t1bInput(), id: undefined } as Record<string, unknown>);
    expect(r1.concourse.id).toBe('concourse-1');
    expect(r2.concourse.id).toBe('concourse-2');
  });

  it('F5 回归：snapshot 回放后计数器播种，新 id 不撞已恢复的 concourse-N', () => {
    const substrate = new StubSubstrate();
    const ledger = new Ledger({ now: fakeClock() });
    const restored = parseConcourse({ ...t1bInput(), id: 'concourse-3' });
    const snapshot = {
      concourses: [
        {
          concourse: restored,
          status: 'pending-approval' as const,
          handles: [],
          budget: new BudgetBook({}),
        },
      ],
    };
    const service = new ConcourseService({ substrate, ledger, now: fakeClock(), snapshot });
    const input = t1bInput() as Record<string, unknown>;
    delete input['id'];
    const rec = service.create(input);
    // 播种到 3 → 下一个是 4，而不是与回放条目撞号的 1
    expect(rec.concourse.id).toBe('concourse-4');
  });

  it('F5 回归：自动 id 撞号即跳过（手工命名的 concourse-N 不阻塞自动生成）', () => {
    const { service } = makeService();
    // 手工占用 concourse-1 / concourse-2
    service.create({ ...t1bInput(), id: 'concourse-1' } as Record<string, unknown>);
    service.create({ ...t1bInput(), id: 'concourse-2' } as Record<string, unknown>);
    const input = t1bInput() as Record<string, unknown>;
    delete input['id'];
    const rec = service.create(input);
    expect(rec.concourse.id).toBe('concourse-3');
  });

  it('F4 回归：结构非法 → issues 为规范化 SCHEMA 列表（含 path），message 不再内嵌整段 JSON', () => {
    const { service } = makeService();
    try {
      service.create({ id: 'x', tier: 'T9', vertices: [] });
      expect.unreachable('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(ConcourseError);
      const ce = err as ConcourseError;
      expect(ce.code).toBe('INVALID_SPEC');
      expect(ce.issues?.length).toBeGreaterThan(0);
      expect(ce.issues?.every((i) => i.code === 'SCHEMA')).toBe(true);
      expect(ce.issues?.some((i) => i.path !== undefined && i.path.length > 0)).toBe(true);
      // message 是单行中文摘要，不含 zod 的 JSON 数组
      expect(ce.message).not.toContain('[\n');
      expect(ce.message.length).toBeLessThan(300);
    }
  });

  it('F2 回归：spec 内部未知字段 → UNKNOWN_FIELD issue（附 did-you-mean）', () => {
    const { service } = makeService();
    const bad = { ...t1bInput(), vertces: [] } as Record<string, unknown>;
    delete bad['vertices'];
    try {
      service.create(bad);
      expect.unreachable('应当抛错');
    } catch (err) {
      const ce = err as ConcourseError;
      expect(ce.code).toBe('INVALID_SPEC');
      const hit = ce.issues?.find((i) => i.code === 'UNKNOWN_FIELD');
      expect(hit).toBeDefined();
      expect(hit?.path).toBe('vertces');
      expect(hit?.message).toContain('vertices');
    }
  });

  it('语义校验有 issue → throw ConcourseError(INVALID_SPEC) 附 issue 列表', () => {
    const { service } = makeService();
    const bad = t1bInput();
    (bad.vertices as { parent?: string }[])[1]!.parent = 'ghost';
    try {
      service.create(bad);
      expect.unreachable('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(ConcourseError);
      const ce = err as ConcourseError;
      expect(ce.code).toBe('INVALID_SPEC');
      expect(ce.issues?.some((i) => i.code === 'DANGLING_PARENT')).toBe(true);
    }
  });

  it('zod 结构非法 → ConcourseError(INVALID_SPEC)', () => {
    const { service } = makeService();
    expect(() => service.create({ id: 'x' })).toThrowError(ConcourseError);
  });

  it('顶点/全局预算经 kernel tokens 估算回填（缺省才填）', () => {
    const { service } = makeService();
    const rec = service.create(t1bInput());
    const parsed = parseConcourse(t1bInput());
    const est = estimateConcourseBudget(parsed);
    // w-1 无预算声明 → 回填估算（reasoningEffort=low ×0.6）
    const w1 = rec.concourse.vertices.find((v) => v.id === 'w-1');
    expect(w1?.budget?.tokens).toBe(Math.ceil(est.perVertex['w-1'] ?? 0));
    // 无任务顶点不回填
    expect(rec.concourse.vertices.find((v) => v.id === 'captain')?.budget).toBeUndefined();
    // concourse 未声明总预算 → 回填估算总和
    expect(rec.concourse.budget?.tokens).toBe(Math.ceil(est.total));
  });

  it('已声明的预算不被回填覆盖', () => {
    const { service } = makeService();
    const input = t1bInput();
    (input.vertices as { budget?: { tokens: number } }[])[2]!.budget = { tokens: 999 };
    input.budget = { tokens: 100000 };
    const rec = service.create(input);
    expect(rec.concourse.vertices.find((v) => v.id === 'w-1')?.budget?.tokens).toBe(999);
    expect(rec.concourse.budget?.tokens).toBe(100000);
  });
});

describe('生命周期转换', () => {
  it('draft → submit → pending-approval → approve → running → archive → archived', async () => {
    const { service, substrate } = makeService();
    service.create(t1bInput());
    service.submit('c-t1b');
    expect(service.get('c-t1b').status).toBe('pending-approval');
    const handles = await service.approve('c-t1b', { fake: 'parent' });
    expect(service.get('c-t1b').status).toBe('running');
    expect(handles).toHaveLength(2);
    expect(substrate.started.map((s) => s.vertexId)).toEqual(['lead', 'w-1']);
    service.archive('c-t1b');
    expect(service.get('c-t1b').status).toBe('archived');
  });

  it.each([
    ['submit', 'pending-approval'],
    ['approve', 'draft'],
    ['reject', 'draft'],
    ['archive', 'archived'],
  ])('非法转换 %s（处于 %s）→ ConcourseError(ILLEGAL_TRANSITION)', async (op, setupStatus) => {
    const { service } = makeService();
    service.create(t1bInput());
    if (setupStatus !== 'draft') service.submit('c-t1b');
    if (setupStatus === 'archived') {
      service.archive('c-t1b');
    }
    const act = async () => {
      if (op === 'submit') service.submit('c-t1b');
      else if (op === 'approve') await service.approve('c-t1b', null);
      else if (op === 'reject') service.reject('c-t1b');
      else service.archive('c-t1b');
    };
    await expect(act()).rejects.toBeInstanceOf(ConcourseError);
    await expect(act()).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });

  it('reject：pending-approval → draft（可再次 submit）', () => {
    const { service } = makeService();
    service.create(t1bInput());
    service.submit('c-t1b');
    service.reject('c-t1b');
    expect(service.get('c-t1b').status).toBe('draft');
    service.submit('c-t1b');
    expect(service.get('c-t1b').status).toBe('pending-approval');
  });

  it('archive running concourse → 已拉起顶点被 interrupt（尽力而为）', async () => {
    const { service, substrate } = makeService();
    service.create(t1bInput());
    service.submit('c-t1b');
    await service.approve('c-t1b', null);
    service.archive('c-t1b');
    expect(substrate.interrupted).toEqual(['lead', 'w-1']);
  });

  it('get/list：list 返回全部记录；get 未知 id → ConcourseError(NOT_FOUND)', async () => {
    const { service } = makeService();
    service.create(t1bInput());
    service.create({ ...t1bInput(), id: 'c-2' });
    expect(service.list().map((r) => r.concourse.id)).toEqual(['c-t1b', 'c-2']);
    expect(() => service.get('ghost')).toThrowError(ConcourseError);
    try {
      service.get('ghost');
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as ConcourseError).code).toBe('NOT_FOUND');
    }
  });
});

describe('approve 语义', () => {
  it('按拓扑序拉起：layer 升序（父先于子）；origin=self 顶点跳过（领队本身）', async () => {
    const { service, substrate, ledger } = makeService();
    service.create(t1bInput());
    service.submit('c-t1b');
    await service.approve('c-t1b', null);
    const layers = substrate.started.map((s) => s.vertexId);
    // self 根顶点不拉起子代理，仅台账留痕
    expect(layers).not.toContain('captain');
    expect(ledger.all().some((e) => e.action === 'vertex-self' && e.detail['vertexId'] === 'captain')).toBe(true);
    expect(layers.indexOf('lead')).toBeLessThan(layers.indexOf('w-1'));
  });

  it('VertexStart 逐顶点定档透传（model/reasoningEffort/toolFilter/maxDepth）', async () => {
    const { service, substrate } = makeService();
    const input = t1bInput();
    (input.vertices as Record<string, unknown>[])[2] = {
      ...(input.vertices as Record<string, unknown>[])[2]!,
      model: 'kimi-k3',
      reasoningEffort: 'high',
      toolFilter: { deny: ['send_message'] },
      maxDepth: 3,
    };
    service.create(input);
    service.submit('c-t1b');
    await service.approve('c-t1b', null);
    const w1 = substrate.started.find((s) => s.vertexId === 'w-1');
    expect(w1?.model).toBe('kimi-k3');
    expect(w1?.reasoningEffort).toBe('high');
    expect(w1?.toolFilter).toEqual({ deny: ['send_message'] });
    expect(w1?.maxDepth).toBe(3);
    // 未定档顶点不带这些键（继承父代理）
    const lead = substrate.started.find((s) => s.vertexId === 'lead');
    expect(lead).not.toHaveProperty('model');
    expect(lead).not.toHaveProperty('reasoningEffort');
  });

  it('台账记录 requested vs effective（inherit 可辨）', async () => {
    const { service, ledger } = makeService();
    service.create(t1bInput()); // w-1 reasoningEffort=low，无 model
    service.submit('c-t1b');
    await service.approve('c-t1b', null);
    const rve = ledger.requestedVsEffective('w-1');
    expect(rve?.requested).toEqual({ model: null, reasoningEffort: 'low' });
    expect(rve?.effective).toEqual({ model: 'inherit', reasoningEffort: 'low' });
    const cap = ledger.requestedVsEffective('captain');
    expect(cap).toBeUndefined(); // self 顶点不拉起，无 requested-vs-effective 记录
  });

  it('任一顶点拉起失败 → 已拉起顶点 interrupt 回滚 + typed error，状态停回 pending-approval', async () => {
    const substrate = new StubSubstrate();
    substrate.failOn.add('w-1');
    const { service } = makeService(substrate);
    service.create(t1bInput());
    service.submit('c-t1b');
    try {
      await service.approve('c-t1b', null);
      expect.unreachable('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(ConcourseError);
      expect((err as ConcourseError).code).toBe('APPROVE_FAILED');
      expect((err as ConcourseError).causeCode).toBe('START_FAILED');
    }
    // captain、lead 已拉起 → 回滚中断
    expect(substrate.interrupted).toEqual(['lead']);
    expect(service.get('c-t1b').status).toBe('pending-approval');
  });

  it('回滚与失败均写台账留痕', async () => {
    const substrate = new StubSubstrate();
    substrate.failOn.add('lead');
    const ledger = new Ledger({ now: fakeClock() });
    const service = new ConcourseService({ substrate, ledger, now: fakeClock() });
    service.create(t1bInput());
    service.submit('c-t1b');
    await expect(service.approve('c-t1b', null)).rejects.toBeInstanceOf(ConcourseError);
    const actions = ledger.query({ concourseId: 'c-t1b' }).map((e) => e.action);
    expect(actions).toContain('rollback');
    expect(actions).toContain('approve-failed');
  });
});
