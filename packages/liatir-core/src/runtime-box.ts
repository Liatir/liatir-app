/**
 * Shared wire contracts for prebuilt AI Runtime Boxes.
 *
 * Signed documents use an exact base64-encoded JSON payload instead of
 * canonicalized JSON. This keeps signature verification identical in Node,
 * Rust, Workers, and future clients without maintaining multiple canonical
 * JSON implementations.
 */

import {
  BOX_SCHEMA_VERSION,
  boxTargetId,
  isSignedBoxDocument,
} from "scrollcase/contract/browser";
import type {
  BoxChannelManifest,
  BoxReleaseManifest,
  BoxRevocationsManifest,
  BoxTarget,
  Provenance,
  SignedBoxDocument,
} from "scrollcase/contract/types";

export const LIATIR_RUNTIME_BOX_SCHEMA_VERSION = BOX_SCHEMA_VERSION;

export type LiatirRuntimeBoxPlatform = BoxTarget["platform"];
export type LiatirRuntimeBoxArch = BoxTarget["arch"];
export type LiatirRuntimeBoxAccelerator = BoxTarget["accelerator"];
export type LiatirRuntimeBoxChannel = BoxChannelManifest["channel"];
export type LiatirRuntimeBoxHostEnvironment = "native" | "windows-wsl2";

export type LiatirRuntimeBoxTarget = BoxTarget;

export type LiatirRuntimeBoxCompatibility = Omit<
  BoxReleaseManifest["compatibility"],
  "minHostAppVersion" | "maxHostAppVersionExclusive" | "hostEnvironments"
> & {
  minLiatirVersion: string;
  maxLiatirVersionExclusive?: string;
  /** Host environments validated for this payload. Omitted by legacy releases. */
  hostEnvironments?: LiatirRuntimeBoxHostEnvironment[];
};

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
  /** Minimum installed memory in decimal gigabytes (1 GB = 1,000,000,000 bytes). */
  minRamGb?: number;
  /** Required for CUDA candidates so selection never guesses driver compatibility. */
  minNvidiaDriverVersion?: string;
}

export type LiatirRuntimeBoxBuildProvenance = Provenance;

export type LiatirRuntimeBoxArchive = BoxReleaseManifest["archive"];
export type LiatirRuntimeBoxSelfTest = BoxReleaseManifest["selfTest"];

/** Immutable release document signed offline by Liatir. */
export type LiatirRuntimeBoxReleaseManifest = Omit<
  BoxReleaseManifest,
  "kind" | "target" | "compatibility" | "selfTest" | "provenance"
> & {
  kind: "liatir.runtime-box.release";
  target: LiatirRuntimeBoxTarget;
  compatibility: LiatirRuntimeBoxCompatibility;
  selfTest: LiatirRuntimeBoxSelfTest;
  provenance: LiatirRuntimeBoxBuildProvenance;
};

export type LiatirRuntimeBoxChannelRelease = BoxChannelManifest["releases"][number];

/** Small mutable channel pointer. It is signed independently from releases. */
export type LiatirRuntimeBoxChannelManifest = Omit<BoxChannelManifest, "kind"> & {
  kind: "liatir.runtime-box.channel";
};

export type LiatirRuntimeBoxRevocation = BoxRevocationsManifest["revocations"][number];

export type LiatirRuntimeBoxRevocationsManifest = Omit<BoxRevocationsManifest, "kind"> & {
  kind: "liatir.runtime-box.revocations";
};

export type LiatirRuntimeBoxSignature = SignedBoxDocument["signatures"][number];

export type LiatirSignedRuntimeBoxDocument = SignedBoxDocument;

