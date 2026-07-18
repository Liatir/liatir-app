#!/usr/bin/env node

/** Checked Runtime Box CI catalog resolver and compact evidence writer. */

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runTrackedCommand,
  validateRuntimeBoxCiEvidence,
  writeCompactEvidence,
  writeHostEvidence,
  writeJson,
  writeModelEvidence,
  writeReleaseEvidence,
} from './runtime-box/evidence.mjs';
import { runWithHeartbeat } from './runtime-box/heartbeat.mjs';
import { runtimeBoxNpmInvocation } from './runtime-box/npm.mjs';
import { runtimeBoxTargetId, runtimeBoxTorchBackendArguments } from './runtime-box/targets.mjs';
import { lockedPythonDistributions } from './runtime-box/licenses.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CATALOG_PATH = resolve(ROOT, 'runtime-boxes/catalog.json');
const VALIDATION_MODES = new Set(['build', 'scientific', 'native-lifecycle']);
const TARGET_STATUSES = new Set([
  'planned',
  'buildable',
  'scientifically-validated',
  'native-lifecycle-validated',
  'published',
]);

/** Reads the catalog without accepting an alternate path from CI input. */
export function readRuntimeBoxCiCatalog() {
  return JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
}

/** Adds one key to GitHub job outputs when running under Actions. */
function setGithubOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** Rejects a false condition with a catalog-specific message. */
function requireCatalog(condition, message) {
  if (!condition) throw new Error(`Runtime Box CI catalog: ${message}`);
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Compares dotted numeric driver versions without floating-point truncation. */
export function numericVersionAtLeast(actual, minimum) {
  if (!/^\d+(?:\.\d+)*$/.test(actual ?? '') || !/^\d+(?:\.\d+)*$/.test(minimum ?? '')) {
    return false;
  }
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  const length = Math.max(actualParts.length, minimumParts.length);
  for (let index = 0; index < length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart !== minimumPart) return actualPart > minimumPart;
  }
  return true;
}

/** Sums existing CI build state so stale self-hosted data is visible before downloading. */
function existingBuildStateBytes(path) {
  if (!existsSync(path)) return 0;
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  return readdirSync(path).reduce(
    (total, entry) => total + existingBuildStateBytes(resolve(path, entry)),
    0,
  );
}

/** Calculates the conservative clean-build peak before any paid runner downloads assets. */
export function runtimeBoxBuildDiskPlan(recipe, target) {
  const sourceAssetBytes = (recipe.assets ?? []).reduce((total, asset) => total + asset.sizeBytes, 0);
  const localSourceBytes = (recipe.localFiles ?? []).reduce((total, file) => {
    const sourcePath = resolve(ROOT, file.sourcePath);
    requireCatalog(existsSync(sourcePath), `missing local recipe source ${file.sourcePath}`);
    return total + statSync(sourcePath).size;
  }, 0);
  const components = {
    sourceAssetBytes,
    localSourceBytes,
    estimatedInstalledSizeBytes: target.diskPlan?.estimatedInstalledSizeBytes,
    estimatedArchiveSizeBytes: target.diskPlan?.estimatedArchiveSizeBytes,
    safetyMarginBytes: target.diskPlan?.safetyMarginBytes,
  };
  requireCatalog(
    Object.values(components).every((value) => Number.isSafeInteger(value) && value >= 0),
    `invalid disk-plan component for ${target.targetId}`,
  );
  const calculatedPeakDiskBytes = Object.values(components).reduce((total, value) => total + value, 0);
  requireCatalog(Number.isSafeInteger(calculatedPeakDiskBytes), `disk plan exceeds safe integer range for ${target.targetId}`);
  requireCatalog(
    target.requiredBuildDiskBytes >= calculatedPeakDiskBytes,
    `required disk ${target.requiredBuildDiskBytes} is below calculated peak ${calculatedPeakDiskBytes} for ${target.targetId}`,
  );
  return { ...components, calculatedPeakDiskBytes, requiredBuildDiskBytes: target.requiredBuildDiskBytes };
}

/** Enforces the reviewed Linux-first gate before any Windows CUDA model target can activate. */
export function validateWindowsCudaPrerequisite(model, target) {
  if (target.target.platform !== 'windows' || target.target.accelerator !== 'cuda') return;
  const targetKey = `${model.modelId}/${target.targetId}`;
  requireCatalog(typeof target.linuxValidationPrerequisiteTargetId === 'string', `Windows CUDA target lacks a Linux prerequisite for ${targetKey}`);
  const prerequisite = model.targets.find((candidate) => candidate.targetId === target.linuxValidationPrerequisiteTargetId);
  requireCatalog(prerequisite?.target.platform === 'linux' && prerequisite?.target.accelerator === 'cuda', `Windows CUDA prerequisite is not a Linux CUDA target for ${targetKey}`);
  if (target.nativeCiEnabled) {
    requireCatalog(['scientifically-validated', 'native-lifecycle-validated', 'published'].includes(prerequisite.status), `Windows CUDA cannot activate before Linux scientific validation for ${targetKey}`);
  }
}

