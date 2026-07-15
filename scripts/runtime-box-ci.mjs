#!/usr/bin/env node

/** Checked Runtime Box CI catalog resolver and compact evidence writer. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { arch, platform, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const HOST_PLATFORM = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const HOST_ARCH = { arm64: 'aarch64', x64: 'x86_64' };

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

/** Runs a checked package script without shell interpolation. */
function runPackageScript(script) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with ${result.status}`);
}

/** Decodes a signed Runtime Box envelope and verifies its embedded payload hash shape. */
function decodeEnvelope(path) {
  const envelope = JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
  requireCatalog(envelope?.payloadEncoding === 'base64-json-utf8', `invalid signed document ${path}`);
  const payloadBytes = Buffer.from(envelope.payloadBase64, 'base64');
  requireCatalog(createHash('sha256').update(payloadBytes).digest('hex') === envelope.payloadSha256, `payload hash mismatch in ${path}`);
  return { envelope, payload: JSON.parse(payloadBytes.toString('utf8')) };
}

/** Writes bounded JSON and Markdown evidence; box artifacts are never copied. */
async function writeEvidence(options) {
  const output = resolve(ROOT, options.get('output') || '.runtime-box-ci/evidence.json');
  const record = {
    schemaVersion: 1,
    phase: options.get('phase') || 'unknown',
    status: options.get('status') || 'unknown',
    modelId: options.get('model') || null,
    recipeId: options.get('recipe') || null,
    targetId: options.get('target') || null,
    mode: options.get('mode') || null,
    commitSha: process.env.GITHUB_SHA || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    runnerName: process.env.RUNNER_NAME || null,
    createdAt: new Date().toISOString(),
  };
  await mkdir(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(output.replace(/\.json$/, '.md'), [
    `# Runtime Box ${record.phase} evidence`,
    '',
    `- Status: \`${record.status}\``,
    `- Model: \`${record.modelId ?? 'n/a'}\``,
    `- Recipe: \`${record.recipeId ?? 'n/a'}\``,
    `- Target: \`${record.targetId ?? 'n/a'}\``,
    `- Mode: \`${record.mode ?? 'n/a'}\``,
    `- Commit: \`${record.commitSha ?? 'local'}\``,
    `- Workflow run: \`${record.runId ?? 'local'}\``,
    '',
  ].join('\n'));
}

/** Checks the current native host and free workspace capacity before a heavy build. */
function probeHost(target, runner) {
  const actualPlatform = HOST_PLATFORM[platform()];
  const actualArch = HOST_ARCH[arch()];
  requireCatalog(actualPlatform === target.target.platform, `host platform ${actualPlatform} does not match ${target.target.platform}`);
  requireCatalog(actualArch === target.target.arch, `host arch ${actualArch} does not match ${target.target.arch}`);
  const filesystem = statfsSync(ROOT);
  const freeDiskBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  requireCatalog(freeDiskBytes >= target.requiredBuildDiskBytes, `only ${freeDiskBytes} free bytes; ${target.requiredBuildDiskBytes} required`);
  if (target.gpuRequired) {
    const probe = spawnSync(process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], { encoding: 'utf8' });
    requireCatalog(probe.status === 0, 'nvidia-smi is required but unavailable');
    console.log(probe.stdout.trim());
  }
  console.log(JSON.stringify({ platform: actualPlatform, arch: actualArch, totalMemoryBytes: totalmem(), freeDiskBytes, runner: runner.runsOn }));
}

/** Produces compact release evidence after build/verify and before publication. */
async function writeReleaseEvidence(options) {
  const release = decodeEnvelope(options.get('release'));
  const channel = decodeEnvelope(options.get('channel'));
  requireCatalog(release.payload.kind === 'liatir.runtime-box.release', 'release evidence input is not a release');
  requireCatalog(channel.payload.kind === 'liatir.runtime-box.channel', 'release evidence input is not a channel');
  const output = resolve(ROOT, options.get('output') || '.runtime-box-ci/release-evidence.json');
  await mkdir(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    boxId: release.payload.boxId,
    modelId: release.payload.modelId,
    version: release.payload.version,
    targetId: runtimeBoxTargetId(release.payload.target),
    archiveSha256: release.payload.archive.sha256,
    archiveSizeBytes: release.payload.archive.sizeBytes,
    installedSizeBytes: release.payload.installedSizeBytes ?? null,
    releasePayloadSha256: release.envelope.payloadSha256,
    channelPayloadSha256: channel.envelope.payloadSha256,
    signingKeyIds: release.envelope.signatures.map((signature) => signature.keyId),
    builderRevision: release.payload.provenance.builderRevision,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
  }, null, 2)}\n`);
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
    probeHost(resolved.target, resolved.runner);
    return;
  }
  if (command === 'run-validator') {
    validateRuntimeBoxCiCatalog(catalog);
    const resolved = resolveCiTarget(catalog, options.get('model'), options.get('recipe'), options.get('target'), options.get('mode'));
    requireCatalog(options.get('script') === resolved.model.validatorScript, 'validator script does not match the catalog');
    runPackageScript(resolved.model.validatorScript);
    return;
  }
  if (command === 'write-evidence') return writeEvidence(options);
  if (command === 'release-evidence') return writeReleaseEvidence(options);
  if (command === 'clean') return cleanBuildState();
  throw new Error(`Unknown Runtime Box CI command: ${command ?? '<none>'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
