import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCKING_OPTIONS,
  DEFAULT_RECEPTOR_PREPARATION_OPTIONS,
  LIATIR_TOOL_RUNTIME_CATALOG,
  MOLECULAR_DOCKING_BOX_ID,
  MOLECULAR_DOCKING_RELEASE_CANDIDATE_METADATA,
  MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
  MOLECULAR_DOCKING_RUNTIME_ID,
  validateDockingOptions,
  validateDockingPoseRows,
  validateDockingSite,
  validateReceptorPreparationOptions,
  type LiatirDockingPoseRow,
} from '@liatir/core';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

const scroll = JSON.parse(readFileSync(
  new URL('../../runtime-boxes/scrolls/molecular-docking/linux-x86_64-cpu/scroll.json', import.meta.url),
  'utf8',
));

function pose(ligand: string, poseRank: number, scoreKcalPerMol: number): LiatirDockingPoseRow {
  return { ligand, inputIndex: 1, poseRank, scoreKcalPerMol, interKcalPerMol: scoreKcalPerMol,
    intraKcalPerMol: 0, heavyAtoms: 37, ligandEfficiency: scoreKcalPerMol / 37 };
}

describe('molecular docking contract', () => {
  it('accepts its own defaults', () => {
    expect(validateReceptorPreparationOptions(DEFAULT_RECEPTOR_PREPARATION_OPTIONS).valid).toBe(true);
    expect(validateDockingOptions(DEFAULT_DOCKING_OPTIONS).valid).toBe(true);
  });

  it('rejects malformed receptor preparation choices', () => {
    const result = validateReceptorPreparationOptions({
      ...DEFAULT_RECEPTOR_PREPARATION_OPTIONS, keepChains: ['A B'], removeResidueNames: ['STI;rm'], ph: 15,
    });
    expect(result.errors).toEqual([
      'Chain identifier "A B" is not valid.',
      'Residue name "STI;rm" is not valid.',
      'Protonation pH must be between 0 and 14.',
    ]);
  });

  it('bounds the search box and repeats Vina’s own large-volume warning', () => {
    expect(validateDockingSite({ mode: 'box', center: [15.19, 53.903, 16.917], size: [20, 20, 20] }))
      .toEqual({ valid: true, errors: [], warnings: [] });
    expect(validateDockingSite({ mode: 'box', center: [0, 0, 0], size: [127, 20, 20] }).valid).toBe(false);
    expect(validateDockingSite({ mode: 'box', center: [0, Number.NaN, 0], size: [20, 20, 20] }).valid).toBe(false);
    const large = validateDockingSite({ mode: 'box', center: [0, 0, 0], size: [31, 30, 30] });
    expect(large.valid).toBe(true);
    expect(large.warnings[0]).toContain('27,000');
    expect(validateDockingSite({ mode: 'reference-ligand', referenceLigand: '', paddingAngstrom: 5 }).valid).toBe(false);
    expect(validateDockingSite({ mode: 'reference-ligand', referenceLigand: 'x.sdf', paddingAngstrom: 31 }).valid).toBe(false);
  });

  it('bounds the search effort, seed and threads', () => {
    expect(validateDockingOptions({ ...DEFAULT_DOCKING_OPTIONS, exhaustiveness: 0 }).valid).toBe(false);
    expect(validateDockingOptions({ ...DEFAULT_DOCKING_OPTIONS, numPoses: 51 }).valid).toBe(false);
    expect(validateDockingOptions({ ...DEFAULT_DOCKING_OPTIONS, seed: 0 }).valid).toBe(false);
    expect(validateDockingOptions({ ...DEFAULT_DOCKING_OPTIONS, cpu: 8 }, 6).valid).toBe(false);
    expect(validateDockingOptions({ ...DEFAULT_DOCKING_OPTIONS, scoringFunction: 'ad4' as 'vina' }).valid).toBe(false);
  });

  it('requires poses best-first with consecutive ranks per ligand', () => {
    expect(validateDockingPoseRows([pose('STI', 1, -13.2), pose('STI', 2, -11.3)]).valid).toBe(true);
    expect(validateDockingPoseRows([pose('STI', 1, -11.3), pose('STI', 2, -13.2)]).errors)
      .toEqual(['STI pose 2 scores better than a higher-ranked pose.']);
    expect(validateDockingPoseRows([pose('STI', 2, -13.2)]).errors).toEqual(['STI pose ranks are not consecutive from 1.']);
    expect(validateDockingPoseRows([pose('STI', 1, Number.NaN)]).valid).toBe(false);
    expect(validateDockingPoseRows([]).errors).toEqual(['No docked pose was returned.']);
  });
});

describe('molecular docking release candidate', () => {
  const metadata = MOLECULAR_DOCKING_RELEASE_CANDIDATE_METADATA;

  it('matches the signed scroll exactly, as the installer requires', () => {
    expect(scroll.boxId).toBe(MOLECULAR_DOCKING_BOX_ID);
    expect(scroll.labels).toEqual({ model: MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID, runtime: MOLECULAR_DOCKING_RUNTIME_ID });
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
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).not.toContain(MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID);
    expect(resolveRuntimeBoxReleaseCandidate(MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID))
      .toEqual({ kind: 'tool-runtime', metadata });
  });
});
