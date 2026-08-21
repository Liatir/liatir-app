/**
 * Security contract for the binaries Liatir downloads and then *executes* on the user's machine.
 *
 * Every release entry must be an immutable HTTPS asset with a declared SHA-256. Those two properties are what
 * make the download safe: HTTPS stops it being swapped in transit, the hash stops it being swapped at the
 * source, and pinning an immutable asset means the bytes behind a URL cannot change under us.
 *
 * An entry missing either one would still work perfectly — right up until it didn't. Asserting it here means a
 * new binary cannot be added without them.
 */
import { describe, expect, it } from 'vitest';

import { DEP_REQUIREMENTS } from '../../frontend/src/lib/data/dep-requirements';
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
    // lh3/bwa ships source tarballs only, on every platform.
    for (const platform of ['macos', 'linux', 'windows'] as const) {
      for (const arch of ['arm64', 'x86_64'] as const) {
        expect(getRelease('bwa', platform, arch)).toBeNull();
      }
    }
  });

  /**
   * bwa-mem2 was advertised here for two months under its own name while every
   * caller, and the dependency catalogue, asked for `bwa`. The Install button
   * was therefore attached to a name nothing would ever resolve: it could not
   * have worked, and no test noticed, because each half was self-consistent.
   *
   * A managed release is only reachable through a declared requirement, so
   * requiring the key to exist in that catalogue is what makes the entry real.
   */
  it('only advertises binaries the dependency catalogue actually declares', () => {
    const declared = new Set(
      Object.values(DEP_REQUIREMENTS).map((requirement) => requirement.binary),
    );
    for (const binary of Object.keys(BINARY_RELEASES)) {
      expect(declared).toContain(binary);
    }
  });
});