/** Finds a unique model and target selected only by catalog IDs. */
export function resolveCiTarget(catalog, modelId, recipeId, targetId, mode) {
  const model = catalog.models.find((candidate) => candidate.modelId === modelId);
  requireCatalog(model, `unknown modelId ${modelId}`);
  const target = model.targets.find((candidate) => candidate.targetId === targetId);
  requireCatalog(target, `unknown target ${modelId}/${targetId}`);
  if (recipeId !== undefined) {
    requireCatalog(target.recipeId === recipeId, `recipe ${recipeId} is not approved for ${modelId}/${targetId}`);
  }
  requireCatalog(target.validationModes.includes(mode), `mode ${mode} is not approved for ${modelId}/${targetId}`);
  const runner = catalog.runnerProfiles.find((candidate) => candidate.id === target.runnerProfileId);
  requireCatalog(runner, `missing runner profile ${target.runnerProfileId}`);
  return { model, target, runner };
}

/** Returns the bounded native-fixture matrix used by the foundation workflow. */
export function foundationMatrix(catalog) {
  return catalog.foundationFixtures.map((fixture) => {
    const runner = catalog.runnerProfiles.find((candidate) => candidate.id === fixture.runnerProfileId);
    requireCatalog(runner, `missing foundation runner ${fixture.runnerProfileId}`);
    return {
      recipeId: fixture.recipeId,
      runsOn: runner.runsOn,
      timeoutMinutes: fixture.timeoutMinutes,
      rustLifecycle: fixture.rustLifecycle,
      requiredBuildDiskBytes: fixture.requiredBuildDiskBytes,
      heartbeatSeconds: catalog.costPolicy.heartbeatSeconds,
    };
  });
}

