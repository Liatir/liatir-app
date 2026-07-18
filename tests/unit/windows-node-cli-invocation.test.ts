import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localNodeCliInvocation } from '../../scripts/node-cli.mjs';

const childProcessOwners = [
  'scripts/build-browser-api.mjs',
  'scripts/build-tauri-test-binary.mjs',
  'scripts/publish-liatir-packages.mjs',
  'scripts/run-runtime-box-product-lifecycle.mjs',
  'scripts/runtime-box-ci.mjs',
  'scripts/smoke-tauri-dev.mjs',
  'tests/e2e/specs/python-plugins.e2e.mjs',
  'tests/test-matrix.mjs',
];

describe('Windows Node CLI invocation', () => {
  it('never passes package-manager command shims directly to child_process', () => {
    for (const path of childProcessOwners) {
      const source = readFileSync(resolve(path), 'utf8');
      expect(source, path).not.toMatch(/\b(?:npm|npx|pnpm|yarn|tauri)\.cmd\b/);
    }
  });

  it('resolves local package CLIs and launches them through Node', () => {
    const cli = 'C:\\repo\\node_modules\\typescript\\bin\\tsc';
    expect(localNodeCliInvocation('typescript/bin/tsc', ['-p', 'tsconfig.json'], {
      nodeExecutable: 'C:\\hostedtoolcache\\node\\node.exe',
      resolveModule: () => cli,
      fileExists: (candidate) => candidate === cli,
    })).toEqual({
      command: 'C:\\hostedtoolcache\\node\\node.exe',
      args: [cli, '-p', 'tsconfig.json'],
    });
  });
});
