import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
    pool: 'forks',
  },
  resolve: {
    alias: {
      $lib: resolve(rootDir, 'frontend/src/lib'),
      '@liatir/core': resolve(rootDir, 'packages/liatir-core/src'),
      '@liatir/output-parser': resolve(rootDir, 'packages/liatir-output-parser/src'),
    },
  },
});
