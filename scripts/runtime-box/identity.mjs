import { runtimeBoxTargetId } from './targets.mjs';

/** Returns the single filename stem shared by an archive and its release document. */
export function runtimeBoxReleaseStem(release) {
  return `${release.boxId}-${release.version}-${runtimeBoxTargetId(release.target)}`;
}

/** Returns the immutable object prefix for one Runtime Box release target. */
export function runtimeBoxReleaseObjectPrefix(release) {
  return `boxes/${release.boxId}/${release.version}/${runtimeBoxTargetId(release.target)}`;
}
