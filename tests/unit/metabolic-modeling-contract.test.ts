import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METABOLIC_OPTIONS,
  LIATIR_TOOL_RUNTIME_CATALOG,
  METABOLIC_ANALYSES,
  METABOLIC_MODELING_BOX_ID,
  METABOLIC_MODELING_INTERPRETATION_NOTICE,
  METABOLIC_MODELING_RELEASE_CANDIDATE_METADATA,
  METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
  METABOLIC_MODELING_RUNTIME_ID,
  parseFluxBoundChanges,
  validateMetabolicOptions,
} from '@liatir/core';
import { METABOLIC_MODELING_SCRIPT } from '../../frontend/src/lib/tools/metabolic-modeling/python-scripts/metabolic';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

const scroll = JSON.parse(readFileSync(
  new URL('../../runtime-boxes/scrolls/metabolic-modeling/linux-x86_64-cpu/scroll.json', import.meta.url),
  'utf8',
));

/** The quoted strings of one Python assignment in the runner, in order. */
function pythonStrings(name: string): string[] {
  const match = new RegExp(`^${name} = ([\\s\\S]*?)\\n(?=\\S)`, 'mu').exec(METABOLIC_MODELING_SCRIPT);
  if (!match) throw new Error(`${name} is not in the runner`);
  return [...match[1].matchAll(/"([^"]*)"/gu)].map((item) => item[1]);
}

describe('metabolic modeling contract', () => {
  it('accepts its own defaults', () => {
    expect(validateMetabolicOptions(DEFAULT_METABOLIC_OPTIONS)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('refuses inverted, repeated and unbounded bounds and an impossible fraction', () => {
    const result = validateMetabolicOptions({
      ...DEFAULT_METABOLIC_OPTIONS,
      fractionOfOptimum: 1.5,
      bounds: [
        { reaction: 'EX_glc__D_e', lower: 5, upper: -5 },
        { reaction: 'EX_glc__D_e', lower: -10, upper: 0 },
        { reaction: 'ATPM', lower: Number.POSITIVE_INFINITY, upper: 0 },
      ],
    });
    expect(result.errors).toEqual([
      'The fraction of the optimum must be between 0 and 1.',
      'The lower bound of EX_glc__D_e exceeds its upper bound.',
      'The bounds of EX_glc__D_e are changed twice.',
      'The bounds of ATPM must be finite and within ±1,000,000.',
    ]);
  });

  it('reads bound changes written one per line', () => {
    expect(parseFluxBoundChanges('EX_glc__D_e -10 1000\n\n  EX_o2_e, 0, 1000 ')).toEqual([
      { reaction: 'EX_glc__D_e', lower: -10, upper: 1000 },
      { reaction: 'EX_o2_e', lower: 0, upper: 1000 },
    ]);
    expect(() => parseFluxBoundChanges('EX_glc__D_e -10')).toThrow('Bound line 1 must read: reaction lower upper.');
  });

  it('says exactly what the runner says and offers exactly what it runs', () => {
    expect(pythonStrings('SCIENTIFIC_NOTICE').join('')).toBe(METABOLIC_MODELING_INTERPRETATION_NOTICE);
    expect(pythonStrings('ANALYSES')).toEqual([...METABOLIC_ANALYSES]);
  });
});

describe('metabolic modeling release candidate', () => {
  const metadata = METABOLIC_MODELING_RELEASE_CANDIDATE_METADATA;

  it('matches the signed scroll exactly, as the installer requires', () => {
    expect(scroll.boxId).toBe(METABOLIC_MODELING_BOX_ID);
    expect(scroll.labels).toEqual({ model: METABOLIC_MODELING_RUNTIME_COMPONENT_ID, runtime: METABOLIC_MODELING_RUNTIME_ID });
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
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).not.toContain(METABOLIC_MODELING_RUNTIME_COMPONENT_ID);
    expect(resolveRuntimeBoxReleaseCandidate(METABOLIC_MODELING_RUNTIME_COMPONENT_ID))
      .toEqual({ kind: 'tool-runtime', metadata });
  });
});
