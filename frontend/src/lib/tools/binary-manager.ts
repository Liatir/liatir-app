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

export async function installBinary(
  binary: string,
  platform: OsPlatform,
  arch: Arch,
  onProgress: (p: InstallProgress) => void,
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

  try {
    // 1. Download
    const downloadId = crypto.randomUUID();
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

    // 2. Extract
    onProgress({ phase: 'extracting' });
    await api.invoke('lia_managed_extract', {
      archivePath,
      destDir: extractDir,
    });

    // 3. Find binary inside extracted dir
    const foundPath = (await api.invoke('lia_managed_find_binary', {
      dir: extractDir,
      name: release.binaryName + binaryExt,
    })) as string | null;
    if (!foundPath) {
      throw new Error(`Binary "${release.binaryName}" not found in archive`);
    }

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

  } finally {
    // Cleanup tmp (best-effort)
    await api.invoke('lia_managed_remove', { path: tmpRoot, recursive: true }).catch(() => {});
  }
}
