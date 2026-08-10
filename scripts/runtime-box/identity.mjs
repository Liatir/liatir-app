import { dirname, join } from 'node:path';

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
 * Returns a channel document's path inside a dist tree.
 *
 * Filed by channel rather than by version, because a channel is a pointer: the next release moves
 * it instead of adding a second one. Shared for the same reason as the archive path — the builder,
 * the local registry and the release orchestration each need this location, and the one that was
 * written independently is the one that was wrong.
 */
export function runtimeBoxChannelDocumentPath(distDir, boxId, channel, targetId) {
  return join(distDir, 'channels', boxId, channel, `${targetId}.json`);
}
