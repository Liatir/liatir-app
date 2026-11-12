import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateLiatirScript, LIATIR_PYTHON_SCRIPT_TEMPLATE, LIATIR_QUENTA_LOCAL_PROFILES, type LiatirPythonScript } from '@liatir/core';
import { installSvelteRuneStubs } from './support/svelte-runes';
installSvelteRuneStubs();
const harness = vi.hoisted(() => ({ files: new Map<string, string>(), workspace: {
  activeId: 'a', workspaces: [{ id: 'a' }, { id: 'b' }], init: async () => {},
} }));
vi.mock('$lib/api', () => ({ liatir: () => ({}) }));
vi.mock('$lib/stores/workspace.svelte', () => ({ workspaceStore: harness.workspace,
  SANDBOX_WORKSPACE_ID: '__test__', getDataPrefix: () => `workspaces/${harness.workspace.activeId}/` }));
vi.mock('$lib/stores/app-storage', () => ({ appStorage: {
  exists: async (path: string) => harness.files.has(path), readText: async (path: string) => harness.files.get(path)!,
  writeText: async (path: string, value: string) => { harness.files.set(path, value); },
} }));
const { pythonScripts } = await import('../../frontend/src/lib/stores/python-scripts.svelte');
const { liaPluginsStore } = await import('../../frontend/src/lib/stores/lia-plugins.svelte');
const { simulationPresets } = await import('../../frontend/src/lib/pipeline/simulation-presets');
const { contractRows, contractSchema } = await import('../../frontend/src/lib/tools/script-contract');

const ECHO = 'def main(ctx):\n    return {"message": ctx.input["message"]}\n';
function script(): LiatirPythonScript { return { id: 'script-a', name: 'Echo', language: 'python', folder: '', savedAt: 1,
  code: ECHO, inputSchema: { message: { type: 'string', required: true } },
  outputSchema: { message: { type: 'string', required: true } }, python: {} }; }

beforeEach(() => { harness.files.clear(); harness.workspace.activeId = 'a'; pythonScripts.reset(); liaPluginsStore.reset(); });

describe('shared Plugin migration', () => {
  it('preserves both pipeline IDs for one imported path and never resurrects a removed import', async () => {
    const base = { name: 'Shared', version: '1', runtime: 'python', path: '/shared.lia', inputSchema: {}, outputSchema: {}, addedAt: 1 };
    harness.files.set('workspaces/a/liatir-plugins.json', JSON.stringify([{ ...base, id: 'from-a' }]));
    harness.files.set('workspaces/b/liatir-plugins.json', JSON.stringify([{ ...base, id: 'from-b' }]));
    await Promise.all([liaPluginsStore.init(), liaPluginsStore.init()]);
    expect(liaPluginsStore.plugins.map(plugin => plugin.id)).toEqual(['from-a', 'from-b']);
    await liaPluginsStore.remove('from-a');
    harness.workspace.activeId = 'b'; liaPluginsStore.reset(); await liaPluginsStore.init();
    expect(liaPluginsStore.plugins.map(plugin => plugin.id)).toEqual(['from-b']);
    expect(harness.files.has('workspaces/a/liatir-plugins.json')).toBe(true);
  });
  it('refuses conflicting identities without replacing the source catalogs', async () => {
    harness.files.set('workspaces/a/liatir-plugins.json', JSON.stringify([{ id: 'same', path: '/a.lia' }]));
    harness.files.set('workspaces/b/liatir-plugins.json', JSON.stringify([{ id: 'same', path: '/b.lia' }]));
    await expect(liaPluginsStore.init()).rejects.toThrow(/collision/);
    expect(harness.files.has('plugins/catalog-v1.json')).toBe(false);
  });
});

describe('workspace Python Scripts', () => {
  it('copies an independent definition without source runs or Results', async () => {
    const original = script(); await pythonScripts.save(original);
    const id = await pythonScripts.copyTo(original.id, 'b');
    await pythonScripts.save({ ...original, code: 'def main(ctx):\n    return {"message":"edited"}\n' });
    harness.workspace.activeId = 'b'; pythonScripts.reset(); await pythonScripts.init();
    expect(pythonScripts.byId(id)?.code).toBe(original.code);
    expect(pythonScripts.byId(original.id)).toBeUndefined();
    expect([...harness.files.keys()].some(path => path.includes('/runs/') || path.includes('analysis-runs'))).toBe(false);
  });
  it('requires explicit valid contracts and Python source', () => {
    expect(() => validateLiatirScript({ ...script(), inputSchema: undefined! })).toThrow(/contract/);
    expect(() => validateLiatirScript({ ...script(), outputSchema: { bad: { type: 'nope' as never } } })).toThrow(/Invalid/);
    expect(() => validateLiatirScript({ ...script(), code: '' })).toThrow(/source/);
    expect(() => validateLiatirScript({ ...script(), python: { requirements: ['pandas', 'numpy>=1.26'] } })).not.toThrow();
    // Package names only: an option could redirect where installed code comes from.
    expect(() => validateLiatirScript({ ...script(), python: { requirements: ['--index-url=http://example.test'] } })).toThrow(/package/);
  });
});

