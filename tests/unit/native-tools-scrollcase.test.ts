/** Contract checks for the single signed Scrollcase box carrying Native Tools. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  NATIVE_TOOLS_BOX_TOOL_IDS,
  isProvidedByNativeToolsBox,
  nativeToolsBoxPlacement,
} from '../../packages/liatir-core/src/native-tools';
import { DEP_REQUIREMENTS } from '../../frontend/src/lib/data/dep-requirements';
import { versionGte } from '../../frontend/src/lib/utils/versions';

const targets = [
  { targetId: 'macos-aarch64-cpu', subdir: 'osx-arm64' },
  { targetId: 'linux-x86_64-cpu', subdir: 'linux-64' },
] as const;
const scrollRoot = new URL('../../runtime-boxes/scrolls/native-tools/', import.meta.url);
const metadata = JSON.parse(readFileSync(
  new URL('../../runtime-boxes/native-tools/native-tools.json', import.meta.url),
  'utf8',
));
/**
 * Reads a source file with its line endings normalised.
 *
 * These assertions anchor on multi-line snippets. `.rs` and `.ts` carry no `eol=lf` rule, so a
 * Windows checkout gets CRLF and a `\n` in an expected string silently stops matching — the
 * assertion then fails for the platform rather than for the thing it guards.
 */
function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
}

const resolver = source('../../src-tauri/src/bridge/native_tools.rs');
const builder = source('../../scripts/build-native-tools-box.mjs');
const wslConsumer = source('../../tools/native-tools-box-consumer/src/main.rs');
const rustBuild = source('../../src-tauri/build.rs');
const selfTest = readFileSync(
  new URL('../../runtime-boxes/native-tools/native-tools-self-test.py', import.meta.url),
  'utf8',
);

function manifest(targetId: string): string {
  return readFileSync(new URL(`${targetId}/pixi.toml`, scrollRoot), 'utf8');
}

function lock(targetId: string): string {
  return readFileSync(new URL(`${targetId}/pixi.lock`, scrollRoot), 'utf8');
}

function scroll(targetId: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`${targetId}/scroll.json`, scrollRoot), 'utf8'));
}

function sha256(contents: string | Buffer): string {
  const canonical = Buffer.isBuffer(contents)
    ? Buffer.from(contents.toString('utf8').replace(/\r\n/gu, '\n'))
    : contents.replace(/\r\n/gu, '\n');
  return createHash('sha256').update(canonical).digest('hex');
}

