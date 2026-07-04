import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../packages/liatir-cli/src/commands/version';

const rootDir = resolve(import.meta.dirname, '../..');
const cliPkg = JSON.parse(readFileSync(resolve(rootDir, 'packages/liatir-cli/package.json'), 'utf8')) as {
  version: string;
};

let tmpRoots: string[] = [];

/** Run `version()` from `cwd`, capturing everything written to stdout. */
async function captureVersion(cwd: string): Promise<string[]> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    lines.push(String(message ?? ''));
  });
  const previousCwd = process.cwd();
  try {
    process.chdir(cwd);
    await version();
  } finally {
    process.chdir(previousCwd);
    logSpy.mockRestore();
  }
  return lines;
}

/** Create a throwaway project with a fake @liatir/api install at `apiVersion`. */
function createProjectWithApi(apiVersion: string): string {
  const root = mkdtempSync(join(tmpdir(), 'liatir-version-'));
  tmpRoots.push(root);
  const apiDir = join(root, 'node_modules', '@liatir', 'api');
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo-plugin', version: '1.0.0' }, null, 2));
  writeFileSync(join(apiDir, 'package.json'), JSON.stringify({ name: '@liatir/api', version: apiVersion }, null, 2));
  return root;
}

afterEach(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpRoots = [];
});

describe('liatir -v', () => {
  it('prints only the CLI version when @liatir/api is not installed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-version-bare-'));
    tmpRoots.push(root);
    const lines = await captureVersion(root);
    expect(lines).toEqual([`@liatir/cli v${cliPkg.version}`]);
  });

  it('also prints the resolved @liatir/api version when it is installed in the project', async () => {
    const root = createProjectWithApi('9.9.9-test');
    const lines = await captureVersion(root);
    expect(lines).toEqual([`@liatir/cli v${cliPkg.version}`, '@liatir/api v9.9.9-test']);
  });

  it('resolves @liatir/api from a nested subdirectory of the project', async () => {
    const root = createProjectWithApi('2.3.4');
    const nested = join(root, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    const lines = await captureVersion(nested);
    expect(lines).toEqual([`@liatir/cli v${cliPkg.version}`, '@liatir/api v2.3.4']);
  });
});
