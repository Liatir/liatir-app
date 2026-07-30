import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_PATHS,
  SCROLLCASE_CONFIG_FILENAME,
  configureWorkspace,
  findWorkspaceConfig,
  getWorkspace,
  resetWorkspace,
  resolveWorkspace,
  workspaceOverridesFromArgv,
  workspaceOverridesFromFlags,
} from '../../scripts/runtime-box/workspace.mjs';

/** Creates a throwaway project directory, optionally holding a workspace config. */
async function makeProject(config?: unknown): Promise<string> {
  // macOS reports /var as a symlink to /private/var, so compare resolved paths.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-workspace-')));
  if (config !== undefined) {
    await writeFile(join(root, SCROLLCASE_CONFIG_FILENAME), `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

describe('scrollcase workspace resolution', () => {
  const created: string[] = [];

  afterEach(async () => {
    resetWorkspace();
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('falls back to the historical layout relative to the working directory', async () => {
    const root = await makeProject();
    created.push(root);
    const workspace = resolveWorkspace({ cwd: root });
    expect(workspace.configPath).toBeNull();
    expect(workspace.root).toBe(root);
    expect(workspace.scrollsDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.scrolls));
    expect(workspace.recipesDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.recipes));
    expect(workspace.buildDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.build));
    expect(workspace.distDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.dist));
    expect(workspace.keysDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.keys));
    expect(workspace.toolchainDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.toolchain));
  });

  it('discovers the project config by walking up from a nested working directory', async () => {
    const root = await makeProject({ version: 1, paths: { scrolls: 'boxes' } });
    created.push(root);
    const nested = join(root, 'deep', 'nested', 'dir');
    await mkdir(nested, { recursive: true });
    expect(findWorkspaceConfig(nested)).toBe(join(root, SCROLLCASE_CONFIG_FILENAME));
    const workspace = resolveWorkspace({ cwd: nested });
    expect(workspace.root).toBe(root);
    // Config paths resolve against the project root, not the working directory.
    expect(workspace.scrollsDir).toBe(join(root, 'boxes'));
    expect(workspace.distDir).toBe(resolve(root, DEFAULT_WORKSPACE_PATHS.dist));
  });

  it('lets a flag override the config, resolving it against the working directory', async () => {
    const root = await makeProject({ version: 1, paths: { scrolls: 'boxes', dist: 'out' } });
    created.push(root);
    const nested = join(root, 'work');
    await mkdir(nested, { recursive: true });
    const workspace = resolveWorkspace({
      cwd: nested,
      overrides: workspaceOverridesFromFlags(new Map([['out-dir', 'artefacts']])),
    });
    expect(workspace.root).toBe(root);
    expect(workspace.distDir).toBe(join(nested, 'artefacts'));
    expect(workspace.scrollsDir).toBe(join(root, 'boxes'));
  });

  it('accepts the toolchain path emitted by the published Scrollcase initializer', async () => {
    const root = await makeProject({
      version: 1,
      paths: {
        scrolls: 'scrolls',
        build: '.scrollcase/build',
        dist: '.scrollcase/dist',
        keys: '.scrollcase/keys',
        toolchain: '.scrollcase/toolchain',
      },
    });
    created.push(root);
    const workspace = resolveWorkspace({ cwd: root });
    expect(workspace.toolchainDir).toBe(join(root, '.scrollcase', 'toolchain'));
    expect(workspace.scrollsDir).toBe(join(root, 'scrolls'));

    const overridden = resolveWorkspace({
      cwd: root,
      overrides: workspaceOverridesFromFlags(
        new Map([['toolchain-dir', 'checked-toolchain']]),
      ),
    });
    expect(overridden.toolchainDir).toBe(join(root, 'checked-toolchain'));
  });

  it('accepts absolute path overrides and an explicit project root', async () => {
    const root = await makeProject();
    created.push(root);
    const elsewhere = await makeProject();
    created.push(elsewhere);
    const workspace = resolveWorkspace({
      cwd: root,
      overrides: { projectRoot: elsewhere, dist: join(elsewhere, 'dist') },
    });
    expect(workspace.root).toBe(elsewhere);
    expect(workspace.distDir).toBe(join(elsewhere, 'dist'));
    expect(workspace.recipesDir).toBe(resolve(elsewhere, DEFAULT_WORKSPACE_PATHS.recipes));
  });

  it('reads an explicitly named config and roots the project at its directory', async () => {
    const root = await makeProject({ version: 1, paths: { build: 'scratch' } });
    created.push(root);
    const workspace = resolveWorkspace({
      cwd: tmpdir(),
      overrides: workspaceOverridesFromArgv(['--config', join(root, SCROLLCASE_CONFIG_FILENAME)]),
    });
    expect(workspace.root).toBe(root);
    expect(workspace.buildDir).toBe(join(root, 'scratch'));
  });

  it('reads workspace flags out of raw arguments in both forms and ignores the rest', async () => {
    expect(workspaceOverridesFromArgv([
      '--model', 'x',
      '--scrolls-dir', 's',
      '--recipes-dir', 'r',
      '--out-dir=o',
      '--toolchain-dir', 't',
    ])).toEqual({
      scrolls: 's',
      recipes: 'r',
      dist: 'o',
      toolchain: 't',
    });
    expect(workspaceOverridesFromArgv(['--mode', 'build'])).toEqual({});
  });

  it('rejects a malformed, misversioned, or unknown-key config instead of falling back', async () => {
    const badJson = await makeProject();
    created.push(badJson);
    await writeFile(join(badJson, SCROLLCASE_CONFIG_FILENAME), '{ not json');
    expect(() => resolveWorkspace({ cwd: badJson })).toThrow(/Invalid scrollcase.config.json/);

    const badVersion = await makeProject({ version: 2 });
    created.push(badVersion);
    expect(() => resolveWorkspace({ cwd: badVersion })).toThrow(/Unsupported scrollcase.config.json version 2/);

    const badKey = await makeProject({ version: 1, paths: { recipe: 'typo' } });
    created.push(badKey);
    expect(() => resolveWorkspace({ cwd: badKey })).toThrow(/Unknown "paths" entry "recipe"/);

    const badValue = await makeProject({ version: 1, paths: { scrolls: '' } });
    created.push(badValue);
    expect(() => resolveWorkspace({ cwd: badValue })).toThrow(/Invalid "paths.scrolls"/);
  });

  it('fails loudly when an explicitly named config does not exist', async () => {
    const root = await makeProject();
    created.push(root);
    expect(() => resolveWorkspace({ cwd: root, overrides: { config: 'missing.json' } }))
      .toThrow(/Workspace config not found/);
  });

  it('memoizes the configured workspace for the process', async () => {
    const root = await makeProject({ version: 1, paths: { dist: 'out' } });
    created.push(root);
    const configured = configureWorkspace({ cwd: root });
    expect(getWorkspace()).toBe(configured);
    expect(getWorkspace().distDir).toBe(join(root, 'out'));
    resetWorkspace();
    expect(getWorkspace()).not.toBe(configured);
  });
});
