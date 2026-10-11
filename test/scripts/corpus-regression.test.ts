/**
 * scripts/corpus-regression.mjs 端到端测试。
 * dist 缺失时先 pnpm build（脚本依赖 tsdown 产物），再以 child_process 运行脚本。
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const DIST_FILES = ['dist/kernel/profile/profiler.js', 'dist/kernel/profile/suggest.js'];
const REPORT = join(ROOT, 'docs', 'corpus-regression-P1.md');

describe('corpus-regression 脚本', () => {
  it('退出码 0 且生成含命中率的 Markdown 报告', { timeout: 120_000 }, () => {
    if (!DIST_FILES.every((f) => existsSync(join(ROOT, f)))) {
      execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });
    }
    const r = spawnSync('node', ['scripts/corpus-regression.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(REPORT)).toBe(true);
    const md = readFileSync(REPORT, 'utf8');
    // 报告含命中率数字与系统性高估/低估小节
    expect(md).toMatch(/effort exact[:：]?\s*\d+(\.\d+)?%/i);
    expect(md).toMatch(/±1/);
    expect(md).toMatch(/tier exact[:：]?\s*\d+(\.\d+)?%/i);
    expect(md).toContain('系统性高估');
  }, 120_000);

  it('dist 缺失时退出码 2 并提示先 build', () => {
    const probe = join(ROOT, 'dist', 'kernel', 'profile', 'profiler.js');
    if (!existsSync(probe)) return; // 无 dist 可移，跳过（上一个用例会先 build）
    const r = spawnSync(
      'node',
      ['-e', `import('node:fs').then(fs=>{fs.renameSync(${JSON.stringify(probe)},${JSON.stringify(probe + '.bak')});})`],
      { cwd: ROOT },
    );
    expect(r.status).toBe(0);
    try {
      const run = spawnSync('node', ['scripts/corpus-regression.mjs'], { cwd: ROOT, encoding: 'utf8' });
      expect(run.status).toBe(2);
      expect(run.stderr + run.stdout).toContain('pnpm build');
    } finally {
      execFileSync('node', ['-e', `require('fs').renameSync(${JSON.stringify(probe + '.bak')},${JSON.stringify(probe)})`]);
    }
  });
});
