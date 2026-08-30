import {
  LIATIR_TOOL_RUNTIME_CATALOG as PRODUCT_TOOL_RUNTIME_CATALOG,
  type LiatirToolRuntimeMetadata,
} from '@liatir/core';
import { runtimeBoxReleaseCandidate } from '$lib/runtime-box-release-candidate';

/** Product catalog plus the one candidate compiled into a non-distributable release test binary. */
const releaseCandidate = runtimeBoxReleaseCandidate?.kind === 'tool-runtime'
  ? runtimeBoxReleaseCandidate.metadata
  : null;

export const LIATIR_TOOL_RUNTIME_CATALOG: readonly LiatirToolRuntimeMetadata[] =
  releaseCandidate && !PRODUCT_TOOL_RUNTIME_CATALOG.some((runtime) => runtime.id === releaseCandidate.id)
    ? [...PRODUCT_TOOL_RUNTIME_CATALOG, releaseCandidate]
    : PRODUCT_TOOL_RUNTIME_CATALOG;
