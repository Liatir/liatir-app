import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localNodeCliInvocation } from '../../scripts/node-cli.mjs';
import { resolveHeartbeatInvocation } from '../../scripts/runtime-box/heartbeat.mjs';

const childProcessOwners = [
  'scripts/build-browser-api.mjs',
  'scripts/build-tauri-test-binary.mjs',
  'scripts/publish-liatir-packages.mjs',
  'scripts/run-runtime-box-product-lifecycle.mjs',
  'scripts/runtime-box-ci.mjs',
  'scripts/runtime-box/heartbeat.mjs',
  'scripts/smoke-tauri-dev.mjs',
  'tests/e2e/specs/python-plugins.e2e.mjs',
  'tests/test-matrix.mjs',
];

const WINDOWS_NPM_CLI = 'C:\\hostedtoolcache\\node\\node_modules\\npm\\bin\\npm-cli.js';
const WINDOWS_NODE = 'C:\\hostedtoolcache\\node\\node.exe';

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

describe('Runtime Box heartbeat command resolution', () => {
  it('routes npm through its JavaScript CLI on Windows so the shell-free spawn is not ENOENT', () => {
    expect(resolveHeartbeatInvocation('npm', ['run', 'runtime-box:test:native'], {
      platform: 'win32',
      nodeExecutable: WINDOWS_NODE,
      npmExecutable: WINDOWS_NPM_CLI,
      fileExists: (candidate: string) => candidate === WINDOWS_NPM_CLI,
    })).toEqual({
      command: WINDOWS_NODE,
      args: [WINDOWS_NPM_CLI, 'run', 'runtime-box:test:native'],
    });
  });

  it('passes npm through unchanged off Windows', () => {
    expect(resolveHeartbeatInvocation('npm', ['run', 'x'], { platform: 'linux' })).toEqual({
      command: 'npm',
      args: ['run', 'x'],
    });
  });

  it('never rewrites non-npm commands such as cargo', () => {
    expect(resolveHeartbeatInvocation('cargo', ['test', 'runtime_box'], { platform: 'win32' })).toEqual({
      command: 'cargo',
      args: ['test', 'runtime_box'],
    });
  });
});
