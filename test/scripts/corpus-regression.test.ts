/**
 * scripts/corpus-regression.mjs 端到端测试。
 * dist 缺失时先 pnpm build（脚本依赖 tsdown 产物），再以 child_process 运行脚本。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'concourse-corpus-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('corpus-regression 脚本', () => {
  it('退出码 0 且生成含命中率的临时报告（不修改入库文档）', { timeout: 120_000 }, () => {
    // dist 由 Vitest globalSetup 在整次测试调用开始时构建一次，worker 只读。
    const report = join(tempDir(), 'report.md');
    const r = spawnSync('node', ['scripts/corpus-regression.mjs', '--report', report], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(existsSync(report)).toBe(true);
    const md = readFileSync(report, 'utf8');
    expect(md).toMatch(/effort exact[^\d]*\d+(\.\d+)?%/i);
    expect(md).toMatch(/±1/);
    expect(md).toMatch(/tier exact[^\d]*\d+(\.\d+)?%/i);
    expect(md).toContain('系统性高估');
  });

  it('dist 缺失时退出码 2 并提示先 build（使用空临时 dist，不移动共享产物）', () => {
    const r = spawnSync(
      'node',
      [
        'scripts/corpus-regression.mjs',
        '--dist',
        join(tempDir(), 'missing-dist'),
        '--report',
        join(tempDir(), 'report.md'),
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(r.status).toBe(2);
    expect(r.stderr + r.stdout).toContain('pnpm build');
  });
});
