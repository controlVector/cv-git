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
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        'examples/',
        '**/*.test.ts',
        '**/*.config.ts',
        '**/*.config.js',
        '**/test-*.mjs',
        // Exclude symlinked packages in node_modules to avoid duplicate coverage
        'packages/*/node_modules/**',
      ],
      // Coverage thresholds - these are minimum requirements
      // Start low and increase as coverage improves
      thresholds: {
        statements: 15,
        branches: 70,
        functions: 20,
        lines: 15,
      },
      // Clean coverage directory before running
      clean: true,
      // Include all source files even if not tested
      all: true,
      // Source files to include in coverage
      include: [
        'packages/*/src/**/*.ts',
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
