import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    // Mock chrome APIs
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/shared/storage/**/*.ts', 'src/shared/crypto/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/__tests__/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/types.ts',
        '**/index.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 90,
        lines: 85,
      },
    },
  },
});