/** Durable install provenance written beside the activated Runtime Box. */
export interface LiatirRuntimeBoxActivationMetadata {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_SCHEMA_VERSION;
  selectedTarget: LiatirRuntimeBoxTarget;
  release: LiatirRuntimeBoxReleaseManifest;
  /** Exact verified signing envelope persisted for offline re-verification before dispatch. */
  signedRelease: LiatirSignedRuntimeBoxDocument;
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
  /** Repository-owned constraints for an on-demand self-hosted runner. */
  selfHosted?: {
    scope: "repository";
    ephemeral: true;
    maxConcurrency: 1;
    cleanWorkDirectory: true;
    runnerNamePrefix: string;
    minimumBootstrapFreeDiskBytes: number;
  };
  /** Exact accelerator identity provisioned by a checked GPU runner profile. */
  expectedGpuModel?: string;
  /** Minimum usable GPU memory reported by the native driver. */
  minimumGpuMemoryBytes?: number;
  /** Exact CUDA compute capability required by the runner profile. */
  expectedComputeCapability?: string;
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
  /** Reviewed compact evidence checked in separately from the CI run artifact. */
  evidenceRecord?: string;
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
  dependencyLockSha256: string;
  /** Reviewed wheel-license inventory bound to this exact dependency lock. */
  dependencyLicenseAudit?: string;
  diskPlan: {
    estimatedInstalledSizeBytes: number;
    estimatedArchiveSizeBytes: number;
    safetyMarginBytes: number;
  };
  gpuRequired: boolean;
  nativeCiEnabled: boolean;
  /** Windows CUDA cannot activate until this Linux CUDA target has scientific evidence. */
  linuxValidationPrerequisiteTargetId?: string;
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
  /** Product-owned runner source validated by the model-specific scientific gate. */
  productScriptPath: string;
  /**
   * The end-to-end spec that drives this model's real product lifecycle before promotion.
   *
   * Per model, because each spec pins its own box, model and expected artifacts: running another
   * model's spec fails on an unknown target rather than validating anything.
   */
  productLifecycleSpec: string;
  callerWorkflow: string;
  targets: readonly LiatirRuntimeBoxCiTargetRecord[];
}

/** Machine-readable CI authority for Runtime Box runners, targets, and validation gates. */
export interface LiatirRuntimeBoxCiCatalog {
  schemaVersion: 1;
  costPolicy: {
    maxPaidRunnerConcurrency: 1;
    maxModelsPerGpuJob: 1;
    maxTargetsPerGpuJob: 1;
    heartbeatSeconds: number;
    gpuManualOnly: true;
    scheduledGpuWorkflows: false;
    linuxCudaBeforeWindowsCuda: true;
    cacheModelWeightsOrArchives: false;
  };
  runnerProfiles: readonly LiatirRuntimeBoxCiRunnerProfile[];
  foundationFixtures: readonly {
    recipeId: string;
    targetId: string;
    target: LiatirRuntimeBoxTarget;
    runnerProfileId: string;
    timeoutMinutes: number;
    rustLifecycle: boolean;
    dependencyLockSha256: string;
    condaDependencyLicenseAudit: string;
    requiredBuildDiskBytes: number;
    diskPlan: {
      estimatedInstalledSizeBytes: number;
      estimatedArchiveSizeBytes: number;
      safetyMarginBytes: number;
    };
  }[];
  models: readonly LiatirRuntimeBoxCiModelRecord[];
}

export const LIATIR_RUNTIME_BOX_CI_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type LiatirRuntimeBoxCiEvidenceStatus = "passed" | "failed" | "cancelled" | "skipped";
export type LiatirRuntimeBoxCiEvidencePhase =
  | "foundation-preflight"
  | "foundation-native"
  | "model-validation"
  | "production-release"
  | "signer-deploy";

export interface LiatirRuntimeBoxCiEvidenceSubject {
  modelId?: string;
  boxId?: string;
  runtimeId?: string;
  recipeId?: string;
  recipeVersion?: string;
  version?: string;
  targetId?: string;
  mode?: LiatirRuntimeBoxCiValidationMode;
}

export interface LiatirRuntimeBoxCiSourceEvidence {
  repository: string;
  commitSha: string;
  sourceTreeDirty: boolean;
}

export interface LiatirRuntimeBoxCiWorkflowEvidence {
  provider: "github-actions" | "local";
  workflow: string | null;
  runId: string | null;
  runAttempt: string | null;
  runUrl: string | null;
  actor: string | null;
  triggeringActor: string | null;
  environment: string | null;
  /** GitHub does not expose this directly on every plan; null means unavailable, not unreviewed. */
  approver: string | null;
}

export interface LiatirRuntimeBoxCiHostEvidence {
  platform: LiatirRuntimeBoxPlatform;
  arch: LiatirRuntimeBoxArch;
  runnerName: string | null;
  runnerLabel: string | null;
  runnerEnvironment: string | null;
  image: string | null;
  freeDiskBytesBefore: number;
  minimumFreeDiskBytes: number | null;
  peakAdditionalDiskBytes: number | null;
  /** Existing Runtime Box build and distribution state counted before allocating new work. */
  existingBuildStateBytes?: number;
  /** Static peak-disk calculation checked before a native runner is allocated. */
  calculatedDiskPlan?: {
    sourceAssetBytes: number;
    localSourceBytes: number;
    estimatedInstalledSizeBytes: number;
    estimatedArchiveSizeBytes: number;
    safetyMarginBytes: number;
    calculatedPeakDiskBytes: number;
    requiredBuildDiskBytes: number;
  };
  gpuModel: string | null;
  gpuCount?: number | null;
  gpuMemoryBytes?: number | null;
  computeCapability?: string | null;
  driverVersion: string | null;
  reportedCudaCompatibility: string | null;
}

