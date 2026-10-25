import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(fileURLToPath(import.meta.url), '../../..');
const script = join(repo, 'scripts/check-boundaries.mjs');
const fx = (p: string) => join(repo, 'test/fixtures/boundary', p);

/** 运行边界检查脚本，返回退出码（0 = 通过，1 = 检出越界）。 */
function run(root: string): number {
  try {
    execFileSync(process.execPath, [script, '--root', root], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe('check-boundaries（§3 模块依赖方向门禁）', () => {
  it('合法依赖方向通过（host → kernel）', () => {
    expect(run(fx('clean'))).toBe(0);
  });

  it('kernel 引入 node: 内置模块即失败（纯函数内核零宿主依赖）', () => {
    expect(run(fx('violation-kernel-node'))).toBe(1);
  });

  it('逆向依赖（host → service）即失败', () => {
    expect(run(fx('violation-direction'))).toBe(1);
  });

  it('未登记的新层默认拒绝，不能 fail-open 绕过依赖方向', () => {
    expect(run(fx('violation-unknown-layer'))).toBe(1);
  });

  it('CommonJS require 与 import 同等受边界约束（kernel 不得 require node:）', () => {
    expect(run(fx('violation-kernel-require'))).toBe(1);
  });

  it('仓库自身 src/ 通过（永久基线：此用例不许变红）', () => {
    expect(run(repo)).toBe(0);
  });
});
