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
 * Returns the builder-identity field for a scroll or a build provenance. One substrate remains,
 * pixi + conda-forge, but the shape stays a spread so provenance and evidence records keep a
 * single place to name the builder rather than repeating the field at every call site.
 */
export function runtimeBoxBuilderVersionFields(source) {
  return { pixiVersion: source?.pixiVersion };
}
