/** Runtime Box CI evidence probes, process tracking, validation, and compact writers. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { sha256File } from './filesystem.mjs';
import { runWithHeartbeat } from './heartbeat.mjs';
import { runtimeBoxBuilderVersionFields } from './identity.mjs';
import { runtimeBoxTargetId } from './targets.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const HOST_PLATFORM = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const HOST_ARCH = { arm64: 'aarch64', x64: 'x86_64' };
const SHA256 = /^[a-f0-9]{64}$/;

function requireEvidence(condition, message) {
  if (!condition) throw new Error(`Runtime Box evidence: ${message}`);
}

function normalizedStatus(value) {
  const status = String(value || 'failed').toLowerCase();
  if (status === 'success' || status === 'passed') return 'passed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'skipped') return 'skipped';
  return 'failed';
}

function gitValue(args, fallback = null) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

/** Returns repository identity without accepting caller-controlled provenance fields. */
export function sourceEvidence() {
  const repository = process.env.GITHUB_REPOSITORY
    || gitValue(['config', '--get', 'remote.origin.url'], 'local-repository');
  const commitSha = process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']);
  // Match the release builder: ignored/generated and unrelated untracked files are not source edits.
  const status = gitValue(['status', '--porcelain', '--untracked-files=no'], 'unknown');
  requireEvidence(typeof commitSha === 'string' && /^[a-f0-9]{40}$/.test(commitSha), 'an exact Git commit is required');
  return {
    repository,
    commitSha,
    sourceTreeDirty: status !== '',
  };
}

/** Keeps final evidence tied to the signed build state, not later product-test file generation. */
export function signedBuildSourceEvidence(currentSource, provenance) {
  requireEvidence(
    provenance?.builderRevision === currentSource.commitSha,
    'release commit differs from workflow commit',
  );
  requireEvidence(
    typeof provenance.sourceTreeDirty === 'boolean',
    'release source cleanliness is missing',
  );
  return {
    ...currentSource,
    sourceTreeDirty: provenance.sourceTreeDirty,
  };
}

