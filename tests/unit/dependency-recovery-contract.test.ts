/**
 * What a cancelled or interrupted download is allowed to throw away.
 *
 * The rule is that bytes already on disk survive: cancelling a download keeps
 * its `.part` file, and the next attempt resumes from it with an HTTP Range
 * request rather than starting again. On a multi-gigabyte AI Model or viewer
 * runtime over a bad connection, the difference between resuming and restarting
 * is the difference between a usable feature and one nobody finishes.
 *
 * This used to be asserted across three files, one of which — the managed binary
 * installer — was deleted on 2026-08-22 when every platform Liatir supports got
 * a bundled Native Tools environment and there was nothing left for it to
 * install. The behaviour did not go with it: it lives in the native downloader,
 * which viewer runtimes, SnpEff databases, Runtime Boxes and the generic
 * download store all still go through. So the contract is now pinned where it is
 * actually implemented, plus one surviving caller proving the cancel path is
 * reachable from the UI.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const nativeDownloader = readFileSync(
  new URL('../../src-tauri/src/bridge/managed_bins.rs', import.meta.url),
  'utf8',
);
const downloadStore = readFileSync(
  new URL('../../frontend/src/lib/stores/downloads.svelte.ts', import.meta.url),
  'utf8',
);

describe('download recovery contract', () => {
  it('retains partial bytes and resumes them with a Range request', () => {
    expect(nativeDownloader).toContain('Leave .part file in place so download can be resumed later');
    expect(nativeDownloader).toContain('req.header("Range", format!("bytes={resume_from}-"))');
  });

  it('honours the cancellation registry while streaming', () => {
    expect(nativeDownloader).toContain('cancelled.load(Ordering::Relaxed)');
  });

  it('keeps the cancel path reachable from a real caller', () => {
    // Without a consumer wired to the registry, the two assertions above would
    // describe a capability nothing can invoke.
    expect(downloadStore).toContain("api.invoke('lia_managed_download_cancel', { id })");
    // A cancellation is reported as cancelled rather than as an error, because
    // the partial download is still there to continue.
    expect(downloadStore).toContain("existing.bytesDownloaded > 0 ? 'cancelled' : 'error'");
  });
});
