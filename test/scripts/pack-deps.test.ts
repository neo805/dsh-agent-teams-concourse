import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  declaredDependencyNames,
  linkDeclaredDependencies,
} from '../../scripts/pack-deps.mjs';

describe('pack-smoke 依赖隔离', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('只为 dependencies + peerDependencies 建链接，不暴露 dev/未声明包', () => {
    const root = mkdtempSync(join(tmpdir(), 'concourse-pack-deps-'));
    dirs.push(root);
    for (const name of ['declared', 'peer', 'undeclared']) {
      mkdirSync(join(root, 'node_modules', name), { recursive: true });
    }
    const pkg = {
      dependencies: { declared: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      devDependencies: { undeclared: '1.0.0' },
    };
    expect(declaredDependencyNames(pkg)).toEqual(['declared', 'peer']);

    const dest = join(root, 'package', 'node_modules');
    expect(linkDeclaredDependencies(root, dest, pkg)).toEqual(['declared', 'peer']);
    expect(readdirSync(dest).sort()).toEqual(['declared', 'peer']);
  });

  it('声明依赖在工作区缺失时 fail-loud', () => {
    const root = mkdtempSync(join(tmpdir(), 'concourse-pack-deps-'));
    dirs.push(root);
    expect(() =>
      linkDeclaredDependencies(root, join(root, 'package', 'node_modules'), {
        dependencies: { missing: '1.0.0' },
      }),
    ).toThrow(/missing/);
  });
});
