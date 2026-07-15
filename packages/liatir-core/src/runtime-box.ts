/**
 * Shared wire contracts for prebuilt AI Runtime Boxes.
 *
 * Signed documents use an exact base64-encoded JSON payload instead of
 * canonicalized JSON. This keeps signature verification identical in Node,
 * Rust, Workers, and future clients without maintaining multiple canonical
 * JSON implementations.
 */

export const LIATIR_RUNTIME_BOX_SCHEMA_VERSION = 1 as const;

export type LiatirRuntimeBoxPlatform = "macos" | "linux" | "windows";
export type LiatirRuntimeBoxArch = "aarch64" | "x86_64";
export type LiatirRuntimeBoxAccelerator = "cpu" | "metal" | "cuda";
export type LiatirRuntimeBoxChannel = "development" | "beta" | "stable";
export type LiatirRuntimeBoxHostEnvironment = "native" | "windows-wsl2";

export interface LiatirRuntimeBoxTarget {
  platform: LiatirRuntimeBoxPlatform;
  arch: LiatirRuntimeBoxArch;
  accelerator: LiatirRuntimeBoxAccelerator;
  /** Required CUDA ABI when accelerator is cuda, for example "12.4". */
  cudaVersion?: string;
}

export interface LiatirRuntimeBoxCompatibility {
  minLiatirVersion: string;
  maxLiatirVersionExclusive?: string;
  minMacosVersion?: string;
  minRamGb?: number;
  /** Minimum host NVIDIA driver accepted by a CUDA payload. */
  minNvidiaDriverVersion?: string;
  /** Host environments validated for this payload. Omitted by legacy releases. */
  hostEnvironments?: LiatirRuntimeBoxHostEnvironment[];
}

/**
 * One published target the desktop installer may consider for a model.
 *
 * Entries are evaluated in array order. This is intentionally smaller than a release manifest:
 * it contains only facts needed before the target-specific signed channel can be requested.
 */
export interface LiatirRuntimeBoxTargetCandidate {
  target: LiatirRuntimeBoxTarget;
  /** Native is required for current desktop selection; windows-wsl2 is future evidence only. */
  hostEnvironments: readonly LiatirRuntimeBoxHostEnvironment[];
  minRamGb?: number;
  /** Required for CUDA candidates so selection never guesses driver compatibility. */
  minNvidiaDriverVersion?: string;
}

export interface LiatirRuntimeBoxBuildProvenance {
  recipeId: string;
  recipeVersion: string;
  builderRevision: string;
  sourceTreeDirty: boolean;
  sourceRevision: string;
  pythonVersion: string;
  uvVersion: string;
  dependencyLockSha256: string;
  builtAt: string;
}

export interface LiatirRuntimeBoxArchive {
  format: "zip";
  url: string;
  sha256: string;
  sizeBytes: number;
}

export interface LiatirRuntimeBoxSelfTest {
  /** Import names checked with the box interpreter before activation. */
  pythonImports: string[];
  timeoutSeconds: number;
}

/** Immutable release document signed offline by Liatir. */
export interface LiatirRuntimeBoxReleaseManifest {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_SCHEMA_VERSION;
  kind: "liatir.runtime-box.release";
  boxId: string;
  modelId: string;
  runtimeId: string;
  version: string;
  target: LiatirRuntimeBoxTarget;
  compatibility: LiatirRuntimeBoxCompatibility;
  archive: LiatirRuntimeBoxArchive;
  /** Exact sum of extracted payload file sizes before activation metadata is added. */
  installedSizeBytes?: number;
  /** Path relative to the extracted runtime root. */
  pythonEntryPoint: string;
  /** Model/cache directory relative to the extracted runtime root. */
  modelCacheSubdir: string;
  selfTest: LiatirRuntimeBoxSelfTest;
  provenance: LiatirRuntimeBoxBuildProvenance;
}

export interface LiatirRuntimeBoxChannelRelease {
  version: string;
  releaseManifestUrl: string;
  /** Integer percentage from 1 to 100. Releases are evaluated in order. */
  rolloutPercentage: number;
}

/** Small mutable channel pointer. It is signed independently from releases. */
export interface LiatirRuntimeBoxChannelManifest {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_SCHEMA_VERSION;
  kind: "liatir.runtime-box.channel";
  channel: LiatirRuntimeBoxChannel;
  boxId: string;
  target: LiatirRuntimeBoxTarget;
  updatedAt: string;
  cohortSalt: string;
  releases: LiatirRuntimeBoxChannelRelease[];
}

export interface LiatirRuntimeBoxRevocation {
  boxId: string;
  version: string;
  target?: LiatirRuntimeBoxTarget;
  reason: string;
  revokedAt: string;
}

export interface LiatirRuntimeBoxRevocationsManifest {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_SCHEMA_VERSION;
  kind: "liatir.runtime-box.revocations";
  updatedAt: string;
  revocations: LiatirRuntimeBoxRevocation[];
}

export interface LiatirRuntimeBoxSignature {
  algorithm: "ed25519";
  keyId: string;
  signatureBase64: string;
}

export interface LiatirSignedRuntimeBoxDocument {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_SCHEMA_VERSION;
  payloadEncoding: "base64-json-utf8";
  payloadBase64: string;
  payloadSha256: string;
  signatures: LiatirRuntimeBoxSignature[];
}

/** Durable install provenance written beside the activated Runtime Box. */
export interface LiatirRuntimeBoxActivationMetadata {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_SCHEMA_VERSION;
  selectedTarget: LiatirRuntimeBoxTarget;
  release: LiatirRuntimeBoxReleaseManifest;
  /** Exact verified signing envelope. Optional only when reading installations from older builds. */
  signedRelease?: LiatirSignedRuntimeBoxDocument;
}

