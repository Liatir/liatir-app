import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import catalog from '../../runtime-boxes/catalog.json';
import {
  runtimeBoxBuildDiskPlan,
  validateRuntimeBoxCiCatalog,
  validateWindowsCudaPrerequisite,
} from '../../scripts/runtime-box-ci.mjs';
import { heartbeatLine } from '../../scripts/runtime-box/heartbeat.mjs';
import { npmInvocation } from '../../scripts/node-cli.mjs';

describe('Runtime Box CI cost controls', () => {
  it('builds the shared core before generating SDK types on a clean product runner', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const prepare = packageJson.scripts['test:tauri:prepare'];
    const productBuild = readFileSync(resolve('scripts/build-tauri-test-binary.mjs'), 'utf8');
    const e2eRunner = readFileSync(resolve('tests/e2e/run-tauri-e2e.mjs'), 'utf8');
    const e2eAppSupport = readFileSync(resolve('tests/e2e/support/liatir-app.mjs'), 'utf8');
    const runtimeBoxSupport = readFileSync(resolve('tests/e2e/support/runtime-box.mjs'), 'utf8');
    const runtimeBoxProductE2E = readFileSync(resolve('tests/e2e/specs/runtime-box-native.e2e.mjs'), 'utf8');
    const tauriMain = readFileSync(resolve('src-tauri/src/main.rs'), 'utf8');
    const diagnostics = readFileSync(resolve('src-tauri/src/bridge/diagnostics.rs'), 'utf8');
    const runtimeBoxCi = readFileSync(resolve('scripts/runtime-box-ci.mjs'), 'utf8');
    const productLifecycle = readFileSync(resolve('scripts/run-runtime-box-product-lifecycle.mjs'), 'utf8');
    const releaseWorkflow = readFileSync(resolve('.github/workflows/runtime-box-release.yml'), 'utf8');
    const windowsProductSmoke = readFileSync(resolve('.github/workflows/runtime-box-windows-product-smoke.yml'), 'utf8');
    const nativeBridgeE2E = readFileSync(resolve('tests/e2e/specs/native-bridge.e2e.mjs'), 'utf8');
    expect(prepare.indexOf('npm run build --prefix packages/liatir-core'))
      .toBeLessThan(prepare.indexOf('npm run gen:sdk-types'));
    expect(prepare.indexOf('npm ci --prefix frontend'))
      .toBeLessThan(prepare.indexOf('npm run check --prefix frontend'));
    expect(packageJson.devDependencies['@tauri-apps/cli']).toBe('2.11.4');
    expect(productBuild).toContain("localNodeCliInvocation('@tauri-apps/cli/tauri.js'");
    expect(productBuild).not.toContain("'cargo',\n    [\n      'tauri'");
    expect(e2eRunner).toContain('Tauri log tail (last 12 KiB)');
    expect(e2eRunner).toContain('Tauri startup failed before WebDriver became available.');
    expect(e2eRunner).toContain("'Native app startup'");
    expect(e2eRunner).toContain('await closeLogStream(app.logStream)');
    expect(e2eRunner).toContain("exitCode=${app.child.exitCode ?? 'running'}");
    expect(e2eRunner).toContain('payload.value?.ready === true');
    expect(e2eRunner).toContain("windowLabel: 'main'");
    expect(e2eAppSupport).toContain("window.location.pathname !== '/workspaces'");
    expect(runtimeBoxSupport).toContain("cancelAfterBytes: options.cancelAfterBytes ?? null");
    expect(runtimeBoxProductE2E).toContain("{ cancelAfterBytes: 1 }");
    expect(runtimeBoxProductE2E).toContain('Resumed Runtime Box install failed');
    expect(runtimeBoxProductE2E.indexOf('runtimeBoxInstallError(browser, resumedId)'))
      .toBeLessThan(runtimeBoxProductE2E.indexOf('runtimeBoxInstallResult(browser, resumedId)'));
    expect(runtimeBoxProductE2E).not.toContain('bytesDownloaded > 64 * 1024');
    expect(runtimeBoxProductE2E).toContain("replaceAll('\\\\', '/')");
    expect(runtimeBoxProductE2E).toContain("path.join(runtimeDir, 'model-cache'");
    expect(tauriMain).not.toContain('app.deep_link().register_all()?');
    expect(tauriMain).toContain('[deep-link] Failed to register desktop deep links');
    expect(diagnostics).toContain('let previous_hook = std::panic::take_hook();');
    expect(diagnostics).toContain('previous_hook(info);');
    expect(runtimeBoxCi).not.toContain("'npm.cmd'");
    expect(productLifecycle).not.toContain("'npm.cmd'");
    expect(releaseWorkflow).toContain('windows-x86_64-cpu');
    expect(packageJson.scripts['runtime-box:product-lifecycle'])
      .toBe('node scripts/run-runtime-box-product-lifecycle.mjs');
    expect(releaseWorkflow).toContain('npm run runtime-box:product-lifecycle');
    expect(releaseWorkflow).toContain("startsWith(inputs.target_id, 'windows-')");
    expect(windowsProductSmoke).toContain('workflow_dispatch:');
    expect(windowsProductSmoke).not.toContain('push:');
    expect(windowsProductSmoke).toContain('runs-on: windows-2025');
    expect(windowsProductSmoke).toContain('timeout-minutes: 40');
    expect(windowsProductSmoke).toContain('npm run test:tauri:prepare');
    expect(windowsProductSmoke).toContain('tests/e2e/specs/native-bridge.e2e.mjs');
    expect(windowsProductSmoke).not.toContain('tests/e2e/specs/runtime-box-native.e2e.mjs');
    expect(windowsProductSmoke).toContain('.runtime-box-ci/windows-product-startup-e2e.json');
    expect(nativeBridgeE2E).toContain("replaceAll('\\\\', '/')");
  });

  it('persists native startup failures in the compact E2E report', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'liatir-e2e-startup-'));
    const reportPath = join(tempDir, 'report.json');
    try {
      const result = spawnSync(
        process.execPath,
        ['tests/e2e/run-tauri-e2e.mjs', '--report', reportPath, 'tests/e2e/specs/runtime-box-native.e2e.mjs'],
        {
          cwd: resolve('.'),
          encoding: 'utf8',
          env: {
            ...process.env,
            LIATIR_TAURI_APP: process.execPath,
          },
          timeout: 10_000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Tauri startup failed before WebDriver became available.');
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      expect(report.summary).toMatchObject({ failed: 1, total: 1 });
      expect(report.tests).toEqual([
        expect.objectContaining({ name: 'Native app startup', nativeLogTail: null, status: 'failed' }),
      ]);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('pins every model lock and calculates disk before native allocation', () => {
    for (const model of catalog.models) {
      for (const target of model.targets) {
        const recipe = JSON.parse(readFileSync(resolve(
          `runtime-boxes/recipes/${target.recipeId}/recipe.json`,
        ), 'utf8'));
        const plan = runtimeBoxBuildDiskPlan(recipe, target);
        expect(target.dependencyLockSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(plan.calculatedPeakDiskBytes).toBeLessThanOrEqual(target.requiredBuildDiskBytes);
        expect(plan.safetyMarginBytes).toBeGreaterThan(0);
      }
    }
  });

  it('rejects lock drift before any native runner is resolved', () => {
    const changed = structuredClone(catalog);
    changed.models[0].targets[0].dependencyLockSha256 = '0'.repeat(64);
    expect(() => validateRuntimeBoxCiCatalog(changed, { requireWorkflows: false }))
      .toThrow(/dependency lock SHA-256 mismatch/);
  });

  it('preserves every byte-pinned recipe input across native Git checkouts', () => {
    const recipeIds = new Set([
      ...catalog.foundationFixtures.map((fixture) => fixture.recipeId),
      ...catalog.models.flatMap((model) => model.targets.map((target) => target.recipeId)),
    ]);

    for (const recipeId of recipeIds) {
      const recipe = JSON.parse(readFileSync(resolve(
        `runtime-boxes/recipes/${recipeId}/recipe.json`,
      ), 'utf8'));
      const lockPath = `runtime-boxes/recipes/${recipeId}/${recipe.requirementsLock}`;
      const attribute = execFileSync('git', ['check-attr', 'eol', '--', lockPath], {
        encoding: 'utf8',
      }).trim();
      expect(attribute).toBe(`${lockPath}: eol: lf`);

      for (const localFile of recipe.localFiles ?? []) {
        const attributes = execFileSync(
          'git',
          ['check-attr', 'eol', 'text', '--', localFile.sourcePath],
          { encoding: 'utf8' },
        ).trim().split('\n');
        const preservesBytes = attributes.includes(`${localFile.sourcePath}: eol: lf`)
          || attributes.includes(`${localFile.sourcePath}: text: unset`);
        if (!preservesBytes) {
          throw new Error(`Byte-pinned local recipe input lacks an exact Git checkout policy: ${localFile.sourcePath}`);
        }
      }
    }
  });

  it('rejects reviewed Python-license audit drift before a native build', () => {
    const changed = structuredClone(catalog);
    const cpu = changed.models[0].targets.find((target) => target.targetId === 'linux-x86_64-cpu');
    cpu.dependencyLicenseAudit = 'runtime-boxes/legal/audits/missing.json';
    expect(() => validateRuntimeBoxCiCatalog(changed, { requireWorkflows: false }))
      .toThrow(/recipe and catalog dependency license audits differ|missing dependency license audit/);
  });

  it('keeps Windows CUDA disabled until same-model Linux CUDA validation passes', () => {
    const linux = {
      targetId: 'linux-x86_64-cuda12.4',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
      status: 'planned',
      nativeCiEnabled: false,
    };
    const windows = {
      targetId: 'windows-x86_64-cuda12.4',
      target: { platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
      status: 'planned',
      nativeCiEnabled: true,
      linuxValidationPrerequisiteTargetId: linux.targetId,
    };
    const model = { modelId: 'model', targets: [linux, windows] };
    expect(() => validateWindowsCudaPrerequisite(model, windows)).toThrow(/before Linux scientific validation/);
    linux.status = 'scientifically-validated';
    expect(() => validateWindowsCudaPrerequisite(model, windows)).not.toThrow();
  });

  it('runs npm through the Node CLI instead of a Windows command shim', () => {
    const npmExecutable = 'C:\\hostedtoolcache\\node\\node_modules\\npm\\bin\\npm-cli.js';
    expect(npmInvocation(['run', 'runtime-box'], {
      platform: 'win32',
      nodeExecutable: 'C:\\hostedtoolcache\\node\\node.exe',
      npmExecutable,
      fileExists: (candidate: string) => candidate === npmExecutable,
    })).toEqual({
      command: 'C:\\hostedtoolcache\\node\\node.exe',
      args: [npmExecutable, 'run', 'runtime-box'],
    });
    expect(() => npmInvocation([], {
      platform: 'win32',
      nodeExecutable: '/missing/node.exe',
      npmExecutable: null,
      fileExists: () => false,
    })).toThrow(/npm CLI could not be resolved/);

    const fallback = '/toolcache/node/node_modules/npm/bin/npm-cli.js';
    expect(npmInvocation(['run', 'test:tauri:run'], {
      platform: 'win32',
      nodeExecutable: '/toolcache/node/node.exe',
      npmExecutable: null,
      fileExists: (candidate: string) => candidate === fallback,
    })).toEqual({
      command: '/toolcache/node/node.exe',
      args: [fallback, 'run', 'test:tauri:run'],
    });
  });

  it('uses one concise heartbeat line without verbose status output', () => {
    expect(heartbeatLine('scientific validation', 17 * 60_000))
      .toBe('[runtime-box heartbeat] scientific validation is still running (17 min elapsed)');
  });
});
