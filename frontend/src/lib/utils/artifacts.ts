/**
 * Stamps provenance onto the files a run produces.
 *
 * Every output file has to carry *where it came from* — which tool made it, as part of which run.
 * In a scientific tool that is not bookkeeping: a result file with no traceable origin cannot be
 * trusted or reproduced, and months later nobody will remember which run wrote it.
 *
 * Applying it centrally means an individual tool cannot forget to do it. A tool may still state these
 * fields itself — the artifact's own values always win — but if it says nothing, the defaults fill in.
 */
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

/**
 * Fills in any missing provenance. Precedence is: the artifact's own value, then the run's default,
 * then a built-in fallback — so a tool that knows better is never overridden.
 */
export function withArtifactMetadata<T extends LiatirFileArtifact>(
  artifact: T,
  defaults: ArtifactDefaults
): T {
  return {
    ...artifact,
    // `final` by default: an unlabelled output is one the user is meant to see, not an intermediate.
    role: artifact.role ?? defaults.role ?? 'final',
    createdAt: artifact.createdAt ?? defaults.createdAt ?? Date.now(),
    producer: artifact.producer ?? defaults.producer,
    parentRun: artifact.parentRun ?? defaults.parentRun,
  };
}

/** The same, for a whole run's outputs. A missing list is an empty one, not an error. */
export function withArtifactsMetadata<T extends LiatirFileArtifact>(
  artifacts: T[] | undefined,
  defaults: ArtifactDefaults
): T[] {
  return (artifacts ?? []).map((artifact) => withArtifactMetadata(artifact, defaults));
}
