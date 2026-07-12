/**
 * Python `.lia` plugins end to end: import, prepare the environment, run.
 *
 * The environment preparation is the reason this has to be a real test — a Python plugin is the one kind that can
 * be installed and still not be runnable, and that gap only exists on a real machine.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  openSandboxWorkspace,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

function execChecked(command, args, options) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
  } catch (error) {
    const stdout = error.stdout ? `\nstdout:\n${error.stdout}` : '';
    const stderr = error.stderr ? `\nstderr:\n${error.stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed.${stdout}${stderr}`);
  }
}

function buildPythonFixture(rootDir, artifactsDir) {
  const fixtureDir = path.join(rootDir, 'tests', 'fixtures', 'python-stdlib-plugin');
  const workDir = path.join(artifactsDir, 'reports', 'python-plugin-e2e', 'python-stdlib-plugin');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(workDir), { recursive: true });
  fs.cpSync(fixtureDir, workDir, { recursive: true });

  execChecked('npm', ['run', 'build', '--prefix', 'packages/liatir-cli'], { cwd: rootDir });
  execChecked('node', [path.join(rootDir, 'packages', 'liatir-cli', 'dist', 'cli.js'), 'build'], {
    cwd: workDir,
  });

  const bundleName = fs
    .readdirSync(path.join(workDir, '.liatir'))
    .find((name) => name.endsWith('.lia'));
  if (!bundleName) throw new Error('Built Python fixture did not produce a .lia bundle.');
  return path.join(workDir, '.liatir', bundleName);
}

async function waitForJobResult(browser, jobId) {
  return browser.execute(async (id) => {
    let lastEntry = null;
    let lastOutput = null;

    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [entry, output] = await Promise.all([
        window.Liatir.invoke('lia_jobs_status', { jobId: id }),
        window.Liatir.invoke('lia_jobs_get_output', { jobId: id }),
      ]);
      lastEntry = entry;
      lastOutput = output;
      if (entry.status?.type !== 'running') {
        const marker = output.stdout.find((line) => line.startsWith('__LIATIR_RESULT__'));
        const result = marker ? JSON.parse(marker.slice('__LIATIR_RESULT__'.length)) : null;
        return { entry, output, result };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for Python plugin job ${id}; last status: ${JSON.stringify(lastEntry)}, output: ${JSON.stringify(lastOutput)}`);
  }, jobId);
}

export const tests = [
  {
    name: 'builds, prepares, and runs a Python .lia plugin through the real Tauri bridge',
    async run({ artifactsDir, browser, expect, rootDir }) {
      const pluginPath = buildPythonFixture(rootDir, artifactsDir);
      await waitForLiatirBridge(browser);
      await openSandboxWorkspace(browser);

      const setup = await browser.execute(async (pathToPlugin) => {
        const manifest = await window.Liatir.invoke('lia_liatir_read_manifest', { path: pathToPlugin });
        const prepared = await window.Liatir.invoke('lia_liatir_python_runtime_prepare', { path: pathToPlugin });
        const after = await window.Liatir.invoke('lia_liatir_python_runtime_status', { path: pathToPlugin });
        const run = await window.Liatir.invoke('lia_liatir_run', {
          path: pathToPlugin,
          inputs: { text: 'hello from e2e' },
        });

        return { manifest, prepared, after, run };
      }, pluginPath);

      expect(setup.manifest.runtime).toBe('python');
      expect(setup.manifest.python.entry).toBe('python/main.py');
      expect(setup.prepared.pythonPath).toContain('plugin-runtimes');
      expect(setup.prepared.sizeBytes).toBeGreaterThan(0);
      expect(setup.after.installed).toBe(true);
      expect(setup.after.missingPackages).toEqual([]);
      expect(setup.after.missingSources).toEqual([]);
      expect(setup.after.envId).toContain('python-stdlib-fixture');
      expect(setup.run.jobId).toBeTruthy();

      const completed = await waitForJobResult(browser, setup.run.jobId);
      expect(completed.entry.kind).toBe('lia-plugin');
      expect(completed.entry.label).toBe('Liatir Python plugin: Python Stdlib Fixture');
      expect(completed.entry.status.type).toBe('done');
      expect(completed.output.stderr).toEqual([]);
      expect(completed.result).toMatchObject({
        length: 14,
        words: 3,
        summary: {
          uppercasePreview: 'HELLO FROM E2E',
        },
      });
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
