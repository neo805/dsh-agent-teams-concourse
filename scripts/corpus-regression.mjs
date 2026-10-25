#!/usr/bin/env node
/**
 * corpus-regression — kernel/profile 语料回归（R-5：阈值只用回归结果标定）。
 *
 * 流程：逐条语料 → profileTask + suggest（内置 mock catalog，与单测一致）
 *      → 统计 effort（exact / ±1 档）与 tier（exact）命中率
 *      → 输出 Markdown 报告 docs/corpus-regression-P1.md
 *      → 按下限判定退出码（effort exact≥50% 且 ±1≥85%，tier exact≥70% → 0，否则 1）。
 *
 * 依赖 tsdown 构建产物 dist/kernel/profile/{profiler,suggest}.js；缺失时退出码 2。
 * 用法：node scripts/corpus-regression.mjs [--corpus <path>] [--report <path>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROFILER_DIST = join(ROOT, 'dist', 'kernel', 'profile', 'profiler.js');
const SUGGEST_DIST = join(ROOT, 'dist', 'kernel', 'profile', 'suggest.js');

// dist 前置检测：缺失 → 提示先 build，退出码 2。
for (const f of [PROFILER_DIST, SUGGEST_DIST]) {
  if (!existsSync(f)) {
    console.error(`[corpus-regression] 缺少构建产物 ${f}，请先运行 pnpm build`);
    exit(2);
  }
}

function argOf(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : fallback;
}

const CORPUS = argOf('corpus', join(ROOT, 'test', 'fixtures', 'corpus', 'public.jsonl'));
const REPORT = argOf('report', join(ROOT, 'docs', 'corpus-regression-P1.md'));

/** 与 test/kernel/profile/suggest.test.ts 保持一致的 mock catalog。 */
const CATALOG = [
  { provider: 'deepseek', model: 'deepseek-chat', efforts: ['low', 'default', 'high'], contextWindow: 128000, tier: 'cheap' },
  { provider: 'deepseek', model: 'deepseek-reasoner', efforts: ['low', 'default', 'high'], contextWindow: 128000, tier: 'balanced' },
  { provider: 'anthropic', model: 'claude-opus', efforts: ['low', 'default', 'high'], contextWindow: 200000, tier: 'premium' },
];

const EFFORT_ORDER = ['low', 'default', 'high'];
const TIER_ORDER = ['cheap', 'balanced', 'premium'];

const { profileTask } = await import(pathToFileURL(PROFILER_DIST).href);
const { suggest } = await import(pathToFileURL(SUGGEST_DIST).href);

// —— 读取语料 ——
const lines = readFileSync(CORPUS, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
const rows = [];
for (const [idx, line] of lines.entries()) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (e) {
    console.error(`[corpus-regression] 第 ${idx + 1} 行 JSON 解析失败：${e.message}`);
    exit(1);
  }
  const profile = profileTask({ text: rec.text });
  const s = suggest(profile, CATALOG);
  rows.push({
    text: rec.text.length > 40 ? rec.text.slice(0, 40) + '…' : rec.text,
    expect: rec.expect,
    actual: { effort: s.reasoningEffort, tier: s.tokenTier },
    profile: { cognitive: profile.cognitive, breadth: profile.breadth, risk: profile.risk },
  });
}

// —— 统计 ——
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const total = rows.length;
const effortExact = rows.filter((r) => r.actual.effort === r.expect.effort).length;
const effortNear = rows.filter(
  (r) => Math.abs(EFFORT_ORDER.indexOf(r.actual.effort) - EFFORT_ORDER.indexOf(r.expect.effort)) <= 1,
).length;
const tierExact = rows.filter((r) => r.actual.tier === r.expect.tier).length;

const miss = (r) => r.actual.effort !== r.expect.effort || r.actual.tier !== r.expect.tier;
const misses = rows.filter(miss);

// 系统性高估/低估：按维度（effort / tier）比较预测与标注的档序差。
const bias = (order, get) => {
  let over = 0;
  let under = 0;
  for (const r of rows) {
    const d = order.indexOf(get(r.actual)) - order.indexOf(get(r.expect));
    if (d > 0) over += 1;
    else if (d < 0) under += 1;
  }
  return { over, under };
};
const effortBias = bias(EFFORT_ORDER, (x) => x.effort);
const tierBias = bias(TIER_ORDER, (x) => x.tier);

// —— 报告 ——
const pass = pct(effortExact, total) >= 50 && pct(effortNear, total) >= 85 && pct(tierExact, total) >= 70;
const md = [
  '# 语料回归报告（P1）',
  '',
  // 报告入库：只写仓库相对路径，绝不写绝对路径（COLLABORATION §11 隐私边界）
  `- 语料：\`${relative(ROOT, CORPUS).split(sep).join('/')}\`（${total} 条）`,
  `- 时间：${new Date().toISOString()}`,
  `- 判定下限：effort exact ≥ 50% · effort ±1 ≥ 85% · tier exact ≥ 70%`,
  '',
  '## 命中率',
  '',
  '| 指标 | 命中率 | 命中/总数 |',
  '| --- | --- | --- |',
  `| effort exact | ${pct(effortExact, total)}% | ${effortExact}/${total} |`,
  `| effort ±1 档 | ${pct(effortNear, total)}% | ${effortNear}/${total} |`,
  `| tier exact | ${pct(tierExact, total)}% | ${tierExact}/${total} |`,
  '',
  `**判定：${pass ? '通过（退出码 0）' : '未达标（退出码 1）'}**`,
  '',
  '## 被系统性高估/低估的维度',
  '',
  '| 维度 | 高估（预测 > 标注） | 低估（预测 < 标注） |',
  '| --- | --- | --- |',
  `| effort | ${effortBias.over} | ${effortBias.under} |`,
  `| tier | ${tierBias.over} | ${tierBias.under} |`,
  '',
  effortBias.over > effortBias.under
    ? '> effort 存在系统性高估倾向，考虑下调 cognitive 权重。'
    : effortBias.under > effortBias.over
      ? '> effort 存在系统性低估倾向，考虑上调 cognitive 权重。'
      : '> effort 无明显系统性偏差。',
  '',
  '## 未命中明细',
  '',
  misses.length === 0
    ? '（无）'
    : [
        '| 语料（截断） | 期望 | 实际 | 画像（cognitive/breadth/risk） |',
        '| --- | --- | --- | --- |',
        ...misses.map(
          (r) =>
            `| ${r.text} | ${r.expect.effort}+${r.expect.tier} | ${r.actual.effort}+${r.actual.tier} | ${r.profile.cognitive}/${r.profile.breadth}/${r.profile.risk} |`,
        ),
      ].join('\n'),
  '',
].join('\n');

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, md, 'utf8');
console.log(`[corpus-regression] effort exact ${pct(effortExact, total)}% · ±1 ${pct(effortNear, total)}% · tier exact ${pct(tierExact, total)}% → ${pass ? '通过' : '未达标'}`);
console.log(`[corpus-regression] 报告已写入 ${REPORT}`);
exit(pass ? 0 : 1);
