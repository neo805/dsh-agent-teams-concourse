import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(fileURLToPath(import.meta.url), '../../..');
const script = join(repo, 'scripts/check-no-assets.mjs');
const fx = (p: string) => join(repo, 'test/fixtures/assets', p);

/** 运行门禁脚本，返回退出码（0 = 通过，1 = 检出违规）。 */
function run(root: string): number {
  try {
    execFileSync(process.execPath, [script, '--root', root], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe('check-no-assets（NFR-3 零美术资产门禁）', () => {
  it('干净目录通过', () => {
    expect(run(fx('clean'))).toBe(0);
  });

  it('src/ 下出现图片文件即失败', () => {
    expect(run(fx('violation-image'))).toBe(1);
  });

  it('src/ 下出现 emoji 码位即失败', () => {
    expect(run(fx('violation-emoji'))).toBe(1);
  });

  it('仓库自身 src/ 通过（永久基线：此用例不许变红）', () => {
    expect(run(repo)).toBe(0);
  });
});
