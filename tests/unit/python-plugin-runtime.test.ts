import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, buildDevBundle } from '../../packages/liatir-cli/src/commands/build';
import { dev } from '../../packages/liatir-cli/src/commands/dev';
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

async function loadBundle(bundlePath: string): Promise<any> {
  return JSZip.loadAsync(readFileSync(bundlePath));
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

function hasWasmToolchain(): boolean {
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    const targets = execFileSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
    return targets.split(/\r?\n/).includes('wasm32-wasip1');
  } catch {
    return false;
  }
}

type DevRuntime = 'node' | 'python' | 'wasm';

function createNodeDevProject(root: string): string {
  const projectDir = join(root, 'node-dev-plugin');
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: 'node-dev-plugin',
    version: '1.0.0',
    description: 'Node dev fixture.',
  }, null, 2));
  writeFileSync(join(projectDir, 'src', 'index.js'), `
export default {
  __liatirPlugin: true,
  inputs: {
    text: { type: "string", label: "Text", required: true },
  },
  outputs: {
    length: { type: "number", label: "Length", format: "integer" },
  },
  async run(input) {
    return { length: String(input.text ?? "").length };
  },
};
`);
  return projectDir;
}

function createPythonDevProject(root: string): string {
  const projectDir = join(root, 'python-stdlib-plugin');
  mkdirSync(root, { recursive: true });
  cpSync(resolve(rootDir, 'tests/fixtures/python-stdlib-plugin'), projectDir, { recursive: true });
  return projectDir;
}

function createWasmDevProject(root: string): string {
  const projectDir = join(root, 'wasm-dev-plugin');
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  writeFileSync(join(projectDir, 'Cargo.toml'), `
[package]
name = "wasm_dev_plugin"
version = "1.0.0"
edition = "2021"

[[bin]]
name = "wasm_dev_plugin"
path = "src/main.rs"
`);
  writeFileSync(join(projectDir, 'src', 'main.rs'), `
fn main() {
    println!("{}", r#"{"length":0}"#);
}
`);
  writeFileSync(join(projectDir, '.lia-manifest.json'), JSON.stringify({
    name: 'WASM Dev Plugin',
    version: '1.0.0',
    description: 'WASM dev fixture.',
    runtime: 'wasm',
    inputSchema: {
      text: { type: 'string', label: 'Text', required: true },
    },
    outputSchema: {
      length: { type: 'number', label: 'Length', format: 'integer' },
    },
  }, null, 2));
  return projectDir;
}

function createDevProject(root: string, runtime: DevRuntime): string {
  if (runtime === 'node') return createNodeDevProject(root);
  if (runtime === 'python') return createPythonDevProject(root);
  return createWasmDevProject(root);
}

