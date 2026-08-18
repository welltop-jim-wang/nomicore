import { defineConfig } from 'vitest/config'

// @nomicore/vfsl 单包测试配置：node 环境，无端口依赖。
// 执行入口：pnpm --filter @nomicore/vfsl exec vitest run（cwd = 本包目录）
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
