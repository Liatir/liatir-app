/**
 * Vitest config for the unit suite.
 *
 * `environment: 'node'` — no DOM. These tests cover contracts, registries, parsers and store logic, none of
 * which needs a browser; anything that does belongs in the end-to-end suite.
 *
 * The aliases point at the packages' **source**, not their build output, so the tests run against what is
 * actually written rather than against a `dist/` that may be stale. That means a contract change is caught by
 * the tests immediately, without a build step in between.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
    // Forks, not threads: several tests install global stubs (the Svelte runes) and touch the filesystem, so
    // each file needs a genuinely separate process rather than a shared one.
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