function authoringRevision(): string {
  const hash = createHash('sha256');
  for (const relative of [
    '../../runtime-boxes/native-tools/native-tools.json',
    '../../runtime-boxes/native-tools/native-tools-self-test.py',
  ]) {
    hash.update(readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/gu, '\n'));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

type BoxTool = { id: string; version: string; package?: string };

/** The conda package each tool is installed from, which is its own name unless recorded. */
function toolPackage(tool: BoxTool): string {
  return tool.package ?? tool.id;
}

/** Declared packages that are not tools: the interpreter, and h5repack's Blosc decoder. */
const SUPPORT_PACKAGES = ['python', 'hdf5plugin'];

function manifestTools(contents: string): string[] {
  const section = contents.split(/^\[dependencies\]$/m)[1] ?? '';
  return [...section.matchAll(/^([A-Za-z0-9_.-]+) = /gm)]
    .map((match) => match[1])
    .filter((name) => !SUPPORT_PACKAGES.includes(name));
}

function lockedVersion(contents: string, subdir: string, tool: string): string | null {
  return contents.match(
    new RegExp(`/${subdir}/${tool}-([^-]+)-[^/]*\\.(?:conda|tar\\.bz2)`),
  )?.[1] ?? null;
}

describe('Native Tools Scrollcase box', () => {
  it('authors one box with exactly the supported target matrix', () => {
    expect(nativeToolsBoxPlacement('windows', 'x86_64')).toEqual({
      targetId: 'linux-x86_64-cpu',
      execution: 'wsl2',
    });
    expect(nativeToolsBoxPlacement('macos', 'arm64')).toEqual({
      targetId: 'macos-aarch64-cpu',
      execution: 'native',
    });
    expect(nativeToolsBoxPlacement('linux', 'x86_64')).toEqual({
      targetId: 'linux-x86_64-cpu',
      execution: 'native',
    });
    expect(nativeToolsBoxPlacement('macos', 'x86_64')).toBeNull();
  });

  it('declares exactly the process-backed tools in every scroll and in Rust', () => {
    const packages = (metadata.tools as BoxTool[]).map(toolPackage).sort();
    for (const { targetId } of targets) {
      expect(manifestTools(manifest(targetId)).sort()).toEqual(packages);
    }
    const declared = resolver.match(/BUNDLED_TOOLS: \[&str; \d+\]\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
    expect([...declared.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(
      [...NATIVE_TOOLS_BOX_TOOL_IDS].sort(),
    );
    expect(metadata.tools.map((tool: { id: string }) => tool.id).sort()).toEqual(
      [...NATIVE_TOOLS_BOX_TOOL_IDS].sort(),
    );
  });

  it('pins every recorded tool version on both targets and satisfies product minimums', () => {
    for (const { targetId, subdir } of targets) {
      const contents = lock(targetId);
      expect(contents).not.toContain('\r');
      for (const tool of metadata.tools as BoxTool[]) {
        const pinned = lockedVersion(contents, subdir, toolPackage(tool));
        expect(pinned, `${tool.id} on ${targetId}`).toBe(tool.version);
        expect(
          versionGte(pinned!, DEP_REQUIREMENTS[tool.id].minVersion),
          `${tool.id} ${pinned} on ${targetId} is below ${DEP_REQUIREMENTS[tool.id].minVersion}`,
        ).toBe(true);
      }
    }
  });

  it('uses Scrollcase for build, signing, verification and native extraction', () => {
    expect(builder).toContain("publishedNodeCliInvocation('scrollcase'");
    expect(builder).toContain("const NAMESPACE = 'liatir.native-tools'");
    expect(builder).toContain("'keygen'");
    expect(builder).toContain("'build'");
    expect(builder).toContain("'verify'");
    expect(builder).toContain('.release.json');
    expect(builder).toContain('.zip');
    expect(builder).not.toContain('.tar.gz');
    expect(builder).not.toContain('.metadata.json');

    expect(resolver).toContain('verify_and_extract_box');
    expect(resolver).toContain('verify_extracted_payload');
    expect(resolver).toContain('inspect_release_document');
    expect(resolver).toContain('EMBEDDED_WSL_CONSUMER_SHA256');
    expect(rustBuild).toContain('Sha256::digest(bytes)');
    expect(rustBuild).toContain('native-tools-box-consumer');
    expect(resolver).not.toContain('Command::new("tar")');
    expect(wslConsumer).toContain('scrollcase_consumer');
    expect(wslConsumer).toContain('verify_and_extract_box');
  });

  it('binds metadata and the executable self-test into every scroll', () => {
    for (const { targetId } of targets) {
      const authored = scroll(targetId);
      expect(authored.schemaVersion).toBe(3);
      expect(authored.boxId).toBe('native-tools');
      expect(authored.labels.runtime).toBe('native-tools');
      expect(authored.sourceRevision).toBe(authoringRevision());
      expect(authored.selfTest.code).toContain('native-tools-self-test.py');
      expect(authored.localFiles.map((file: { relativePath: string }) => file.relativePath))
        .toEqual(['native-tools.json', 'native-tools-self-test.py']);
      for (const file of authored.localFiles as { sourcePath: string; sha256: string }[]) {
        expect(file.sha256).toBe(sha256(readFileSync(new URL(`../../${file.sourcePath}`, import.meta.url))));
      }
    }
    for (const tool of NATIVE_TOOLS_BOX_TOOL_IDS) {
      expect(selfTest).toContain(`"${tool}"`);
      for (const { targetId } of targets) {
        expect(scroll(targetId).selfTest.files).toContain(`venv/bin/${tool}`);
      }
    }
    // piscem is in the box as simpleaf's mapping engine and is never launched on its own.
    // It is not a declared tool, so only the file check can notice it going missing.
    for (const { targetId } of targets) {
      expect(scroll(targetId).selfTest.files).toContain('venv/bin/piscem');
    }
  });

  it('points h5repack at the Blosc decoder the self-test repacks through', () => {
    const directory = resolver.match(/HDF5_PLUGIN_DIR: &str = "([^"]+)";/)?.[1];
    expect(directory).toBeDefined();
    expect(selfTest).toContain(`ROOT / "${directory}"`);
    // The directory names the interpreter's version, so it holds only while the pin does.
    const python = directory!.match(/\/python(\d+\.\d+)\//)?.[1];
    for (const { targetId } of targets) {
      expect(manifest(targetId)).toContain(`python = "${python}.`);
    }
  });

  it('reports only box-provided tools as included', () => {
    expect(isProvidedByNativeToolsBox('samtools', 'macos', 'arm64')).toBe(true);
    expect(isProvidedByNativeToolsBox('samtools', 'windows', 'x86_64')).toBe(true);
    expect(isProvidedByNativeToolsBox('samtools', 'linux', 'x86_64')).toBe(true);
    expect(isProvidedByNativeToolsBox('fastqc', 'macos', 'arm64')).toBe(false);
    expect(isProvidedByNativeToolsBox('snpeff', 'macos', 'arm64')).toBe(false);
  });

  it('retains the verified archive digest after passing it to the WSL2 consumer', () => {
    expect(resolver).toContain('mapped[3].clone(),\n                digest.clone(),');
    expect(resolver).toContain('= Some(digest);');
  });
});
