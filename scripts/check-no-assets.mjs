#!/usr/bin/env node
/**
 * check-no-assets — NFR-3 / P1 零美术资产门禁。
 *
 * 规则（扫描 <root>/src/）：
 *  ① 禁止任何图片文件（.png/.jpg/.jpeg/.gif/.svg/.webp/.ico/.bmp/.avif）。
 *  ② 禁止 emoji 码位：U+1F000–U+1FAFF（全部表情/符号扩展区）、U+FE0F（emoji 呈现选择符）、
 *     U+200D（零宽连接符，emoji 组合序列的标志）。
 *  ③ 显式允许：U+25A0–25FF 几何形状与 U+2700–27BF 装饰符号——
 *     它们是本插件「形状承载语义」体系的设计内元素（报告 §7.6.1 原语表），不是拟人化资产。
 *
 * 用法：node scripts/check-no-assets.mjs [--root <dir>]   （默认当前工作目录）
 * 退出码：0 通过；1 检出违规。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '.yml', '.yaml', '.md']);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{FE0F}\u{200D}]/u;

function parseRoot() {
  const i = argv.indexOf('--root');
  return resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : cwd());
}

/** package.json files 的发布集合（目录与简单 glob 以所在目录近似；精确文件逐个检查）。 */
function publishedEntries(root) {
  const dirs = [];
  const files = [];
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return { dirs, files };
  }
  if (!Array.isArray(pkg.files)) return { dirs, files };
  for (const raw of pkg.files) {
    if (typeof raw !== 'string' || raw.trim().length === 0) continue;
    const entry = raw.replace(/^\.\//, '');
    const globAt = entry.search(/[*?[]/);
    if (globAt >= 0) {
      const slash = entry.lastIndexOf('/', globAt);
      if (slash < 0) {
        // 根级 glob（如 *.svg）：只匹配根本身这一层，避免递归扫描整个仓库。
        const re = new RegExp(
          `^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
        );
        for (const name of readdirSync(root)) {
          if (re.test(name)) {
            const full = join(root, name);
            if (statSync(full).isFile()) files.push(full);
          }
        }
      } else {
        dirs.push(resolve(root, entry.slice(0, slash)));
      }
      continue;
    }
    const candidate = resolve(root, entry);
    const rel = relative(root, candidate);
    if (rel.startsWith('..') || rel === '') continue;
    try {
      if (statSync(candidate).isDirectory()) dirs.push(candidate);
      else files.push(candidate);
    } catch {
      // 不存在的 files 条目由 pack 契约单独负责；这里只检查真实存在的发布物。
    }
  }
  return { dirs, files };
}

/**
 * 扫描源码/产物（图片 + emoji）以及 package.json files 实际发布集合（图片）。
 * @returns {string[]} 命中的违规清单（人类可读）。
 */
export function scan(root) {
  const violations = [];
  const sourceRoots = [join(root, 'src'), join(root, 'dist')].filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
  const published = publishedEntries(root);

  /** @param {string} dir @param {boolean} checkEmoji */
  function walk(dir, checkEmoji) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full);
      if (statSync(full).isDirectory()) {
        walk(full, checkEmoji);
        continue;
      }
      inspect(full, rel, checkEmoji);
    }
  }

  function inspect(full, rel, checkEmoji) {
    const ext = extname(full).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      violations.push(`${rel} — 图片文件（NFR-3 禁止打包美术资产）`);
      return;
    }
    if (!checkEmoji || !TEXT_EXT.has(ext)) return;
    const text = readFileSync(full, 'utf8');
    const lines = text.split('\n');
    for (let n = 0; n < lines.length; n++) {
      if (EMOJI.test(lines[n])) {
        violations.push(`${rel}:${n + 1} — emoji 码位（允许 25A0–25FF / 2700–27BF 形状字符，禁止 1F000–1FAFF / FE0F / 200D）`);
      }
    }
  }

  for (const dir of sourceRoots) walk(dir, true);
  const seen = new Set(sourceRoots);
  for (const dir of published.dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    walk(dir, false);
  }
  for (const file of published.files) inspect(file, relative(root, file), false);
  return violations;
}

// 直接执行时按门禁语义退出。
if (import.meta.url === `file://${resolve(argv[1] ?? '').replaceAll('\\', '/')}` || argv[1]?.endsWith('check-no-assets.mjs')) {
  const root = parseRoot();
  const violations = scan(root);
  if (violations.length > 0) {
    console.error(`[check-no-assets] 检出 ${violations.length} 处违规：`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    exit(1);
  }
  console.log('[check-no-assets] 通过：零美术资产、零 emoji。');
}
