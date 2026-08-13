import { liatir } from '$lib/api';
import {
  checkLiatirArtifactCompatibility,
  validateLiatirAnnDataArtifact,
  type LiatirAnnDataInspectionV1,
  type LiatirArtifactCompatibilityReport,
  type LiatirArtifactLineage,
  type LiatirArtifactRequirement,
  type LiatirArtifactViewerHints,
  type LiatirScientificArtifactMetadata,
} from '@liatir/core';

const HDF5_SIGNATURE_HEX = '894844460d0a1a0a';

interface NativeFileIdentity {
  sizeBytes: number;
  sha256: string;
  prefixHex: string;
}

export interface AnnDataArtifactOptions {
  lineage?: LiatirArtifactLineage;
  viewerHints?: LiatirArtifactViewerHints;
  validatedAt?: string;
}

export async function inspectAnnDataArtifact(
  path: string,
  inspection: Omit<LiatirAnnDataInspectionV1, 'hdf5Signature'> = {},
  options: AnnDataArtifactOptions = {},
): Promise<LiatirScientificArtifactMetadata> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const identity = await api.invoke('lia_file_identity', { path }) as NativeFileIdentity;
  return validateLiatirAnnDataArtifact({
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    inspection: {
      ...inspection,
      hdf5Signature: identity.prefixHex.toLowerCase() === HDF5_SIGNATURE_HEX,
    },
    validatedAt: options.validatedAt ?? new Date().toISOString(),
    ...(options.lineage ? { lineage: options.lineage } : {}),
    ...(options.viewerHints ? { viewerHints: options.viewerHints } : {}),
  });
}

export function refineAnnDataArtifact(
  artifact: LiatirScientificArtifactMetadata,
  inspection: Omit<LiatirAnnDataInspectionV1, 'hdf5Signature'>,
  options: AnnDataArtifactOptions = {},
): LiatirScientificArtifactMetadata {
  return validateLiatirAnnDataArtifact({
    sizeBytes: artifact.physical.sizeBytes,
    sha256: artifact.physical.digest.value,
    inspection: { ...inspection, hdf5Signature: artifact.physical.format.container === 'hdf5' },
    validatedAt: options.validatedAt ?? new Date().toISOString(),
    ...(options.lineage ?? artifact.lineage ? { lineage: options.lineage ?? artifact.lineage } : {}),
    ...(options.viewerHints ?? artifact.viewerHints
      ? { viewerHints: options.viewerHints ?? artifact.viewerHints }
      : {}),
  });
}

export function artifactCompatibility(
  artifact: LiatirScientificArtifactMetadata | undefined,
  requirement: LiatirArtifactRequirement | undefined,
): LiatirArtifactCompatibilityReport | null {
  return requirement ? checkLiatirArtifactCompatibility(artifact, requirement) : null;
}

export function artifactValidationLabel(artifact: LiatirScientificArtifactMetadata | undefined): string | null {
  if (!artifact) return null;
  const status = artifact.validation.status === 'valid'
    ? 'validated'
    : artifact.validation.status === 'invalid'
      ? 'invalid'
      : 'partially validated';
  return `${artifact.profile.id.split('.').pop() ?? artifact.profile.id} ${artifact.profile.version} · ${status}`;
}

export function assertArtifactCompatible(
  artifact: LiatirScientificArtifactMetadata | undefined,
  requirement: LiatirArtifactRequirement,
): LiatirArtifactCompatibilityReport {
  const report = checkLiatirArtifactCompatibility(artifact, requirement);
  if (report.status === 'incompatible') {
    const errors = report.diagnostics.filter((item) => item.severity === 'error');
    throw new Error(errors.map((item) => `${item.message}${item.action ? ` ${item.action}` : ''}`).join(' '));
  }
  return report;
}
