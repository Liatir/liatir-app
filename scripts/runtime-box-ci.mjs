#!/usr/bin/env node

/** Checked Runtime Box CI catalog resolver and compact evidence writer. */

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureWorkspace,
  getWorkspace,
  lockedCondaDistributions,
  workspaceOverridesFromArgv,
} from 'scrollcase/build';
import { boxTargetId } from 'scrollcase/contract/browser';
import {
  runTrackedCommand,
  validateRuntimeBoxCiEvidence,
  writeCompactEvidence,
  writeHostEvidence,
  writeJson,
  writeModelEvidence,
  writeReleaseEvidence,
} from './runtime-box/evidence.mjs';
import { npmInvocation } from './node-cli.mjs';
import { runWithHeartbeat } from './runtime-box/heartbeat.mjs';
import { runtimeBoxChannelDocumentPath } from './runtime-box/identity.mjs';
import { runtimeBoxPolicyFingerprint } from '../services/runtime-box-signer/src/policy.mjs';
import { resolveRuntimeBoxAuthoringInput } from './runtime-box/authoring-input.mjs';

/**
 * Workspace accessors. These read lazily so `main()` can configure the workspace from flags before
 * any path is resolved. The catalog, legal records, trust keys and workflows are Liatir-side inputs
 * addressed relative to the project root; recipes and build state come from the workspace layout.
 */
const workspaceRoot = () => getWorkspace().root;
const catalogPath = () => resolve(workspaceRoot(), 'runtime-boxes/catalog.json');
const LEGACY_AUTHORING_FIELDS = Object.freeze([
  'uvVersion',
  'requirementsInput',
  'requirementsLock',
  'torchBackend',
]);

function requireNoLegacyAuthoringFields(scroll, identity) {
  for (const field of LEGACY_AUTHORING_FIELDS) {
    requireCatalog(!(field in scroll), `${identity} retains deprecated ${field}`);
  }
}

function authoringInputFor(recipeId, { expectedBoxId, expectedTargetId } = {}) {
  return resolveRuntimeBoxAuthoringInput({
    recipeId,
    scrollsDir: getWorkspace().scrollsDir,
    expectedBoxId,
    expectedTargetId,
  });
}

/** Finds one canonical v2 scroll by its stable Liatir provenance identity. */
function scrollPathForId(scrollId) {
  return authoringInputFor(scrollId).documentPath;
}
/** Generated directories the builder owns, in the order it is safe to remove them. */
const buildStateDirectories = () => {
  const workspace = getWorkspace();
  return [workspace.buildDir, workspace.distDir, workspace.keysDir, resolve(workspace.root, '.runtime-box-ci')];
};
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
  return JSON.parse(readFileSync(catalogPath(), 'utf8'));
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

/**
 * Validates a pixi recipe's committed pixi.lock and its reviewed conda license audit.
 *
 * `pixi install --frozen` guarantees the installed set equals the lock, and the lock carries every
 * package's SPDX license, so the audit is a pure function of the lock (no built prefix needed). No
 * prune-vs-lock guard here: the conda
 * audit is lock-derived and conservatively lists the full locked set, so pruning transitive conda
 * dependencies to shrink the box is allowed and over-discloses licenses rather than under-disclosing.
 */
