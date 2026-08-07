/**
 * Verified downloads of large declared assets — model weights, tokenizers, reference archives.
 *
 * Scrollcase fetches the assets a scroll declares while building a box. This is the same guarantee
 * for the assets Liatir's own scientific validators need: an upstream file that must match a hash
 * stated ahead of time, fetched over a link that may drop halfway through.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileExists, safeRelativePath, sha256File } from './filesystem.mjs';
import { fail } from './process.mjs';

/**
 * Downloads an asset and enforces its declared hash.
 *
 * Model files are large, so the download is resumable: a partial file is kept as `.part` and
 * continued with a Range request. Two safeguards matter here — an already-complete file with the
 * right size and hash is skipped entirely (making a re-run cheap rather than another gigabyte),
 * and the `.part` file is only renamed into place *after* the hash matches, so an interrupted or
 * corrupted transfer can never masquerade as a finished asset.
 */
export async function downloadVerified(asset, destination) {
  const expectedPath = safeRelativePath(asset.relativePath).split('/').join(sep);
  if (!destination.endsWith(expectedPath)) fail(`Unexpected asset destination: ${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  if (await fileExists(destination)) {
    const current = await stat(destination);
    if (current.size === asset.sizeBytes && await sha256File(destination) === asset.sha256) return;
  }
  const partPath = `${destination}.part`;
  // Large assets (e.g. the 205 MB scGPT checkpoint) come from hosts like Google Drive that
  // occasionally drop a connection mid-stream — undici surfaces that as `Error: terminated`. Retry
  // with backoff, resuming from the partial via Range so a reset near the end is not paid in full.
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    const resumeAt = await fileExists(partPath) ? (await stat(partPath)).size : 0;
    try {
      const response = await fetch(asset.url, {
        headers: resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined,
        redirect: 'follow',
      });
      if (!response.ok) fail(`Asset download failed (${response.status}): ${asset.url}`);
      // Only append when the server actually honoured the range (206). A server that ignores Range
      // replies 200 with the whole body, which must overwrite rather than be appended to a partial.
      const append = resumeAt > 0 && response.status === 206;
      await pipeline(response.body, createWriteStream(partPath, { flags: append ? 'a' : 'w' }));
      break;
    } catch (error) {
      // `fail` (asset URL / status) is a hard error, not a transient network drop — do not retry it.
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Asset download failed') || attempt >= maxAttempts) throw error;
      console.error(`runtime-box: asset ${asset.relativePath} download attempt ${attempt} failed (${message}); retrying.`);
      await new Promise((wait) => setTimeout(wait, 2000 * attempt));
    }
  }
  const downloaded = await stat(partPath);
  if (downloaded.size !== asset.sizeBytes) fail(`Asset size mismatch for ${asset.relativePath}.`);
  if (await sha256File(partPath) !== asset.sha256) fail(`Asset SHA-256 mismatch for ${asset.relativePath}.`);
  await rename(partPath, destination);
}
