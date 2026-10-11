#!/usr/bin/env node
/**
 * check-boundaries — §3 模块依赖方向门禁。
 *
 * 合法方向（被 CI 强制）：
 *   kernel  → 仅 kernel 内部 + zod（NFR-5 纯函数内核：禁 node:* 与 @deepseek-ai/*）
 *   host    → kernel
 *   service → kernel / host
 *   tools   → kernel / host / service
 *   client  → kernel + react（禁 node:* 与 @deepseek-ai/* —— 浏览器侧）
 *   index   → 任意 src 内模块（client 除外；client 由宿主按 dsh.client 独立装载）
 *
 * 用法：node scripts/check-boundaries.mjs [--root <dir>]
 * 退出码：0 通过；1 检出越界。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { argv, cwd, exit } from 'node:process';

/** 各层的禁止规则。forbidDirs：相对 import 解析后落在这些顶层目录即违规。 */
const RULES = {
  kernel: { forbidDirs: ['host', 'service', 'tools', 'client'], forbidExternal: [/^(node|bun):/, /^@deepseek-ai\//], allowExternal: ['zod'] },
  host: { forbidDirs: ['service', 'tools', 'client'] },
  service: { forbidDirs: ['tools', 'client'] },
  tools: { forbidDirs: ['client'] },
  client: { forbidDirs: ['host', 'service', 'tools'], forbidExternal: [/^(node|bun):/, /^@deepseek-ai\//], allowExternal: ['react', 'react-dom', 'react/jsx-runtime'] },
};

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function parseRoot() {
  const i = argv.indexOf('--root');
  return resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : cwd());
}

/** 取 src/ 下的顶层模块目录名（kernel/host/service/tools/client/…）。 */
function topDir(srcRoot, file) {
  const rel = relative(srcRoot, file);
  return rel.split(sep)[0];
}

/** 收集一个文件里的全部 import 说明符。 */
function specifiers(text) {
  const out = [];
  for (const re of [IMPORT_RE, DYN_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
  }
  return out;
}

/** @returns {string[]} 违规清单（人类可读）。 */
export function scan(root) {
  const srcRoot = join(root, 'src');
  const violations = [];
  let stat;
  try {
    stat = statSync(srcRoot);
  } catch {
    return violations;
  }
  if (!stat.isDirectory()) return violations;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(entry)) continue;
      const layer = topDir(srcRoot, full);
      const rule = RULES[layer];
      if (!rule) continue; // src 根或非受管目录（如未来新增层需先登记规则）
      const rel = relative(root, full);
      for (const spec of specifiers(readFileSync(full, 'utf8'))) {
        if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:/.test(spec)) {
          // 相对/绝对路径：解析后判定落在哪个顶层目录。
          const target = normalize(join(dirname(full), spec));
          const targetLayer = target.startsWith(srcRoot) ? topDir(srcRoot, target) : null;
          if (targetLayer && rule.forbidDirs.includes(targetLayer)) {
            violations.push(`${rel} — ${layer} 不得依赖 ${targetLayer}（import "${spec}"）`);
          }
        } else {
          // 外部包：先查禁止名单，再查白名单（有白名单的层为封闭白名单制）。
          if (rule.forbidExternal?.some((re) => re.test(spec))) {
            violations.push(`${rel} — ${layer} 禁止的外部依赖 "${spec}"`);
          } else if (rule.allowExternal && !rule.allowExternal.includes(spec)) {
            violations.push(`${rel} — ${layer} 仅允许外部依赖 ${rule.allowExternal.join(' / ')}，实为 "${spec}"`);
          }
        }
      }
    }
  }
  walk(srcRoot);
  return violations;
}

if (import.meta.url === `file://${resolve(argv[1] ?? '').replaceAll('\\', '/')}` || argv[1]?.endsWith('check-boundaries.mjs')) {
  const root = parseRoot();
  const violations = scan(root);
  if (violations.length > 0) {
    console.error(`[check-boundaries] 检出 ${violations.length} 处越界：`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    exit(1);
  }
  console.log('[check-boundaries] 通过：模块依赖方向合法。');
}
