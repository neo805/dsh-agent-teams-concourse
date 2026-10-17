import { defineConfig } from 'tsdown';

// 双入口：宿主侧（node）+ 客户端（browser，React 18，由宿主 ModuleLoader 装载）。
// 所有 @deepseek-ai/* 与 react/zod 均为外部依赖（宿主运行时提供或随 dependencies 安装）。
export default defineConfig([
  {
    // kernel 纯函数模块单独出产物：scripts/corpus-regression.mjs 直接消费 dist/kernel/profile/*.js。
    entry: {
      index: 'src/index.ts',
      'kernel/profile/profiler': 'src/kernel/profile/profiler.ts',
      'kernel/profile/suggest': 'src/kernel/profile/suggest.ts',
      'kernel/glyphs': 'src/kernel/glyphs.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    dts: true,
    external: [/^@deepseek-ai\//, /^react(\/.*)?$/, /^react-dom(\/.*)?$/, 'zod'],
  },
  {
    entry: { 'client/index': 'src/client/index.ts' },
    outDir: 'dist',
    // 客户端产物必须是「普通 script + ModuleLoader CJS 包裹」：
    // 宿主把 client bundle 当普通 <script> 加载，ESM 顶层 import 会抛
    // SyntaxError: Cannot use import statement outside a module 并拖垮 web boot
    // （2026-10-17 真机崩溃实证，crash-*-web-boot.log）。形态对齐官方
    // dsh-effort-router/lib/client.js：factory(require) 提供 react / jsx-runtime。
    format: ['cjs'],
    platform: 'browser',
    fixedExtension: false,
    dts: true,
    external: [/^@deepseek-ai\//, /^react(\/.*)?$/, /^react-dom(\/.*)?$/, 'zod'],
    outputOptions: {
      banner: [
        'window.__ModuleLoader__.load({',
        '\tid: "dsh-agent-teams-concourse",',
        '\tfactory: (require) => {',
        '\t\tvar module = { exports: {} };',
        '\t\tvar exports = module.exports;',
      ].join('\n'),
      footer: ['\t\treturn module.exports;', '\t},', '});'].join('\n'),
    },
  },
]);
