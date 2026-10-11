/**
 * kernel/glyphs 测试（先写测试，TDD）。
 * P6 结构断言：任意两状态形状两两可辨；形状承载语义，零美术资产。
 */
import { describe, expect, it } from 'vitest';
import { GLYPHS, STATUS, formatOverviewLine, renderTree } from '../../src/kernel/glyphs.js';

describe('GLYPHS · 状态表', () => {
  it('恰好 7 个状态', () => {
    expect(STATUS).toEqual(['active', 'idle', 'blocked', 'running', 'done', 'failed', 'pending']);
    expect(Object.keys(GLYPHS).sort()).toEqual([...STATUS].sort());
  });

  it('任意两状态形状两两不同（形状单独可辨）', () => {
    const shapes = STATUS.map((s) => GLYPHS[s].shape);
    expect(new Set(shapes).size).toBe(STATUS.length);
  });

  it('每状态同时具备形状 + 颜色 + 中文标签', () => {
    for (const s of STATUS) {
      expect(GLYPHS[s].shape.length).toBeGreaterThan(0);
      expect(GLYPHS[s].color.length).toBeGreaterThan(0);
      expect(GLYPHS[s].label.length).toBeGreaterThan(0);
    }
  });

  it('关键形状固定：active ● / idle ○ / blocked ◆ / running ▸ / done ✓ / failed ✗ / pending ·', () => {
    expect(GLYPHS.active.shape).toBe('●');
    expect(GLYPHS.idle.shape).toBe('○');
    expect(GLYPHS.blocked.shape).toBe('◆');
    expect(GLYPHS.running.shape).toBe('▸');
    expect(GLYPHS.done.shape).toBe('✓');
    expect(GLYPHS.failed.shape).toBe('✗');
    expect(GLYPHS.pending.shape).toBe('·');
  });
});

describe('renderTree · L2 文字树', () => {
  const vertices = [
    { id: 'captain', parent: null },
    { id: 'sub-lead-A', parent: 'captain' },
    { id: 'w-1', parent: 'sub-lead-A', role: 'schema' },
    { id: 'w-2', parent: 'sub-lead-A', role: 'api' },
    { id: 'sub-lead-B', parent: 'captain' },
    { id: 'w-3', parent: 'sub-lead-B', role: 'tests' },
  ];

  it('与契约示例逐行相等（├ 分支子行前缀 │，└ 分支子行前缀空格）', () => {
    const lines = renderTree(vertices, {
      status: { captain: 'active', 'sub-lead-A': 'blocked', 'sub-lead-B': 'blocked', 'w-2': 'active' },
    });
    expect(lines).toEqual([
      '● captain',
      '├─◆ sub-lead-A',
      '│  ├─○ w-1  schema',
      '│  └─● w-2  api',
      '└─◆ sub-lead-B',
      '   └─○ w-3  tests',
    ]);
  });

  it('缺省状态用 ○', () => {
    const lines = renderTree([{ id: 'a', parent: null }]);
    expect(lines).toEqual(['○ a']);
  });

  it('DFS 按输入数组声明序（兄弟顺序不打乱）', () => {
    const lines = renderTree([
      { id: 'root', parent: null },
      { id: 'b', parent: 'root' },
      { id: 'a', parent: 'root' },
      { id: 'c', parent: 'root' },
    ]);
    expect(lines).toEqual(['○ root', '├─○ b', '├─○ a', '└─○ c']);
  });

  it('多根：每个根行都不带连线', () => {
    const lines = renderTree([
      { id: 'r1', parent: null },
      { id: 'r2', parent: null },
      { id: 'x', parent: 'r2' },
    ]);
    expect(lines).toEqual(['○ r1', '○ r2', '└─○ x']);
  });
});

describe('formatOverviewLine · L0 单行总览', () => {
  it('含预算：进度条 10 格 ▰▱，四舍五入', () => {
    const line = formatOverviewLine({
      tier: 'T1b', tierLabel: '多层领队', vertices: 7, depth: 1, active: 3,
      openEdges: 4, totalEdges: 21, budgetPct: 61, echo: 0, fused: 0,
    });
    expect(line).toBe('T1b 多层领队 · 7 顶点 · 深度 1 · 3 活跃 · 开放边 4/21 · 预算 ▰▰▰▰▰▰▱▱▱▱ 61% · 回声 0 · 熔断 0');
  });

  it('预算缺省时省略预算段', () => {
    const line = formatOverviewLine({
      tier: 'T1a', tierLabel: '星型', vertices: 3, depth: 1, active: 1,
      openEdges: 2, totalEdges: 6, echo: 1, fused: 2,
    });
    expect(line).toBe('T1a 星型 · 3 顶点 · 深度 1 · 1 活跃 · 开放边 2/6 · 回声 1 · 熔断 2');
    expect(line).not.toContain('预算');
  });

  it('边界：0% 全 ▱，100% 全 ▰，5% 四舍五入为 1 格', () => {
    const mk = (budgetPct: number) =>
      formatOverviewLine({ tier: 'T0', tierLabel: '单点', vertices: 1, depth: 0, active: 0, openEdges: 0, totalEdges: 0, budgetPct, echo: 0, fused: 0 });
    expect(mk(0)).toContain('▱▱▱▱▱▱▱▱▱▱ 0%');
    expect(mk(100)).toContain('▰▰▰▰▰▰▰▰▰▰ 100%');
    expect(mk(5)).toContain('▰▱▱▱▱▱▱▱▱▱ 5%');
  });
});
