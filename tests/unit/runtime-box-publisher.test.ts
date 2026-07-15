import { describe, expect, it } from 'vitest';

import { multipartPartRanges } from '../../scripts/runtime-box.mjs';
import {
  parseImmutableReleaseIdentity,
  parseMultipartArchiveIdentity,
  validateImmutableReleaseRoute,
} from '../../workers/runtime-box-registry/src/index';

describe('Runtime Box large-archive publisher', () => {
  it('splits the measured UCE archive into contiguous 64 MiB parts', () => {
    const archiveSize = 8_862_120_348;
    const ranges = multipartPartRanges(archiveSize);

    expect(ranges).toHaveLength(133);
    expect(ranges[0]).toEqual({
      partNumber: 1,
      start: 0,
      end: 67_108_863,
      sizeBytes: 67_108_864,
    });
    expect(ranges.at(-1)).toEqual({
      partNumber: 133,
      start: 8_858_370_048,
      end: 8_862_120_347,
      sizeBytes: 3_750_300,
    });
    expect(ranges.every((range, index) => index === 0 || range.start === ranges[index - 1].end + 1)).toBe(true);
  });

  it('allows only content-addressed Runtime Box archive identities', () => {
    const sha256 = 'a'.repeat(64);
    expect(parseMultipartArchiveIdentity(
      'uce-4layer',
      '1.0.0-beta.1',
      'macos-aarch64-metal',
      sha256,
    )).toEqual({
      boxId: 'uce-4layer',
      version: '1.0.0-beta.1',
      target: 'macos-aarch64-metal',
      sha256,
      key: `boxes/uce-4layer/1.0.0-beta.1/macos-aarch64-metal/${sha256}.zip`,
    });
    expect(parseMultipartArchiveIdentity('../uce', '1.0.0', 'macos-aarch64-metal', sha256)).toBeNull();
    expect(parseMultipartArchiveIdentity('uce-4layer', '1.0.0', 'macos/aarch64', sha256)).toBeNull();
    expect(parseMultipartArchiveIdentity('uce-4layer', '1.0.0', 'macos-aarch64-metal', 'not-a-hash')).toBeNull();
  });

  it('binds signed release documents to one immutable route', () => {
    const sha256 = 'b'.repeat(64);
    const identity = parseImmutableReleaseIdentity(
      'geneformer-v1-10m',
      '1.0.0-beta.1',
      'macos-aarch64-metal',
      sha256,
    );
    expect(identity).toEqual({
      boxId: 'geneformer-v1-10m',
      version: '1.0.0-beta.1',
      target: 'macos-aarch64-metal',
      sha256,
      key: `boxes/geneformer-v1-10m/1.0.0-beta.1/macos-aarch64-metal/${sha256}.release.json`,
    });
    expect(validateImmutableReleaseRoute({
      schemaVersion: 1,
      kind: 'liatir.runtime-box.release',
      boxId: 'geneformer-v1-10m',
      version: '1.0.0-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
    }, identity!)).toBe(true);
    expect(validateImmutableReleaseRoute({
      schemaVersion: 1,
      kind: 'liatir.runtime-box.release',
      boxId: 'scgpt-whole-human',
      version: '1.0.0-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
    }, identity!)).toBe(false);
    expect(parseImmutableReleaseIdentity('../geneformer', '1.0.0', 'macos-aarch64-metal', sha256)).toBeNull();
  });
});
