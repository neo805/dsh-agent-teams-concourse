#!/usr/bin/env node
/**
 * pack-smoke — 打包完整性冒烟：pnpm pack → 解包 → import 入口 → 断言导出契约。
 * 前置：已执行 `pnpm build`（verify 脚本保证顺序）。
 * pnpm 定位：经 `pnpm pack:smoke` 运行时取 process.env.npm_execpath；否则回退 PNPM_MJS / PATH 的 pnpm。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cwd, exit } from 'node:process';

const root = cwd();
const tmp = mkdtempSync(join(tmpdir(), 'concourse-pack-'));

function pnpmInvocation(args) {
  const execpath = process.env.npm_execpath;
  if (execpath && execpath.endsWith('.mjs')) return [process.execPath, [execpath, ...args]];
  if (process.env.PNPM_MJS) return [process.execPath, [process.env.PNPM_MJS, ...args]];
  return ['pnpm', args]; // 依赖 PATH（Windows 下需经 shell：见调用处 shell:true）
}

try {
  const [cmd, args] = pnpmInvocation(['pack', '--pack-destination', tmp]);
  execFileSync(cmd, args, { cwd: root, stdio: 'pipe', shell: cmd === 'pnpm' });

  const found = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!found) throw new Error('pnpm pack 未产出 .tgz');
  execFileSync('tar', ['-xzf', join(tmp, found), '-C', tmp], { stdio: 'pipe' });

  const pkgDir = join(tmp, 'package');
  const mod = await import(pathToFileURL(join(pkgDir, 'dist/index.js')).href);
  if (mod.name !== 'dsh-agent-teams-concourse') throw new Error(`入口 name 契约破坏：${mod.name}`);
  if (typeof mod.apply !== 'function') throw new Error('入口缺少 apply()');

  const clientDist = join(pkgDir, 'dist/client/index.js');
  const client = await import(pathToFileURL(clientDist).href);
  if (typeof client.apply !== 'function') throw new Error('client 入口缺少 apply()');

  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  for (const required of ['cordis.patch.yml', 'README.md', 'LICENSE']) {
    if (!pkg.files?.some((f) => required.startsWith(f) || f === required)) {
      throw new Error(`files 清单缺少 ${required}`);
    }
  }
  console.log('[pack-smoke] 通过：包可装载，入口契约完整。');
} catch (error) {
  console.error('[pack-smoke] 失败：', error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