export interface LiatirAIModelRuntimeBoxInstall {
  boxId: string;
  channel: LiatirRuntimeBoxChannel;
  /** Public control-plane base URL. Debug builds may override it locally. */
  registryBaseUrl: string;
  /** Ordered targets already published for this model; unlisted targets are never requested. */
  publishedTargets: readonly LiatirRuntimeBoxTargetCandidate[];
}

export type LiatirRuntimeBoxCiValidationMode = "build" | "scientific" | "native-lifecycle";
export type LiatirRuntimeBoxCiTargetStatus =
  | "planned"
  | "buildable"
  | "scientifically-validated"
  | "native-lifecycle-validated"
  | "published";

/** A runner selected by checked catalog ID, never by workflow input. */
export interface LiatirRuntimeBoxCiRunnerProfile {
  id: string;
  runsOn: string;
  platform: LiatirRuntimeBoxPlatform;
  arch: LiatirRuntimeBoxArch;
  gpu: boolean;
  maxTimeoutMinutes: number;
}

export interface LiatirRuntimeBoxCiPublicationEvidence {
  /** Legacy operator publications are explicitly marked and may not claim a GitHub run. */
  source: "github-actions" | "legacy-operator";
  releaseManifestUrl: string;
  archiveSha256: string;
  archiveSizeBytes: number;
  installedSizeBytes?: number;
  signingKeyId: string;
  publishedAt: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
}

export interface LiatirRuntimeBoxCiTargetRecord {
  targetId: string;
  target: LiatirRuntimeBoxTarget;
  hostEnvironments: readonly LiatirRuntimeBoxHostEnvironment[];
  recipeId: string;
  runnerProfileId: string;
  status: LiatirRuntimeBoxCiTargetStatus;
  validationModes: readonly LiatirRuntimeBoxCiValidationMode[];
  timeoutMinutes: number;
  requiredBuildDiskBytes: number;
  gpuRequired: boolean;
  nativeCiEnabled: boolean;
  publication?: LiatirRuntimeBoxCiPublicationEvidence;
}

export interface LiatirRuntimeBoxCiModelRecord {
  modelId: string;
  boxId: string;
  runtimeId: string;
  legalRecord: string;
  legalStatus: "approved" | "blocked";
  validatorScript: string;
  validatorPath: string;
  callerWorkflow: string;
  targets: readonly LiatirRuntimeBoxCiTargetRecord[];
}

/** Machine-readable CI authority for Runtime Box runners, targets, and validation gates. */
export interface LiatirRuntimeBoxCiCatalog {
  schemaVersion: 1;
  runnerProfiles: readonly LiatirRuntimeBoxCiRunnerProfile[];
  foundationFixtures: readonly {
    recipeId: string;
    runnerProfileId: string;
    timeoutMinutes: number;
    rustLifecycle: boolean;
  }[];
  models: readonly LiatirRuntimeBoxCiModelRecord[];
}

const RUNTIME_BOX_TARGET_ACCELERATORS: Readonly<
  Record<LiatirRuntimeBoxPlatform, Readonly<Partial<Record<LiatirRuntimeBoxArch, readonly LiatirRuntimeBoxAccelerator[]>>>>
> = {
  macos: { aarch64: ["metal", "cpu"] },
  linux: { x86_64: ["cpu", "cuda"] },
  windows: { x86_64: ["cpu", "cuda"] },
};
const RUNTIME_BOX_CUDA_VERSION = /^[1-9][0-9]*\.[0-9]+$/;

/** Return the stable target identifier used by R2 keys and registry routes. */
export function runtimeBoxTargetId(target: LiatirRuntimeBoxTarget): string {
  if (!target || typeof target !== "object") {
    throw new TypeError("Runtime Box target must be an object");
  }
  const accelerators = RUNTIME_BOX_TARGET_ACCELERATORS[target.platform]?.[target.arch];
  if (!accelerators?.includes(target.accelerator)) {
    throw new TypeError(
      `Unsupported Runtime Box target: ${target.platform}/${target.arch}/${target.accelerator}`,
    );
  }
  if (target.accelerator === "cuda") {
    if (typeof target.cudaVersion !== "string" || !RUNTIME_BOX_CUDA_VERSION.test(target.cudaVersion)) {
      throw new TypeError("A CUDA Runtime Box target requires a numeric major.minor CUDA version");
    }
    return `${target.platform}-${target.arch}-cuda${target.cudaVersion}`;
  }
  if (target.cudaVersion !== undefined) {
    throw new TypeError("Only CUDA Runtime Box targets may declare a CUDA version");
  }
  return `${target.platform}-${target.arch}-${target.accelerator}`;
}

export function isLiatirSignedRuntimeBoxDocument(
  value: unknown,
): value is LiatirSignedRuntimeBoxDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<LiatirSignedRuntimeBoxDocument>;
  return document.schemaVersion === LIATIR_RUNTIME_BOX_SCHEMA_VERSION
    && document.payloadEncoding === "base64-json-utf8"
    && typeof document.payloadBase64 === "string"
    && typeof document.payloadSha256 === "string"
    && Array.isArray(document.signatures)
    && document.signatures.length > 0
    && document.signatures.every((signature) =>
      signature?.algorithm === "ed25519"
      && typeof signature.keyId === "string"
      && typeof signature.signatureBase64 === "string"
    );
}
