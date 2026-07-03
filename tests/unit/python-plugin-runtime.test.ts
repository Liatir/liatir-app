import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from '../../packages/liatir-cli/src/commands/build';
import { init } from '../../packages/liatir-cli/src/commands/init';

const rootDir = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const JSZip = require(resolve(rootDir, 'packages/liatir-cli/node_modules/jszip')) as any;

let tmpRoots: string[] = [];

function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function venvPython(venvDir: string): string {
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');
}

async function builtBundle(projectDir: string): Promise<any> {
  const bundleName = readdirSync(join(projectDir, '.liatir')).find((name) => name.endsWith('.lia'));
  expect(bundleName).toBeTruthy();
  return JSZip.loadAsync(readFileSync(join(projectDir, '.liatir', bundleName!)));
}

async function runPythonMainFromBundle(bundle: any, input: Record<string, unknown>, python = findPython()): Promise<Record<string, unknown> | null> {
  if (!python) return null;
  const root = mkdtempSync(join(tmpdir(), 'liatir-python-run-'));
  tmpRoots.push(root);
  const sourceDir = join(root, 'python');
  mkdirSync(sourceDir, { recursive: true });

  for (const name of Object.keys(bundle.files)) {
    if (!name.startsWith('python/') || name.endsWith('/')) continue;
    const relative = name.slice('python/'.length);
    const target = join(sourceDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await bundle.file(name).async('nodebuffer'));
  }

  const script = `
import importlib.util
import json
import pathlib
import sys

entry = pathlib.Path("main.py").resolve()
sys.path.insert(0, str(entry.parent))
spec = importlib.util.spec_from_file_location("_liatir_test_plugin", entry)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(module.main(${JSON.stringify(input)})))
`;
  const output = execFileSync(python, ['-c', script], {
    cwd: sourceDir,
    encoding: 'utf8',
  });
  return JSON.parse(output.trim()) as Record<string, unknown>;
}

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

  it('builds and runs the Python stdlib fixture through the packaged I/O contract', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-python-fixture-'));
    tmpRoots.push(root);
    const projectDir = join(root, 'python-stdlib-plugin');
    cpSync(resolve(rootDir, 'tests/fixtures/python-stdlib-plugin'), projectDir, { recursive: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.chdir(projectDir);
      await build();
    } finally {
      process.chdir(previousCwd);
      logSpy.mockRestore();
    }

    const bundle = await builtBundle(projectDir);
    const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));
    expect(manifest.runtime).toBe('python');
    expect(manifest.python.entry).toBe('python/main.py');

    const result = await runPythonMainFromBundle(bundle, { text: 'hello from Liatir' });
    if (!result) return;
    expect(result).toMatchObject({
      length: 17,
      words: 3,
    });
    expect(result.summary).toMatchObject({
      uppercasePreview: 'HELLO FROM LIATIR',
    });
  });

  it('can run a Python plugin with a small declared dependency when explicitly enabled', async () => {
    if (process.env.LIATIR_RUN_PLUGIN_PYTHON_DEPS !== '1') return;
    const python = findPython();
    if (!python) return;

    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-python-dep-plugin-'));
    tmpRoots.push(root);
    const projectDir = join(root, 'python-colorama-plugin');
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'requirements.txt'), 'colorama==0.4.6\n');
    writeFileSync(join(projectDir, '.lia-manifest.json'), JSON.stringify({
      name: 'Python Dependency Fixture',
      version: '1.0.0',
      description: 'Fixture plugin with one small Python dependency.',
      runtime: 'python',
      category: 'Tests',
      tags: ['python', 'dependency'],
      inputSchema: {
        text: { type: 'string', label: 'Text', required: true },
      },
      outputSchema: {
        colored: { type: 'string', label: 'Colored text' },
      },
      python: {
        entry: 'src/main.py',
        pythonRequirement: { minVersion: '3.10', maxVersionExclusive: '3.13' },
      },
    }, null, 2));
    writeFileSync(join(projectDir, 'src/main.py'), [
      'from colorama import Fore, Style',
      '',
      'def main(input):',
      '    text = str(input.get("text", ""))',
      '    return {"colored": Fore.GREEN + text + Style.RESET_ALL}',
      '',
    ].join('\n'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.chdir(projectDir);
      await build();
    } finally {
      process.chdir(previousCwd);
      logSpy.mockRestore();
    }

    const bundle = await builtBundle(projectDir);
    const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));
    expect(manifest.python.requirements).toEqual(['colorama==0.4.6']);

    const venvDir = join(root, 'venv');
    execFileSync(python, ['-m', 'venv', venvDir], { stdio: 'inherit' });
    const py = venvPython(venvDir);
    execFileSync(py, ['-m', 'pip', 'install', 'colorama==0.4.6'], { stdio: 'inherit' });
    const result = await runPythonMainFromBundle(bundle, { text: 'ok' }, py);
    expect(result?.colored).toContain('ok');
  }, 120_000);

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
