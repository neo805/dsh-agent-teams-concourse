import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REQUIRED_PACK_FILES, packedFileIssues } from '../../scripts/pack-contract.mjs';

describe('pack 必需文件契约', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function pkg(files: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'concourse-pack-contract-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    return dir;
  }

  function complete(): Record<string, string> {
    return {
      'cordis.patch.yml': '- insert: []\n',
      'README.md': '# readme\n',
      'README.zh.md': '# 说明\n',
      LICENSE: 'MIT\n',
      'dist/index.js': 'export {};\n',
      'dist/index.d.ts': 'export {};\n',
      'dist/client/index.cjs': 'window.__ModuleLoader__.load({});\n',
      'dist/client/index.d.cts': 'export {};\n',
    };
  }

  it('完整解包目录通过', () => {
    expect(REQUIRED_PACK_FILES).toContain('cordis.patch.yml');
    expect(packedFileIssues(pkg(complete()))).toEqual([]);
  });

  it('manifest 声称存在但实物缺失仍失败', () => {
    const files = complete();
    delete files['README.zh.md'];
    expect(packedFileIssues(pkg(files)).join('\n')).toContain('README.zh.md');
  });

  it('客户端类型导出缺失同样破坏 pack 契约', () => {
    const files = complete();
    delete files['dist/client/index.d.cts'];
    expect(packedFileIssues(pkg(files)).join('\n')).toContain('dist/client/index.d.cts');
  });

  it('空 patch 视为不可装载', () => {
    const files = complete();
    files['cordis.patch.yml'] = '   \n';
    expect(packedFileIssues(pkg(files)).join('\n')).toContain('cordis.patch.yml');
  });
});