function validatePixiRecipeLockAndAudit(recipe, target, recipePath, targetKey) {
  const lockPath = resolve(recipePath, '..', 'pixi.lock');
  requireCatalog(existsSync(lockPath), `missing pixi.lock for ${targetKey}`);
  const lockBytes = readFileSync(lockPath);
  requireCatalog(/^[a-f0-9]{64}$/.test(target.dependencyLockSha256), `invalid pinned lock SHA-256 for ${targetKey}`);
  requireCatalog(sha256Bytes(lockBytes) === target.dependencyLockSha256, `pixi.lock SHA-256 mismatch for ${targetKey}`);
  // Every current model bundles a framework (torch), so a pixi recipe must carry a reviewed audit.
  requireCatalog(target.condaDependencyLicenseAudit, `pixi target lacks a reviewed conda license audit for ${targetKey}`);
  requireCatalog(
    recipe.condaDependencyLicenseAudit === target.condaDependencyLicenseAudit,
    `recipe and catalog conda license audits differ for ${targetKey}`,
  );
  const auditPath = resolve(workspaceRoot(), target.condaDependencyLicenseAudit);
  requireCatalog(
    auditPath.startsWith(`${resolve(workspaceRoot(), 'runtime-boxes/legal/audits')}${sep}`),
    `conda license audit is outside runtime-boxes/legal/audits for ${targetKey}`,
  );
  requireCatalog(existsSync(auditPath), `missing conda license audit for ${targetKey}`);
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  const expectedAuditIdentity = recipe.schemaVersion === 2
    ? audit.schemaVersion === 2
      && audit.kind === 'scrollcase.box.dependency-license-audit'
    : audit.schemaVersion === 1
      && audit.kind === 'liatir.runtime-box.conda-dependency-license-audit';
  requireCatalog(
    expectedAuditIdentity
      && audit.targetId === target.targetId
      && audit.dependencyLockSha256 === target.dependencyLockSha256,
    `conda license audit identity mismatch for ${targetKey}`,
  );
  const byIdentity = (left, right) => (
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  );
  const reviewedPackages = audit.packages
    .map(({ name, version }) => ({ name, version }))
    .sort(byIdentity);
  const lockedPackages = lockedCondaDistributions(lockBytes)
    .map(({ name, version }) => ({ name, version }))
    .sort(byIdentity);
  requireCatalog(
    JSON.stringify(reviewedPackages) === JSON.stringify(lockedPackages),
    `conda license audit package set differs from the lock for ${targetKey}`,
  );
  requireCatalog(
    audit.packages.every((entry) => (
      typeof entry.declaredLicense === 'string'
      && entry.declaredLicense
      && (entry.source === 'conda' || entry.source === 'pypi')
    )),
    `conda license audit contains an incomplete entry for ${targetKey}`,
  );
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
    const sourcePath = resolve(workspaceRoot(), file.sourcePath);
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
  const model = catalog.components.find((candidate) => candidate.modelId === modelId);
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

/** Rejects a heavy job unless GitHub assigned it to the reviewed ephemeral runner. */
export function validateRunnerExecutionContext(runner, environment = process.env) {
  if (!runner?.selfHosted) return;
  requireCatalog(environment.GITHUB_ACTIONS === 'true', `runner ${runner.id} must execute inside GitHub Actions`);
  requireCatalog(environment.RUNNER_ENVIRONMENT === 'self-hosted', `runner ${runner.id} must execute on a self-hosted runner`);
  requireCatalog(
    environment.RUNNER_NAME?.startsWith(runner.selfHosted.runnerNamePrefix),
    `runner name ${environment.RUNNER_NAME ?? 'missing'} does not match prefix ${runner.selfHosted.runnerNamePrefix}`,
  );
}

/** Returns the bounded native-fixture matrix used by the foundation workflow. */
export function foundationMatrix(catalog, recipeId = '') {
  const fixtures = recipeId
    ? catalog.foundationFixtures.filter((fixture) => fixture.recipeId === recipeId)
    : catalog.foundationFixtures;
  requireCatalog(
    !recipeId || fixtures.length === 1,
    `unknown or ambiguous foundation recipe ${recipeId}`,
  );
  return fixtures.map((fixture) => {
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
  requireCatalog(catalog?.schemaVersion === 2, 'schemaVersion must be 2');
  requireCatalog(catalog.costPolicy?.maxPaidRunnerConcurrency === 1, 'paid runner concurrency must remain 1');
  requireCatalog(catalog.costPolicy?.maxComponentsPerGpuJob === 1, 'GPU jobs must remain scoped to one Runtime Component');
  requireCatalog(catalog.costPolicy?.maxTargetsPerGpuJob === 1, 'GPU jobs must remain scoped to one target');
  requireCatalog(Number.isInteger(catalog.costPolicy?.heartbeatSeconds) && catalog.costPolicy.heartbeatSeconds >= 60, 'heartbeat must be at least 60 seconds');
  requireCatalog(catalog.costPolicy?.gpuManualOnly === true, 'GPU workflows must remain manual-only');
  requireCatalog(catalog.costPolicy?.scheduledGpuWorkflows === false, 'scheduled GPU workflows are forbidden');
  requireCatalog(catalog.costPolicy?.linuxCudaBeforeWindowsCuda === true, 'Linux-first CUDA policy is required');
  requireCatalog(catalog.costPolicy?.cacheModelWeightsOrArchives === false, 'model weights and archives may not be cached');
  requireCatalog(Array.isArray(catalog.runnerProfiles) && catalog.runnerProfiles.length > 0, 'runnerProfiles are required');
  requireCatalog(Array.isArray(catalog.foundationFixtures) && catalog.foundationFixtures.length > 0, 'foundationFixtures are required');
  requireCatalog(Array.isArray(catalog.components) && catalog.components.length > 0, 'components are required');

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
    if (runner.selfHosted) {
      requireCatalog(runner.selfHosted.scope === 'repository', `self-hosted runner ${runner.id} must be repository-scoped`);
      requireCatalog(runner.selfHosted.ephemeral === true, `self-hosted runner ${runner.id} must be ephemeral`);
      requireCatalog(runner.selfHosted.maxConcurrency === 1, `self-hosted runner ${runner.id} concurrency must remain 1`);
      requireCatalog(runner.selfHosted.cleanWorkDirectory === true, `self-hosted runner ${runner.id} must use a clean work directory`);
      requireCatalog(
        typeof runner.selfHosted.runnerNamePrefix === 'string' && runner.selfHosted.runnerNamePrefix.startsWith('liatir-'),
        `self-hosted runner ${runner.id} lacks the reviewed name prefix`,
      );
      requireCatalog(
        Number.isSafeInteger(runner.selfHosted.minimumBootstrapFreeDiskBytes)
          && runner.selfHosted.minimumBootstrapFreeDiskBytes > 0,
        `self-hosted runner ${runner.id} lacks a bootstrap disk floor`,
      );
    }
    if (runner.gpu) {
      // A GPU runner declares capability *floors*, not one exact card: the CI must be able to move
      // between GPUs (the hosted Tesla T4 gave way to a local RTX 4060 Ti) without a contract change.
      requireCatalog(Number.isSafeInteger(runner.minimumGpuMemoryBytes) && runner.minimumGpuMemoryBytes > 0, `GPU runner ${runner.id} lacks a VRAM floor`);
      requireCatalog(/^\d+\.\d+$/.test(runner.minimumComputeCapability ?? ''), `GPU runner ${runner.id} lacks a minimum compute capability`);
      requireCatalog(
        runner.expectedGpuModel === undefined && runner.expectedComputeCapability === undefined,
        `GPU runner ${runner.id} still pins an exact GPU instead of declaring floors`,
      );
    } else {
      requireCatalog(
        runner.minimumComputeCapability === undefined
          && runner.minimumGpuMemoryBytes === undefined
          && runner.expectedGpuModel === undefined
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
    const recipePath = scrollPathForId(fixture.recipeId);
    const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
    const runner = catalog.runnerProfiles.find((candidate) => candidate.id === fixture.runnerProfileId);
    requireCatalog(runner, `unknown foundation runner ${fixture.runnerProfileId}`);
    requireCatalog(recipe.schemaVersion === 2, `foundation scroll is not schema v2 for ${fixture.recipeId}`);
    requireCatalog(recipe.scrollId === fixture.recipeId, `foundation scrollId mismatch for ${fixture.recipeId}`);
    requireCatalog(boxTargetId(recipe.target) === fixture.targetId, `foundation target mismatch for ${fixture.recipeId}`);
    requireCatalog(
      JSON.stringify(recipe.target) === JSON.stringify(fixture.target),
      `foundation target contract differs for ${fixture.recipeId}`,
    );
    requireNoLegacyAuthoringFields(recipe, `foundation scroll ${fixture.recipeId}`);
    requireCatalog(recipe.target.platform === runner.platform && recipe.target.arch === runner.arch, `foundation runner host mismatch for ${fixture.recipeId}`);
    requireCatalog(fixture.timeoutMinutes <= runner.maxTimeoutMinutes, `foundation timeout exceeds ${runner.id}`);
    for (const localFile of recipe.localFiles ?? []) {
      const localPath = resolve(workspaceRoot(), localFile.sourcePath);
      requireCatalog(
        existsSync(localPath) && sha256Bytes(readFileSync(localPath)) === localFile.sha256,
        `foundation local file hash mismatch for ${fixture.recipeId}`,
      );
    }
    validatePixiRecipeLockAndAudit(recipe, fixture, recipePath, fixture.recipeId);
    runtimeBoxBuildDiskPlan(recipe, fixture);
    requireCatalog(Number.isSafeInteger(fixture.requiredBuildDiskBytes) && fixture.requiredBuildDiskBytes > 0, `invalid fixture disk requirement for ${fixture.recipeId}`);
    fixtureIds.add(fixture.recipeId);
  }

  const signerPolicy = JSON.parse(readFileSync(resolve(workspaceRoot(), 'services/runtime-box-signer/policy.json'), 'utf8'));
  const productionTrust = JSON.parse(readFileSync(resolve(workspaceRoot(), 'runtime-boxes/trust/production-public.json'), 'utf8'));
  const trustedKeyIds = new Set(productionTrust.keys.map((key) => key.keyId));
  const modelIds = new Set();
  const boxIds = new Set();
  const targetKeys = new Set();
  for (const model of catalog.components) {
    requireCatalog(['ai-model', 'tool-runtime'].includes(model.componentKind), `invalid component kind for ${model.modelId}`);
    requireCatalog(model.componentId === model.modelId, `Scrollcase identity mismatch for ${model.componentId}`);
    requireCatalog(!modelIds.has(model.modelId), `duplicate modelId ${model.modelId}`);
    requireCatalog(!boxIds.has(model.boxId), `duplicate boxId ${model.boxId}`);
    requireCatalog(model.legalStatus === 'approved', `${model.modelId} is not legally approved`);
    requireCatalog(existsSync(resolve(workspaceRoot(), model.legalRecord)), `missing legal record ${model.legalRecord}`);
    requireCatalog(existsSync(resolve(workspaceRoot(), model.validatorPath)), `missing validator ${model.validatorPath}`);
    requireCatalog(existsSync(resolve(workspaceRoot(), model.productScriptPath)), `missing product script ${model.productScriptPath}`);
    requireCatalog(existsSync(resolve(workspaceRoot(), model.productLifecycleSpec)), `missing product lifecycle spec ${model.productLifecycleSpec}`);
    requireCatalog(typeof model.validatorScript === 'string' && model.validatorScript.startsWith('runtime-box:validate:'), `invalid validator script for ${model.modelId}`);
    requireCatalog(Array.isArray(model.targets) && model.targets.length > 0, `targets are required for ${model.modelId}`);
    const signerBox = signerPolicy.boxes.find((candidate) => candidate.boxId === model.boxId);
    requireCatalog(signerBox?.modelId === model.modelId && signerBox?.runtimeId === model.runtimeId, `signer policy identity mismatch for ${model.boxId}`);

    for (const target of model.targets) {
      const targetKey = `${model.modelId}/${target.targetId}`;
      requireCatalog(!targetKeys.has(targetKey), `duplicate target ${targetKey}`);
      requireCatalog(boxTargetId(target.target) === target.targetId, `targetId mismatch for ${targetKey}`);
      requireCatalog(TARGET_STATUSES.has(target.status), `invalid status for ${targetKey}`);
      requireCatalog(target.validationModes.length > 0 && target.validationModes.every((mode) => VALIDATION_MODES.has(mode)), `invalid validation mode for ${targetKey}`);
      requireCatalog(target.hostEnvironments.length > 0, `host environments are required for ${targetKey}`);
      requireCatalog(!target.hostEnvironments.includes('windows-wsl2') || target.target.platform === 'linux', `WSL2 may only use a Linux target for ${targetKey}`);
      requireCatalog(!(target.target.platform === 'macos' && target.target.arch === 'x86_64'), `macOS Intel is excluded for ${targetKey}`);
      const runner = catalog.runnerProfiles.find((candidate) => candidate.id === target.runnerProfileId);
      requireCatalog(runner, `unknown runner ${target.runnerProfileId}`);
      requireCatalog(runner.platform === target.target.platform && runner.arch === target.target.arch, `runner host mismatch for ${targetKey}`);
      requireCatalog(runner.gpu || !target.gpuRequired, `GPU target uses a non-GPU runner for ${targetKey}`);
      if (runner.selfHosted) {
        requireCatalog(
          runner.selfHosted.minimumBootstrapFreeDiskBytes > target.requiredBuildDiskBytes,
          `self-hosted runner bootstrap disk floor must exceed target requirement for ${targetKey}`,
        );
      }
      if (target.target.accelerator === 'cuda') {
        requireCatalog(target.gpuRequired === true, `CUDA target is not marked GPU-required for ${targetKey}`);
      }
      requireCatalog(target.timeoutMinutes <= runner.maxTimeoutMinutes, `timeout exceeds runner maximum for ${targetKey}`);
      requireCatalog(Number.isSafeInteger(target.requiredBuildDiskBytes) && target.requiredBuildDiskBytes > 0, `invalid disk requirement for ${targetKey}`);
      requireCatalog(signerBox.targets.includes(target.targetId), `catalog target is outside signer policy for ${targetKey}`);
      const authoring = authoringInputFor(target.recipeId, {
        expectedBoxId: model.boxId,
        expectedTargetId: target.targetId,
      });
      const recipePath = authoring.documentPath;
      const recipe = authoring.document;
      requireCatalog(
        authoring.authoringId === target.recipeId
          && recipe.modelId === model.modelId
          && recipe.boxId === model.boxId
          && recipe.runtimeId === model.runtimeId,
        `authoring identity mismatch for ${targetKey}`,
      );
      requireCatalog(boxTargetId(recipe.target) === target.targetId, `recipe target mismatch for ${targetKey}`);
      requireNoLegacyAuthoringFields(recipe, `scroll ${target.recipeId}`);
      requireCatalog(readFileSync(resolve(workspaceRoot(), model.legalRecord), 'utf8').includes(recipe.sourceRevision), `legal record is not pinned to recipe source ${recipe.sourceRevision} for ${targetKey}`);
      for (const localFile of recipe.localFiles ?? []) {
        const localPath = resolve(workspaceRoot(), localFile.sourcePath);
        requireCatalog(existsSync(localPath), `missing local recipe file ${localFile.sourcePath} for ${targetKey}`);
        requireCatalog(/^[a-f0-9]{64}$/.test(localFile.sha256), `invalid local recipe hash for ${targetKey}`);
        requireCatalog(
          sha256Bytes(readFileSync(localPath)) === localFile.sha256,
          `local recipe file hash mismatch for ${localFile.sourcePath} in ${targetKey}`,
        );
      }
      requireCatalog(recipe.pixiVersion, `authoring input is not a pixi scroll for ${targetKey}`);
      validatePixiRecipeLockAndAudit(recipe, target, recipePath, targetKey);
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
          const evidencePath = resolve(workspaceRoot(), publication.evidenceRecord);
          requireCatalog(evidencePath.startsWith(`${resolve(workspaceRoot(), 'runtime-boxes/evidence')}${sep}`), `evidence record is outside runtime-boxes/evidence for ${targetKey}`);
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
      const workflowPath = resolve(workspaceRoot(), model.callerWorkflow);
      requireCatalog(existsSync(workflowPath), `missing caller workflow ${model.callerWorkflow}`);
      const workflow = readFileSync(workflowPath, 'utf8');
      requireCatalog(workflow.includes('uses: ./.github/workflows/_runtime-box-validate.yml'), `caller does not use reusable validation: ${model.callerWorkflow}`);
      requireCatalog(workflow.includes(`runtime-boxes/recipes/${model.targets[0].recipeId}/**`)
        || authoringInputFor(model.targets[0].recipeId).kind === 'scroll-v2',
      `caller lacks recipe path scope: ${model.callerWorkflow}`);
      for (const target of model.targets) {
        const authoring = authoringInputFor(target.recipeId, {
          expectedBoxId: model.boxId,
          expectedTargetId: target.targetId,
        });
        if (authoring.kind === 'scroll-v2') {
          const pathScope = `runtime-boxes/scrolls/${model.boxId}/${target.targetId}/**`;
          requireCatalog(workflow.includes(pathScope), `caller lacks authoring path scope ${pathScope}: ${model.callerWorkflow}`);
        }
      }
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
    const windowsPixiInstaller = readFileSync(
      resolve(workspaceRoot(), 'scripts/install-pixi-windows.ps1'),
      'utf8',
    );
    requireCatalog(
      windowsPixiInstaller.includes('pixi-x86_64-pc-windows-msvc.exe')
        && windowsPixiInstaller.includes('Get-FileHash')
        && windowsPixiInstaller.includes("conda-pack==0.9.2"),
      'shared Windows pixi installer must verify the official executable and pin conda-pack 0.9.2',
    );
    for (const workflowName of ['runtime-box-linux-cuda-preflight.yml', 'runtime-box-windows-cuda-preflight.yml']) {
      const workflow = readFileSync(resolve(workspaceRoot(), '.github/workflows', workflowName), 'utf8');
      requireCatalog(workflow.includes('workflow_dispatch:'), `${workflowName} must be manual-only`);
      requireCatalog(!workflow.includes('schedule:') && !workflow.includes('pull_request:') && !workflow.includes('push:'), `${workflowName} has an automatic trigger`);
      requireCatalog(workflow.includes('cancel-in-progress: true'), `${workflowName} must cancel stale validation`);
      requireCatalog(!workflow.includes('actions/cache'), `${workflowName} may not cache model assets`);
      requireCatalog(workflow.includes('PIXI_VERSION: v0.73.0'), `${workflowName} must pin pixi 0.73.0`);
      requireCatalog(!workflow.includes('--uv') && !workflow.includes('setup-uv'), `${workflowName} must not invoke the deprecated uv fixture path`);
      if (workflowName.includes('windows')) {
        requireCatalog(workflow.includes('scripts/install-pixi-windows.ps1'), `${workflowName} must use the shared Windows pixi installer`);
        requireCatalog(workflow.includes('linux_run_id:') && workflow.includes('run.head_sha === process.env.GITHUB_SHA'), 'Windows T4 preflight must prove the successful Linux run for the exact commit');
      } else {
        requireCatalog(workflow.includes('conda-pack==0.9.2'), `${workflowName} must pin conda-pack 0.9.2`);
      }
    }
    const foundation = readFileSync(resolve(workspaceRoot(), '.github/workflows/runtime-box-foundation.yml'), 'utf8');
    requireCatalog(
      foundation.includes('workflow_dispatch:')
        && !foundation.includes('schedule:')
        && !foundation.includes('pull_request:')
        && !foundation.includes('push:'),
      'foundation workflow must remain manual-only',
    );
    requireCatalog(
      foundation.includes('fixture_id:')
        && foundation.includes('installer-fixture-linux-x86_64')
        && foundation.includes('installer-fixture-windows-x86_64')
        && foundation.includes('--recipe "${{ inputs.fixture_id }}"'),
      'foundation manual dispatch must select exactly one fixture',
    );
    requireCatalog(
      foundation.includes("if: github.ref == 'refs/heads/main'"),
      'foundation native allocation must require main',
    );
    requireCatalog(
      foundation.includes("'liatir-linux-selfhosted'")
        && foundation.includes("'liatir-windows-selfhosted'")
        && !foundation.includes('ubuntu-')
        && !foundation.includes('windows-2025')
        && !foundation.includes('macos-'),
      'foundation execution must remain entirely self-hosted',
    );
    requireCatalog(
      !foundation.includes('--uv') && !foundation.includes('requirements.lock'),
      'foundation workflow must remain v2/pixi-only',
    );
    const release = readFileSync(resolve(workspaceRoot(), '.github/workflows/runtime-box-release.yml'), 'utf8');
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
  const invocation = npmInvocation(['run', '--silent', script]);
  const result = await runWithHeartbeat(
    invocation.command,
    invocation.args,
    {
      label: `Scientific validator ${script}`,
      capture: true,
      maxBuffer: 64 * 1024 * 1024,
      cwd: workspaceRoot(),
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

/**
 * Confirms the *deployed* signer serves the same policy that is committed, before a protected
 * release spends a run only to be rejected at signing time.
 *
 * The signer bakes `policy.json` into its running container at deploy time, so committing a policy
 * change (for a new box/target) does nothing until `runtime-box:signer:deploy` runs. A release
 * against a stale deployment fails late, with a generic `signing_rejected`. This reads the live
 * fingerprint from `/health` and compares it to the committed policy; on a mismatch it fails fast
 * with the exact remedy. `fetchImpl` is injectable for tests.
 */
export async function verifyDeployedSignerPolicy({
  signerUrl,
  identityToken,
  policyText,
  fetchImpl = fetch,
}) {
  requireCatalog(typeof signerUrl === 'string' && signerUrl, 'a signer URL is required');
  requireCatalog(typeof identityToken === 'string' && identityToken, 'a signer identity token is required');
  const committedFingerprint = runtimeBoxPolicyFingerprint(JSON.parse(policyText));
  const response = await fetchImpl(`${signerUrl.replace(/\/$/, '')}/health`, {
    headers: { authorization: `Bearer ${identityToken}` },
  });
  if (!response.ok) {
    throw new Error(`Signer health check failed (${response.status}): ${await response.text()}`);
  }
  const health = await response.json();
  const deployedFingerprint = health.policyFingerprint;
  if (!deployedFingerprint) {
    throw new Error('The deployed signer does not report a policy fingerprint; redeploy it to expose one.');
  }
  if (deployedFingerprint !== committedFingerprint) {
    throw new Error(
      'Deployed signer policy is stale: '
        + `deployed ${deployedFingerprint}, committed ${committedFingerprint}. `
        + 'Run `npm run runtime-box:signer:deploy` (or dispatch the signer-deployment workflow) before releasing.',
    );
  }
  return { fingerprint: committedFingerprint };
}

/** Checks the current native host and free workspace capacity before a heavy build. */
async function probeHost(model, target, runner, output) {
  validateRunnerExecutionContext(runner);
  const record = await writeHostEvidence(output, target.target, runner.runsOn);
  const recipe = authoringInputFor(target.recipeId, {
    expectedBoxId: model.boxId,
    expectedTargetId: target.targetId,
  }).document;
  if (target.gpuRequired) {
    requireCatalog(record.gpuCount === 1, `runner ${runner.id} must expose exactly one GPU`);
    // The exact card is recorded as evidence, not asserted: what has to hold is that it clears the
    // declared capability and VRAM floors. Compute capability is compared component-wise, so 8.9
    // satisfies a 7.5 floor.
    requireCatalog(typeof record.gpuModel === 'string' && record.gpuModel, `runner ${runner.id} exposed no GPU model`);
    requireCatalog(record.gpuMemoryBytes >= runner.minimumGpuMemoryBytes, `runner ${runner.id} has only ${record.gpuMemoryBytes ?? 0} GPU bytes, below the ${runner.minimumGpuMemoryBytes} floor`);
    requireCatalog(
      numericVersionAtLeast(record.computeCapability, runner.minimumComputeCapability),
      `runner ${runner.id} compute capability ${record.computeCapability ?? 'missing'} is below the ${runner.minimumComputeCapability} floor`,
    );
    requireCatalog(
      numericVersionAtLeast(record.driverVersion, recipe.compatibility?.minNvidiaDriverVersion),
      `runner ${runner.id} driver ${record.driverVersion ?? 'missing'} is below ${recipe.compatibility?.minNvidiaDriverVersion ?? 'the recipe minimum'}`,
    );
  }
  const existingBytes = [getWorkspace().buildDir, getWorkspace().distDir].reduce(
    (total, directory) => total + existingBuildStateBytes(directory),
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
  const scroll = JSON.parse(readFileSync(scrollPathForId(fixture.recipeId), 'utf8'));
  const record = await writeHostEvidence(output, scroll.target, runner.runsOn);
  record.calculatedDiskPlan = runtimeBoxBuildDiskPlan(scroll, fixture);
  await writeJson(output, record);
  requireCatalog(record.freeDiskBytesBefore >= fixture.requiredBuildDiskBytes, `only ${record.freeDiskBytesBefore} free bytes; ${fixture.requiredBuildDiskBytes} required`);
  console.log(JSON.stringify({ ...record, requiredBuildDiskBytes: fixture.requiredBuildDiskBytes }));
}

function builtReleasePath(authoring, targetId) {
  const directory = resolve(
    getWorkspace().distDir,
    'boxes',
    authoring.document.boxId,
    authoring.document.version,
    targetId,
  );
  const candidates = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith('.release.json'))
    : [];
  requireCatalog(
    candidates.length === 1,
    `expected one built v2 release for ${authoring.authoringId}, found ${candidates.length}`,
  );
  return resolve(directory, candidates[0]);
}

/** Removes Runtime Box build state without touching repository sources. */
async function cleanBuildState() {
  for (const directory of buildStateDirectories()) {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Dispatches bounded CI commands. */
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // The workspace must be resolved before the catalog is read: every later path derives from it.
  configureWorkspace({ overrides: workspaceOverridesFromArgv(rest) });
  const catalog = readRuntimeBoxCiCatalog();
  if (command === 'check') {
    validateRuntimeBoxCiCatalog(catalog);
    console.log(`Validated ${catalog.components.length} Runtime Component records and ${catalog.foundationFixtures.length} foundation fixtures.`);
    return;
  }
  if (command === 'foundation-matrix') {
    validateRuntimeBoxCiCatalog(catalog);
    const options = parseOptions(rest);
    const matrix = JSON.stringify({
      include: foundationMatrix(catalog, options.get('recipe') || ''),
    });
    setGithubOutput('matrix', matrix);
    console.log(matrix);
    return;
  }
  const options = parseOptions(rest);
  if (command === 'resolve-foundation') {
    validateRuntimeBoxCiCatalog(catalog);
    const fixture = catalog.foundationFixtures.find(
      (candidate) => candidate.recipeId === options.get('recipe'),
    );
    requireCatalog(fixture, `unknown foundation recipe ${options.get('recipe')}`);
    const runner = catalog.runnerProfiles.find(
      (candidate) => candidate.id === fixture.runnerProfileId,
    );
    requireCatalog(runner, `missing foundation runner ${fixture.runnerProfileId}`);
    const values = {
      recipe_id: fixture.recipeId,
      target_id: fixture.targetId,
      runs_on: runner.runsOn,
      timeout_minutes: fixture.timeoutMinutes,
      self_hosted: runner.selfHosted ? 'true' : 'false',
      runner_name_prefix: runner.selfHosted?.runnerNamePrefix ?? '',
      minimum_bootstrap_free_disk_bytes:
        runner.selfHosted?.minimumBootstrapFreeDiskBytes ?? 0,
      runner_platform: runner.platform,
      runner_arch: runner.arch,
      required_disk_bytes: fixture.requiredBuildDiskBytes,
      heartbeat_seconds: catalog.costPolicy.heartbeatSeconds,
    };
    for (const [key, value] of Object.entries(values)) setGithubOutput(key, value);
    console.log(JSON.stringify(values));
    return;
  }
  if (command === 'resolve') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    const nativeRequested = options.get('native-requested') === 'true';
    requireCatalog(!nativeRequested || resolved.target.nativeCiEnabled, `native CI is not enabled for ${resolved.model.modelId}/${resolved.target.targetId}`);
    const authoring = authoringInputFor(resolved.target.recipeId, {
      expectedBoxId: resolved.model.boxId,
      expectedTargetId: resolved.target.targetId,
    });
    const recipe = authoring.document;
    const values = {
      recipe_id: resolved.target.recipeId,
      runs_on: resolved.runner.runsOn,
      timeout_minutes: resolved.target.timeoutMinutes,
      pixi_version: recipe.pixiVersion ?? '',
      validator_script: resolved.model.validatorScript,
      native_eligible: nativeRequested ? 'true' : 'false',
      gpu_required: resolved.target.gpuRequired ? 'true' : 'false',
      self_hosted: resolved.runner.selfHosted ? 'true' : 'false',
      runner_name_prefix: resolved.runner.selfHosted?.runnerNamePrefix ?? '',
      minimum_bootstrap_free_disk_bytes: resolved.runner.selfHosted?.minimumBootstrapFreeDiskBytes ?? 0,
      // The self-hosted launcher runs on whatever machine the operator invoked it from, so it must
      // be able to refuse a target belonging to a different OS before it registers anything.
      runner_platform: resolved.runner.platform,
      runner_arch: resolved.runner.arch,
      build_dir_relative: relative(workspaceRoot(), getWorkspace().buildDir).replaceAll('\\', '/'),
      box_id: resolved.model.boxId,
      release_path: '',
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
    const model = catalog.components.find((candidate) => candidate.modelId === options.get('model'));
    requireCatalog(model, `unknown modelId ${options.get('model')}`);
    const target = model.targets.find((candidate) => candidate.targetId === options.get('target'));
    requireCatalog(target, `unknown target ${model.modelId}/${options.get('target')}`);
    const resolved = resolveCiTarget(catalog, model.modelId, target.recipeId, target.targetId, 'native-lifecycle');
    requireCatalog(resolved.target.nativeCiEnabled, `native CI is not enabled for ${model.modelId}/${target.targetId}`);
    const authoring = authoringInputFor(target.recipeId, {
      expectedBoxId: model.boxId,
      expectedTargetId: target.targetId,
    });
    const recipe = authoring.document;
    const values = {
      recipe_id: target.recipeId,
      version: recipe.version,
      runs_on: resolved.runner.runsOn,
      timeout_minutes: target.timeoutMinutes,
      pixi_version: recipe.pixiVersion ?? '',
      validator_script: model.validatorScript,
      box_id: model.boxId,
      release_path: '',
      // Where the builder actually writes it, resolved through the shared helper rather than
      // reconstructed: the flat name here was the old local builder's and no longer exists.
      channel_path: relative(
        workspaceRoot(),
        runtimeBoxChannelDocumentPath(getWorkspace().distDir, model.boxId, 'beta', target.targetId),
      ),
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
    await probeHost(
      resolved.model,
      resolved.target,
      resolved.runner,
      options.get('output') || '.runtime-box-ci/host.json',
    );
    return;
  }
  if (command === 'verify-signer-policy') {
    const signerUrl = options.get('signer') || process.env.LIATIR_RUNTIME_BOX_SIGNER_URL;
    const identityToken = String(process.env.LIATIR_RUNTIME_BOX_SIGNER_ID_TOKEN || '').trim();
    const policyText = readFileSync(resolve(workspaceRoot(), 'services/runtime-box-signer/policy.json'), 'utf8');
    const { fingerprint } = await verifyDeployedSignerPolicy({ signerUrl, identityToken, policyText });
    console.log(`Deployed signer policy matches the committed policy (${fingerprint}).`);
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
    const authoring = authoringInputFor(resolved.target.recipeId, {
      expectedBoxId: resolved.model.boxId,
      expectedTargetId: resolved.target.targetId,
    });
    const args = ['run', 'runtime-box', '--', 'build', resolved.target.recipeId];
    for (const name of ['channel', 'signer', 'signer-audience', 'public-key', 'asset-base-url']) {
      if (options.has(name)) args.push(`--${name}`, options.get(name));
    }
    const invocation = npmInvocation(args);
    await runTrackedCommand(
      invocation.command,
      invocation.args,
      options.get('metrics') || '.runtime-box-ci/build-metrics.json',
    );
    const releasePath = relative(
      workspaceRoot(),
      builtReleasePath(authoring, resolved.target.targetId),
    ).replaceAll('\\', '/');
    setGithubOutput('release_path', releasePath);
    console.log(JSON.stringify({ release_path: releasePath }));
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
  // Exit explicitly once the awaited work is done. Some commands (e.g. verify-signer-policy) use
  // fetch, whose undici keep-alive pool would otherwise hold the event loop open well past the
  // point the command has finished, making the CLI look hung in CI.
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