it('refuses to save a contract with an unnamed, invalid or repeated field instead of dropping it', () => {
  const field = { type: 'number' as const, required: true };
  expect(contractSchema(contractRows({ a: field, b: field }), 'input')).toEqual({ a: field, b: field });
  const rows = (...names: string[]) => names.map((name) => ({ id: name + Math.random(), name, field }));
  expect(() => contractSchema(rows(''), 'input')).toThrow(/Give this input a name/);
  expect(() => contractSchema(rows('2nd'), 'output')).toThrow(/Outputs: Use only letters/);
  expect(() => contractSchema(rows('x', ' x '), 'input')).toThrow(/already uses this name/);
});

describe('mandatory Python SDK enforcement', () => {
  function run(code: string, inputs: unknown, expectedOutput: LiatirPythonScript['outputSchema'] = { message: { type: 'string', required: true } },
    inputSchema: LiatirPythonScript['inputSchema'] = script().inputSchema) {
    const dir = mkdtempSync(join(tmpdir(), 'liatir-script-test-'));
    try {
      writeFileSync(join(dir, 'main.py'), code);
      writeFileSync(join(dir, 'runner.py'), readFileSync(resolve('src-tauri/src/bridge/script_runner.py')));
      writeFileSync(join(dir, 'liatir.py'), readFileSync(resolve('packages/liatir-cli/src/assets/liatir.py')));
      writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ ...script(), inputSchema, outputSchema: expectedOutput }));
      return spawnSync('python3', [join(dir, 'runner.py')], { input: JSON.stringify(inputs), encoding: 'utf8', env: { ...process.env, LIATIR_SCRIPT_OUTPUT_DIR: dir } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  it('executes plain main(ctx) through the Plugin SDK and validates both sides', () => {
    const good = run(script().code, { message: 'preserved' });
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout).toContain('__LIATIR_RESULT__{"message": "preserved"}');
    expect(run(script().code, {}).status).not.toBe(0);
    const fileResult = run('from pathlib import Path\ndef main(ctx):\n    Path("output.csv").write_text("value\\n7\\n")\n    return {"message":"output.csv"}\n', { message: 'test' }, { message: { type: 'file', required: true } });
    expect(fileResult.status, fileResult.stderr).toBe(0);
    expect(JSON.parse(fileResult.stdout.split('__LIATIR_RESULT__')[1]).message).toMatch(/liatir-script-test-.*output.csv$/);
    expect(run('def main(ctx):\n    return {"message": 3}\n', { message: 'test' }).stderr).toMatch(/LiatirOutputError/);
    expect(run('def main(ctx):\n    return {"message": "ok", "undeclared": 1}\n', { message: 'test' }).status).not.toBe(0);
    expect(run('def main(ctx):\n    return {"message": 3}\nmain.__liatir_plugin__ = True\n', { message: 'test' }).status).not.toBe(0);
  });
  it('runs the starting code of a new script as is, with no inputs and no outputs', () => {
    const fresh = run(LIATIR_PYTHON_SCRIPT_TEMPLATE, {}, {}, {});
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.stdout).toContain('__LIATIR_RESULT__{}');
    expect(LIATIR_PYTHON_SCRIPT_TEMPLATE).toContain('# Write your code here...');
  });
  it('checks syntax before importing any user code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'liatir-no-import-')); const sideEffect = join(directory, 'side-effect');
    try {
      const bad = run(`open(${JSON.stringify(sideEffect)}, 'w').close()\ndef main(ctx)\n    return {}\n`, { message: 'test' });
      expect(bad.status).not.toBe(0); expect(existsSync(sideEffect)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

it('instantiates seven presets with stable declared port wiring and fresh graph identities', () => {
  expect(simulationPresets).toHaveLength(7);
  const ids = new Set<string>();
  for (const preset of simulationPresets) {
    expect(preset.requirements).toMatch(/Linux.*Windows/);
    for (let repeat = 0; repeat < 2; repeat++) {
      const graph = preset.instantiate();
      for (const node of graph.nodes) { expect(ids.has(node.id)).toBe(false); ids.add(node.id); }
      for (const edge of graph.edges) {
        expect(graph.nodes.some(node => node.id === edge.source)).toBe(true);
        expect(graph.nodes.some(node => node.id === edge.target)).toBe(true);
      }
    }
  }
});

it('offers explicit 16 GB and 32 GB profiles', () => {
  expect(LIATIR_QUENTA_LOCAL_PROFILES.map(profile => [profile.memoryGb, profile.model])).toEqual([[16, 'qwen3.5:9b'], [32, 'qwen3.8:27b']]);
});


it('retains the viewer blob-script capability when adding a development frame policy', () => {
  for (const name of ['dev', 'local.dev', 'prod']) {
    const config = JSON.parse(readFileSync(resolve(`conf-templates/tauri.conf.template.${name}.json`), 'utf8'));
    const directives = Object.fromEntries(config.app.security.csp.split(';').map((value: string) => {
      const [name, ...sources] = value.trim().split(/\s+/); return [name, sources];
    }));
    expect(directives['script-src']).toContain('blob:');
    expect(directives['frame-src']).not.toContain('https:');
  }
});
