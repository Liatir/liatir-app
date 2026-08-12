import { liatir } from '$lib/api';
import { managedBins } from '$lib/stores/managedBins.svelte';
import { getRelease, type Arch, type OsPlatform } from './binary-releases';
export * from './binary-releases';

// ── install orchestrator ───────────────────────────────────────────────────

export type InstallProgress =
  | { phase: 'downloading'; bytesDownloaded: number; bytesTotal: number | null }
  | { phase: 'extracting' }
  | { phase: 'done'; path: string }
  | { phase: 'error'; message: string };

export interface InstallBinaryOptions {
  /** Stable per-attempt ID used by cancellation and progress events. */
  downloadId?: string;
  signal?: AbortSignal;
}

export async function installBinary(
  binary: string,
  platform: OsPlatform,
  arch: Arch,
  onProgress: (p: InstallProgress) => void,
  options: InstallBinaryOptions = {},
): Promise<void> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  const release = getRelease(binary, platform, arch);
  if (!release) throw new Error(`No precompiled release for ${binary} on ${platform}/${arch}`);

  await managedBins.init();

  // All paths are absolute — computed from the data directory root
  const dataPath = await api.desktop.fs.data.path();
  const tmpRoot = `${dataPath}/managed-bins/.tmp/${binary}`;
  const archiveName = release.url.split('/').pop()!;
  const archivePath = `${tmpRoot}/${archiveName}`;
  const extractDir = `${tmpRoot}/extracted`;
  const binDir = `${dataPath}/managed-bins/bin`;
  const binaryExt = platform === 'windows' ? '.exe' : '';
  const finalPath = `${binDir}/${release.binaryName}${binaryExt}`;

  let installed = false;
  const downloadId = options.downloadId ?? crypto.randomUUID();
  const cancelDownload = () => {
    void api.invoke('lia_managed_download_cancel', { id: downloadId }).catch(() => false);
  };
  if (options.signal?.aborted) throw new DOMException('Install cancelled', 'AbortError');
  options.signal?.addEventListener('abort', cancelDownload, { once: true });

  try {
    // 1. Download
    // A fully downloaded archive may remain after extraction or activation was
    // interrupted. Reuse it only after re-verifying its pinned checksum.
    let archiveReady = false;
    let archiveBytes: number | null = null;
    try {
      archiveBytes = await api.invoke('lia_file_size', { path: archivePath }) as number;
    } catch { /* no completed archive */ }
    if (archiveBytes !== null) {
      archiveReady = await api.invoke('lia_managed_verify_sha256', {
        path: archivePath,
        expected: release.sha256,
      }) as boolean;
      if (archiveReady) {
        onProgress({ phase: 'downloading', bytesDownloaded: archiveBytes, bytesTotal: archiveBytes });
      } else {
        await api.invoke('lia_managed_remove', { path: archivePath, recursive: false });
      }
    }

    // A previous interruption leaves `<archive>.part`; the native downloader
    // resumes it with an HTTP Range request instead of discarding good bytes.
    if (!archiveReady) {
      try {
        const resumedBytes = await api.invoke('lia_file_size', { path: `${archivePath}.part` }) as number;
        if (resumedBytes > 0) {
          onProgress({ phase: 'downloading', bytesDownloaded: resumedBytes, bytesTotal: null });
        }
      } catch { /* no partial download */ }
      const unlisten = await api.desktop.events.on(
        `managed:progress:${downloadId}`,
        (p: { bytesDownloaded: number; bytesTotal: number | null }) => {
          onProgress({ phase: 'downloading', bytesDownloaded: p.bytesDownloaded, bytesTotal: p.bytesTotal });
        },
      );
      try {
        await api.invoke('lia_managed_download', {
          id: downloadId,
          url: release.url,
          destPath: archivePath,
          sha256: release.sha256,
        });
      } finally {
        unlisten();
      }
    }
    if (options.signal?.aborted) throw new DOMException('Install cancelled', 'AbortError');

    // 2. Extract
    onProgress({ phase: 'extracting' });
    // Extraction is restartable, not resumable. Remove only stale extracted
    // files; the verified archive and any download .part remain available.
    await api.invoke('lia_managed_remove', { path: extractDir, recursive: true }).catch(() => {});
    await api.invoke('lia_managed_extract', {
      archivePath,
      destDir: extractDir,
    });
    if (options.signal?.aborted) throw new DOMException('Install cancelled', 'AbortError');

    // 3. Find binary inside extracted dir
    const foundPath = (await api.invoke('lia_managed_find_binary', {
      dir: extractDir,
      name: release.binaryName + binaryExt,
    })) as string | null;
    if (!foundPath) {
      throw new Error(`Binary "${release.binaryName}" not found in archive`);
    }
    if (options.signal?.aborted) throw new DOMException('Install cancelled', 'AbortError');

    // 4. Move to final location + chmod +x
    await api.invoke('lia_managed_move', { src: foundPath, dest: finalPath });
    await api.invoke('lia_managed_set_executable', { path: finalPath });

    // 5. Persist to store
    const info = await api.desktop.app.info();
    await managedBins.save({
      binary,
      version: release.version,
      path: finalPath,
      platform: info.os,
      arch: info.arch,
      installedAt: Date.now(),
    });

    onProgress({ phase: 'done', path: finalPath });
    installed = true;

  } finally {
    options.signal?.removeEventListener('abort', cancelDownload);
    // Only a committed install owns the temporary tree. Interrupted or failed
    // attempts retain the archive/.part so the next attempt can recover.
    if (installed) {
      await api.invoke('lia_managed_remove', { path: tmpRoot, recursive: true }).catch(() => {});
    }
  }
}