/** Captures immutable GitHub run identity and the protected environment when one is supplied. */
export function workflowEvidence(environment = null) {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID || null;
  return {
    provider: runId ? 'github-actions' : 'local',
    workflow: process.env.GITHUB_WORKFLOW || null,
    runId,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    runUrl: runId && repository
      ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${runId}`
      : null,
    actor: process.env.GITHUB_ACTOR || null,
    triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR || null,
    environment,
    approver: process.env.LIATIR_GITHUB_ENVIRONMENT_APPROVER || null,
  };
}

function freeDiskBytes() {
  const filesystem = statfsSync(ROOT);
  return Number(filesystem.bavail) * Number(filesystem.bsize);
}

function gpuIdentity(target) {
  if (target?.accelerator === 'cuda') {
    // Compute capability is a fixed hardware property of each supported GPU. Some Windows NVIDIA
    // drivers ship an nvidia-smi too old to expose the `compute_cap` query field, so it is derived
    // from the nvidia-smi-reported model when the field is unavailable; the authoritative capability
    // check still runs later against torch during scientific validation.
    const KNOWN_COMPUTE_CAPABILITY = new Map([['Tesla T4', '7.5']]);
    // On Windows the NVIDIA driver does not always place nvidia-smi.exe on PATH, so also probe the
    // standard install locations (System32 for a modern driver, the legacy NVSMI folder otherwise).
    const candidates = process.platform === 'win32'
      ? [
          'nvidia-smi.exe',
          resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
          resolve(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
        ]
      : ['nvidia-smi'];
    const query = (command, fields) => spawnSync(
      command,
      [`--query-gpu=${fields}`, '--format=csv,noheader,nounits'],
      { encoding: 'utf8' },
    );
    // The base fields are supported by every nvidia-smi, so probe with them to find a runnable one.
    let baseResult;
    let smiCommand;
    const attempts = [];
    for (const candidate of candidates) {
      // A bare command resolves through PATH; an absolute path is only worth trying when it exists.
      if (candidate.includes(sep) && !existsSync(candidate)) {
        attempts.push(`${candidate}: not found`);
        continue;
      }
      const result = query(candidate, 'name,driver_version,memory.total');
      if (result.status === 0) {
        baseResult = result;
        smiCommand = candidate;
        break;
      }
      const reason = result.error ? (result.error.code || result.error.message) : `exit ${result.status}`;
      const output = [result.stdout, result.stderr]
        .map((stream) => (stream || '').trim())
        .filter(Boolean)
        .join(' | ');
      attempts.push(`${candidate}: ${reason}${output ? ` -> ${output}` : ' (no output)'}`);
    }
    requireEvidence(
      baseResult,
      `CUDA evidence requires nvidia-smi; tried [${attempts.join('; ')}]`,
    );
    // Prefer nvidia-smi's own compute capability; fall back to the known-model constant when the
    // installed nvidia-smi is too old to support the compute_cap query field.
    const capabilityResult = query(smiCommand, 'compute_cap');
    const capabilities = capabilityResult.status === 0
      ? capabilityResult.stdout.trim().split(/\r?\n/).map((line) => line.trim())
      : [];
    const devices = baseResult.stdout.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
      const [gpuModel, driverVersion, memoryMiB] = line.split(',').map((value) => value.trim());
      const parsedMemoryMiB = Number(memoryMiB);
      return {
        gpuModel: gpuModel || null,
        driverVersion: driverVersion || null,
        gpuMemoryBytes: Number.isFinite(parsedMemoryMiB)
          ? Math.floor(parsedMemoryMiB * 1024 * 1024)
          : null,
        computeCapability: capabilities[index] || KNOWN_COMPUTE_CAPABILITY.get(gpuModel) || null,
      };
    });
    requireEvidence(devices.length > 0, 'CUDA evidence requires at least one NVIDIA GPU');
    return { ...devices[0], gpuCount: devices.length };
  }
  if (target?.accelerator === 'metal' && process.platform === 'darwin') {
    const result = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status === 0) {
      try {
        const display = JSON.parse(result.stdout).SPDisplaysDataType?.[0];
        return {
          gpuModel: display?.sppci_model || display?._name || null,
          gpuCount: 1,
          gpuMemoryBytes: null,
          computeCapability: null,
          driverVersion: null,
        };
      } catch {
        // A missing optional Metal model remains explicit as null.
      }
    }
  }
  return {
    gpuModel: null,
    gpuCount: null,
    gpuMemoryBytes: null,
    computeCapability: null,
    driverVersion: null,
  };
}

/** Records the exact native host and free disk before a build starts. */
export async function writeHostEvidence(output, target, runnerLabel = null) {
  const actualPlatform = HOST_PLATFORM[platform()];
  const actualArch = HOST_ARCH[arch()];
  requireEvidence(actualPlatform === target.platform, `host platform ${actualPlatform} does not match ${target.platform}`);
  requireEvidence(actualArch === target.arch, `host architecture ${actualArch} does not match ${target.arch}`);
  const gpu = gpuIdentity(target);
  const record = {
    platform: actualPlatform,
    arch: actualArch,
    runnerName: process.env.RUNNER_NAME || null,
    runnerLabel,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT || null,
    image: process.env.ImageOS && process.env.ImageVersion
      ? `${process.env.ImageOS}-${process.env.ImageVersion}`
      : process.env.ImageOS || null,
    freeDiskBytesBefore: freeDiskBytes(),
    minimumFreeDiskBytes: null,
    peakAdditionalDiskBytes: null,
    gpuModel: gpu.gpuModel,
    gpuCount: gpu.gpuCount,
    gpuMemoryBytes: gpu.gpuMemoryBytes,
    computeCapability: gpu.computeCapability,
    driverVersion: gpu.driverVersion,
    reportedCudaCompatibility: null,
  };
  await writeJson(output, record);
  return record;
}

/** Runs a build while silently sampling filesystem pressure for required peak-disk evidence. */
export async function runTrackedCommand(command, args, metricsOutput) {
  const startedAt = Date.now();
  const freeBefore = freeDiskBytes();
  let minimumFree = freeBefore;
  const sample = () => { minimumFree = Math.min(minimumFree, freeDiskBytes()); };
  const timer = setInterval(sample, 2_000);
  let exitCode = null;
  try {
    const result = await runWithHeartbeat(command, args, {
      cwd: ROOT,
      label: 'Runtime Box native build',
    });
    if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
    exitCode = result.code;
  } finally {
    clearInterval(timer);
    sample();
    await writeJson(metricsOutput, {
      elapsedMs: Date.now() - startedAt,
      freeDiskBytesBefore: freeBefore,
      minimumFreeDiskBytes: minimumFree,
      peakAdditionalDiskBytes: Math.max(0, freeBefore - minimumFree),
      exitCode,
    });
  }
  if (exitCode !== 0) throw new Error(`${command} exited with ${exitCode}`);
}

export async function writeJson(path, value) {
  const output = resolve(ROOT, path);
  await mkdir(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

function optionalJson(path) {
  return path && existsSync(resolve(ROOT, path)) ? readJson(path) : null;
}

/** Decodes a signed envelope while proving its embedded payload hash. */
export function decodeEvidenceEnvelope(path) {
  const envelope = readJson(path);
  requireEvidence(envelope?.payloadEncoding === 'base64-json-utf8', `invalid signed document ${path}`);
  const bytes = Buffer.from(envelope.payloadBase64, 'base64');
  requireEvidence(createHash('sha256').update(bytes).digest('hex') === envelope.payloadSha256, `payload hash mismatch in ${path}`);
  return { envelope, payload: JSON.parse(bytes.toString('utf8')) };
}

function baseRecord({ phase, status, subject = {}, environment = null }) {
  return {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.ci-evidence',
    phase,
    status: normalizedStatus(status),
    createdAt: new Date().toISOString(),
    subject,
    source: sourceEvidence(),
    workflow: workflowEvidence(environment),
  };
}

/** Writes failure/preflight/deployment evidence that does not claim model validation. */
export async function writeCompactEvidence(options) {
  const record = baseRecord({
    phase: options.phase || 'foundation-preflight',
    status: options.status,
    subject: {
      ...(options.model ? { modelId: options.model } : {}),
      ...(options.recipe ? { recipeId: options.recipe } : {}),
      ...(options.target ? { targetId: options.target } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    },
    environment: options.environment || null,
  });
  validateRuntimeBoxCiEvidence(record);
  await writeJson(options.output, record);
  return record;
}

function evidenceSources(recipe) {
  return (recipe.assets || []).map((asset) => ({
    kind: asset.relativePath.startsWith('.sources/')
      ? 'source'
      : /(?:checkpoint|model|best_model|\.torch|\.pt|\.safetensors)/i.test(asset.relativePath)
        ? 'checkpoint'
        : 'asset',
    identity: asset.url,
    revision: recipe.sourceRevision || null,
    sha256: asset.sha256,
  }));
}

async function completeModelRecord(options, catalog, phase) {
  const model = catalog.models.find((candidate) => candidate.modelId === options.model);
  requireEvidence(model, `unknown model ${options.model}`);
  const target = model.targets.find((candidate) => candidate.targetId === options.target);
  requireEvidence(target, `unknown target ${options.model}/${options.target}`);
  requireEvidence(target.recipeId === options.recipe, 'recipe does not match catalog target');
  const recipePath = `runtime-boxes/recipes/${target.recipeId}/recipe.json`;
  const recipe = readJson(recipePath);
  const record = baseRecord({
    phase,
    status: options.status,
    environment: options.environment || null,
    subject: {
      modelId: model.modelId,
      boxId: model.boxId,
      runtimeId: model.runtimeId,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.recipeVersion,
      version: recipe.version,
      targetId: target.targetId,
      mode: options.mode,
    },
  });
  const releaseDocument = optionalJson(options.release) ? decodeEvidenceEnvelope(options.release) : null;
  const host = optionalJson(options.host);
  const metrics = optionalJson(options.metrics);
  const verification = optionalJson(options.verification);
  const scientificRun = optionalJson(options.scientific);

  if (record.status === 'passed') {
    requireEvidence(releaseDocument && host && metrics && verification, 'successful evidence requires release, host, metrics, and verification receipts');
    if (options.mode !== 'build') requireEvidence(scientificRun, 'successful scientific evidence requires validator output');
  }

  if (releaseDocument && host && metrics && verification) {
    const release = releaseDocument.payload;
    requireEvidence(release.kind === 'liatir.runtime-box.release', 'release receipt input is not a Runtime Box release');
    requireEvidence(release.modelId === model.modelId && release.boxId === model.boxId, 'release identity differs from catalog');
    requireEvidence(runtimeBoxTargetId(release.target) === target.targetId, 'release target differs from catalog');
    requireEvidence(verification.status === 'passed' && verification.localSignatureVerified === true, 'local release verification did not pass');
    record.source = signedBuildSourceEvidence(record.source, release.provenance);
    requireEvidence(host.platform === release.target.platform && host.arch === release.target.arch, 'recorded host differs from release target');
    const lockFile = recipe.pixiVersion ? 'pixi.lock' : recipe.requirementsLock;
    const lockSha256 = await sha256File(resolve(ROOT, 'runtime-boxes/recipes', target.recipeId, lockFile));
    requireEvidence(lockSha256 === release.provenance.dependencyLockSha256, 'checked dependency lock differs from signed provenance');
    record.host = {
      ...host,
      minimumFreeDiskBytes: metrics.minimumFreeDiskBytes,
      peakAdditionalDiskBytes: metrics.peakAdditionalDiskBytes,
    };
    record.build = {
      recipeSha256: await sha256File(resolve(ROOT, recipePath)),
      dependencyLockSha256: lockSha256,
      pythonVersion: release.provenance.pythonVersion,
      ...runtimeBoxBuilderVersionFields(release.provenance),
      archiveSha256: release.archive.sha256,
      archiveSizeBytes: release.archive.sizeBytes,
      installedSizeBytes: release.installedSizeBytes,
      elapsedMs: metrics.elapsedMs,
      selfTest: {
        status: 'passed',
        imports: release.selfTest.pythonImports,
        localSignatureVerified: true,
      },
    };
  }

  if (scientificRun) {
    const result = scientificRun.result;
    const evidence = result?.evidence;
    requireEvidence(scientificRun.status === 'passed' && evidence, 'validator result lacks canonical evidence');
    requireEvidence(result.status === 'passed', 'scientific validator did not pass');
    const productScriptSha256 = await sha256File(resolve(ROOT, model.productScriptPath));
    const accelerator = {
      ...evidence.accelerator,
      gpuModel: evidence.accelerator.gpuModel ?? record.host?.gpuModel ?? null,
      driverVersion: evidence.accelerator.driverVersion ?? record.host?.driverVersion ?? null,
      reportedCudaCompatibility: evidence.accelerator.reportedCudaCompatibility
        ?? evidence.framework.reportedCudaCompatibility
        ?? null,
    };
    requireEvidence(accelerator.kind === recipe.target.accelerator, 'scientific accelerator differs from recipe target');
    if (record.host) record.host.reportedCudaCompatibility = accelerator.reportedCudaCompatibility;
    record.scientific = {
      validator: {
        path: model.validatorPath,
        sha256: await sha256File(resolve(ROOT, model.validatorPath)),
      },
      productScript: { path: model.productScriptPath, sha256: productScriptSha256 },
      fixture: evidence.fixture,
      sources: evidenceSources(recipe),
      framework: {
        name: evidence.framework.name,
        version: evidence.framework.version,
        backend: evidence.framework.backend,
      },
      accelerator,
      outputShapes: evidence.outputShapes,
      finiteValues: evidence.finiteValues,
      tolerances: evidence.tolerances,
      parity: evidence.parity,
      elapsedMs: scientificRun.elapsedMs,
      peakRamBytes: evidence.peakRamBytes ?? null,
      peakVramBytes: evidence.peakVramBytes ?? null,
      outputContract: evidence.outputContract,
      provenanceContract: evidence.provenanceContract,
    };
  }
  return record;
}

/** Writes build/scientific evidence while archives remain local and excluded. */
export async function writeModelEvidence(options, catalog) {
  const record = await completeModelRecord(options, catalog, 'model-validation');
  validateRuntimeBoxCiEvidence(record);
  await writeJson(options.output, record);
  return record;
}

/** Writes final KMS/publication evidence after immutable upload and channel promotion. */
export async function writeReleaseEvidence(options, catalog) {
  const record = await completeModelRecord(options, catalog, 'production-release');
  const release = optionalJson(options.release) ? decodeEvidenceEnvelope(options.release) : null;
  const channel = optionalJson(options.channel) ? decodeEvidenceEnvelope(options.channel) : null;
  const publish = optionalJson(options.publishReceipt);
  const promotion = optionalJson(options.promotionReceipt);
  const productLifecycle = optionalJson(options.productLifecycle);
  if (record.status === 'passed') {
    requireEvidence(release && channel && publish && promotion, 'successful publication evidence requires all signed documents and receipts');
    if (record.subject.targetId.startsWith('linux-')) {
      requireEvidence(productLifecycle, 'successful Linux publication evidence requires the real product lifecycle receipt');
    }
  }
  if (productLifecycle) {
    requireEvidence(
      productLifecycle.schemaVersion === 1
        && productLifecycle.kind === 'liatir.runtime-box.product-lifecycle-evidence'
        && productLifecycle.status === 'passed',
      'product lifecycle receipt did not pass',
    );
    requireEvidence(
      productLifecycle.boxId === record.subject.boxId
        && productLifecycle.modelId === record.subject.modelId
        && productLifecycle.runtimeId === record.subject.runtimeId
        && productLifecycle.targetId === record.subject.targetId
        && productLifecycle.version === record.subject.version,
      'product lifecycle identity differs from the release',
    );
    requireEvidence(
      typeof productLifecycle.jobId === 'string'
        && productLifecycle.jobId
        && typeof productLifecycle.analysisRunId === 'string'
        && productLifecycle.analysisRunId
        && Number.isSafeInteger(productLifecycle.resultArtifactCount)
        && productLifecycle.resultArtifactCount > 0
        && Object.values(productLifecycle.assertions ?? {}).length >= 10
        && Object.values(productLifecycle.assertions ?? {}).every((value) => value === 'passed'),
      'product lifecycle receipt lacks complete Job, Result, provenance, replacement, or cleanup proof',
    );
    record.productLifecycle = {
      status: 'passed',
      targetId: productLifecycle.targetId,
      version: productLifecycle.version,
      jobId: productLifecycle.jobId,
      analysisRunId: productLifecycle.analysisRunId,
      accelerator: productLifecycle.accelerator,
      gpuModel: productLifecycle.gpuModel ?? null,
      computeCapability: productLifecycle.computeCapability ?? null,
      reportedCudaCompatibility: productLifecycle.reportedCudaCompatibility ?? null,
      peakVramBytes: productLifecycle.peakVramBytes ?? null,
      resultArtifactCount: productLifecycle.resultArtifactCount,
      assertions: productLifecycle.assertions,
    };
  }
  if (release && channel && publish && promotion) {
    const signingKeyIds = release.envelope.signatures.map((signature) => signature.keyId);
    requireEvidence(publish.status === 'passed' && promotion.status === 'passed', 'publication receipts did not pass');
    requireEvidence(publish.archive.sha256 === release.payload.archive.sha256, 'published archive hash differs from release');
    requireEvidence(channel.payload.kind === 'liatir.runtime-box.channel', 'publication channel has the wrong kind');
    record.publication = {
      signingKeyIds,
      localSignatureVerified: true,
      archive: {
        url: publish.archive.url,
        sizeBytes: publish.archive.sizeBytes,
        sha256: publish.archive.sha256,
        streamedVerification: 'passed',
      },
      release: {
        url: publish.release.url,
        sizeBytes: publish.release.sizeBytes,
        sha256: publish.release.sha256,
        streamedVerification: 'passed',
      },
      channelUrl: promotion.channelUrl,
      promotionHttpStatus: promotion.httpStatus,
      promotionResponse: promotion.response,
    };
  }
  validateRuntimeBoxCiEvidence(record);
  await writeJson(options.output, record);
  return record;
}

/** Validates the durable contract before upload or acceptance into runtime-boxes/evidence. */
export function validateRuntimeBoxCiEvidence(record) {
  requireEvidence(record?.schemaVersion === 1, 'schemaVersion must be 1');
  requireEvidence(record.kind === 'liatir.runtime-box.ci-evidence', 'kind is invalid');
  requireEvidence(['foundation-preflight', 'foundation-native', 'model-validation', 'production-release', 'signer-deploy'].includes(record.phase), 'phase is invalid');
  requireEvidence(['passed', 'failed', 'cancelled', 'skipped'].includes(record.status), 'status is invalid');
  requireEvidence(!Number.isNaN(Date.parse(record.createdAt)), 'createdAt must be ISO-compatible');
  requireEvidence(typeof record.source?.repository === 'string' && record.source.repository, 'repository is required');
  requireEvidence(/^[a-f0-9]{40}$/.test(record.source?.commitSha), 'exact commit SHA is required');
  requireEvidence(typeof record.source?.sourceTreeDirty === 'boolean', 'source cleanliness is required');
  requireEvidence(['github-actions', 'local'].includes(record.workflow?.provider), 'workflow provider is invalid');

  if (record.status === 'passed' && ['model-validation', 'production-release'].includes(record.phase)) {
    requireEvidence(record.host && record.build, 'successful model evidence requires host and build sections');
    requireEvidence(SHA256.test(record.build.recipeSha256), 'recipe SHA-256 is invalid');
    requireEvidence(SHA256.test(record.build.dependencyLockSha256), 'lock SHA-256 is invalid');
    requireEvidence(SHA256.test(record.build.archiveSha256), 'archive SHA-256 is invalid');
    requireEvidence(Number.isSafeInteger(record.build.archiveSizeBytes) && record.build.archiveSizeBytes > 0, 'archive size is invalid');
    requireEvidence(Number.isSafeInteger(record.build.installedSizeBytes) && record.build.installedSizeBytes > 0, 'installed size is invalid');
    if (record.subject.mode !== 'build') {
      requireEvidence(record.scientific, 'successful scientific mode requires scientific evidence');
      requireEvidence(SHA256.test(record.scientific.validator.sha256), 'validator SHA-256 is invalid');
      requireEvidence(SHA256.test(record.scientific.productScript.sha256), 'product script SHA-256 is invalid');
      requireEvidence(SHA256.test(record.scientific.fixture.sha256), 'fixture SHA-256 is invalid');
      requireEvidence(record.scientific.finiteValues === true, 'finite-value check did not pass');
      requireEvidence(record.scientific.outputContract === 'passed', 'output contract did not pass');
      requireEvidence(record.scientific.provenanceContract === 'passed', 'provenance contract did not pass');
      const cudaVersion = record.subject.targetId.match(/-cuda([1-9][0-9]*\.[0-9]+)$/)?.[1] ?? null;
      if (cudaVersion) {
        requireEvidence(record.host.gpuCount === 1, 'CUDA evidence requires exactly one GPU');
        requireEvidence(typeof record.host.gpuModel === 'string' && record.host.gpuModel, 'CUDA host GPU model is missing');
        requireEvidence(Number.isSafeInteger(record.host.gpuMemoryBytes) && record.host.gpuMemoryBytes > 0, 'CUDA host GPU memory is missing');
        requireEvidence(typeof record.host.computeCapability === 'string' && record.host.computeCapability, 'CUDA host compute capability is missing');
        requireEvidence(typeof record.host.driverVersion === 'string' && record.host.driverVersion, 'CUDA host driver is missing');
        requireEvidence(record.host.reportedCudaCompatibility === cudaVersion, 'CUDA host compatibility differs from the target');
        requireEvidence(record.scientific.accelerator.kind === 'cuda', 'CUDA target lacks CUDA scientific evidence');
        requireEvidence(record.scientific.accelerator.gpuModel === record.host.gpuModel, 'scientific GPU model differs from the host');
        requireEvidence(Number.isSafeInteger(record.scientific.accelerator.gpuMemoryBytes) && record.scientific.accelerator.gpuMemoryBytes > 0, 'scientific GPU memory is missing');
        requireEvidence(record.scientific.accelerator.computeCapability === record.host.computeCapability, 'scientific compute capability differs from the host');
        requireEvidence(record.scientific.accelerator.driverVersion === record.host.driverVersion, 'scientific driver differs from the host');
        requireEvidence(record.scientific.accelerator.reportedCudaCompatibility === cudaVersion, 'scientific CUDA compatibility differs from the target');
        requireEvidence(Number.isSafeInteger(record.scientific.peakVramBytes) && record.scientific.peakVramBytes > 0, 'CUDA peak VRAM evidence is missing');
        requireEvidence(record.scientific.parity?.cpuBaselinePassed === true, 'CUDA evidence lacks a passed CPU baseline');
        requireEvidence(record.scientific.parity?.acceleratorPassed === true, 'CUDA accelerator parity did not pass');
      }
    }
  }
  if (record.status === 'passed' && record.phase === 'production-release') {
    requireEvidence(record.workflow.environment === 'runtime-box-production', 'release environment is not protected production');
    requireEvidence(record.publication?.localSignatureVerified === true, 'local signature verification is missing');
    requireEvidence(record.publication.signingKeyIds.length > 0, 'signing key ID is missing');
    requireEvidence(record.publication.archive.streamedVerification === 'passed', 'archive stream verification is missing');
    requireEvidence(record.publication.release.streamedVerification === 'passed', 'release stream verification is missing');
    requireEvidence(record.publication.promotionHttpStatus >= 200 && record.publication.promotionHttpStatus < 300, 'promotion response did not pass');
    if (record.subject.targetId.startsWith('linux-')) {
      requireEvidence(record.productLifecycle?.status === 'passed', 'Linux release lacks passed product lifecycle evidence');
      requireEvidence(record.productLifecycle.assertions?.results === 'passed', 'Linux release lacks Results proof');
      requireEvidence(record.productLifecycle.assertions?.provenance === 'passed', 'Linux release lacks provenance proof');
      requireEvidence(record.productLifecycle.assertions?.removal === 'passed', 'Linux release lacks removal proof');
      if (record.subject.targetId.includes('-cuda')) {
        requireEvidence(record.productLifecycle.accelerator === 'CUDA', 'CUDA release product lifecycle did not use CUDA');
        requireEvidence(record.productLifecycle.gpuModel === record.host.gpuModel, 'CUDA product GPU differs from the host');
        requireEvidence(record.productLifecycle.computeCapability === record.host.computeCapability, 'CUDA product compute capability differs from the host');
        requireEvidence(record.productLifecycle.reportedCudaCompatibility === record.host.reportedCudaCompatibility, 'CUDA product compatibility differs from the host');
        requireEvidence(Number.isSafeInteger(record.productLifecycle.peakVramBytes) && record.productLifecycle.peakVramBytes > 0, 'CUDA product peak VRAM evidence is missing');
      }
    }
  }
  return record;
}

/** Loads and validates a reviewed checked-in record referenced by the CI catalog. */
export async function readCheckedEvidence(path) {
  const resolved = resolve(ROOT, path);
  requireEvidence(resolved.startsWith(`${resolve(ROOT, 'runtime-boxes/evidence')}${sep}`), 'checked evidence must live under runtime-boxes/evidence');
  return validateRuntimeBoxCiEvidence(JSON.parse(await readFile(resolved, 'utf8')));
}
