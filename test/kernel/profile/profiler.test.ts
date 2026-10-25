/**
 * kernel/profile/profiler 测试（先写测试，TDD）。
 * 关键背景（auto-router 教训）：信号必须对短、口语化中文有效；
 * 禁止 \b 单词边界（CJK 永不成立），用 includes / 无边界正则。
 */
import { describe, expect, it } from 'vitest';
import { profileTask } from '../../../src/kernel/profile/profiler.js';

describe('profileTask · 风险与安全', () => {
  it('安全类词 → risk=security 且 determinism=high 且 cognitive≥4，signals 留可解释条目', () => {
    const p = profileTask({ text: '对整个鉴权模块做一次安全审计' });
    expect(p.risk).toBe('security');
    expect(p.determinism).toBe('high');
    expect(p.cognitive).toBeGreaterThanOrEqual(4);
    expect(p.signals.some((s) => s.startsWith('security:') && s.includes('安全') && s.includes('审计'))).toBe(true);
  });

  it('安全类优先于破坏类：同时命中时 risk=security', () => {
    const p = profileTask({ text: '审计后批量删除硬编码的密钥' });
    expect(p.risk).toBe('security');
  });

  it('英文 security/audit 同样命中（大小写不敏感）', () => {
    const p = profileTask({ text: 'do a Security Audit of the auth pipeline' });
    expect(p.risk).toBe('security');
  });

  it('破坏类词 → risk=destructive', () => {
    const p = profileTask({ text: '把旧订单表 migrate 到新库，清空历史分区' });
    expect(p.risk).toBe('destructive');
    expect(p.signals.some((s) => s.startsWith('destructive:'))).toBe(true);
  });

  it('只读类词 → risk=readonly 且 determinism=low', () => {
    const p = profileTask({ text: '帮我总结一下这篇文章的重点' });
    expect(p.risk).toBe('readonly');
    expect(p.determinism).toBe('low');
    expect(p.signals.some((s) => s.startsWith('readonly:') && s.includes('总结'))).toBe(true);
  });

  it('无关键词 → 默认 reversible / determinism mid', () => {
    const p = profileTask({ text: '给按钮换个颜色' });
    expect(p.risk).toBe('reversible');
    expect(p.determinism).toBe('mid');
  });
});

describe('profileTask · 认知与广度', () => {
  it('英文实施词按词边界：fixture/prefix 不误判，fix the bug 仍命中', () => {
    const readonly = profileTask({ text: 'analyze the fixture prefix only' });
    expect(readonly.cognitive).toBe(2);
    expect(readonly.signals.some((s) => s.startsWith('implement:'))).toBe(false);

    const implementation = profileTask({ text: 'fix the bug' });
    expect(implementation.cognitive).toBe(3);
    expect(implementation.signals.some((s) => s.startsWith('implement:') && s.includes('fix'))).toBe(true);
  });

  it('实施类词 → cognitive+1（默认 2 → 3）', () => {
    const p = profileTask({ text: '实现一个登录接口' });
    expect(p.cognitive).toBe(3);
    expect(p.signals.some((s) => s.startsWith('implement:') && s.includes('实现'))).toBe(true);
  });

  it('紧凑枚举 "1做A 2做B 3做C" ≥3 → breadth+2 且 parallelism=parallel', () => {
    const p = profileTask({ text: '1做登录 2做注册 3做找回密码' });
    expect(p.parallelism).toBe('parallel');
    expect(p.breadth).toBeGreaterThanOrEqual(3);
    expect(p.signals.some((s) => s.startsWith('structure:'))).toBe(true);
  });

  it('顿号/分号并列 ≥3 → breadth+2', () => {
    const p = profileTask({ text: '支持登录、注册、找回、注销' });
    expect(p.breadth).toBeGreaterThanOrEqual(3);
    expect(p.parallelism).toBe('parallel');
  });

  it('markdown 列表行 ≥3 → breadth+2', () => {
    const p = profileTask({ text: '- 登录\n- 注册\n- 找回密码' });
    expect(p.parallelism).toBe('parallel');
    expect(p.breadth).toBeGreaterThanOrEqual(3);
  });

  it('口语并列连词（然后/另外/再把…）≥2 → breadth+1 但不一定 parallel', () => {
    const p = profileTask({ text: '先加个按钮，然后接下接口，另外把样式调下' });
    expect(p.breadth).toBe(2);
    expect(p.parallelism).toBe('serial');
    expect(p.signals.some((s) => s.startsWith('oral:'))).toBe(true);
  });

  it('breadth / cognitive 均封顶 5', () => {
    const p = profileTask({
      text: `实现 ${'很长的描述'.repeat(60)} 1做A 2做B 3做C、甲、乙、丙，然后另外再把还要`,
    });
    expect(p.cognitive).toBeLessThanOrEqual(5);
    expect(p.breadth).toBeLessThanOrEqual(5);
  });
});

describe('profileTask · 体量', () => {
  it('text.length>200 → contextTokens 上抬（length/2 量级）且 cognitive+1', () => {
    const text = '请处理这段文本。' + '细'.repeat(250);
    const p = profileTask({ text });
    expect(p.contextTokens).toBeGreaterThanOrEqual(Math.floor(text.length / 2));
    expect(p.cognitive).toBe(3); // 2 + 1（长文本）
    expect(p.signals.some((s) => s.startsWith('bulk:'))).toBe(true);
  });

  it('fileCount / pathTokens 直接折算进 contextTokens', () => {
    const base = profileTask({ text: '改一下样式' });
    const p = profileTask({ text: '改一下样式', fileCount: 3, pathTokens: 10 });
    expect(p.contextTokens).toBe(base.contextTokens + 3 * 2000 + 10 * 500);
  });
});

describe('profileTask · 纯函数与确定性', () => {
  it('同输入 → 完全同输出（连跑两次深比较）', () => {
    const input = { text: '1做A 2做B 3做C，然后审计一下权限', fileCount: 2 };
    expect(profileTask(input)).toEqual(profileTask(input));
  });

  it('输出维度均在 schema 合法域内', () => {
    const p = profileTask({ text: '' });
    expect(p.cognitive).toBeGreaterThanOrEqual(1);
    expect(p.breadth).toBeGreaterThanOrEqual(1);
    expect(['low', 'mid', 'high']).toContain(p.determinism);
    expect(['readonly', 'reversible', 'destructive', 'security']).toContain(p.risk);
    expect(['serial', 'parallel']).toContain(p.parallelism);
  });
});