/** Validates all static catalog invariants and its repository-owned references. */
export function validateRuntimeBoxCiCatalog(catalog, { requireWorkflows = true } = {}) {
  requireCatalog(catalog?.schemaVersion === 1, 'schemaVersion must be 1');
  requireCatalog(catalog.costPolicy?.maxPaidRunnerConcurrency === 1, 'paid runner concurrency must remain 1');
  requireCatalog(catalog.costPolicy?.maxModelsPerGpuJob === 1, 'GPU jobs must remain scoped to one model');
  requireCatalog(catalog.costPolicy?.maxTargetsPerGpuJob === 1, 'GPU jobs must remain scoped to one target');
  requireCatalog(Number.isInteger(catalog.costPolicy?.heartbeatSeconds) && catalog.costPolicy.heartbeatSeconds >= 60, 'heartbeat must be at least 60 seconds');
  requireCatalog(catalog.costPolicy?.gpuManualOnly === true, 'GPU workflows must remain manual-only');
  requireCatalog(catalog.costPolicy?.scheduledGpuWorkflows === false, 'scheduled GPU workflows are forbidden');
  requireCatalog(catalog.costPolicy?.linuxCudaBeforeWindowsCuda === true, 'Linux-first CUDA policy is required');
  requireCatalog(catalog.costPolicy?.cacheModelWeightsOrArchives === false, 'model weights and archives may not be cached');
  requireCatalog(Array.isArray(catalog.runnerProfiles) && catalog.runnerProfiles.length > 0, 'runnerProfiles are required');
  requireCatalog(Array.isArray(catalog.foundationFixtures) && catalog.foundationFixtures.length > 0, 'foundationFixtures are required');
  requireCatalog(Array.isArray(catalog.models) && catalog.models.length > 0, 'models are required');

  const runnerIds = new Set();
  const runnerLabels = new Set();
  for (const runner of catalog.runnerProfiles) {
    requireCatalog(typeof runner.id === 'string' && runner.id, 'runner id is required');
    requireCatalog(!runnerIds.has(runner.id), `duplicate runner id ${runner.id}`);
    requireCatalog(typeof runner.runsOn === 'string' && runner.runsOn, `runner ${runner.id} has no label`);
    requireCatalog(!runnerLabels.has(runner.runsOn), `duplicate runner label ${runner.runsOn}`);
    requireCatalog(['macos', 'linux', 'windows'].includes(runner.platform), `invalid runner platform ${runner.platform}`);
    requireCatalog(['aarch64', 'x86_64'].includes(runner.arch), `invalid runner arch ${runner.arch}`);
    requireCatalog(Number.isInteger(runner.maxTimeoutMinutes) && runner.maxTimeoutMinutes > 0, `invalid timeout for ${runner.id}`);
    if (runner.gpu) {
      requireCatalog(typeof runner.expectedGpuModel === 'string' && runner.expectedGpuModel, `GPU runner ${runner.id} lacks an exact model`);
      requireCatalog(Number.isSafeInteger(runner.minimumGpuMemoryBytes) && runner.minimumGpuMemoryBytes > 0, `GPU runner ${runner.id} lacks a VRAM floor`);
      requireCatalog(/^\d+\.\d+$/.test(runner.expectedComputeCapability ?? ''), `GPU runner ${runner.id} lacks a compute capability`);
    } else {
      requireCatalog(
        runner.expectedGpuModel === undefined
          && runner.minimumGpuMemoryBytes === undefined
          && runner.expectedComputeCapability === undefined,
        `CPU runner ${runner.id} declares GPU-only requirements`,
      );
    }
    runnerIds.add(runner.id);
    runnerLabels.add(runner.runsOn);
  }

  const fixtureIds = new Set();
  for (const fixture of catalog.foundationFixtures) {
    requireCatalog(!fixtureIds.has(fixture.recipeId), `duplicate foundation recipe ${fixture.recipeId}`);
    const recipePath = resolve(ROOT, 'runtime-boxes/recipes', fixture.recipeId, 'recipe.json');
    requireCatalog(existsSync(recipePath), `missing foundation recipe ${fixture.recipeId}`);
    const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
    const runner = catalog.runnerProfiles.find((candidate) => candidate.id === fixture.runnerProfileId);
    requireCatalog(runner, `unknown foundation runner ${fixture.runnerProfileId}`);
    requireCatalog(recipe.recipeId === fixture.recipeId, `foundation recipeId mismatch for ${fixture.recipeId}`);
    requireCatalog(recipe.target.platform === runner.platform && recipe.target.arch === runner.arch, `foundation runner host mismatch for ${fixture.recipeId}`);
    requireCatalog(fixture.timeoutMinutes <= runner.maxTimeoutMinutes, `foundation timeout exceeds ${runner.id}`);
    const fixtureLock = readFileSync(resolve(recipePath, '..', recipe.requirementsLock));
    requireCatalog(/^[a-f0-9]{64}$/.test(fixture.dependencyLockSha256), `invalid fixture lock SHA-256 for ${fixture.recipeId}`);
    requireCatalog(sha256Bytes(fixtureLock) === fixture.dependencyLockSha256, `fixture dependency lock SHA-256 mismatch for ${fixture.recipeId}`);
    requireCatalog(Number.isSafeInteger(fixture.requiredBuildDiskBytes) && fixture.requiredBuildDiskBytes > 0, `invalid fixture disk requirement for ${fixture.recipeId}`);
    fixtureIds.add(fixture.recipeId);
  }

  const signerPolicy = JSON.parse(readFileSync(resolve(ROOT, 'services/runtime-box-signer/policy.json'), 'utf8'));
  const productionTrust = JSON.parse(readFileSync(resolve(ROOT, 'runtime-boxes/trust/production-public.json'), 'utf8'));
  const trustedKeyIds = new Set(productionTrust.keys.map((key) => key.keyId));
  const modelIds = new Set();
  const boxIds = new Set();
  const targetKeys = new Set();
  for (const model of catalog.models) {
    requireCatalog(!modelIds.has(model.modelId), `duplicate modelId ${model.modelId}`);
    requireCatalog(!boxIds.has(model.boxId), `duplicate boxId ${model.boxId}`);
    requireCatalog(model.legalStatus === 'approved', `${model.modelId} is not legally approved`);
    requireCatalog(existsSync(resolve(ROOT, model.legalRecord)), `missing legal record ${model.legalRecord}`);
    requireCatalog(existsSync(resolve(ROOT, model.validatorPath)), `missing validator ${model.validatorPath}`);
    requireCatalog(existsSync(resolve(ROOT, model.productScriptPath)), `missing product script ${model.productScriptPath}`);
    requireCatalog(typeof model.validatorScript === 'string' && model.validatorScript.startsWith('runtime-box:validate:'), `invalid validator script for ${model.modelId}`);
    requireCatalog(Array.isArray(model.targets) && model.targets.length > 0, `targets are required for ${model.modelId}`);
    const signerBox = signerPolicy.boxes.find((candidate) => candidate.boxId === model.boxId);
    requireCatalog(signerBox?.modelId === model.modelId && signerBox?.runtimeId === model.runtimeId, `signer policy identity mismatch for ${model.boxId}`);

    for (const target of model.targets) {
      const targetKey = `${model.modelId}/${target.targetId}`;
      requireCatalog(!targetKeys.has(targetKey), `duplicate target ${targetKey}`);
      requireCatalog(runtimeBoxTargetId(target.target) === target.targetId, `targetId mismatch for ${targetKey}`);
      requireCatalog(TARGET_STATUSES.has(target.status), `invalid status for ${targetKey}`);
      requireCatalog(target.validationModes.length > 0 && target.validationModes.every((mode) => VALIDATION_MODES.has(mode)), `invalid validation mode for ${targetKey}`);
      requireCatalog(target.hostEnvironments.length > 0, `host environments are required for ${targetKey}`);
      requireCatalog(!target.hostEnvironments.includes('windows-wsl2') || target.target.platform === 'linux', `WSL2 may only use a Linux target for ${targetKey}`);
      requireCatalog(!(target.target.platform === 'macos' && target.target.arch === 'x86_64'), `macOS Intel is excluded for ${targetKey}`);
      const runner = catalog.runnerProfiles.find((candidate) => candidate.id === target.runnerProfileId);
      requireCatalog(runner, `unknown runner ${target.runnerProfileId}`);
      requireCatalog(runner.platform === target.target.platform && runner.arch === target.target.arch, `runner host mismatch for ${targetKey}`);
      requireCatalog(runner.gpu || !target.gpuRequired, `GPU target uses a non-GPU runner for ${targetKey}`);
      if (target.target.accelerator === 'cuda') {
        requireCatalog(target.gpuRequired === true, `CUDA target is not marked GPU-required for ${targetKey}`);
      }
      requireCatalog(target.timeoutMinutes <= runner.maxTimeoutMinutes, `timeout exceeds runner maximum for ${targetKey}`);
      requireCatalog(Number.isSafeInteger(target.requiredBuildDiskBytes) && target.requiredBuildDiskBytes > 0, `invalid disk requirement for ${targetKey}`);
      requireCatalog(signerBox.targets.includes(target.targetId), `catalog target is outside signer policy for ${targetKey}`);
      const recipePath = resolve(ROOT, 'runtime-boxes/recipes', target.recipeId, 'recipe.json');
      requireCatalog(existsSync(recipePath), `missing recipe ${target.recipeId}`);
      const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
      requireCatalog(recipe.recipeId === target.recipeId && recipe.modelId === model.modelId && recipe.boxId === model.boxId && recipe.runtimeId === model.runtimeId, `recipe identity mismatch for ${targetKey}`);
      requireCatalog(runtimeBoxTargetId(recipe.target) === target.targetId, `recipe target mismatch for ${targetKey}`);
      runtimeBoxTorchBackendArguments(recipe);
      requireCatalog(readFileSync(resolve(ROOT, model.legalRecord), 'utf8').includes(recipe.sourceRevision), `legal record is not pinned to recipe source ${recipe.sourceRevision} for ${targetKey}`);
      for (const localFile of recipe.localFiles ?? []) {
        const localPath = resolve(ROOT, localFile.sourcePath);
        requireCatalog(existsSync(localPath), `missing local recipe file ${localFile.sourcePath} for ${targetKey}`);
        requireCatalog(/^[a-f0-9]{64}$/.test(localFile.sha256), `invalid local recipe hash for ${targetKey}`);
        requireCatalog(
          sha256Bytes(readFileSync(localPath)) === localFile.sha256,
          `local recipe file hash mismatch for ${localFile.sourcePath} in ${targetKey}`,
        );
      }
      const lockPath = resolve(recipePath, '..', recipe.requirementsLock);
      requireCatalog(existsSync(lockPath), `missing dependency lock for ${targetKey}`);
      const lockBytes = readFileSync(lockPath);
      requireCatalog(/^[a-f0-9]{64}$/.test(target.dependencyLockSha256), `invalid pinned lock SHA-256 for ${targetKey}`);
      requireCatalog(sha256Bytes(lockBytes) === target.dependencyLockSha256, `dependency lock SHA-256 mismatch for ${targetKey}`);
      requireCatalog(lockBytes.includes(Buffer.from('--hash=sha256:')), `dependency lock is not hash-pinned for ${targetKey}`);
      if (target.dependencyLicenseAudit) {
        requireCatalog(
          recipe.dependencyLicenseAudit === target.dependencyLicenseAudit,
          `recipe and catalog dependency license audits differ for ${targetKey}`,
        );
        const auditPath = resolve(ROOT, target.dependencyLicenseAudit);
        requireCatalog(
          auditPath.startsWith(`${resolve(ROOT, 'runtime-boxes/legal/audits')}${sep}`),
          `dependency license audit is outside runtime-boxes/legal/audits for ${targetKey}`,
        );
        requireCatalog(existsSync(auditPath), `missing dependency license audit for ${targetKey}`);
        const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
        requireCatalog(
          audit.schemaVersion === 1
            && audit.kind === 'liatir.runtime-box.python-dependency-license-audit'
            && audit.targetId === target.targetId
            && audit.torchBackend === recipe.torchBackend
            && audit.dependencyLockSha256 === target.dependencyLockSha256,
          `dependency license audit identity mismatch for ${targetKey}`,
        );
        const reviewedPackages = audit.packages.map(({ name, version }) => ({ name, version }));
        requireCatalog(
          JSON.stringify(reviewedPackages) === JSON.stringify(lockedPythonDistributions(lockBytes)),
          `dependency license audit package set differs from the lock for ${targetKey}`,
        );
        requireCatalog(
          audit.packages.every((entry) => (
            typeof entry.declaredLicense === 'string'
            && entry.declaredLicense
            && Array.isArray(entry.licenseFiles)
          )),
          `dependency license audit contains an incomplete entry for ${targetKey}`,
        );
      }
      if (recipe.torchBackend) {
        requireCatalog(target.dependencyLicenseAudit, `PyTorch target lacks a reviewed dependency license audit for ${targetKey}`);
      }
      runtimeBoxBuildDiskPlan(recipe, target);

      validateWindowsCudaPrerequisite(model, target);

      if (target.status === 'published') {
        const publication = target.publication;
        requireCatalog(publication, `published target lacks evidence for ${targetKey}`);
        requireCatalog(/^https:\/\//.test(publication.releaseManifestUrl), `published target lacks an HTTPS manifest for ${targetKey}`);
        requireCatalog(/^[a-f0-9]{64}$/.test(publication.archiveSha256), `published target has an invalid archive hash for ${targetKey}`);
        requireCatalog(Number.isSafeInteger(publication.archiveSizeBytes) && publication.archiveSizeBytes > 0, `published target has an invalid archive size for ${targetKey}`);
        requireCatalog(trustedKeyIds.has(publication.signingKeyId), `published target uses an untrusted key for ${targetKey}`);
        if (publication.source === 'github-actions') {
          requireCatalog(publication.workflowRunId && publication.workflowRunUrl, `GitHub publication lacks workflow evidence for ${targetKey}`);
          requireCatalog(publication.evidenceRecord, `GitHub publication lacks a reviewed evidence record for ${targetKey}`);
          const evidencePath = resolve(ROOT, publication.evidenceRecord);
          requireCatalog(evidencePath.startsWith(`${resolve(ROOT, 'runtime-boxes/evidence')}${sep}`), `evidence record is outside runtime-boxes/evidence for ${targetKey}`);
          requireCatalog(existsSync(evidencePath), `missing evidence record for ${targetKey}`);
          const evidence = validateRuntimeBoxCiEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')));
          requireCatalog(evidence.phase === 'production-release' && evidence.status === 'passed', `reviewed publication evidence did not pass for ${targetKey}`);
          requireCatalog(evidence.subject.modelId === model.modelId && evidence.subject.targetId === target.targetId, `reviewed publication evidence identity mismatch for ${targetKey}`);
        } else {
          requireCatalog(publication.source === 'legacy-operator', `invalid publication source for ${targetKey}`);
          requireCatalog(!publication.workflowRunId && !publication.workflowRunUrl, `legacy publication must not invent workflow evidence for ${targetKey}`);
        }
      }
      targetKeys.add(targetKey);
    }

    if (requireWorkflows) {
      const workflowPath = resolve(ROOT, model.callerWorkflow);
      requireCatalog(existsSync(workflowPath), `missing caller workflow ${model.callerWorkflow}`);
      const workflow = readFileSync(workflowPath, 'utf8');
      requireCatalog(workflow.includes('uses: ./.github/workflows/_runtime-box-validate.yml'), `caller does not use reusable validation: ${model.callerWorkflow}`);
      requireCatalog(workflow.includes(`runtime-boxes/recipes/${model.targets[0].recipeId}/**`), `caller lacks recipe path scope: ${model.callerWorkflow}`);
      requireCatalog(workflow.includes(model.legalRecord), `caller lacks legal path scope: ${model.callerWorkflow}`);
      requireCatalog(workflow.includes(model.validatorPath), `caller lacks validator path scope: ${model.callerWorkflow}`);
      requireCatalog(!workflow.includes('secrets: inherit'), `caller may not inherit secrets: ${model.callerWorkflow}`);
      requireCatalog(!workflow.includes('environment:'), `caller may not use an environment: ${model.callerWorkflow}`);
      requireCatalog(workflow.includes('cancel-in-progress: true'), `validation workflow must cancel stale runs: ${model.callerWorkflow}`);
      const concurrencyGroup = workflow.match(/concurrency:\s*\n\s*group:\s*([^\n]+)/)?.[1] ?? '';
      requireCatalog(concurrencyGroup && !concurrencyGroup.includes('inputs.mode'), `model and target modes may not run concurrently: ${model.callerWorkflow}`);
    }
    modelIds.add(model.modelId);
    boxIds.add(model.boxId);
  }
  if (requireWorkflows) {
    for (const workflowName of ['runtime-box-linux-cuda-preflight.yml', 'runtime-box-windows-cuda-preflight.yml']) {
      const workflow = readFileSync(resolve(ROOT, '.github/workflows', workflowName), 'utf8');
      requireCatalog(workflow.includes('workflow_dispatch:'), `${workflowName} must be manual-only`);
      requireCatalog(!workflow.includes('schedule:') && !workflow.includes('pull_request:') && !workflow.includes('push:'), `${workflowName} has an automatic trigger`);
      requireCatalog(workflow.includes('cancel-in-progress: true'), `${workflowName} must cancel stale validation`);
      requireCatalog(!workflow.includes('actions/cache'), `${workflowName} may not cache model assets`);
      requireCatalog(workflow.includes('enable-cache: false'), `${workflowName} must keep uv caching disabled`);
      if (workflowName.includes('windows')) {
        requireCatalog(workflow.includes('linux_run_id:') && workflow.includes('run.head_sha === process.env.GITHUB_SHA'), 'Windows T4 preflight must prove the successful Linux run for the exact commit');
      }
    }
    const foundation = readFileSync(resolve(ROOT, '.github/workflows/runtime-box-foundation.yml'), 'utf8');
    requireCatalog(foundation.includes('max-parallel: 1'), 'foundation paid fixture concurrency must remain 1');
    const release = readFileSync(resolve(ROOT, '.github/workflows/runtime-box-release.yml'), 'utf8');
    requireCatalog(release.includes('cancel-in-progress: false'), 'production releases must never be cancelled');
  }
  return catalog;
}

/** Parses strict --key value options without accepting positional commands as values. */
function parseOptions(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    assert(key?.startsWith('--') && value !== undefined, `Expected --key value, got ${key ?? '<end>'}`);
    options.set(key.slice(2), value);
  }
  return options;
}

