import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BIOCHEMICAL_BUILTIN_MODELS,
  BIOCHEMICAL_MAX_PARAMETER_CHANGES,
  BIOCHEMICAL_MAX_POINTS,
  BIOCHEMICAL_MAX_RUNS,
  BIOCHEMICAL_MAX_SEED,
  BIOCHEMICAL_SIMULATION_BOX_ID,
  BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE,
  BIOCHEMICAL_SIMULATION_RELEASE_CANDIDATE_METADATA,
  BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
  BIOCHEMICAL_SIMULATION_RUNTIME_ID,
  DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS,
  LIATIR_TOOL_RUNTIME_CATALOG,
  parseParameterChanges,
  validateBiochemicalSimulationOptions,
} from '@liatir/core';
import { BIOCHEMICAL_SIMULATION_SCRIPT } from '../../frontend/src/lib/tools/biochemical-simulation/python-scripts/biochemical';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

const scroll = JSON.parse(readFileSync(
  new URL('../../runtime-boxes/scrolls/biochemical-simulation/linux-x86_64-cpu/scroll.json', import.meta.url),
  'utf8',
));

/** The quoted strings of one Python assignment in the runner, in order. */
function pythonStrings(name: string): string[] {
  const match = new RegExp(`^${name} = ([\\s\\S]*?)\\n(?=\\S)`, 'mu').exec(BIOCHEMICAL_SIMULATION_SCRIPT);
  if (!match) throw new Error(`${name} is not in the runner`);
  return [...match[1].matchAll(/"([^"]*)"/gu)].map((item) => item[1]);
}

function pythonInteger(name: string): number {
  const match = new RegExp(`^${name} = ([0-9_]+)$`, 'mu').exec(BIOCHEMICAL_SIMULATION_SCRIPT);
  if (!match) throw new Error(`${name} is not an integer in the runner`);
  return Number(match[1].replaceAll('_', ''));
}

describe('biochemical simulation contract', () => {
  it('accepts its own defaults', () => {
    expect(validateBiochemicalSimulationOptions(DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS))
      .toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('refuses log-spaced stochastic runs, a seed that overflows, and repeated or unnamed parameters', () => {
    const result = validateBiochemicalSimulationOptions({
      ...DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS,
      method: 'ssa',
      spacing: 'log',
      runs: 10,
      seed: BIOCHEMICAL_MAX_SEED,
      parameters: [{ name: 'k', value: 1 }, { name: 'k', value: 2 }, { name: '', value: Number.NaN }],
    });
    expect(result.errors).toEqual([
      'Stochastic runs report evenly spaced times; choose linear spacing.',
      `The seed must be a whole number from 1 to ${BIOCHEMICAL_MAX_SEED - 9}, so that every run's seed fits.`,
      'The parameter k is changed twice.',
      'Every parameter change needs a name.',
      'The new value of a parameter must be a finite number.',
    ]);
  });

  it('refuses tolerances and output points outside what the runner integrates', () => {
    const result = validateBiochemicalSimulationOptions({
      ...DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS, tEnd: 0, points: 1.5, spacing: 'log', tFirst: 200, rtol: 0.5, atol: 0,
    });
    expect(result.errors).toEqual([
      'The end time must be positive and at most 1000000000000.',
      'Output points must be a whole number from 2 to 10,001.',
      'The first output time of a log-spaced series must lie between zero and the end time.',
      'The relative tolerance must be between 1e-14 and 1e-3.',
      'The absolute tolerance must be between 1e-30 and 1e-3.',
    ]);
  });

  it('reads parameter changes written one per line', () => {
    expect(parseParameterChanges('kA_syn 2\n\n  kA_deg = 0.5 ')).toEqual([
      { name: 'kA_syn', value: 2 },
      { name: 'kA_deg', value: 0.5 },
    ]);
    expect(() => parseParameterChanges('kA_syn')).toThrow('Parameter line 1 must read: name value.');
  });

  it('says exactly what the runner says and offers exactly what it runs, within its limits', () => {
    expect(pythonStrings('SCIENTIFIC_NOTICE').join('')).toBe(BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE);
    const builtins = pythonStrings('BUILTIN_MODELS');
    expect(Object.fromEntries(builtins.flatMap((value, index) => (index % 2 ? [] : [[value, builtins[index + 1]]]))))
      .toEqual(BIOCHEMICAL_BUILTIN_MODELS);
    expect(pythonInteger('MAX_POINTS')).toBe(BIOCHEMICAL_MAX_POINTS);
    expect(pythonInteger('MAX_RUNS')).toBe(BIOCHEMICAL_MAX_RUNS);
    expect(pythonInteger('MAX_SEED')).toBe(BIOCHEMICAL_MAX_SEED);
    expect(pythonInteger('MAX_OVERRIDES')).toBe(BIOCHEMICAL_MAX_PARAMETER_CHANGES);
  });
});

describe('biochemical simulation release candidate', () => {
  const metadata = BIOCHEMICAL_SIMULATION_RELEASE_CANDIDATE_METADATA;

  it('matches the signed scroll exactly, as the installer requires', () => {
    expect(scroll.boxId).toBe(BIOCHEMICAL_SIMULATION_BOX_ID);
    expect(scroll.labels).toEqual({ model: BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID, runtime: BIOCHEMICAL_SIMULATION_RUNTIME_ID });
    expect(metadata.install.runtimeBox.boxId).toBe(scroll.boxId);
    expect(metadata.install.runtimeId).toBe(scroll.labels.runtime);
    expect(metadata.install.runtimeBox.publishedTargets).toEqual([{
      target: scroll.target,
      hostEnvironments: scroll.compatibility.hostEnvironments,
      minRamGb: scroll.compatibility.minRamGb,
    }]);
    expect(metadata.hardware?.minRamGb).toBe(scroll.compatibility.minRamGb);
  });

  it('is in the product catalog, its target published', () => {
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).toContain(BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID);
    expect(resolveRuntimeBoxReleaseCandidate(BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID))
      .toEqual({ kind: 'tool-runtime', metadata });
  });
});
