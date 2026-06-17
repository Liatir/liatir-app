import { offlab } from '$lib/api';
import { managedBins } from '$lib/stores/managedBins.svelte';

export type OsPlatform = 'macos' | 'linux' | 'windows';
export type Arch = 'x86_64' | 'arm64';
export type ArchiveType = 'tar.gz' | 'tar.bz2' | 'zip' | 'binary';

export interface BinaryRelease {
  url: string;
  archiveType: ArchiveType;
  version: string;
  binaryName: string;
}

export type BinaryReleaseMap = Partial<
  Record<OsPlatform, Partial<Record<Arch, BinaryRelease>>>
>;

/**
 * Official precompiled binary releases.
 * Only tools with verified precompiled builds are listed here.
 * Others fall back to brew/conda in the UI.
 *
 * Sources:
 *   minimap2  — https://github.com/lh3/minimap2/releases
 *   bwa-mem2  — https://github.com/bwa-mem2/bwa-mem2/releases
 */
export const BINARY_RELEASES: Record<string, BinaryReleaseMap> = {
  minimap2: {
    linux: {
      x86_64: {
        url: 'https://github.com/lh3/minimap2/releases/download/v2.28/minimap2-2.28_x64-linux.tar.bz2',
        archiveType: 'tar.bz2',
        version: '2.28',
        binaryName: 'minimap2',
      },
    },
    macos: {
      x86_64: {
        url: 'https://github.com/lh3/minimap2/releases/download/v2.28/minimap2-2.28_x64-macosx.tar.bz2',
        archiveType: 'tar.bz2',
        version: '2.28',
        binaryName: 'minimap2',
      },
      arm64: {
        // Runs via Rosetta 2 on Apple Silicon
        url: 'https://github.com/lh3/minimap2/releases/download/v2.28/minimap2-2.28_x64-macosx.tar.bz2',
        archiveType: 'tar.bz2',
        version: '2.28 (x86 via Rosetta)',
        binaryName: 'minimap2',
      },
    },
  },

  'bwa-mem2': {
    linux: {
      x86_64: {
        url: 'https://github.com/bwa-mem2/bwa-mem2/releases/download/v2.2.1/bwa-mem2-2.2.1_x64-linux.tar.bz2',
        archiveType: 'tar.bz2',
        version: '2.2.1',
        binaryName: 'bwa-mem2',
      },
    },
    macos: {
      x86_64: {
        url: 'https://github.com/bwa-mem2/bwa-mem2/releases/download/v2.2.1/bwa-mem2-2.2.1_x64-macosx.tar.bz2',
        archiveType: 'tar.bz2',
        version: '2.2.1',
        binaryName: 'bwa-mem2',
      },
    },
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

export function getRelease(
  binary: string,
  platform: OsPlatform,
  arch: Arch,
): BinaryRelease | null {
  return BINARY_RELEASES[binary]?.[platform]?.[arch] ?? null;
}

export function getManagedBinPath(binary: string): string | null {
  return managedBins.get(binary)?.path ?? null;
}

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
  const api = offlab();
  if (!api) throw new Error('Offlab API not available');

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
      await api.invoke('dtr_managed_download', {
        id: downloadId,
        url: release.url,
        destPath: archivePath,
      });
    } finally {
      unlisten();
    }

    // 2. Extract
    onProgress({ phase: 'extracting' });
    await api.invoke('dtr_managed_extract', {
      archivePath,
      destDir: extractDir,
    });

    // 3. Find binary inside extracted dir
    const foundPath = (await api.invoke('dtr_managed_find_binary', {
      dir: extractDir,
      name: release.binaryName + binaryExt,
    })) as string | null;
    if (!foundPath) {
      throw new Error(`Binary "${release.binaryName}" not found in archive`);
    }

    // 4. Move to final location + chmod +x
    await api.invoke('dtr_managed_move', { src: foundPath, dest: finalPath });
    await api.invoke('dtr_managed_set_executable', { path: finalPath });

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
    await api.invoke('dtr_managed_remove', { path: tmpRoot, recursive: true }).catch(() => {});
  }
}
