import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@nomicore/yjs-server', replacement: fileURLToPath(new URL('./apps/yjs-server/src/index.ts', import.meta.url)) },
      { find: '@nomicore/vfs3-assets', replacement: fileURLToPath(new URL('./domains/vfs3-assets/index.ts', import.meta.url)) },
      { find: /^@nomicore\/([^/]+)\/testing$/, replacement: fileURLToPath(new URL('./packages/$1/src/testing.ts', import.meta.url)) },
      { find: /^@nomicore\/namespace-runtime\/internal$/, replacement: fileURLToPath(new URL('./packages/namespace-runtime/src/internal.ts', import.meta.url)) },
      { find: /^@nomicore\/([^/]+)$/, replacement: fileURLToPath(new URL('./packages/$1/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    passWithNoTests: true,
    maxWorkers: 1,
    typecheck: {
      enabled: true,
      include: ['packages/*/test/**/*.test-d.ts', 'domains/*/test/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
});
