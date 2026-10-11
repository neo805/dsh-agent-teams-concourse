import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // P0 全局阈值；P1 起切换为按层阈值（kernel ≥90 / service ≥80 / host ≥70 / client ≥60）。
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
