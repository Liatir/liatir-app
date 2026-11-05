import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GNINA_BOX_ID,
  GNINA_INTERPRETATION_NOTICE,
  GNINA_RELEASE_CANDIDATE_METADATA,
  GNINA_RUNTIME_COMPONENT_ID,
  GNINA_RUNTIME_ID,
  LIATIR_TOOL_RUNTIME_CATALOG,
} from '@liatir/core';
import { GNINA_SCRIPT } from '../../frontend/src/lib/tools/gnina/python-scripts/gnina';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const scroll = JSON.parse(read('runtime-boxes/scrolls/gnina/linux-x86_64-cuda12.8/scroll.json'));
const selfTest = read('runtime-boxes/scrolls/gnina/self-test.py');

/** The quoted strings of one Python assignment, in order. */
function pythonStrings(source: string, name: string): string[] {
  const match = new RegExp(`^${name} = ([\\s\\S]*?)\\n(?=\\S)`, 'mu').exec(source);
  if (!match) throw new Error(`${name} is not in the script`);
  return [...match[1].matchAll(/"([^"]*)"/gu)].map((item) => item[1]);
}

function pythonInteger(source: string, name: string): number {
  const match = new RegExp(`^${name} = ([0-9_]+)$`, 'mu').exec(source);
  if (!match) throw new Error(`${name} is not an integer in the script`);
  return Number(match[1].replaceAll('_', ''));
}

describe('GNINA contract', () => {
  const binary = scroll.assets.find((asset: { relativePath: string }) => asset.relativePath === 'gnina/bin/gnina');

  it('says exactly what the runner says', () => {
    expect(pythonStrings(GNINA_SCRIPT, 'SCIENTIFIC_NOTICE').join('')).toBe(GNINA_INTERPRETATION_NOTICE);
  });

  it('defers GNINA to its own release, never into the box, and runs that exact file', () => {
    expect(binary).toEqual({
      url: 'https://github.com/gnina/gnina/releases/download/v1.3.3/gnina.cuda12.8.static',
      relativePath: 'gnina/bin/gnina',
      sizeBytes: 2_056_131_000,
      sha256: '3340c1f49cd3c7c84d8699182a1c6af13c7fa2a22448d1204640446106f72172',
      embed: false,
      executable: true,
    });
    expect(pythonStrings(GNINA_SCRIPT, 'EXECUTABLE')).toEqual([binary.relativePath]);
    expect(pythonStrings(GNINA_SCRIPT, 'EXECUTABLE_SHA256')).toEqual([binary.sha256]);
    expect(pythonInteger(GNINA_SCRIPT, 'EXECUTABLE_BYTES')).toBe(binary.sizeBytes);
    // Every other asset is reference data, packed into the box.
    expect(scroll.assets.filter((asset: { embed?: boolean }) => asset.embed === false)).toEqual([binary]);
  });

  it('preloads the same libraries in the runner and in the self-test, and starts the same build', () => {
    expect(pythonStrings(GNINA_SCRIPT, 'PRELOADED_LIBRARIES')).toEqual(pythonStrings(selfTest, 'PRELOADED_LIBRARIES'));
    expect(pythonStrings(GNINA_SCRIPT, 'GNINA_BUILD')).toEqual(pythonStrings(selfTest, 'GNINA_BUILD'));
  });
});

describe('GNINA release candidate', () => {
  const metadata = GNINA_RELEASE_CANDIDATE_METADATA;

  it('matches the signed scroll exactly, as the installer requires', () => {
    expect(scroll.boxId).toBe(GNINA_BOX_ID);
    expect(scroll.labels).toEqual({ model: GNINA_RUNTIME_COMPONENT_ID, runtime: GNINA_RUNTIME_ID });
    expect(metadata.install.runtimeBox.boxId).toBe(scroll.boxId);
    expect(metadata.install.runtimeId).toBe(scroll.labels.runtime);
    expect(metadata.install.runtimeBox.publishedTargets).toEqual([{
      target: scroll.target,
      hostEnvironments: scroll.compatibility.hostEnvironments,
      minRamGb: scroll.compatibility.minRamGb,
      minNvidiaDriverVersion: scroll.compatibility.minNvidiaDriverVersion,
    }]);
    // The floor decided in .context/decisions/gnina-cuda-driver-floor.md.
    expect(scroll.compatibility.minNvidiaDriverVersion).toBe('570.26');
    expect(metadata.hardware?.minRamGb).toBe(scroll.compatibility.minRamGb);
  });

  it('is in the product catalog, its target published', () => {
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).toContain(GNINA_RUNTIME_COMPONENT_ID);
    expect(resolveRuntimeBoxReleaseCandidate(GNINA_RUNTIME_COMPONENT_ID)).toEqual({ kind: 'tool-runtime', metadata });
  });
});
