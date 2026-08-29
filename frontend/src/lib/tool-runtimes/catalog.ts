import {
  LIATIR_TOOL_RUNTIME_CATALOG as PRODUCT_TOOL_RUNTIME_CATALOG,
  type LiatirToolRuntimeMetadata,
} from '@liatir/core';
import { runtimeBoxReleaseCandidate } from '$lib/runtime-box-release-candidate';

/** Product catalog plus the one candidate compiled into a non-distributable release test binary. */
export const LIATIR_TOOL_RUNTIME_CATALOG: readonly LiatirToolRuntimeMetadata[] =
  runtimeBoxReleaseCandidate?.kind === 'tool-runtime'
    ? [...PRODUCT_TOOL_RUNTIME_CATALOG, runtimeBoxReleaseCandidate.metadata]
    : PRODUCT_TOOL_RUNTIME_CATALOG;
