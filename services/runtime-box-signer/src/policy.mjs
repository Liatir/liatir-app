const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const HOST_ENVIRONMENTS = new Set(['native', 'windows-wsl2']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function targetId(target) {
  requireValue(target && typeof target === 'object', 'target must be an object');
  for (const field of ['platform', 'arch', 'accelerator']) {
    requireValue(SEGMENT.test(target[field] ?? ''), `invalid target ${field}`);
  }
  if (target.cudaVersion !== undefined) requireValue(SEGMENT.test(target.cudaVersion), 'invalid CUDA version');
  return `${target.platform}-${target.arch}-${target.accelerator}${target.cudaVersion ? `-cuda${target.cudaVersion}` : ''}`;
}

function allowedBox(policy, boxId) {
  const box = policy.boxes.find((candidate) => candidate.boxId === boxId);
  requireValue(box, `box is not approved: ${boxId}`);
  return box;
}

function exactAssetUrl(policy, value, expectedPath) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid asset URL');
  }
  requireValue(url.origin === policy.assetOrigin, 'asset URL origin is not approved');
  requireValue(url.username === '' && url.password === '' && url.search === '' && url.hash === '', 'asset URL must not contain credentials, query, or fragment');
  requireValue(url.pathname === `/${policy.objectPrefix}/${expectedPath}`, 'asset URL path does not match the immutable object identity');
}

function validateHostEnvironments(payload) {
  const environments = payload.compatibility?.hostEnvironments;
  if (environments === undefined) return;
  requireValue(Array.isArray(environments) && environments.length > 0, 'host environments must be a non-empty array');
  requireValue(new Set(environments).size === environments.length, 'host environments must be unique');
  requireValue(environments.every((environment) => HOST_ENVIRONMENTS.has(environment)), 'invalid host environment');
  requireValue(
    !environments.includes('windows-wsl2') || payload.target.platform === 'linux',
    'windows-wsl2 is only valid for Linux payloads',
  );
}

function validateRelease(policy, payload) {
  const box = allowedBox(policy, payload.boxId);
  requireValue(payload.modelId === box.modelId, 'model ID does not match signing policy');
  requireValue(payload.runtimeId === box.runtimeId, 'runtime ID does not match signing policy');
  requireValue(VERSION.test(payload.version ?? ''), 'invalid release version');
  const target = targetId(payload.target);
  requireValue(box.targets.includes(target), 'target is not approved for this box');
  requireValue(payload.archive?.format === 'zip', 'only ZIP Runtime Boxes are approved');
  requireValue(SHA256.test(payload.archive?.sha256 ?? ''), 'invalid archive SHA-256');
  requireValue(Number.isSafeInteger(payload.archive?.sizeBytes) && payload.archive.sizeBytes > 0, 'invalid archive size');
  if (payload.installedSizeBytes !== undefined) {
    requireValue(
      Number.isSafeInteger(payload.installedSizeBytes) && payload.installedSizeBytes > 0,
      'invalid installed size',
    );
  }
  validateHostEnvironments(payload);
  exactAssetUrl(policy, payload.archive.url, `boxes/${payload.boxId}/${payload.version}/${target}/${payload.archive.sha256}.zip`);
  requireValue(payload.provenance?.sourceTreeDirty === false, 'dirty source trees cannot be signed for production');
  for (const field of ['recipeId', 'recipeVersion', 'builderRevision', 'sourceRevision', 'pythonVersion', 'uvVersion', 'dependencyLockSha256', 'builtAt']) {
    requireValue(typeof payload.provenance?.[field] === 'string' && payload.provenance[field].length > 0, `missing provenance ${field}`);
  }
  requireValue(SHA256.test(payload.provenance.dependencyLockSha256), 'invalid dependency lock SHA-256');
  requireValue(typeof payload.pythonEntryPoint === 'string' && payload.pythonEntryPoint.length > 0, 'missing Python entry point');
  requireValue(typeof payload.modelCacheSubdir === 'string' && payload.modelCacheSubdir.length > 0, 'missing model cache directory');
  requireValue(Array.isArray(payload.selfTest?.pythonImports) && payload.selfTest.pythonImports.length > 0, 'missing self-test imports');
}

function validateChannel(policy, payload) {
  const box = allowedBox(policy, payload.boxId);
  requireValue(policy.allowedChannels.includes(payload.channel), 'channel is not approved');
  const target = targetId(payload.target);
  requireValue(box.targets.includes(target), 'target is not approved for this box');
  requireValue(typeof payload.updatedAt === 'string' && payload.updatedAt.length > 0, 'missing channel update time');
  requireValue(typeof payload.cohortSalt === 'string' && /^[a-f0-9]{32}$/.test(payload.cohortSalt), 'invalid cohort salt');
  requireValue(Array.isArray(payload.releases) && payload.releases.length > 0 && payload.releases.length <= 10, 'channel must contain 1 to 10 releases');
  const versions = new Set();
  for (const release of payload.releases) {
    requireValue(VERSION.test(release?.version ?? ''), 'invalid channel release version');
    requireValue(!versions.has(release.version), 'channel release versions must be unique');
    versions.add(release.version);
    requireValue(Number.isInteger(release.rolloutPercentage) && release.rolloutPercentage >= 1 && release.rolloutPercentage <= 100, 'invalid rollout percentage');
    let releaseUrl;
    try {
      releaseUrl = new URL(release.releaseManifestUrl);
    } catch {
      throw new Error('invalid release manifest URL');
    }
    const prefix = `boxes/${payload.boxId}/${release.version}/${target}/`;
    requireValue(releaseUrl.pathname.startsWith(`/${policy.objectPrefix}/${prefix}`), 'release manifest path does not match channel identity');
    const name = releaseUrl.pathname.slice(`/${policy.objectPrefix}/${prefix}`.length);
    requireValue(/^[a-f0-9]{64}\.release\.json$/.test(name), 'release manifest URL is not immutable');
    exactAssetUrl(policy, release.releaseManifestUrl, `${prefix}${name}`);
  }
}

function validateRevocations(policy, payload) {
  requireValue(typeof payload.updatedAt === 'string' && payload.updatedAt.length > 0, 'missing revocations update time');
  requireValue(Array.isArray(payload.revocations) && payload.revocations.length > 0 && payload.revocations.length <= 100, 'revocations must contain 1 to 100 entries');
  for (const revocation of payload.revocations) {
    const box = allowedBox(policy, revocation?.boxId);
    requireValue(VERSION.test(revocation.version ?? ''), 'invalid revoked version');
    requireValue(typeof revocation.reason === 'string' && revocation.reason.trim().length >= 8, 'revocation reason is too short');
    requireValue(typeof revocation.revokedAt === 'string' && revocation.revokedAt.length > 0, 'missing revocation time');
    if (revocation.target) requireValue(box.targets.includes(targetId(revocation.target)), 'revocation target is not approved');
  }
}

/** Validate the exact payload before KMS is allowed to sign it. */
export function validateSigningPayload(policy, payload) {
  requireValue(payload && typeof payload === 'object' && !Array.isArray(payload), 'payload must be an object');
  requireValue(payload.schemaVersion === 1, 'unsupported Runtime Box schema');
  if (payload.kind === 'liatir.runtime-box.release') validateRelease(policy, payload);
  else if (payload.kind === 'liatir.runtime-box.channel') validateChannel(policy, payload);
  else if (payload.kind === 'liatir.runtime-box.revocations') validateRevocations(policy, payload);
  else throw new Error('document kind is not signable');
}
