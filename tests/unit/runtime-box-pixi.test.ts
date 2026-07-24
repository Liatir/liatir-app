import { describe, expect, it } from 'vitest';
import {
  findPixi,
  runtimeBoxCondaPackArguments,
  runtimeBoxPixiInstallArguments,
  runtimeBoxPixiLockArguments,
} from '../../scripts/runtime-box/pixi.mjs';

type RunResult = { status: number; stdout: string; stderr?: string; error?: Error };

/** Builds a fake process runner that records its calls and returns a scripted result. */
function stubRunner(result: RunResult) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runResult = (command: string, args: string[]) => {
    calls.push({ command, args });
    return result;
  };
  return { calls, runResult };
}

describe('Runtime Box pixi builder helpers', () => {
  it('accepts a pixi whose version exactly matches the recipe pin', () => {
    const { calls, runResult } = stubRunner({ status: 0, stdout: 'pixi 0.73.0\n' });
    const flags = new Map<string, string>();
    expect(findPixi(flags, '0.73.0', { runResult })).toBe('pixi');
    expect(calls).toEqual([{ command: 'pixi', args: ['--version'] }]);
  });

  it('honours an explicit --pixi path over PATH discovery', () => {
    const { calls, runResult } = stubRunner({ status: 0, stdout: 'pixi 0.73.0\n' });
    const flags = new Map<string, string>([['pixi', '/opt/pixi/bin/pixi']]);
    expect(findPixi(flags, '0.73.0', { runResult })).toBe('/opt/pixi/bin/pixi');
    expect(calls[0]?.command).toBe('/opt/pixi/bin/pixi');
  });

  it('rejects a missing pixi and a version mismatch', () => {
    const missing = stubRunner({ status: 127, stdout: '', error: new Error('ENOENT') });
    expect(() => findPixi(new Map(), '0.73.0', { runResult: missing.runResult })).toThrow(/pixi 0\.73\.0 is required/);

    const wrong = stubRunner({ status: 0, stdout: 'pixi 0.72.0\n' });
    expect(() => findPixi(new Map(), '0.73.0', { runResult: wrong.runResult })).toThrow(
      /Recipe requires pixi 0\.73\.0, found 0\.72\.0/,
    );
  });

  it('builds deterministic lock, install, and conda-pack argument vectors', () => {
    expect(runtimeBoxPixiLockArguments('/r/pixi.toml')).toEqual(['lock', '--manifest-path', '/r/pixi.toml']);
    expect(runtimeBoxPixiInstallArguments('/r/pixi.toml')).toEqual([
      'install', '--manifest-path', '/r/pixi.toml', '--frozen',
    ]);
    expect(runtimeBoxCondaPackArguments('/b/.pixi/envs/default', '/b/env.tar.gz')).toEqual([
      '-p', '/b/.pixi/envs/default', '-o', '/b/env.tar.gz', '--format', 'tar.gz',
    ]);
  });
});
