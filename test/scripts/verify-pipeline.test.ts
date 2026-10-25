import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

const steps = (pkg.scripts?.['verify'] ?? '').split('&&').map((step) => step.trim());

describe('verify 构建单一权威', () => {
  it('不得在测试之外预构建：globalSetup 负责当次唯一构建', () => {
    expect(steps.length).toBeGreaterThan(1);
    expect(steps).not.toContain('pnpm build');
  });

  it('测试产物先构建，资产与打包冒烟后消费', () => {
    const coverage = steps.indexOf('pnpm test:coverage');
    const assets = steps.indexOf('pnpm verify:assets');
    const pack = steps.indexOf('pnpm pack:smoke');
    expect(coverage).toBeGreaterThanOrEqual(0);
    expect(assets).toBeGreaterThan(coverage);
    expect(pack).toBeGreaterThan(assets);
  });
});