/** Converts kebab-case CLI flags to the camelCase evidence API contract. */
export function runtimeBoxEvidenceOptions(options) {
  return Object.fromEntries([...options].map(([key, value]) => [
    key.replace(/-([a-z0-9])/g, (_match, character) => character.toUpperCase()),
    value,
  ]));
}

/** Runs a checked validator, preserves its logs, and stores its canonical JSON result. */
async function runPackageScript(script, output, environment = {}) {
  const invocation = runtimeBoxNpmInvocation(['run', '--silent', script]);
  const result = await runWithHeartbeat(
    invocation.command,
    invocation.args,
    {
      label: `Scientific validator ${script}`,
      capture: true,
      maxBuffer: 64 * 1024 * 1024,
      cwd: ROOT,
      env: environment,
    },
  );
  if (result.signal) throw new Error(`${script} terminated by ${result.signal}`);
  if (result.code !== 0) throw new Error(`${script} exited with ${result.code}`);
  let validatorResult;
  try {
    validatorResult = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`${script} did not emit one canonical JSON result`);
  }
  requireCatalog(validatorResult.status === 'passed' && validatorResult.evidence, `${script} emitted incomplete evidence`);
  await writeJson(output, {
    schemaVersion: 1,
    status: 'passed',
    elapsedMs: result.elapsedMs,
    result: validatorResult,
  });
}

