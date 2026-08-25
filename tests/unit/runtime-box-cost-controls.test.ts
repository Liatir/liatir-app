import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import catalog from '../../runtime-boxes/catalog.json';
import {
  runtimeBoxBuildDiskPlan,
  validateRuntimeBoxCiCatalog,
  validateWindowsCudaPrerequisite,
} from '../../scripts/runtime-box-ci.mjs';
import { heartbeatLine } from '../../scripts/runtime-box/heartbeat.mjs';
import { resolveRuntimeBoxAuthoringInput } from '../../scripts/runtime-box/authoring-input.mjs';
import { npmInvocation } from '../../scripts/node-cli.mjs';

function authoringInput(recipeId: string) {
  return resolveRuntimeBoxAuthoringInput({
    recipeId,
    recipesDir: resolve('runtime-boxes/recipes'),
    scrollsDir: resolve('runtime-boxes/scrolls'),
  });
}

function repositoryPath(path: string) {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

describe('Runtime Box CI cost controls', () => {
  it('builds the shared core before generating SDK types on a clean product runner', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const prepare = packageJson.scripts['test:tauri:prepare'];
    const productBuild = readFileSync(resolve('scripts/build-tauri-test-binary.mjs'), 'utf8');
    const e2eRunner = readFileSync(resolve('tests/e2e/run-tauri-e2e.mjs'), 'utf8');
    const e2eAppSupport = readFileSync(resolve('tests/e2e/support/liatir-app.mjs'), 'utf8');
    const runtimeBoxSupport = readFileSync(resolve('tests/e2e/support/runtime-box.mjs'), 'utf8');
    const runtimeBoxProductE2E = readFileSync(resolve('tests/e2e/specs/runtime-box-native.e2e.mjs'), 'utf8');
    const scgptRuntimeBoxProductE2E = readFileSync(resolve('tests/e2e/specs/runtime-box-scgpt-native.e2e.mjs'), 'utf8');
    const aiRuntime = readFileSync(resolve('src-tauri/src/bridge/ai_runtime.rs'), 'utf8');
    const tauriMain = readFileSync(resolve('src-tauri/src/main.rs'), 'utf8');
    const diagnostics = readFileSync(resolve('src-tauri/src/bridge/diagnostics.rs'), 'utf8');
    const runtimeBoxCi = readFileSync(resolve('scripts/runtime-box-ci.mjs'), 'utf8');
    const productLifecycle = readFileSync(resolve('scripts/run-runtime-box-product-lifecycle.mjs'), 'utf8');
    const releaseWorkflow = readFileSync(resolve('.github/workflows/runtime-box-release.yml'), 'utf8');
    const windowsProductSmoke = readFileSync(resolve('.github/workflows/runtime-box-windows-product-smoke.yml'), 'utf8');
    const nativeBridgeE2E = readFileSync(resolve('tests/e2e/specs/native-bridge.e2e.mjs'), 'utf8');
    const tauriProcessSupport = readFileSync(resolve('tests/e2e/support/tauri-process.mjs'), 'utf8');
    // Every job that runs a Runtime Box script on a bare ephemeral runner must install
    // dependencies first: the CI entry point imports the published Scrollcase contract, so
    // without node_modules it cannot start at all. Release run 31225652966 died here, on the
    // first release dispatched after the adoption, having reached no paid step. The check is
    // per job, not per file — a sibling job's `npm ci` installs nothing on this runner.
    for (const [name, workflow] of [
      ['release', releaseWorkflow],
      ['validate', readFileSync(resolve('.github/workflows/_runtime-box-validate.yml'), 'utf8')],
    ] as const) {
      const jobs = workflow.split(/\n {2}(?=[a-z][\w-]*:\n)/);
      let checked = 0;
      for (const job of jobs) {
        const first = Math.min(
          ...['node scripts/runtime-box-ci.mjs', 'npm run runtime-box:ci']
            .map((script) => job.indexOf(script))
            .filter((index) => index !== -1),
        );
        if (!Number.isFinite(first)) continue;
        checked += 1;
        const install = job.indexOf('- run: npm ci');
        expect(install, `${name}: job runs a Runtime Box script without npm ci`).toBeGreaterThan(-1);
        expect(install, `${name}: npm ci must precede the first Runtime Box script`)
          .toBeLessThan(first);
      }
      expect(checked, `${name}: no job parsed`).toBeGreaterThan(0);
    }
    // Release and validation run the same build on the same self-hosted runners, so any host
    // setup one needs, the other needs identically. Only validation was exercised between the
    // pixi migration and the first re-release, and the release workflow silently fell behind it
    // three times over — no npm ci before its scripts, then no pinned pixi or conda-pack at all,
    // each found by burning a runner. Pin the shared setup rather than rediscovering it.
    const validateWorkflow = readFileSync(resolve('.github/workflows/_runtime-box-validate.yml'), 'utf8');
    for (const setup of [
      'Install pinned pixi and conda-pack (POSIX)',
      'Install pinned pixi and conda-pack (Windows)',
      'Select Git Bash for Windows composite actions',
      'Add Windows native inspection tools',
      'Install Linux product lifecycle dependencies',
      'PIXI_VERSION: v${{ needs.preflight.outputs.pixi_version }}',
      "ExpectedSha256 '02c3e1bb4712199f62124deb1b1e9a5ddae32c413d21fda1586e198cd6f9cf2a'",
      "conda-pack==0.9.2",
    ]) {
      expect(validateWorkflow, `validate: ${setup}`).toContain(setup);
      expect(releaseWorkflow, `release: ${setup}`).toContain(setup);
    }
    // The toolchain has to be on PATH before the build asks Scrollcase to resolve it.
    expect(releaseWorkflow.indexOf('Install pinned pixi and conda-pack (POSIX)'))
      .toBeLessThan(releaseWorkflow.indexOf('runtime-box:ci -- tracked-build'));
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
    // The same rule for every spec the release routes to. A failed install is only diagnosable from
    // the error the app recorded, and the box is gone with the ephemeral runner moments later — so
    // asserting the status first, as scGPT's spec did, loses the only account of what went wrong
    // (run 31296511194: "expected done, received error", cause unknown).
    for (const specPath of ['runtime-box-scgpt-native', 'runtime-box-uce-native']) {
      const spec = readFileSync(resolve(`tests/e2e/specs/${specPath}.e2e.mjs`), 'utf8');
      const readsError = spec.indexOf('runtimeBoxInstallError(');
      const assertsDone = spec.indexOf("toBe('done')");
      expect(readsError, specPath).toBeGreaterThan(-1);
      if (assertsDone > -1) expect(readsError, specPath).toBeLessThan(assertsDone);
    }

    // A release refuses to certify a Linux publication without a receipt carrying a Job, an analysis
    // run, Result artifacts and ten passing assertions. A spec that installs and embeds cannot
    // produce one, which is how scGPT Linux CPU ended up promoted with no usable evidence. Both
    // lifecycle specs must cover the same ground, and neither may keep a private copy of the
    // navigation and section helpers that let the two drift apart in the first place.
    for (const specPath of ['runtime-box-native', 'runtime-box-scgpt-native']) {
      const spec = readFileSync(resolve(`tests/e2e/specs/${specPath}.e2e.mjs`), 'utf8');
      for (const phase of [
        'interruptedResume', 'install', 'realInference', 'jobs', 'results',
        'provenance', 'replacement', 'rollback', 'removal', 'resultArtifactsSurvivedRemoval',
      ]) {
        expect(spec, `${specPath} lifecycle receipt lacks ${phase}`).toContain(`${phase}: 'passed'`);
      }
      expect(spec, specPath).toContain('lia_ai_runtime_box_rollback');
      expect(spec, specPath).toContain('lia_ai_runtime_box_remove');
      expect(spec, specPath).toContain('analysisRunId');
      expect(spec, specPath).toContain("kind: 'liatir.runtime-box.product-lifecycle-evidence'");
      expect(spec, specPath).toContain('navigateInApp(');
      expect(spec, `${specPath} must not keep a private navigate helper`)
        .not.toContain('async function navigate(');
    }
    for (const phase of [
      'legacyV1InlineExecutionRejected',
      'legacyV1JobExecutionRejected',
      'legacyV1Cleanup',
    ]) {
      expect(scgptRuntimeBoxProductE2E, `P5.6 lifecycle receipt lacks ${phase}`)
        .toContain(`${phase}: 'passed'`);
    }
    const inlineRun = aiRuntime.slice(aiRuntime.indexOf('pub async fn lia_ai_python_run'));
    expect(inlineRun).toContain('runtime_box_activation_metadata(&app, &runtime_id)?;');
    expect(runtimeBoxProductE2E).not.toContain('bytesDownloaded > 64 * 1024');
    // Path normalisation lives in the shared support helper now, so both specs get it from one
    // place, and the isolation assertion names the home the runner actually used rather than a
    // literal that stopped being true when the Windows home moved out of the checkout.
    expect(runtimeBoxProductE2E).toContain('isolatedTestHome()');
    expect(tauriProcessSupport).toContain("replaceAll('\\\\', '/')");
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
    expect(windowsProductSmoke).toContain('runs-on: liatir-windows-selfhosted');
    expect(windowsProductSmoke).toContain('timeout-minutes: 40');
    expect(windowsProductSmoke).toContain('npm run test:tauri:prepare');
    expect(windowsProductSmoke).toContain('tests/e2e/specs/native-bridge.e2e.mjs');
    expect(windowsProductSmoke).not.toContain('tests/e2e/specs/runtime-box-native.e2e.mjs');
    expect(windowsProductSmoke).toContain('.runtime-box-ci/windows-product-startup-e2e.json');
    expect(nativeBridgeE2E).toContain('isolatedTestHome()');
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
    for (const model of catalog.components) {
      for (const target of model.targets) {
        const recipe = authoringInput(target.recipeId).document;
        const plan = runtimeBoxBuildDiskPlan(recipe, target);
        expect(target.dependencyLockSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(plan.calculatedPeakDiskBytes).toBeLessThanOrEqual(target.requiredBuildDiskBytes);
        expect(plan.safetyMarginBytes).toBeGreaterThan(0);
      }
    }
  });

  // scGPT's macOS box failed its scientific forward because an inherited prune list removed
  // locked sympy, which PyTorch 2.8 imports lazily. The rule is not scGPT's: a packed conda
  // prefix is only sound whole, and every model pays a native run to rediscover that.
  it('keeps every locked runtime dependency in every canonical model box', () => {
    for (const model of catalog.components) {
      for (const target of model.targets ?? []) {
        const authoring = authoringInput(target.recipeId);
        expect(authoring.kind, target.targetId).toBe('scroll-v2');
        expect(
          (authoring.document.prunePaths ?? []).filter((path: string) => path.startsWith('venv/')),
          `${model.boxId} ${target.targetId}`,
        ).toEqual([]);
      }
    }
  });

  it('uses canonical v2 pixi inputs for the active Geneformer migrations', () => {
    const migrations = [
      {
        scrollId: 'geneformer-v1-10m-macos-arm64-metal',
        auditPath: 'runtime-boxes/legal/audits/geneformer-v1-10m-macos-arm64-metal.json',
        pythonEntryPoint: 'venv/bin/python',
      },
      {
        scrollId: 'geneformer-v1-10m-linux-x86_64-cuda12.9',
        auditPath: 'runtime-boxes/legal/audits/geneformer-v1-10m-linux-x86_64-cuda12.9.json',
        pythonEntryPoint: 'venv/bin/python',
      },
      {
        scrollId: 'geneformer-v1-10m-windows-x86_64-cuda12.8',
        auditPath: 'runtime-boxes/legal/audits/geneformer-v1-10m-windows-x86_64-cuda12.8.json',
        // Windows conda prefixes put the interpreter at the prefix root, not under bin/.
        pythonEntryPoint: 'venv/python.exe',
      },
    ];

    for (const { scrollId, auditPath, pythonEntryPoint } of migrations) {
      const authoring = authoringInput(scrollId);
      expect(authoring.kind, scrollId).toBe('scroll-v2');
      expect(authoring.document).toMatchObject({
        schemaVersion: 2,
        scrollId,
        scrollVersion: '1.0.0',
        pixiVersion: '0.73.0',
        pythonVersion: '3.11.15',
        condaDependencyLicenseAudit: auditPath,
        pythonEntryPoint,
      });
      expect(authoring.document).not.toHaveProperty('uvVersion');
      expect(authoring.document).not.toHaveProperty('requirementsInput');
      expect(authoring.document).not.toHaveProperty('requirementsLock');
    }
  });

  it('rejects lock drift before any native runner is resolved', () => {
    const changed = structuredClone(catalog);
    changed.components[0].targets[0].dependencyLockSha256 = '0'.repeat(64);
    expect(() => validateRuntimeBoxCiCatalog(changed, { requireWorkflows: false }))
      .toThrow(/(?:dependency lock|pixi\.lock) SHA-256 mismatch/);
  });

  it('preserves every byte-pinned recipe input across native Git checkouts', () => {
    const pinnedInputs = [
      ...catalog.foundationFixtures.map((fixture) => ({
        descriptorPath: `runtime-boxes/scrolls/runtime-box-installer-fixture/${fixture.targetId}/scroll.json`,
        lockPath: `runtime-boxes/scrolls/runtime-box-installer-fixture/${fixture.targetId}/pixi.lock`,
      })),
      ...catalog.components.flatMap((model) => model.targets.map((target) => ({
        descriptorPath: repositoryPath(authoringInput(target.recipeId).documentPath),
        lockPath: repositoryPath(authoringInput(target.recipeId).lockPath),
      }))),
    ];

    for (const input of pinnedInputs) {
      const descriptor = JSON.parse(readFileSync(resolve(input.descriptorPath), 'utf8'));
      // Foundation scrolls byte-pin pixi.lock; compatibility recipes retain their substrate-specific
      // lock until P5.4. Every lock must survive a Windows checkout byte-for-byte.
      const lockPath = input.lockPath;
      const attribute = execFileSync('git', ['check-attr', 'eol', '--', lockPath], {
        encoding: 'utf8',
      }).trim();
      expect(attribute).toBe(`${lockPath}: eol: lf`);

      for (const localFile of descriptor.localFiles ?? []) {
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
    const target = changed.components[0].targets[0];
    target.condaDependencyLicenseAudit = 'runtime-boxes/legal/audits/missing.json';
    expect(() => validateRuntimeBoxCiCatalog(changed, { requireWorkflows: false }))
      .toThrow(/recipe and catalog conda license audits differ|missing conda dependency license audit/);
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

    // Built with the same resolver the implementation uses, so the expectation holds on a
    // Windows host too (where `resolve` yields a drive-qualified, backslash-separated path).
    const fallback = resolve('/toolcache/node', 'node_modules', 'npm', 'bin', 'npm-cli.js');
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
