import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/integration'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@cv-git/core': resolve(__dirname, './packages/core/src'),
      '@cv-git/shared': resolve(__dirname, './packages/shared/src'),
      '@cv-git/credentials': resolve(__dirname, './packages/credentials/src'),
      '@cv-git/platform': resolve(__dirname, './packages/platform/src'),
    },
  },
});