export interface LiatirRuntimeBoxCiBuildEvidence {
  recipeSha256: string;
  dependencyLockSha256: string;
  pythonVersion: string;
  /** Mirrors the provenance builder identity: exactly one of these is present. */
  uvVersion?: string;
  pixiVersion?: string;
  archiveSha256: string;
  archiveSizeBytes: number;
  installedSizeBytes: number;
  elapsedMs: number | null;
  selfTest: {
    status: "passed";
    imports: readonly string[];
    localSignatureVerified: boolean;
  };
}

export interface LiatirRuntimeBoxCiScientificEvidence {
  validator: { path: string; sha256: string };
  productScript: { path: string; sha256: string };
  fixture: {
    id: string;
    sha256: string;
    inputShapes: Readonly<Record<string, readonly number[]>>;
  };
  sources: readonly {
    kind: "source" | "checkpoint" | "asset";
    identity: string;
    revision: string | null;
    sha256: string;
  }[];
  framework: { name: string; version: string; backend: string };
  accelerator: {
    kind: "cpu" | "metal" | "cuda";
    gpuModel: string | null;
    gpuMemoryBytes?: number | null;
    computeCapability?: string | null;
    driverVersion: string | null;
    reportedCudaCompatibility: string | null;
  };
  outputShapes: Readonly<Record<string, readonly number[]>>;
  finiteValues: boolean;
  tolerances: Readonly<Record<string, number>>;
  parity: Readonly<Record<string, number | boolean | string | null>>;
  elapsedMs: number;
  peakRamBytes: number | null;
  peakVramBytes: number | null;
  outputContract: "passed";
  provenanceContract: "passed";
}

export interface LiatirRuntimeBoxCiPublicationEvidenceRecord {
  signingKeyIds: readonly string[];
  localSignatureVerified: boolean;
  archive: { url: string; sizeBytes: number; sha256: string; streamedVerification: "passed" };
  release: { url: string; sizeBytes: number; sha256: string; streamedVerification: "passed" };
  channelUrl: string;
  promotionHttpStatus: number;
  promotionResponse: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LiatirRuntimeBoxCiProductLifecycleEvidence {
  status: "passed";
  targetId: string;
  version: string;
  jobId: string;
  analysisRunId: string;
  accelerator: string;
  gpuModel?: string | null;
  computeCapability?: string | null;
  reportedCudaCompatibility?: string | null;
  peakVramBytes?: number | null;
  resultArtifactCount: number;
  assertions: Readonly<Record<string, "passed">>;
}

/** Small CI artifact and checked-in review record; Runtime Box archives never belong here. */
export interface LiatirRuntimeBoxCiEvidenceRecord {
  schemaVersion: typeof LIATIR_RUNTIME_BOX_CI_EVIDENCE_SCHEMA_VERSION;
  kind: "liatir.runtime-box.ci-evidence";
  phase: LiatirRuntimeBoxCiEvidencePhase;
  status: LiatirRuntimeBoxCiEvidenceStatus;
  createdAt: string;
  subject: LiatirRuntimeBoxCiEvidenceSubject;
  source: LiatirRuntimeBoxCiSourceEvidence;
  workflow: LiatirRuntimeBoxCiWorkflowEvidence;
  host?: LiatirRuntimeBoxCiHostEvidence;
  build?: LiatirRuntimeBoxCiBuildEvidence;
  scientific?: LiatirRuntimeBoxCiScientificEvidence;
  productLifecycle?: LiatirRuntimeBoxCiProductLifecycleEvidence;
  publication?: LiatirRuntimeBoxCiPublicationEvidenceRecord;
}

/** Return the stable target identifier used by R2 keys and registry routes. */
export function runtimeBoxTargetId(target: LiatirRuntimeBoxTarget): string {
  return boxTargetId(target);
}

export function isLiatirSignedRuntimeBoxDocument(
  value: unknown,
): value is LiatirSignedRuntimeBoxDocument {
  return isSignedBoxDocument(value);
}