/** Checks the current native host and free workspace capacity before a heavy build. */
async function probeHost(target, runner, output) {
  const record = await writeHostEvidence(output, target.target, runner.runsOn);
  const recipe = JSON.parse(readFileSync(
    resolve(ROOT, 'runtime-boxes/recipes', target.recipeId, 'recipe.json'),
    'utf8',
  ));
  if (target.gpuRequired) {
    requireCatalog(record.gpuCount === 1, `runner ${runner.id} must expose exactly one GPU`);
    requireCatalog(record.gpuModel === runner.expectedGpuModel, `runner ${runner.id} exposed ${record.gpuModel ?? 'no GPU'} instead of ${runner.expectedGpuModel}`);
    requireCatalog(record.gpuMemoryBytes >= runner.minimumGpuMemoryBytes, `runner ${runner.id} has only ${record.gpuMemoryBytes ?? 0} GPU bytes`);
    requireCatalog(record.computeCapability === runner.expectedComputeCapability, `runner ${runner.id} compute capability is ${record.computeCapability ?? 'missing'} instead of ${runner.expectedComputeCapability}`);
    requireCatalog(
      numericVersionAtLeast(record.driverVersion, recipe.compatibility?.minNvidiaDriverVersion),
      `runner ${runner.id} driver ${record.driverVersion ?? 'missing'} is below ${recipe.compatibility?.minNvidiaDriverVersion ?? 'the recipe minimum'}`,
    );
  }
  const existingBytes = ['.runtime-box-build', '.runtime-box-dist'].reduce(
    (total, name) => total + existingBuildStateBytes(resolve(ROOT, name)),
    0,
  );
  record.existingBuildStateBytes = existingBytes;
  record.calculatedDiskPlan = runtimeBoxBuildDiskPlan(
    recipe,
    target,
  );
  await writeJson(output, record);
  requireCatalog(record.freeDiskBytesBefore >= target.requiredBuildDiskBytes, `only ${record.freeDiskBytesBefore} free bytes; ${target.requiredBuildDiskBytes} required`);
  console.log(JSON.stringify(record));
}

