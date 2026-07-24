import { runtimeBoxTargetId } from './targets.mjs';

/** Returns the single filename stem shared by an archive and its release document. */
export function runtimeBoxReleaseStem(release) {
  return `${release.boxId}-${release.version}-${runtimeBoxTargetId(release.target)}`;
}

/** Returns the immutable object prefix for one Runtime Box release target. */
export function runtimeBoxReleaseObjectPrefix(release) {
  return `boxes/${release.boxId}/${release.version}/${runtimeBoxTargetId(release.target)}`;
}

/**
 * Returns the builder-identity field for a recipe or a build provenance: exactly one of
 * `pixiVersion` (pixi + conda-forge substrate) or `uvVersion` (legacy standalone-Python builder).
 * Spread into provenance and evidence records so the two substrates can coexist during migration
 * without every call site repeating the branch.
 */
export function runtimeBoxBuilderVersionFields(source) {
  return source?.pixiVersion
    ? { pixiVersion: source.pixiVersion }
    : { uvVersion: source?.uvVersion };
}
