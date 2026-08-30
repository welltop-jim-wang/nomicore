import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ['packages/*/test/**/*.test-d.ts', 'domains/*/test/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
});
