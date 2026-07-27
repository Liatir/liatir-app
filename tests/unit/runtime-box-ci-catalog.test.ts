import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import catalogJson from '../../runtime-boxes/catalog.json';
import {
  RUNTIME_BOX_AI_MODEL_REGISTRY,
  runtimeBoxTargetId,
  type LiatirRuntimeBoxCiCatalog,
} from '../../packages/liatir-core/src';
import {
  foundationMatrix,
  lockedDistributionPrunePaths,
  numericVersionAtLeast,
  resolveCiTarget,
  runtimeBoxEvidenceOptions,
  validateRunnerExecutionContext,
  validateRuntimeBoxCiCatalog,
} from '../../scripts/runtime-box-ci.mjs';

const catalog = catalogJson as LiatirRuntimeBoxCiCatalog;

describe('Runtime Box CI catalog', () => {
  it('validates repository identities, legal gates, recipes, runners, and publication evidence', () => {
    expect(() => validateRuntimeBoxCiCatalog(catalog, { requireWorkflows: false })).not.toThrow();
  });

  it('rejects pruning complete packages or metadata that remain required by the lock', () => {
    const lock = Buffer.from([
      'networkx==3.6.1 \\',
      '    --hash=sha256:fixture',
      'torch==2.4.1+cpu \\',
      '    --hash=sha256:fixture',
    ].join('\n'));
    expect(lockedDistributionPrunePaths({
      prunePaths: [
        'venv/lib/python3.11/site-packages/networkx',
        'venv/lib/python3.11/site-packages/networkx-3.6.1.dist-info',
        'venv/lib/python3.11/site-packages/torch/include',
        'venv/lib/python3.11/site-packages/pip-24.1.2.dist-info',
      ],
    }, lock)).toEqual([
      'venv/lib/python3.11/site-packages/networkx',
      'venv/lib/python3.11/site-packages/networkx-3.6.1.dist-info',
    ]);
  });

  it('keeps published core targets exactly aligned with published catalog targets', () => {
    for (const record of catalog.models) {
      const model = RUNTIME_BOX_AI_MODEL_REGISTRY.find((candidate) => candidate.id === record.modelId);
      const appTargets = model?.install?.runtimeBox?.publishedTargets ?? [];
      const catalogTargets = record.targets.filter((target) => target.status === 'published');

      expect(model?.install?.runtimeBox?.boxId).toBe(record.boxId);
      expect(model?.install?.runtimeId).toBe(record.runtimeId);
      expect(appTargets.map((candidate) => runtimeBoxTargetId(candidate.target)).sort())
        .toEqual(catalogTargets.map((target) => target.targetId).sort());
      for (const target of catalogTargets) {
        const candidate = appTargets.find((value) => runtimeBoxTargetId(value.target) === target.targetId);
        expect(candidate?.hostEnvironments).toEqual(target.hostEnvironments);
      }
    }
  });

  it('resolves runner labels only through an exact model, recipe, target, and mode tuple', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      'geneformer-v1-10m-macos-arm64-metal',
      'macos-aarch64-metal',
      'scientific',
    );
    expect(resolved.runner).toMatchObject({ runsOn: 'macos-15', platform: 'macos', arch: 'aarch64' });
    expect(() => resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      'geneformer-v1-10m-macos-arm64-metal',
      'macos-aarch64-metal',
      'arbitrary-mode',
    )).toThrow(/mode arbitrary-mode is not approved/);
  });

  it('derives the Linux CPU recipe and runner only from the checked model and target', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      undefined,
      'linux-x86_64-cpu',
      'native-lifecycle',
    );
    expect(resolved.target).toMatchObject({
      recipeId: 'geneformer-v1-10m-linux-x86_64-cpu',
      status: 'published',
      dependencyLicenseAudit: 'runtime-boxes/legal/audits/geneformer-v1-10m-linux-x86_64-cpu.json',
    });
    expect(resolved.runner).toMatchObject({ runsOn: 'liatir-linux-selfhosted', gpu: false });
  });

  it('derives the checked Linux CUDA recipe and exact self-hosted GPU runner contract', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      undefined,
      'linux-x86_64-cuda12.4',
      'native-lifecycle',
    );
    expect(resolved.target).toMatchObject({
      recipeId: 'geneformer-v1-10m-linux-x86_64-cuda12.4',
      status: 'published',
      timeoutMinutes: 35,
      gpuRequired: true,
      dependencyLockSha256: '4cc737f7bb6580de2fc6da0d89f2a17a2f200a35c82f5734f7e503c1772579ed',
    });
    expect(resolved.runner).toMatchObject({
      runsOn: 'liatir-linux-cuda-selfhosted',
      gpu: true,
      minimumComputeCapability: '7.5',
      minimumGpuMemoryBytes: 7_500_000_000,
      selfHosted: { ephemeral: true, maxConcurrency: 1 },
    });
    // Floors, not an exact card: pinning a model is what blocked the move off the hosted T4.
    expect(resolved.runner).not.toHaveProperty('expectedGpuModel');
    expect(resolved.runner).not.toHaveProperty('expectedComputeCapability');
  });

  it('derives the Windows CPU recipe and self-hosted runner from checked catalog state', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      undefined,
      'windows-x86_64-cpu',
      'native-lifecycle',
    );
    expect(resolved.target).toMatchObject({
      recipeId: 'geneformer-v1-10m-windows-x86_64-cpu',
      status: 'published',
      dependencyLockSha256: 'b0e070dbcbf7c236db06afd086bd39dec99721221f0019ce12f9cb1affd28e7c',
      dependencyLicenseAudit: 'runtime-boxes/legal/audits/geneformer-v1-10m-windows-x86_64-cpu.json',
    });
    expect(resolved.runner).toMatchObject({ runsOn: 'liatir-windows-selfhosted', gpu: false });
  });

  it('accepts any GPU that clears the declared floors, not one exact card', () => {
    const cuda = catalog.runnerProfiles.find((candidate) => candidate.id === 'linux-x64-cuda-selfhosted');
    const floor = cuda?.minimumComputeCapability as string;

    // The hardware the CI actually moved between: hosted Tesla T4 (7.5) and local RTX 4060 Ti (8.9).
    expect(numericVersionAtLeast('7.5', floor)).toBe(true);
    expect(numericVersionAtLeast('8.9', floor)).toBe(true);
    // A card below the baseline the scientific tolerances were established on is still refused.
    expect(numericVersionAtLeast('6.1', floor)).toBe(false);

    // The RTX 4060 Ti's ~8.19 GB clears the VRAM floor; a 4 GB card does not.
    expect(8_585_740_288).toBeGreaterThanOrEqual(cuda?.minimumGpuMemoryBytes as number);
    expect(4_294_967_296).toBeLessThan(cuda?.minimumGpuMemoryBytes as number);
  });

  it('compares NVIDIA driver versions component by component', () => {
    expect(numericVersionAtLeast('590.48.01', '550.54.14')).toBe(true);
    expect(numericVersionAtLeast('550.54.14', '550.54.14')).toBe(true);
    expect(numericVersionAtLeast('550.54.2', '550.54.14')).toBe(false);
    expect(numericVersionAtLeast('not-a-version', '550.54.14')).toBe(false);
  });

  it('derives the small native fixture matrix from checked runner profiles', () => {
    expect(foundationMatrix(catalog)).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipeId: 'installer-fixture-linux-x86_64', runsOn: 'ubuntu-24.04', heartbeatSeconds: 300 }),
      expect.objectContaining({ recipeId: 'installer-fixture-windows-x86_64', runsOn: 'windows-2025' }),
      expect.objectContaining({ recipeId: 'installer-fixture-macos-arm64', runsOn: 'macos-15' }),
    ]));
  });

  it('keeps the checked cost policy manual, serial, uncached, and low-noise', () => {
    expect(catalog.costPolicy).toEqual({
      maxPaidRunnerConcurrency: 1,
      maxModelsPerGpuJob: 1,
      maxTargetsPerGpuJob: 1,
      heartbeatSeconds: 300,
      gpuManualOnly: true,
      scheduledGpuWorkflows: false,
      linuxCudaBeforeWindowsCuda: true,
      cacheModelWeightsOrArchives: false,
    });
  });

  it('checks the paid native host under pinned Node before authentication or setup downloads', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/runtime-box-release.yml', import.meta.url), 'utf8');
    const releaseJob = workflow.slice(workflow.indexOf('\n  release:\n'));
    const setupNode = releaseJob.indexOf('actions/setup-node@v4');
    const hostProbe = releaseJob.indexOf('npm run runtime-box:ci -- host-probe');
    const releaseAuth = releaseJob.indexOf('id: release-auth');
    const npmInstall = releaseJob.indexOf('run: npm ci');
    expect(setupNode).toBeGreaterThanOrEqual(0);
    expect(setupNode).toBeLessThan(hostProbe);
    expect(hostProbe).toBeLessThan(releaseAuth);
    expect(hostProbe).toBeLessThan(npmInstall);
  });

  it('suppresses npm wrapper output before parsing one canonical validator result', () => {
    const ciSource = readFileSync(new URL('../../scripts/runtime-box-ci.mjs', import.meta.url), 'utf8');
    expect(ciSource).toContain("['run', '--silent', script]");
    expect(ciSource).toContain('JSON.parse(result.stdout.trim())');
  });

  it('maps workflow receipt flags to the evidence API contract', () => {
    expect(runtimeBoxEvidenceOptions(new Map([
      ['publish-receipt', 'publish.json'],
      ['promotion-receipt', 'promotion.json'],
      ['product-lifecycle', 'product.json'],
    ]))).toEqual({
      publishReceipt: 'publish.json',
      promotionReceipt: 'promotion.json',
      productLifecycle: 'product.json',
    });
  });

  it('routes UCE native CI only to the repository-scoped ephemeral heavy runner', () => {
    const uce = catalog.models.find((model) => model.boxId === 'uce-4layer');
    const runner = catalog.runnerProfiles.find((candidate) => candidate.id === uce?.targets[0].runnerProfileId);
    expect(uce?.targets[0]).toMatchObject({
      status: 'published',
      requiredBuildDiskBytes: 32_212_254_720,
      nativeCiEnabled: true,
      runnerProfileId: 'macos-arm64-heavy',
    });
    expect(runner).toMatchObject({
      runsOn: 'liatir-macos-arm64-heavy',
      platform: 'macos',
      arch: 'aarch64',
      selfHosted: {
        scope: 'repository',
        ephemeral: true,
        maxConcurrency: 1,
        cleanWorkDirectory: true,
        runnerNamePrefix: 'liatir-macos-heavy-',
        minimumBootstrapFreeDiskBytes: 37_580_963_840,
      },
    });
  });

  it('rejects a self-hosted heavy job outside the exact checked runner context', () => {
    const runner = catalog.runnerProfiles.find((candidate) => candidate.id === 'macos-arm64-heavy');
    expect(() => validateRunnerExecutionContext(runner, {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'self-hosted',
      RUNNER_NAME: 'liatir-macos-heavy-1721600000-1234',
    })).not.toThrow();
    expect(() => validateRunnerExecutionContext(runner, {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      RUNNER_NAME: 'Mac-1',
    })).toThrow(/must execute on a self-hosted runner/);
    expect(() => validateRunnerExecutionContext(runner, {
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'self-hosted',
      RUNNER_NAME: 'unreviewed-runner',
    })).toThrow(/does not match prefix/);
  });

  it('guards heavy native allocation and preserves OIDC signing plus unconditional cleanup', () => {
    const validation = readFileSync(new URL('../../.github/workflows/_runtime-box-validate.yml', import.meta.url), 'utf8');
    const release = readFileSync(new URL('../../.github/workflows/runtime-box-release.yml', import.meta.url), 'utf8');
    const launcher = readFileSync(new URL('../../scripts/run-runtime-box-selfhosted-runner.sh', import.meta.url), 'utf8');
    const validationNative = validation.slice(validation.indexOf('\n  native:\n'));
    const releaseJob = release.slice(release.indexOf('\n  release:\n'));

    expect(validation).toContain('Require main before any native runner allocation');
    expect(validation).toContain('test "${{ github.ref }}" = "refs/heads/main"');
    expect(validationNative.indexOf('Clean stale Runtime Box state')).toBeLessThan(validationNative.indexOf('host-probe'));
    expect(validationNative).toContain('if: always()');
    expect(releaseJob.indexOf('Clean stale Runtime Box state')).toBeLessThan(releaseJob.indexOf('host-probe'));
    expect(release).toContain('id-token: write');
    expect(releaseJob).toContain('LIATIR_RUNTIME_BOX_SIGNER_ID_TOKEN');
    expect(releaseJob).not.toContain('keygen');
    expect(launcher).toContain('RUNNER_VERSION="2.336.0"');
    expect(launcher).toContain('8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079');
    expect(launcher).toContain('--ephemeral');
    expect(launcher).toContain('--no-default-labels');
    expect(launcher).toContain('RUNNER_ONLINE_TIMEOUT_SECONDS=11400');
  });

  it('keeps both self-hosted launchers on one pinned runner release and one cleanup contract', () => {
    const posix = readFileSync(new URL('../../scripts/run-runtime-box-selfhosted-runner.sh', import.meta.url), 'utf8');
    const windows = readFileSync(new URL('../../scripts/run-runtime-box-selfhosted-runner.ps1', import.meta.url), 'utf8');

    // Same pinned runner release on every OS, each with its own reviewed archive digest.
    expect(posix).toContain('RUNNER_VERSION="2.336.0"');
    expect(windows).toContain("$RunnerVersion = '2.336.0'");
    expect(posix).toContain('04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d');
    expect(windows).toContain('d59123a43003e357b0805b5d0f611d0bd2f65ab67d51bd070dd4e7a0f685c162');

    // The ephemeral, single-job, no-default-label contract holds on both.
    for (const launcher of [posix, windows]) {
      expect(launcher).toContain('--ephemeral');
      expect(launcher).toContain('--disableupdate');
      expect(launcher).toContain('--no-default-labels');
      expect(launcher).toContain('.liatir-runtime-box-runner');
      expect(launcher).toContain('actions/runners/registration-token');
      expect(launcher).toContain('--method DELETE');
    }
    expect(windows).toContain('$RunnerOnlineTimeoutSeconds = 11400');

    // Operational parameters come from the catalog, never hardcoded in a launcher.
    for (const launcher of [posix, windows]) {
      expect(launcher).toContain('runtime-box-ci.mjs');
      expect(launcher).not.toContain('liatir-linux-selfhosted');
      expect(launcher).not.toContain('liatir-windows-selfhosted');
    }

    // WSL: a multi-gigabyte conda prefix must never land on the 9p Windows mount.
    expect(posix).toContain('/mnt/*');

    // A hand-invoked launcher must refuse a target belonging to another OS before registering.
    for (const launcher of [posix, windows]) {
      expect(launcher).toContain('runner_platform');
      expect(launcher).toContain('runner_arch');
    }
  });

  it('keeps every Linux and Windows model target off the paid hosted runners', () => {
    // Phase 3 retired the paid native runners. Coordination jobs stay hosted on purpose — the
    // resolve job is what tells the operator which self-hosted runner to bring online, so putting
    // it behind one would deadlock.
    const paidLabels = ['ubuntu-24.04', 'windows-2025', 'liatir-linux-t4', 'liatir-windows-t4'];
    expect(catalog.runnerProfiles.map((runner) => runner.runsOn))
      .toEqual(expect.not.arrayContaining(['liatir-linux-t4', 'liatir-windows-t4']));

    for (const model of catalog.models) {
      for (const target of model.targets) {
        if (target.target.platform === 'macos') continue;
        const runner = catalog.runnerProfiles.find((candidate) => candidate.id === target.runnerProfileId);
        expect(runner?.selfHosted, `${model.boxId}/${target.targetId} is not self-hosted`).toBeDefined();
        expect(paidLabels, `${model.boxId}/${target.targetId} still uses a paid runner`)
          .not.toContain(runner?.runsOn);
      }
    }
  });

  it('exposes the resolved runner host so a launcher can refuse a foreign target', () => {
    const resolution = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../scripts/runtime-box-ci.mjs', import.meta.url)),
        'resolve',
        '--model', 'snap-stanford-uce-4layer',
        '--target', 'macos-aarch64-metal',
        '--mode', 'native-lifecycle',
        '--native-requested', 'false',
      ],
      { encoding: 'utf8' },
    );
    const resolved = JSON.parse(resolution.trim().split('\n').at(-1) as string);
    expect(resolved).toMatchObject({
      self_hosted: 'true',
      runner_platform: 'macos',
      runner_arch: 'aarch64',
    });
  });

  it('declares reviewed self-hosted Linux and Windows runner profiles for the pixi substrate', () => {
    const expected = [
      { id: 'linux-x64-selfhosted', runsOn: 'liatir-linux-selfhosted', platform: 'linux', gpu: false },
      { id: 'linux-x64-cuda-selfhosted', runsOn: 'liatir-linux-cuda-selfhosted', platform: 'linux', gpu: true },
      { id: 'windows-x64-selfhosted', runsOn: 'liatir-windows-selfhosted', platform: 'windows', gpu: false },
      { id: 'windows-x64-cuda-selfhosted', runsOn: 'liatir-windows-cuda-selfhosted', platform: 'windows', gpu: true },
    ];

    for (const { id, runsOn, platform, gpu } of expected) {
      const runner = catalog.runnerProfiles.find((candidate) => candidate.id === id);
      expect(runner, `missing runner profile ${id}`).toBeDefined();
      expect(runner).toMatchObject({
        runsOn,
        platform,
        arch: 'x86_64',
        gpu,
        selfHosted: {
          scope: 'repository',
          ephemeral: true,
          maxConcurrency: 1,
          cleanWorkDirectory: true,
          runnerNamePrefix: `${runsOn}-`,
        },
      });
      // The bootstrap floor is what stops a runner coming online without room to finish.
      expect(runner?.selfHosted?.minimumBootstrapFreeDiskBytes).toBeGreaterThanOrEqual(42_949_672_960);
      if (gpu) {
        // Capability floors the local RTX 4060 Ti (8.9, ~8.19 GB) clears, and the hosted T4 did too.
        expect(runner).toMatchObject({ minimumComputeCapability: '7.5' });
        expect(runner?.minimumGpuMemoryBytes).toBeLessThanOrEqual(8_585_740_288);
        expect(runner).not.toHaveProperty('expectedGpuModel');
      }
    }
  });

  it('rejects a self-hosted Linux or Windows job outside the exact checked runner context', () => {
    for (const id of ['linux-x64-cuda-selfhosted', 'windows-x64-selfhosted']) {
      const runner = catalog.runnerProfiles.find((candidate) => candidate.id === id);
      const prefix = runner?.selfHosted?.runnerNamePrefix ?? '';
      expect(() => validateRunnerExecutionContext(runner, {
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'self-hosted',
        RUNNER_NAME: `${prefix}1721600000-1234`,
      })).not.toThrow();
      expect(() => validateRunnerExecutionContext(runner, {
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        RUNNER_NAME: `${prefix}1721600000-1234`,
      })).toThrow(/must execute on a self-hosted runner/);
      expect(() => validateRunnerExecutionContext(runner, {
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'self-hosted',
        RUNNER_NAME: 'unreviewed-runner',
      })).toThrow(/does not match prefix/);
    }
  });

  it('shares the proven Linux product lifecycle dependencies across validation and release', () => {
    const validation = readFileSync(
      new URL('../../.github/workflows/_runtime-box-validate.yml', import.meta.url),
      'utf8',
    );
    const release = readFileSync(
      new URL('../../.github/workflows/runtime-box-release.yml', import.meta.url),
      'utf8',
    );
    const foundation = readFileSync(
      new URL('../../.github/workflows/runtime-box-foundation.yml', import.meta.url),
      'utf8',
    );
    const dependencyScript = readFileSync(
      new URL('../../scripts/install-runtime-box-linux-product-deps.sh', import.meta.url),
      'utf8',
    );
    const sharedCommand = 'bash scripts/install-runtime-box-linux-product-deps.sh';

    expect(validation).toContain(sharedCommand);
    expect(validation.indexOf(sharedCommand)).toBeLessThan(
      validation.indexOf('Install pinned Rust 1.95.0'),
    );
    expect(release).toContain(sharedCommand);
    expect(foundation).toContain(sharedCommand);
    expect(dependencyScript).toContain('libwebkit2gtk-4.1-dev');
    expect(dependencyScript).toContain('libayatana-appindicator3-dev');
    expect(dependencyScript).toContain('xvfb');
  });

  it('keeps tracked builds on the stable adapter and watches the package boundary', () => {
    const ciDispatcher = readFileSync(
      new URL('../../scripts/runtime-box-ci.mjs', import.meta.url),
      'utf8',
    );
    const stableCli = readFileSync(
      new URL('../../scripts/runtime-box.mjs', import.meta.url),
      'utf8',
    );
    expect(ciDispatcher).toContain(
      "const args = ['run', 'runtime-box', '--', 'build', resolved.target.recipeId];",
    );
    expect(stableCli).toContain(
      "import { dispatchRuntimeBox } from './runtime-box/scrollcase-adapter.mjs';",
    );

    for (const workflowName of [
      'runtime-box-foundation.yml',
      'runtime-box-scgpt-whole-human.yml',
      'runtime-box-geneformer-v1-10m.yml',
      'runtime-box-uce-4layer.yml',
    ]) {
      const workflow = readFileSync(
        new URL(`../../.github/workflows/${workflowName}`, import.meta.url),
        'utf8',
      );
      expect(workflow).toContain('- "package.json"');
      expect(workflow).toContain('- "package-lock.json"');
      expect(workflow).toContain('- "scripts/runtime-box.mjs"');
      expect(workflow).toContain('- "scripts/runtime-box/**"');
    }
  });
});
