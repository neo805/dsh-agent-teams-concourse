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
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import ts from 'typescript';

/**
 * 各层允许的相对依赖目标（正向白名单）。
 * 未登记的新层不在任何 allowDirs 中，因而默认拒绝；index 是 src 根入口层。
 */
const RULES = {
  kernel: {
    allowDirs: ['kernel'],
    forbidExternal: [/^(node|bun):/, /^@deepseek-ai\//],
    allowExternal: ['zod'],
  },
  host: { allowDirs: ['host', 'kernel'] },
  service: { allowDirs: ['service', 'host', 'kernel'] },
  tools: { allowDirs: ['tools', 'service', 'host', 'kernel'] },
  client: {
    allowDirs: ['client', 'kernel'],
    forbidExternal: [/^(node|bun):/, /^@deepseek-ai\//],
    allowExternal: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  index: { allowDirs: ['index', 'kernel', 'host', 'service', 'tools'] },
};

/**
 * 用 TypeScript AST 提取静态依赖，覆盖 import/export/import=require/require()/import()。
 * 非字面量动态依赖无法审计，交由调用方在受限层 fail-loud。
 */
function dependencySpecs(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specs = [];
  const dynamic = [];
  const add = (node, label) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specs.push(node.text);
    else dynamic.push(label);
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier, 'import/export');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, 'import=require');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node.arguments[0], 'import()');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add(node.arguments[0], 'require()');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specs, dynamic };
}

function parseRoot() {
  const i = argv.indexOf('--root');
  return resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : cwd());
}

/** src/ 根文件统一归 index 层；其余取顶层目录名。 */
function layerOf(srcRoot, file) {
  const rel = relative(srcRoot, file);
  const parts = rel.split(sep);
  return parts.length === 1 ? 'index' : parts[0];
}

/** target 是否确实位于 srcRoot 内（不能用字符串前缀判断）。 */
function isInside(srcRoot, target) {
  const rel = relative(srcRoot, target);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
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
      const layer = layerOf(srcRoot, full);
      const rule = RULES[layer];
      const rel = relative(root, full);
      if (!rule) {
        violations.push(`${rel} — 未登记层 "${layer}"（默认拒绝；新增层必须先登记依赖规则）`);
        continue;
      }
      const deps = dependencySpecs(full, readFileSync(full, 'utf8'));
      for (const label of deps.dynamic) {
        violations.push(`${rel} — 无法静态判定 ${label} 的依赖目标（受限层 fail-loud）`);
      }
      for (const spec of deps.specs) {
        if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:/.test(spec)) {
          // 相对/绝对路径：必须留在 src 内，且目标层在正向白名单中。
          const target = normalize(join(dirname(full), spec));
          if (!isInside(srcRoot, target)) {
            violations.push(`${rel} — ${layer} 的相对依赖越出 src（import "${spec}"）`);
            continue;
          }
          const targetLayer = layerOf(srcRoot, target);
          if (!rule.allowDirs.includes(targetLayer)) {
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
