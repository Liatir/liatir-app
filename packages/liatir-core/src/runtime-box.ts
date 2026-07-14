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
  /** Host environments validated for this payload. Omitted by legacy releases. */
  hostEnvironments?: LiatirRuntimeBoxHostEnvironment[];
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

export interface LiatirAIModelRuntimeBoxInstall {
  boxId: string;
  channel: LiatirRuntimeBoxChannel;
  /** Public control-plane base URL. Debug builds may override it locally. */
  registryBaseUrl: string;
}

/** Return the stable target identifier used by R2 keys and registry routes. */
export function runtimeBoxTargetId(target: LiatirRuntimeBoxTarget): string {
  const cuda = target.cudaVersion ? `-cuda${target.cudaVersion}` : "";
  return `${target.platform}-${target.arch}-${target.accelerator}${cuda}`;
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
