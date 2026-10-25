import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('依赖声明契约', () => {
  it('未使用的 experimental-agent-team 不再进入 peer/dev 依赖面', () => {
    const name = '@deepseek-ai/dsh-experimental-agent-team';
    expect(pkg.peerDependencies?.[name]).toBeUndefined();
    expect(pkg.devDependencies?.[name]).toBeUndefined();
  });
});
