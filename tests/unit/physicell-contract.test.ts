import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHYSICELL_OPTIONS,
  LIATIR_TOOL_RUNTIME_CATALOG,
  PHYSICELL_BOX_ID,
  PHYSICELL_INTERPRETATION_NOTICE,
  PHYSICELL_MAX_SEED,
  PHYSICELL_MAX_TIME_MIN,
  PHYSICELL_RELEASE_CANDIDATE_METADATA,
  PHYSICELL_RUNTIME_COMPONENT_ID,
  PHYSICELL_RUNTIME_ID,
  validatePhysiCellOptions,
} from '@liatir/core';
import { PHYSICELL_SCRIPT } from '../../frontend/src/lib/tools/physicell/python-scripts/physicell';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

const scroll = JSON.parse(readFileSync(
  new URL('../../runtime-boxes/scrolls/physicell/linux-x86_64-cpu/scroll.json', import.meta.url),
  'utf8',
));

/** The quoted strings of one Python assignment in the runner, in order. */
function pythonStrings(name: string): string[] {
  const match = new RegExp(`^${name} = ([\\s\\S]*?)\\n(?=\\S)`, 'mu').exec(PHYSICELL_SCRIPT);
  if (!match) throw new Error(`${name} is not in the runner`);
  return [...match[1].matchAll(/"([^"]*)"/gu)].map((item) => item[1]);
}

function pythonInteger(name: string): number {
  const match = new RegExp(`^${name} = ([0-9_]+)$`, 'mu').exec(PHYSICELL_SCRIPT);
  if (!match) throw new Error(`${name} is not an integer in the runner`);
  return Number(match[1].replaceAll('_', ''));
}

describe('PhysiCell contract', () => {
  it('accepts its own defaults', () => {
    expect(validatePhysiCellOptions(DEFAULT_PHYSICELL_OPTIONS, 4)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('refuses a time, seed or thread count the runner would refuse', () => {
    expect(validatePhysiCellOptions({ maxTime: 0, seed: -1, threads: 9 }, 8).errors).toEqual([
      'Simulated time must be positive and at most 100,000 minutes.',
      `The seed must be a whole number from 0 to ${PHYSICELL_MAX_SEED}.`,
      'Threads must be a whole number from 1 to 8.',
    ]);
  });

  it('says exactly what the runner says and holds the same limits', () => {
    expect(pythonStrings('SCIENTIFIC_NOTICE').join('')).toBe(PHYSICELL_INTERPRETATION_NOTICE);
    expect(pythonInteger('MAX_SEED')).toBe(PHYSICELL_MAX_SEED);
    expect(pythonInteger('MAX_TIME_MIN')).toBe(PHYSICELL_MAX_TIME_MIN);
  });

  it('runs the executable the scroll ships, pinned by the same hash', () => {
    const [asset] = scroll.assets;
    expect(pythonStrings('EXECUTABLE')).toEqual([asset.relativePath]);
    expect(pythonStrings('EXECUTABLE_SHA256')).toEqual([asset.sha256]);
    expect(asset.executable).toBe(true);
  });
});

describe('PhysiCell release candidate', () => {
  const metadata = PHYSICELL_RELEASE_CANDIDATE_METADATA;

  it('matches the signed scroll exactly, as the installer requires', () => {
    expect(scroll.boxId).toBe(PHYSICELL_BOX_ID);
    expect(scroll.labels).toEqual({ model: PHYSICELL_RUNTIME_COMPONENT_ID, runtime: PHYSICELL_RUNTIME_ID });
    expect(metadata.install.runtimeBox.boxId).toBe(scroll.boxId);
    expect(metadata.install.runtimeId).toBe(scroll.labels.runtime);
    expect(metadata.install.runtimeBox.publishedTargets).toEqual([{
      target: scroll.target,
      hostEnvironments: scroll.compatibility.hostEnvironments,
      minRamGb: scroll.compatibility.minRamGb,
    }]);
    expect(metadata.hardware?.minRamGb).toBe(scroll.compatibility.minRamGb);
  });

  it('stays out of the product until a target is published', () => {
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).not.toContain(PHYSICELL_RUNTIME_COMPONENT_ID);
    expect(resolveRuntimeBoxReleaseCandidate(PHYSICELL_RUNTIME_COMPONENT_ID)).toEqual({ kind: 'tool-runtime', metadata });
  });
});