async function runDevWithFakeIpc(projectDir: string): Promise<string[]> {
  const token = 'test-token';
  const commands: string[] = [];
  const ipcRoot = mkdtempSync(join(tmpdir(), 'liatir-dev-ipc-'));
  tmpRoots.push(ipcRoot);
  const ipcFile = join(ipcRoot, '.ipc');
  writeFileSync(ipcFile, JSON.stringify({ port: 45678, token }));

  const previousCwd = process.cwd();
  const previousIpcFile = process.env.LIATIR_IPC_FILE;
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe(`Bearer ${token}`);
    const payload = JSON.parse(String(init?.body ?? '{}')) as { cmd?: string };
    commands.push(payload.cmd ?? '');
    const result = payload.cmd === 'lia_plugin_dev_get_session' ? null : {};
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    process.chdir(projectDir);
    process.env.LIATIR_IPC_FILE = ipcFile;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      dev([]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`liatir dev did not stop after fake IPC session; commands: ${commands.join(', ')}`));
        }, 10_000);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  } finally {
    process.chdir(previousCwd);
    if (previousIpcFile === undefined) {
      delete process.env.LIATIR_IPC_FILE;
    } else {
      process.env.LIATIR_IPC_FILE = previousIpcFile;
    }
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }

  return commands;
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
    expect(bundleName).toBe('python-length.lia');

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
    expect(readdirSync(join(projectDir, '.liatir')).find((name) => name.endsWith('.lia'))).toBe('python-stdlib-plugin.lia');
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

  it('reports nearby plugin roots instead of falling through to the Node package.json error', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-python-parent-'));
    tmpRoots.push(root);
    const projectDir = join(root, 'python-stdlib-plugin');
    cpSync(resolve(rootDir, 'tests/fixtures/python-stdlib-plugin'), projectDir, { recursive: true });

    try {
      process.chdir(root);
      let error: unknown;
      try {
        await buildDevBundle();
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/No Liatir plugin project found/);
      expect((error as Error).message).toMatch(/python-stdlib-plugin \(python\)/);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('builds a Node dev bundle from the plugin root', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-node-dev-'));
    tmpRoots.push(root);
    const projectDir = createNodeDevProject(root);

    try {
      process.chdir(projectDir);
      const result = await buildDevBundle();
      expect(result.runtime).toBe('node');
      expect(result.path).toMatch(/[\\/]\.lia-dev[\\/]current\.lia$/);
      const bundle = await loadBundle(result.path);
      const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));
      expect(manifest.runtime).toBe('node');
      expect(manifest.inputSchema.text.type).toBe('string');
      expect(manifest.outputSchema.length.type).toBe('number');
      expect(bundle.file('index.js')).toBeTruthy();
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('reflects Node schema edits across rebuilds in the same dev process', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-node-dev-reload-'));
    tmpRoots.push(root);
    const projectDir = createNodeDevProject(root);
    const entry = join(projectDir, 'src', 'index.js');

    const readManifest = async () => {
      const result = await buildDevBundle();
      const bundle = await loadBundle(result.path);
      return JSON.parse(await bundle.file('manifest.json').async('string'));
    };

    try {
      process.chdir(projectDir);

      const firstManifest = await readManifest();
      expect(Object.keys(firstManifest.inputSchema)).toEqual(['text']);

      // Change the declared input schema and rebuild in the SAME process. The
      // dev-bundle path is stable, so a cached ESM import would keep serving the
      // first module and miss this edit (regression guard for that bug).
      writeFileSync(entry, `
export default {
  __liatirPlugin: true,
  inputs: {
    renamed: { type: "string", label: "Renamed", required: true },
  },
  outputs: {
    length: { type: "number", label: "Length", format: "integer" },
  },
  async run(input) {
    return { length: String(input.renamed ?? "").length };
  },
};
`);

      const secondManifest = await readManifest();
      expect(Object.keys(secondManifest.inputSchema)).toEqual(['renamed']);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('builds a Python dev bundle from the plugin root', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-python-dev-'));
    tmpRoots.push(root);
    const projectDir = createPythonDevProject(root);

    try {
      process.chdir(projectDir);
      const result = await buildDevBundle();
      expect(result.runtime).toBe('python');
      expect(result.path).toMatch(/[\\/]\.lia-dev[\\/]current\.lia$/);
      const bundle = await loadBundle(result.path);
      const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));
      expect(manifest.runtime).toBe('python');
      expect(manifest.python.entry).toBe('python/main.py');
      expect(bundle.file('python/main.py')).toBeTruthy();
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('builds a WASM dev bundle from the plugin root when the Rust WASI target is available', async () => {
    if (!hasWasmToolchain()) return;
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'liatir-wasm-dev-'));
    tmpRoots.push(root);
    const projectDir = createWasmDevProject(root);

    try {
      process.chdir(projectDir);
      const result = await buildDevBundle();
      expect(result.runtime).toBe('wasm');
      expect(result.path).toMatch(/[\\/]\.lia-dev[\\/]current\.lia$/);
      const bundle = await loadBundle(result.path);
      const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));
      expect(manifest.runtime).toBe('wasm');
      expect(manifest.inputSchema.text.type).toBe('string');
      expect(manifest.outputSchema.length.type).toBe('number');
      expect(bundle.file('plugin.wasm')).toBeTruthy();
    } finally {
      process.chdir(previousCwd);
    }
  }, 120_000);

  it('publishes Node, Python, and WASM dev bundles through the app-backed dev IPC flow', async () => {
    const runtimes: DevRuntime[] = hasWasmToolchain() ? ['node', 'python', 'wasm'] : ['node', 'python'];
    const root = mkdtempSync(join(tmpdir(), 'liatir-dev-ipc-projects-'));
    tmpRoots.push(root);

    for (const runtime of runtimes) {
      const projectDir = createDevProject(join(root, runtime), runtime);
      const commands = await runDevWithFakeIpc(projectDir);
      expect(commands).toContain('lia_plugin_dev_update_session');
      expect(commands).toContain('lia_plugin_dev_open_session');
      expect(commands).toContain('lia_plugin_dev_get_session');
      const bundle = await loadBundle(join(projectDir, '.lia-dev', 'current.lia'));
      const manifest = JSON.parse(await bundle.file('manifest.json').async('string'));
      expect(manifest.runtime).toBe(runtime);
    }
  }, 180_000);

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
    // Venv identity must come from the dependency spec, not the bundle bytes,
    // so code-only edits in `liatir dev` reuse the same environment.
    expect(liaPlugins).toContain('fn python_spec_hash');
    expect(liaPlugins).toContain('python_env_id_for_manifest');
    expect(liaPlugins).toContain('metadata_map.insert("runtime".to_string(), Value::String("python".to_string()))');
    expect(aiRuntime).toContain('const AI_PYTHON_ENV_ROOT: &str = "ai-runtimes";');
    expect(aiRuntime).not.toContain('plugin-runtimes');
  });

  it('keeps liatir dev in a temporary app-backed session instead of importing real plugins', () => {
    const devCommand = readFileSync(resolve(rootDir, 'packages/liatir-cli/src/commands/dev.ts'), 'utf8');
    const api = readFileSync(resolve(rootDir, 'packages/liatir-api/src/index.ts'), 'utf8');
    const pluginDev = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/plugin_dev.rs'), 'utf8');
    const liaPlugins = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/lia_plugins.rs'), 'utf8');
    const ipcServer = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/ipc_server.rs'), 'utf8');
    const jobs = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/jobs.rs'), 'utf8');

    expect(devCommand).toContain('buildDevBundle');
    expect(devCommand).toContain('lia_plugin_dev_update_session');
    expect(devCommand).toContain('lia_plugin_dev_open_session');
    expect(devCommand).toContain('lia_plugin_dev_end_session');
    expect(devCommand).toContain('Liatir desktop app is required');
    expect(devCommand).toContain('https://liatir.com/plugins');
    expect(devCommand).not.toContain('child_process.spawn("python3"');
    expect(devCommand).not.toContain('esbuildContext');

    expect(pluginDev).toContain('PluginDevRegistry');
    expect(pluginDev).toContain('/plugin-dev?session=');
    expect(pluginDev).toContain('"lia-plugin-dev"');
    expect(pluginDev).toContain('PYTHON_PLUGIN_DEV_ENV_ROOT');
    expect(pluginDev).toContain('LIATIR_RUN_SCOPE');
    expect(pluginDev).toContain('LIATIR_DEV_SESSION_ID');
    expect(pluginDev).toContain('SANDBOX_WORKSPACE_ID');
    expect(liaPlugins).toContain('pub(crate) const PYTHON_PLUGIN_DEV_ENV_ROOT: &str = "plugin-dev-runtimes";');
    expect(liaPlugins).toContain('workspace_id: Option<String>');
    expect(liaPlugins).toContain('env: Option<HashMap<String, String>>');
    expect(api).toContain('readDevContextFromEnv');
    expect(api).toContain('withDevSpawnOptions');
    expect(api).toContain('pluginDevSessionId');
    expect(ipcServer).toContain('DEV_CONTEXT_PAYLOAD_KEY');
    expect(ipcServer).toContain('scope_dev_fs_payload');
    expect(ipcServer).toContain('lia-plugin-dev-child');
    expect(jobs).toContain('include_dev');
    expect(jobs).toContain('is_dev_job');
  });

  it('keeps liatir dev sessions sandboxed and free of global residues', () => {
    const ipcServer = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/ipc_server.rs'), 'utf8');
    const pluginDev = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/plugin_dev.rs'), 'utf8');
    const startupCleanup = readFileSync(resolve(rootDir, 'src-tauri/src/bridge/startup_cleanup.rs'), 'utf8');

    // Global/destructive bridge commands are refused inside dev sessions.
    expect(ipcServer).toContain('DEV_BLOCKED_COMMANDS');
    expect(ipcServer).toContain('"lia_app_exit"');
    expect(ipcServer).toContain('"lia_fs_clear_data"');
    expect(ipcServer).toContain('"lia_plugin_add_module"');
    // Per-job commands only reach jobs inside the sandbox workspace.
    expect(ipcServer).toContain('ensure_dev_job_access');
    // Global variables are namespaced per dev session.
    expect(ipcServer).toContain('dev_global_var_key');
    expect(pluginDev).toContain('session_global_vars_prefix');
    // Session ids reach fs paths, so they are validated at the boundary.
    expect(pluginDev).toContain('validate_session_id');
    // Dev sessions are volatile: end-of-session and startup cleanup.
    expect(pluginDev).toContain('cleanup_orphan_dev_residues');
    expect(pluginDev).toContain('session_sandbox_rel');
    expect(startupCleanup).toContain('cleanup_orphan_dev_residues');
  });

  it('keeps the npm publish helper responsible for synced CLI/API version bumps', () => {
    const publishScript = readFileSync(resolve(rootDir, 'scripts/publish-liatir-packages.mjs'), 'utf8');
    const initCommand = readFileSync(resolve(rootDir, 'packages/liatir-cli/src/commands/init.ts'), 'utf8');
    const cliPkg = JSON.parse(readFileSync(resolve(rootDir, 'packages/liatir-cli/package.json'), 'utf8'));
    const apiPkg = JSON.parse(readFileSync(resolve(rootDir, 'packages/liatir-api/package.json'), 'utf8'));
    expect(publishScript).toContain('bumpVersion');
    expect(publishScript).toContain('updatePackageVersionFiles');
    expect(publishScript).toContain('updateInitTemplateVersion');
    expect(publishScript).toContain('--minor');
    expect(publishScript).toContain('--major');
    expect(publishScript).toContain('--version <ver>');
    expect(publishScript).toContain('Target version');
    expect(publishScript).toContain('must be greater than current package baseline');
    expect(initCommand).toContain(`"@liatir/cli": "^${cliPkg.version}"`);
    expect(initCommand).toContain(`"@liatir/api": "^${apiPkg.version}"`);
  });
});
