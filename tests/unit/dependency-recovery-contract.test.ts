import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manager = readFileSync(
  new URL('../../frontend/src/lib/tools/binary-manager.ts', import.meta.url),
  'utf8',
);
const nativeDownloader = readFileSync(
  new URL('../../src-tauri/src/bridge/managed_bins.rs', import.meta.url),
  'utf8',
);
const dependencyPage = readFileSync(
  new URL('../../frontend/src/routes/deps/+page.svelte', import.meta.url),
  'utf8',
);

describe('dependency install recovery contract', () => {
  it('retains partial downloads until a managed install commits', () => {
    expect(manager).toContain('if (installed)');
    expect(manager).toContain('`${archivePath}.part`');
    expect(dependencyPage).toContain('downloadId: execution.runId');
    expect(nativeDownloader).toContain('Leave .part file in place so download can be resumed later');
    expect(nativeDownloader).toContain('req.header("Range", format!("bytes={resume_from}-"))');
  });

  it('connects AbortSignal cancellation to the native download registry', () => {
    expect(manager).toContain("api.invoke('lia_managed_download_cancel', { id: downloadId })");
    expect(manager).toContain("options.signal?.addEventListener('abort', cancelDownload");
    expect(nativeDownloader).toContain('cancelled.load(Ordering::Relaxed)');
  });
});
