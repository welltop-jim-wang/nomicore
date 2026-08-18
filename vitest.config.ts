import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // 骨架阶段没有测试文件；PRD/issues 落地后移除
    passWithNoTests: true,
  },
});
