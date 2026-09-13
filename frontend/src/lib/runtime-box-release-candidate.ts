import {
	MHCFLURRY_CLASS1_PRESENTATION_RELEASE_CANDIDATE_METADATA,
	BOLTZ_2_RELEASE_CANDIDATE_METADATA,
	PROTENIX_BASE_V1_RELEASE_CANDIDATE_METADATA,
	PROTENIX_V2_RELEASE_CANDIDATE_METADATA,
	PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA,
	OPENMM_RELEASE_CANDIDATE_METADATA,
  PVACTOOLS_RELEASE_CANDIDATE_METADATA,
  type LiatirAIModelMetadata,
  type LiatirToolRuntimeMetadata,
} from '@liatir/core';

export type RuntimeBoxReleaseCandidate =
  | { kind: 'ai-model'; metadata: LiatirAIModelMetadata }
  | { kind: 'tool-runtime'; metadata: LiatirToolRuntimeMetadata };

/** Resolves the one candidate compiled into a non-distributable release test binary. */
export function resolveRuntimeBoxReleaseCandidate(
  candidateId: string | null | undefined,
): RuntimeBoxReleaseCandidate | null {
  const id = candidateId?.trim();
  if (!id) return null;
  if (id === MHCFLURRY_CLASS1_PRESENTATION_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'ai-model', metadata: MHCFLURRY_CLASS1_PRESENTATION_RELEASE_CANDIDATE_METADATA };
  }
  if (id === PVACTOOLS_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'tool-runtime', metadata: PVACTOOLS_RELEASE_CANDIDATE_METADATA };
  }
  if (id === BOLTZ_2_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'ai-model', metadata: BOLTZ_2_RELEASE_CANDIDATE_METADATA };
  }
  if (id === PROTENIX_BASE_V1_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'ai-model', metadata: PROTENIX_BASE_V1_RELEASE_CANDIDATE_METADATA };
  }
  if (id === PROTENIX_V2_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'ai-model', metadata: PROTENIX_V2_RELEASE_CANDIDATE_METADATA };
  }
  if (id === PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'ai-model', metadata: PROTENIX_MINI_DEFAULT_RELEASE_CANDIDATE_METADATA };
  }
  if (id === OPENMM_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'tool-runtime', metadata: OPENMM_RELEASE_CANDIDATE_METADATA };
  }
  throw new Error(`Unsupported Runtime Box release candidate: ${id}`);
}

export const runtimeBoxReleaseCandidate = resolveRuntimeBoxReleaseCandidate(
  import.meta.env.VITE_LIATIR_RUNTIME_BOX_RELEASE_CANDIDATE_ID,
);
