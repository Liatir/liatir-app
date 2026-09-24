import {
	RUNTIME_BOX_AI_MODEL_REGISTRY,
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
  // A model already in the product is republished against its own product metadata, so a
  // rebuild of a published box (a format migration, a new version) needs no candidate entry.
  const productModel = RUNTIME_BOX_AI_MODEL_REGISTRY.find((model) => model.id === id);
  if (productModel) return { kind: 'ai-model', metadata: productModel };
  if (id === PVACTOOLS_RELEASE_CANDIDATE_METADATA.id) {
    return { kind: 'tool-runtime', metadata: PVACTOOLS_RELEASE_CANDIDATE_METADATA };
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
