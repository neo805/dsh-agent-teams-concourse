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

/**
 * 同时扫描源码与实际发布目录 dist（含图片文件与文本中的 emoji）。
 * @returns {string[]} 命中的违规清单（人类可读）。
 */
export function scan(root) {
  const violations = [];
  const roots = [join(root, 'src'), join(root, 'dist')].filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const ext = extname(entry).toLowerCase();
      if (IMAGE_EXT.has(ext)) {
        violations.push(`${rel} — 图片文件（NFR-3 禁止打包美术资产）`);
        continue;
      }
      if (TEXT_EXT.has(ext)) {
        const text = readFileSync(full, 'utf8');
        const lines = text.split('\n');
        for (let n = 0; n < lines.length; n++) {
          if (EMOJI.test(lines[n])) {
            violations.push(`${rel}:${n + 1} — emoji 码位（允许 25A0–25FF / 2700–27BF 形状字符，禁止 1F000–1FAFF / FE0F / 200D）`);
          }
        }
      }
    }
  }

  for (const dir of roots) walk(dir);
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
