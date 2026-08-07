import { dirname, join } from 'node:path';
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
 * Returns where a signed release's archive sits, given the release document's own path.
 *
 * Content-addressed, not stem-named: Scrollcase lays a built box out exactly as the bucket serves
 * it, so both objects sit under the release prefix under their own SHA-256. One helper because two
 * call sites resolved this independently and drifted — verification followed the box format while
 * publish still used the old local builder's stem, which passed verify and then failed publish
 * after a full signed build (run 31226809919).
 */
export function runtimeBoxArchivePath(releaseDocumentPath, release) {
  return join(dirname(releaseDocumentPath), `${release.archive.sha256}.zip`);
}

/**
 * Returns the builder-identity field for a scroll or a build provenance. One substrate remains,
 * pixi + conda-forge, but the shape stays a spread so provenance and evidence records keep a
 * single place to name the builder rather than repeating the field at every call site.
 */
export function runtimeBoxBuilderVersionFields(source) {
  return { pixiVersion: source?.pixiVersion };
}
