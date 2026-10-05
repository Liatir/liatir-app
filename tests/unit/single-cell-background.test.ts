import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function waitForExit(execution: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => { watcher.close(); reject(new Error('Detached child did not record its exit')); }, 8000);
    const check = () => {
      try {
        const record = JSON.parse(readFileSync(path.join(execution, 'exit.json'), 'utf8'));
        clearTimeout(timeout);
        watcher.close();
        resolve(record);
      } catch { /* Its next file event confirms the completed atomic record. */ }
    };
    const watcher = watch(execution, check);
    check();
  });
}

describe('single-cell detached driver', () => {
  it('survives its launcher exiting and records the real child exit', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'single-cell-driver-'));
    const helper = pathToFileURL(path.resolve('scripts/single-cell-background.mjs')).href;
    const source = `import { launchBackground } from ${JSON.stringify(helper)};
      console.log(JSON.stringify(launchBackground({directory: process.argv[1], cwd: process.cwd(),
        args: ['-e', 'setTimeout(() => process.exit(7), 500)']})));`;
    const launcher = spawnSync(process.execPath, ['--input-type=module', '-e', source, directory], { encoding: 'utf8' });
    expect(launcher.status, launcher.stderr).toBe(0);
    const { execution } = JSON.parse(launcher.stdout);
    const result = await waitForExit(execution);
    expect(result.code).toBe(7);
    expect(result.status).toBe('failed');
    expect(result.signal).toBeNull();
  }, 10000);

  it('executes the recorded external command and preserves its failure', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'single-cell-external-driver-'));
    const helper = pathToFileURL(path.resolve('scripts/single-cell-background.mjs')).href;
    const command = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/c', 'exit 9'] : ['-c', 'exit 9'];
    const source = `import { launchBackground } from ${JSON.stringify(helper)};
      console.log(JSON.stringify(launchBackground({directory: process.argv[1], cwd: process.cwd(),
        command: ${JSON.stringify(command)}, args: ${JSON.stringify(args)}})));`;
    const launcher = spawnSync(process.execPath, ['--input-type=module', '-e', source, directory], { encoding: 'utf8' });
    expect(launcher.status, launcher.stderr).toBe(0);
    const { execution } = JSON.parse(launcher.stdout);
    expect(JSON.parse(readFileSync(path.join(execution, 'request.json'), 'utf8')).command).toBe(command);
    expect(await waitForExit(execution)).toMatchObject({ code: 9, signal: null, status: 'failed' });
  }, 10000);
});
