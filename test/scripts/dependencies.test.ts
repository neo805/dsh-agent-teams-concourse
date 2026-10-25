import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** semver 声明中的主版本；用于锁住“类型契约与运行时同代”。 */
function majorOf(spec: string | undefined): number | undefined {
  const match = spec === undefined ? null : /\d+/.exec(spec);
  return match === null ? undefined : Number(match[0]);
}

describe('依赖声明契约', () => {
  it('未使用的 experimental-agent-team 不再进入 peer/dev 依赖面', () => {
    const name = '@deepseek-ai/dsh-experimental-agent-team';
    expect(pkg.peerDependencies?.[name]).toBeUndefined();
    expect(pkg.devDependencies?.[name]).toBeUndefined();
  });

  it('React 运行时与 @types/react(-dom) 主版本一致', () => {
    const reactMajor = majorOf(pkg.devDependencies?.['react']);
    const reactDomMajor = majorOf(pkg.devDependencies?.['react-dom']);
    expect(reactMajor).toBeDefined();
    expect(reactDomMajor).toBe(reactMajor);
    expect(majorOf(pkg.devDependencies?.['@types/react'])).toBe(reactMajor);
    expect(majorOf(pkg.devDependencies?.['@types/react-dom'])).toBe(reactDomMajor);
  });
});
