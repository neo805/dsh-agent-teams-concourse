/**
 * pack-contract — tarball 解包后的实际文件契约（不信任 manifest 的 files 声明）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 包可装载所需的最小实际文件。 */
export const REQUIRED_PACK_FILES = Object.freeze([
  'cordis.patch.yml',
  'README.md',
  'README.zh.md',
  'LICENSE',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/client/index.cjs',
  'dist/client/index.d.cts',
]);

/**
 * 返回解包目录的契约问题；空数组 = 通过。
 * @param {string} pkgDir
 * @returns {string[]}
 */
export function packedFileIssues(pkgDir) {
  const issues = [];
  for (const rel of REQUIRED_PACK_FILES) {
    const full = join(pkgDir, rel);
    if (!existsSync(full)) {
      issues.push(`缺少必需文件 ${rel}`);
      continue;
    }
    if (rel === 'cordis.patch.yml' && readFileSync(full, 'utf8').trim().length === 0) {
      issues.push('cordis.patch.yml 为空，包不可装载');
    }
  }
  return issues;
}
