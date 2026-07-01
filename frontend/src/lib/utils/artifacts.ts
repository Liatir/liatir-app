import type {
  LiatirArtifactParentRun,
  LiatirArtifactProducer,
  LiatirFileArtifact,
  LiatirFileArtifactRole,
} from '@liatir/core';

export interface ArtifactDefaults {
  role?: LiatirFileArtifactRole;
  createdAt?: number;
  producer?: LiatirArtifactProducer;
  parentRun?: LiatirArtifactParentRun;
}

export function withArtifactMetadata<T extends LiatirFileArtifact>(
  artifact: T,
  defaults: ArtifactDefaults
): T {
  return {
    ...artifact,
    role: artifact.role ?? defaults.role ?? 'final',
    createdAt: artifact.createdAt ?? defaults.createdAt ?? Date.now(),
    producer: artifact.producer ?? defaults.producer,
    parentRun: artifact.parentRun ?? defaults.parentRun,
  };
}

export function withArtifactsMetadata<T extends LiatirFileArtifact>(
  artifacts: T[] | undefined,
  defaults: ArtifactDefaults
): T[] {
  return (artifacts ?? []).map((artifact) => withArtifactMetadata(artifact, defaults));
}
