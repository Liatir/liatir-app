#!/usr/bin/env node

/** Checked Runtime Box CI catalog resolver and compact evidence writer. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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
import { runtimeBoxTargetId } from './runtime-box/targets.mjs';

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

/** Finds a unique model and target selected only by catalog IDs. */
export function resolveCiTarget(catalog, modelId, recipeId, targetId, mode) {
  const model = catalog.models.find((candidate) => candidate.modelId === modelId);
  requireCatalog(model, `unknown modelId ${modelId}`);
  const target = model.targets.find((candidate) => candidate.targetId === targetId);
  requireCatalog(target, `unknown target ${modelId}/${targetId}`);
  requireCatalog(target.recipeId === recipeId, `recipe ${recipeId} is not approved for ${modelId}/${targetId}`);
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
    };
  });
}

/** Validates all static catalog invariants and its repository-owned references. */
export function validateRuntimeBoxCiCatalog(catalog, { requireWorkflows = true } = {}) {
  requireCatalog(catalog?.schemaVersion === 1, 'schemaVersion must be 1');
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
      requireCatalog(target.timeoutMinutes <= runner.maxTimeoutMinutes, `timeout exceeds runner maximum for ${targetKey}`);
      requireCatalog(Number.isSafeInteger(target.requiredBuildDiskBytes) && target.requiredBuildDiskBytes > 0, `invalid disk requirement for ${targetKey}`);
      requireCatalog(signerBox.targets.includes(target.targetId), `catalog target is outside signer policy for ${targetKey}`);
      const recipePath = resolve(ROOT, 'runtime-boxes/recipes', target.recipeId, 'recipe.json');
      requireCatalog(existsSync(recipePath), `missing recipe ${target.recipeId}`);
      const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
      requireCatalog(recipe.recipeId === target.recipeId && recipe.modelId === model.modelId && recipe.boxId === model.boxId && recipe.runtimeId === model.runtimeId, `recipe identity mismatch for ${targetKey}`);
      requireCatalog(runtimeBoxTargetId(recipe.target) === target.targetId, `recipe target mismatch for ${targetKey}`);
      requireCatalog(readFileSync(resolve(ROOT, model.legalRecord), 'utf8').includes(recipe.sourceRevision), `legal record is not pinned to recipe source ${recipe.sourceRevision} for ${targetKey}`);

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
    }
    modelIds.add(model.modelId);
    boxIds.add(model.boxId);
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

/** Runs a checked validator, preserves its logs, and stores its canonical JSON result. */
async function runPackageScript(script, output) {
  const startedAt = Date.now();
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${script} exited with ${result.status}`);
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
    elapsedMs: Date.now() - startedAt,
    result: validatorResult,
  });
}

/** Checks the current native host and free workspace capacity before a heavy build. */
async function probeHost(target, runner, output) {
  const record = await writeHostEvidence(output, target.target, runner.runsOn);
  requireCatalog(record.freeDiskBytesBefore >= target.requiredBuildDiskBytes, `only ${record.freeDiskBytesBefore} free bytes; ${target.requiredBuildDiskBytes} required`);
  console.log(JSON.stringify(record));
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
      runs_on: resolved.runner.runsOn,
      timeout_minutes: resolved.target.timeoutMinutes,
      uv_version: recipe.uvVersion,
      validator_script: resolved.model.validatorScript,
      native_eligible: nativeRequested ? 'true' : 'false',
      gpu_required: resolved.target.gpuRequired ? 'true' : 'false',
      box_id: resolved.model.boxId,
      release_path: `.runtime-box-dist/${resolved.model.boxId}-${recipe.version}-${resolved.target.targetId}.release.json`,
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
      runs_on: resolved.runner.runsOn,
      timeout_minutes: target.timeoutMinutes,
      uv_version: recipe.uvVersion,
      validator_script: model.validatorScript,
      box_id: model.boxId,
      release_path: `.runtime-box-dist/${model.boxId}-${recipe.version}-${target.targetId}.release.json`,
      channel_path: `.runtime-box-dist/${model.boxId}-beta-${target.targetId}.channel.json`,
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
  if (command === 'tracked-build') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    const args = ['run', 'runtime-box', '--', 'build', resolved.target.recipeId];
    for (const name of ['channel', 'signer', 'signer-audience', 'public-key', 'asset-base-url']) {
      if (options.has(name)) args.push(`--${name}`, options.get(name));
    }
    await runTrackedCommand(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args,
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
    );
    return;
  }
  const evidenceOptions = Object.fromEntries(options);
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
