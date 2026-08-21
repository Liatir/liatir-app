/**
 * The bundled Native Tools environment is described in four places that cannot
 * see each other: the pixi manifest that builds it, the lock that pins it, the
 * TypeScript contract the UI reads, and the Rust list the Jobs resolver uses. A
 * tool present in three of them and missing from the fourth produces no error —
 * it produces an application that silently falls back to whatever is on the
 * user's PATH, which is the exact situation bundling exists to end.
 *
 * These tests are the only thing holding those four in agreement.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BUNDLED_ENVIRONMENT_TOOL_IDS,
  isProvidedByBundledEnvironment,
  nativeToolsPlacement,
} from '../../packages/liatir-core/src/native-tools';
import { DEP_REQUIREMENTS } from '../../frontend/src/lib/data/dep-requirements';
import { versionGte } from '../../frontend/src/lib/utils/versions';

const manifest = readFileSync(new URL('../../native-tools-env/pixi.toml', import.meta.url), 'utf8');
const lock = readFileSync(new URL('../../native-tools-env/pixi.lock', import.meta.url), 'utf8');
const resolver = readFileSync(
  new URL('../../src-tauri/src/bridge/native_tools.rs', import.meta.url),
  'utf8',
);
const builder = readFileSync(
  new URL('../../scripts/build-native-tools-env.mjs', import.meta.url),
  'utf8',
);

/** Tool names declared in the manifest's `[dependencies]` table. */
function manifestTools(): string[] {
  const section = manifest.split(/^\[dependencies\]$/m)[1] ?? '';
  return [...section.matchAll(/^([A-Za-z0-9_.-]+) = /gm)].map((match) => match[1]);
}

function manifestPlatforms(): string[] {
  const match = manifest.match(/^platforms = \[(.*)\]$/m);
  return [...(match?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/** The version the lock pins for a tool on one platform. */
function lockedVersion(subdir: string, tool: string): string | null {
  return lock.match(new RegExp(`/${subdir}/${tool}-([^-]+)-[^/]*\\.(?:conda|tar\\.bz2)`))?.[1] ?? null;
}

describe('bundled Native Tools environment', () => {
  it('builds exactly the tools the contract claims it provides', () => {
    expect(manifestTools().sort()).toEqual([...BUNDLED_ENVIRONMENT_TOOL_IDS].sort());
  });

  it('lists the same tools in the Rust resolver', () => {
    const declared = resolver.match(/BUNDLED_TOOLS: \[&str; \d+\] = \[([\s\S]*?)\];/)?.[1] ?? '';
    const tools = [...declared.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(tools.sort()).toEqual([...BUNDLED_ENVIRONMENT_TOOL_IDS].sort());
  });

  it('declares no win-64 environment, because bioconda does not build one', () => {
    // Windows gets the linux-64 environment through WSL2. A win-64 platform
    // appearing here would mean someone tried to solve an environment that
    // cannot exist, and the failure would surface as an unrelated solve error.
    expect(manifestPlatforms()).not.toContain('win-64');
    expect(nativeToolsPlacement('windows', 'x86_64')).toEqual({
      subdir: 'linux-64',
      execution: 'wsl2',
    });
    expect(nativeToolsPlacement('macos', 'arm64')).toEqual({
      subdir: 'osx-arm64',
      execution: 'native',
    });
  });

  it('pins every tool on every platform it ships', () => {
    for (const subdir of manifestPlatforms()) {
      for (const tool of BUNDLED_ENVIRONMENT_TOOL_IDS) {
        expect(lockedVersion(subdir, tool), `${tool} on ${subdir}`).not.toBeNull();
      }
    }
  });

  it('pins versions that satisfy what the product declares it needs', () => {
    // The manifest's ranges are a lower bound; the lock is what actually
    // installs. Only the lock can be checked against `dep-requirements.ts`.
    for (const subdir of manifestPlatforms()) {
      for (const tool of BUNDLED_ENVIRONMENT_TOOL_IDS) {
        const requirement = DEP_REQUIREMENTS[tool];
        expect(requirement, `${tool} has no dependency requirement`).toBeTruthy();
        const pinned = lockedVersion(subdir, tool)!;
        expect(
          versionGte(pinned, requirement.minVersion),
          `${tool} ${pinned} on ${subdir} is below the declared minimum ${requirement.minVersion}`,
        ).toBe(true);
      }
    }
  });

  it('names the unpacked environment after the archive, not the lock', () => {
    // The lock pins tool *versions*; the archive is the bytes those versions were
    // packed into. Change what the build packs — pruning, layout — and the archive
    // digest moves while the lock digest does not. Keying the directory on the lock
    // therefore leaves an older release's completion marker in place, and the
    // application goes on running the environment that release unpacked instead of
    // the one it shipped. The build has to write the field the resolver reads.
    expect(builder).toContain('archiveSha256');
    expect(resolver).toContain('archiveSha256');
    // If a future change wants to *show* the lock digest somewhere, that is fine —
    // but it must not come back as the name of the directory, so change this
    // deliberately rather than by accident.
    expect(resolver).not.toContain('lockDigest');
  });

  it('keeps the lock byte-identical on a Windows checkout too', () => {
    // Two failures at once if Git for Windows is allowed to rewrite this file:
    // the build finds a platform by an exact `      linux-64:` line, which a
    // trailing CR turns into "no linux-64 environment"; and the lock's sha256
    // names the directory the environment unpacks into, so a CRLF checkout would
    // build an archive whose identity disagrees with the one Linux and macOS
    // build from the same lock. Every other test here uses line-tolerant regexes
    // and would keep passing through both. Pinned in `.gitattributes`.
    expect(lock).not.toContain('\r');
    expect(manifest).not.toContain('\r');
  });

  it('is reported as bundled on every platform that has an environment', () => {
    expect(isProvidedByBundledEnvironment('samtools', 'macos', 'arm64')).toBe(true);
    expect(isProvidedByBundledEnvironment('samtools', 'windows', 'x86_64')).toBe(true);
    expect(isProvidedByBundledEnvironment('samtools', 'linux', 'x86_64')).toBe(true);
    // FastQC runs as WASM in-process and SnpEff is a Java runtime, so neither is
    // in the environment and neither may claim to be.
    expect(isProvidedByBundledEnvironment('fastqc', 'macos', 'arm64')).toBe(false);
    expect(isProvidedByBundledEnvironment('snpeff', 'macos', 'arm64')).toBe(false);
    // No environment is built for macOS x86_64 yet, so nothing there is bundled.
    expect(isProvidedByBundledEnvironment('samtools', 'macos', 'x86_64')).toBe(false);
  });
});
