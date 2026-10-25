import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = join(fileURLToPath(import.meta.url), '../../..');
const script = join(repo, 'scripts/check-boundaries.mjs');
const fx = (p: string) => join(repo, 'test/fixtures/boundary', p);

function run(root: string): number {
  try {
    execFileSync(process.execPath, [script, '--root', root], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe('check-boundaries 正向白名单', () => {
  it('kernel 不得经根入口间接依赖宿主层', () => {
    expect(run(fx('violation-kernel-index'))).toBe(1);
  });

  it('kernel 不得依赖未登记的新层', () => {
    expect(run(fx('violation-kernel-future'))).toBe(1);
  });

  it('index 不得依赖 client（client 由宿主独立装载）', () => {
    expect(run(fx('violation-index-client'))).toBe(1);
  });
});
