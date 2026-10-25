import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const DIST_FILES = ['dist/kernel/profile/profiler.js', 'dist/kernel/profile/suggest.js'];

describe('corpus-regression 产物新鲜度', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('dist 早于源码时 fail-loud（退出码 2），不得验证旧代码', () => {
    const dir = mkdtempSync(join(tmpdir(), 'concourse-corpus-stale-'));
    dirs.push(dir);
    const staleDist = join(dir, 'dist');
    cpSync(join(ROOT, 'dist'), staleDist, { recursive: true });
    const epoch = new Date(0);
    for (const f of DIST_FILES) {
      utimesSync(join(staleDist, f.slice('dist/'.length)), epoch, epoch);
    }

    const report = join(dir, 'report.md');
    const r = spawnSync(
      'node',
      ['scripts/corpus-regression.mjs', '--dist', staleDist, '--report', report],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(2);
    expect(r.stderr + r.stdout).toContain('过期');
  });
});
