import { describe, expect, it } from 'vitest';

import {
  BINARY_RELEASES,
  getRelease,
  type BinaryRelease,
} from '../../frontend/src/lib/tools/binary-releases';

function releases(): BinaryRelease[] {
  return Object.values(BINARY_RELEASES).flatMap((platforms) =>
    Object.values(platforms).flatMap((architectures) =>
      Object.values(architectures),
    ),
  );
}

describe('managed binary release registry', () => {
  it('requires immutable HTTPS assets with SHA-256 metadata', () => {
    for (const release of releases()) {
      expect(release.url).toMatch(/^https:\/\/github\.com\/.+\/releases\/download\//);
      expect(release.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(release.sizeBytes).toBeGreaterThan(0);
      expect(release.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.version).not.toMatch(/latest/i);
    }
  });

  it('offers native SeqKit assets across the supported desktop matrix', () => {
    expect(getRelease('seqkit', 'macos', 'arm64')?.binaryName).toBe('seqkit');
    expect(getRelease('seqkit', 'macos', 'x86_64')?.binaryName).toBe('seqkit');
    expect(getRelease('seqkit', 'linux', 'arm64')?.binaryName).toBe('seqkit');
    expect(getRelease('seqkit', 'linux', 'x86_64')?.binaryName).toBe('seqkit');
    expect(getRelease('seqkit', 'windows', 'x86_64')?.binaryName).toBe('seqkit');
  });

  it('does not advertise upstream assets that do not exist', () => {
    expect(getRelease('minimap2', 'macos', 'arm64')).toBeNull();
    expect(getRelease('minimap2', 'macos', 'x86_64')).toBeNull();
    expect(getRelease('bwa-mem2', 'macos', 'arm64')).toBeNull();
    expect(getRelease('bwa-mem2', 'macos', 'x86_64')).toBeNull();
  });
});