async function probeFoundationHost(fixture, runner, output) {
  const recipe = JSON.parse(readFileSync(resolve(ROOT, 'runtime-boxes/recipes', fixture.recipeId, 'recipe.json'), 'utf8'));
  const record = await writeHostEvidence(output, recipe.target, runner.runsOn);
  requireCatalog(record.freeDiskBytesBefore >= fixture.requiredBuildDiskBytes, `only ${record.freeDiskBytesBefore} free bytes; ${fixture.requiredBuildDiskBytes} required`);
  console.log(JSON.stringify({ ...record, requiredBuildDiskBytes: fixture.requiredBuildDiskBytes }));
}

/** Removes Runtime Box build state without touching repository sources. */
async function cleanBuildState() {
  for (const name of ['.runtime-box-build', '.runtime-box-dist', '.runtime-box-local', '.runtime-box-ci']) {
    await rm(resolve(ROOT, name), { recursive: true, force: true });
  }
}

/** Dispatches bounded CI commands. */
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const catalog = readRuntimeBoxCiCatalog();
  if (command === 'check') {
    validateRuntimeBoxCiCatalog(catalog);
    console.log(`Validated ${catalog.models.length} Runtime Box model records and ${catalog.foundationFixtures.length} foundation fixtures.`);
    return;
  }
  if (command === 'foundation-matrix') {
    validateRuntimeBoxCiCatalog(catalog);
    const matrix = JSON.stringify({ include: foundationMatrix(catalog) });
    setGithubOutput('matrix', matrix);
    console.log(matrix);
    return;
  }
  const options = parseOptions(rest);
  if (command === 'resolve') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    const nativeRequested = options.get('native-requested') === 'true';
    requireCatalog(!nativeRequested || resolved.target.nativeCiEnabled, `native CI is not enabled for ${resolved.model.modelId}/${resolved.target.targetId}`);
    const recipe = JSON.parse(readFileSync(resolve(ROOT, 'runtime-boxes/recipes', resolved.target.recipeId, 'recipe.json'), 'utf8'));
    const values = {
      recipe_id: resolved.target.recipeId,
      runs_on: resolved.runner.runsOn,
      timeout_minutes: resolved.target.timeoutMinutes,
      uv_version: recipe.uvVersion,
      validator_script: resolved.model.validatorScript,
      native_eligible: nativeRequested ? 'true' : 'false',
      gpu_required: resolved.target.gpuRequired ? 'true' : 'false',
      box_id: resolved.model.boxId,
      release_path: `.runtime-box-dist/${resolved.model.boxId}-${recipe.version}-${resolved.target.targetId}.release.json`,
      dependency_lock_sha256: resolved.target.dependencyLockSha256,
      calculated_peak_disk_bytes: runtimeBoxBuildDiskPlan(recipe, resolved.target).calculatedPeakDiskBytes,
      required_disk_bytes: resolved.target.requiredBuildDiskBytes,
      heartbeat_seconds: catalog.costPolicy.heartbeatSeconds,
    };
    for (const [key, value] of Object.entries(values)) setGithubOutput(key, value);
    console.log(JSON.stringify(values));
    return;
  }
  if (command === 'release-resolve') {
    validateRuntimeBoxCiCatalog(catalog);
    const model = catalog.models.find((candidate) => candidate.modelId === options.get('model'));
    requireCatalog(model, `unknown modelId ${options.get('model')}`);
    const target = model.targets.find((candidate) => candidate.targetId === options.get('target'));
    requireCatalog(target, `unknown target ${model.modelId}/${options.get('target')}`);
    const resolved = resolveCiTarget(catalog, model.modelId, target.recipeId, target.targetId, 'native-lifecycle');
    requireCatalog(resolved.target.nativeCiEnabled, `native CI is not enabled for ${model.modelId}/${target.targetId}`);
    const recipe = JSON.parse(readFileSync(resolve(ROOT, 'runtime-boxes/recipes', target.recipeId, 'recipe.json'), 'utf8'));
    const values = {
      recipe_id: target.recipeId,
      version: recipe.version,
      runs_on: resolved.runner.runsOn,
      timeout_minutes: target.timeoutMinutes,
      uv_version: recipe.uvVersion,
      validator_script: model.validatorScript,
      box_id: model.boxId,
      release_path: `.runtime-box-dist/${model.boxId}-${recipe.version}-${target.targetId}.release.json`,
      channel_path: `.runtime-box-dist/${model.boxId}-beta-${target.targetId}.channel.json`,
      dependency_lock_sha256: target.dependencyLockSha256,
      calculated_peak_disk_bytes: runtimeBoxBuildDiskPlan(recipe, target).calculatedPeakDiskBytes,
      required_disk_bytes: target.requiredBuildDiskBytes,
      heartbeat_seconds: catalog.costPolicy.heartbeatSeconds,
    };
    for (const [key, value] of Object.entries(values)) setGithubOutput(key, value);
    console.log(JSON.stringify(values));
    return;
  }
  if (command === 'host-probe') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    await probeHost(resolved.target, resolved.runner, options.get('output') || '.runtime-box-ci/host.json');
    return;
  }
  if (command === 'foundation-host-probe') {
    validateRuntimeBoxCiCatalog(catalog);
    const fixture = catalog.foundationFixtures.find((candidate) => candidate.recipeId === options.get('recipe'));
    requireCatalog(fixture, `unknown foundation recipe ${options.get('recipe')}`);
    const runner = catalog.runnerProfiles.find((candidate) => candidate.id === fixture.runnerProfileId);
    requireCatalog(runner, `missing foundation runner ${fixture.runnerProfileId}`);
    await probeFoundationHost(fixture, runner, options.get('output') || '.runtime-box-ci/foundation-host.json');
    return;
  }
  if (command === 'tracked-build') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    const args = ['run', 'runtime-box', '--', 'build', resolved.target.recipeId];
    for (const name of ['channel', 'signer', 'signer-audience', 'public-key', 'asset-base-url']) {
      if (options.has(name)) args.push(`--${name}`, options.get(name));
    }
    const invocation = runtimeBoxNpmInvocation(args);
    await runTrackedCommand(
      invocation.command,
      invocation.args,
      options.get('metrics') || '.runtime-box-ci/build-metrics.json',
    );
    return;
  }
  if (command === 'run-validator') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    requireCatalog(options.get('script') === resolved.model.validatorScript, 'validator script does not match the catalog');
    await runPackageScript(
      resolved.model.validatorScript,
      options.get('output') || '.runtime-box-ci/scientific-result.json',
      {
        LIATIR_RUNTIME_BOX_RECIPE_ID: resolved.target.recipeId,
        LIATIR_RUNTIME_BOX_TARGET_ID: resolved.target.targetId,
      },
    );
    return;
  }
  const evidenceOptions = runtimeBoxEvidenceOptions(options);
  if (command === 'write-evidence') return writeCompactEvidence(evidenceOptions);
  if (command === 'write-model-evidence') return writeModelEvidence(evidenceOptions, catalog);
  if (command === 'write-release-evidence' || command === 'release-evidence') {
    return writeReleaseEvidence(evidenceOptions, catalog);
  }
  if (command === 'clean') return cleanBuildState();
  throw new Error(`Unknown Runtime Box CI command: ${command ?? '<none>'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
