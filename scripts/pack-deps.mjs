/**
 * pack 依赖隔离 —— 只把 tarball 声明的 dependencies + peerDependencies 链入临时包，
 * 不暴露工作区 devDependencies/间接依赖，避免打包冒烟掩盖漏声明。
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 声明依赖名（去重、稳定排序）。 */
export function declaredDependencyNames(pkg) {
  return [
    ...new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]),
  ].sort();
}

/** 逐项链接 manifest 声明的依赖；工作区缺失即 fail-loud。 */
export function linkDeclaredDependencies(sourceRoot, destination, pkg) {
  mkdirSync(destination, { recursive: true });
  const names = declaredDependencyNames(pkg);
  for (const name of names) {
    const source = join(sourceRoot, 'node_modules', name);
    const target = join(destination, name);
    if (!existsSync(source)) {
      throw new Error(`pack-smoke 声明依赖在工作区缺失：${name}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    try {
      symlinkSync(source, target, 'junction');
    } catch (error) {
      throw new Error(
        `pack-smoke 声明依赖无法链接：${name}（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
  }
  return names;
}
