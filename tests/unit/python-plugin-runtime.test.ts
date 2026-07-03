import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from '../../packages/liatir-cli/src/commands/build';
import { init } from '../../packages/liatir-cli/src/commands/init';

const rootDir = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const JSZip = require(resolve(rootDir, 'packages/liatir-cli/node_modules/jszip')) as any;

let tmpRoots: string[] = [];

afterEach(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpRoots = [];
});

describe('Python .lia plugin runtime', () => {
  it('scaffolds and packages Python plugins with a manifest-owned I/O contract', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-python-plugin-'));
    tmpRoots.push(root);
    const projectDir = join(root, 'python-length');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await init([
        projectDir,
        '--python',
        '--yes',
        '--display-name',
        'Python Length',
        '--description',
        'Counts characters with Python.',
        '--category',
        'Examples',
        '--tags',
        'python,test',
      ]);
      process.chdir(projectDir);
      await build();
    } finally {
      process.chdir(previousCwd);
      logSpy.mockRestore();
    }

    const bundleName = readdirSync(join(projectDir, '.liatir')).find((name) => name.endsWith('.lia'));
    expect(bundleName).toBeTruthy();

    const bundle = await JSZip.loadAsync(readFileSync(join(projectDir, '.liatir', bundleName!)));
    const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));

    expect(manifest).toMatchObject({
      name: 'Python Length',
      version: '1.0.0',
      runtime: 'python',
      category: 'Examples',
      tags: ['python', 'test'],
      inputSchema: {
        text: {
          type: 'string',
          required: true,
        },
      },
      outputSchema: {
        length: {
          type: 'number',
          format: 'integer',
        },
      },
      python: {
        entry: 'python/main.py',
        pythonRequirement: {
          minVersion: '3.10',
          maxVersionExclusive: '3.13',
        },
      },
    });
    expect(bundle.file('python/main.py')).toBeTruthy();
    expect(await bundle.file('python/main.py').async('string')).toContain('def main(input):');
  });

  it('keeps Python plugin runtime boxes separate from AI model runtimes', () => {
    const liaPlugins = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/lia_plugins.rs'), 'utf8');
    const aiRuntime = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/ai_runtime.rs'), 'utf8');

    expect(liaPlugins).toContain('const PYTHON_PLUGIN_ENV_ROOT: &str = "plugin-runtimes";');
    expect(liaPlugins).toContain('prepare_env(');
    expect(liaPlugins).toContain('spawn_in_env(');
    expect(liaPlugins).toContain('"runtime": "python"');
    expect(aiRuntime).toContain('const AI_PYTHON_ENV_ROOT: &str = "ai-runtimes";');
    expect(aiRuntime).not.toContain('plugin-runtimes');
  });
});
