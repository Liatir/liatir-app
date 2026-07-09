export type OsPlatform = 'macos' | 'linux' | 'windows';
export type Arch = 'x86_64' | 'arm64';
export type ArchiveType = 'tar.gz' | 'tar.bz2' | 'zip' | 'binary';

export interface BinaryRelease {
  url: string;
  archiveType: ArchiveType;
  version: string;
  binaryName: string;
  sha256: string;
  sizeBytes: number;
  verifiedAt: string;
}

export type BinaryReleaseMap = Partial<
  Record<OsPlatform, Partial<Record<Arch, BinaryRelease>>>
>;

/**
 * Official precompiled binary releases. Tools without an upstream binary for a
 * host stay on the explicit package-manager path instead of using unofficial
 * or fabricated assets.
 */
export const BINARY_RELEASES: Record<string, BinaryReleaseMap> = {
  seqkit: {
    macos: {
      x86_64: {
        url: 'https://github.com/shenwei356/seqkit/releases/download/v2.13.0/seqkit_darwin_amd64.tar.gz',
        archiveType: 'tar.gz', version: '2.13.0', binaryName: 'seqkit',
        sha256: '7db4264a1a49d9ad7cc6d02f572c8573469d6f91881da2a2420b7f5426d63951',
        sizeBytes: 8_662_154, verifiedAt: '2026-07-09',
      },
      arm64: {
        url: 'https://github.com/shenwei356/seqkit/releases/download/v2.13.0/seqkit_darwin_arm64.tar.gz',
        archiveType: 'tar.gz', version: '2.13.0', binaryName: 'seqkit',
        sha256: 'c36d68cfe4d8796c017a136a625b4706b4f7dc2664f1a555e4b4ced4ee394a28',
        sizeBytes: 8_188_794, verifiedAt: '2026-07-09',
      },
    },
    linux: {
      x86_64: {
        url: 'https://github.com/shenwei356/seqkit/releases/download/v2.13.0/seqkit_linux_amd64.tar.gz',
        archiveType: 'tar.gz', version: '2.13.0', binaryName: 'seqkit',
        sha256: '7d686de448464fada1b1988e2e07d693bec68768312da62846bc0e2b502bfc46',
        sizeBytes: 8_589_589, verifiedAt: '2026-07-09',
      },
      arm64: {
        url: 'https://github.com/shenwei356/seqkit/releases/download/v2.13.0/seqkit_linux_arm64.tar.gz',
        archiveType: 'tar.gz', version: '2.13.0', binaryName: 'seqkit',
        sha256: '2bce55ea352ceab56a428b2d6e06e6565485a446c17dc17cadb5dc28ab7a9cdc',
        sizeBytes: 7_963_731, verifiedAt: '2026-07-09',
      },
    },
    windows: {
      x86_64: {
        url: 'https://github.com/shenwei356/seqkit/releases/download/v2.13.0/seqkit_windows_amd64.exe.tar.gz',
        archiveType: 'tar.gz', version: '2.13.0', binaryName: 'seqkit',
        sha256: '789a11df5306ae9d8cc0ccc9a11b76b6b8f44c31e6cc3ba3e4bc13db5819b1dd',
        sizeBytes: 8_758_176, verifiedAt: '2026-07-09',
      },
    },
  },
  minimap2: {
    linux: {
      x86_64: {
        url: 'https://github.com/lh3/minimap2/releases/download/v2.31/minimap2-2.31_x64-linux.tar.bz2',
        archiveType: 'tar.bz2', version: '2.31', binaryName: 'minimap2',
        sha256: '300bc287f05eb890c6211fa7db043ce98320a401621fadd1cfdbeabd1a6e4ab5',
        sizeBytes: 2_252_266, verifiedAt: '2026-07-09',
      },
    },
  },
  'bwa-mem2': {
    linux: {
      x86_64: {
        url: 'https://github.com/bwa-mem2/bwa-mem2/releases/download/v2.3/bwa-mem2-2.3_x64-linux.tar.bz2',
        archiveType: 'tar.bz2', version: '2.3', binaryName: 'bwa-mem2',
        sha256: '112f3a3ebf3f8c2377f52d61446ead392c4a98ecf89e7629617d3ed16f4e73cb',
        sizeBytes: 3_707_862, verifiedAt: '2026-07-09',
      },
    },
  },
};

export function getRelease(
  binary: string,
  platform: OsPlatform,
  arch: Arch,
): BinaryRelease | null {
  return BINARY_RELEASES[binary]?.[platform]?.[arch] ?? null;
}
