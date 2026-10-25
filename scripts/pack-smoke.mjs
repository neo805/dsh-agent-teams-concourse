#!/usr/bin/env node
/**
 * pack-smoke — 打包完整性冒烟：pnpm pack → 解包 → import 入口 → 断言导出契约。
 * 前置：已执行 `pnpm build`（verify 脚本保证顺序）。
 * pnpm 定位：经 `pnpm pack:smoke` 运行时取 process.env.npm_execpath；否则回退 PNPM_MJS / PATH 的 pnpm。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cwd, exit } from 'node:process';
import { runInNewContext as vmRunInNewContext } from 'node:vm';
import { packedFileIssues } from './pack-contract.mjs';

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
  // 依赖解析：解包目录无 node_modules，链接工作区依赖树模拟安装后形态
  // （zod 走 dependencies、@deepseek-ai/* 走 peerDeps 宿主提供，冒烟只验证入口可装载）。
  symlinkSync(join(root, 'node_modules'), join(pkgDir, 'node_modules'), 'junction');
  const mod = await import(pathToFileURL(join(pkgDir, 'dist/index.js')).href);
  if (mod.name !== 'dsh-agent-teams-concourse') throw new Error(`入口 name 契约破坏：${mod.name}`);
  if (typeof mod.apply !== 'function') throw new Error('入口缺少 apply()');

  // client 产物是「普通 script + ModuleLoader CJS 包裹」（宿主按 <script> 加载，
  // 不是 ESM）：验证形态 + 用假 window/require 模拟宿主装载。
  const clientSrc = readFileSync(join(pkgDir, 'dist/client/index.cjs'), 'utf8');
  if (!clientSrc.startsWith('window.__ModuleLoader__.load({')) {
    throw new Error('client 产物缺少 ModuleLoader 包裹（宿主按普通 script 加载，ESM 会拖垮 web boot）');
  }
  if (/^import\s/m.test(clientSrc)) throw new Error('client 产物存在顶层 ESM import');
  let loaded;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          loaded = entry;
        },
      },
    },
  };
  vmRunInNewContext(clientSrc, sandbox);
  if (loaded?.id !== 'dsh-agent-teams-concourse') throw new Error(`ModuleLoader id 契约破坏：${loaded?.id}`);
  const client = loaded.factory((id) => {
    if (id === 'react') return { createElement: () => null };
    if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
    throw new Error(`未预期的 require：${id}`);
  });
  if (typeof client.apply !== 'function') throw new Error('client 入口缺少 apply()');

  // 实际执行打包后的 client.apply：keyed slot 必须用 key，页型必须进 effect。
  const tabDefs = [];
  const slotDefs = [];
  client.apply({
    logger: { warn: () => {} },
    effect: (fn) => fn(),
    sidebarRightTabs: {
      register: (definition) => {
        tabDefs.push(definition);
        return () => {};
      },
    },
    slots: {
      inject: (_name, factory) => {
        factory();
        return () => {};
      },
      register: (definition) => {
        if (definition.name === 'sidebar.right.pane.tab' && typeof definition.key !== 'string') {
          throw new Error('keyed slot 缺少 key');
        }
        slotDefs.push(definition);
        return () => {};
      },
    },
  });
  if (tabDefs.length !== 1) throw new Error(`client 页型注册次数异常：${tabDefs.length}`);
  if (slotDefs.length !== 1) throw new Error(`client 面板体注册次数异常：${slotDefs.length}`);
  if (slotDefs[0]?.key !== 'dsh-agent-teams-concourse') {
    throw new Error(`client panel key 契约破坏：${String(slotDefs[0]?.key)}`);
  }
  if ('id' in slotDefs[0]) throw new Error('client panel 不得沿用页型 id 字段');

  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) throw new Error('package.json files 清单为空');
  const issues = packedFileIssues(pkgDir);
  if (issues.length > 0) throw new Error(`解包文件契约失败：${issues.join('；')}`);
  console.log('[pack-smoke] 通过：包可装载，入口与文件契约完整。');
} catch (error) {
  console.error('[pack-smoke] 失败：', error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
