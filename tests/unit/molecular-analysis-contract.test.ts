import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERACTION_FINGERPRINT_OPTIONS,
  DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS,
  LIATIR_TOOL_RUNTIME_CATALOG,
  MOLECULAR_ANALYSIS_BOX_ID,
  MOLECULAR_ANALYSIS_INTERPRETATION_NOTICE,
  MOLECULAR_ANALYSIS_RELEASE_CANDIDATE_METADATA,
  MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID,
  MOLECULAR_ANALYSIS_RUNTIME_ID,
  PROLIF_DEFAULT_INTERACTIONS,
  PROLIF_OFFERED_INTERACTIONS,
  validateInteractionFingerprintOptions,
  validateTrajectoryAnalysisOptions,
} from '@liatir/core';
import { MOLECULAR_ANALYSIS_SCRIPT } from '../../frontend/src/lib/tools/molecular-analysis/python-scripts/analysis';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';

const scroll = JSON.parse(readFileSync(
  new URL('../../runtime-boxes/scrolls/molecular-analysis/linux-x86_64-cpu/scroll.json', import.meta.url),
  'utf8',
));

/** The quoted strings of one Python assignment in the runner, in order. */
function pythonStrings(name: string): string[] {
  const match = new RegExp(`^${name} = ([\\s\\S]*?)\\n(?=\\S)`, 'mu').exec(MOLECULAR_ANALYSIS_SCRIPT);
  if (!match) throw new Error(`${name} is not in the runner`);
  return [...match[1].matchAll(/"([^"]*)"/gu)].map((item) => item[1]);
}

describe('molecular analysis contract', () => {
  it('accepts its own defaults', () => {
    expect(validateTrajectoryAnalysisOptions(DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS).valid).toBe(true);
    expect(validateInteractionFingerprintOptions(DEFAULT_INTERACTION_FINGERPRINT_OPTIONS, 'poses').valid).toBe(true);
    expect(validateInteractionFingerprintOptions(
      { ...DEFAULT_INTERACTION_FINGERPRINT_OPTIONS, ligandSelection: 'resname LIG' }, 'trajectory').valid).toBe(true);
  });

  it('rejects duplicate names, empty selections and an empty request', () => {
    const result = validateTrajectoryAnalysisOptions({
      ...DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS,
      rmsd: [{ label: 'Ligand', selection: 'resname LIG' }, { label: 'ligand', selection: ' ' }],
    });
    expect(result.errors).toEqual(['Two measurements are both named ligand.', 'RMSD ligand needs an atom selection.']);
    expect(validateTrajectoryAnalysisOptions({ ...DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS, rmsd: [], rmsf: null }).errors)
      .toEqual(['Choose at least one measurement.']);
    expect(validateTrajectoryAnalysisOptions({ ...DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS, fitSelection: 'x'.repeat(513) })
      .errors).toEqual(['The superposition is longer than 512 characters.']);
  });

  it('bounds the frame window', () => {
    expect(validateTrajectoryAnalysisOptions({ ...DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS, start: 5, stop: 5 }).errors)
      .toEqual(['The frame range must end after its first frame.']);
    expect(validateTrajectoryAnalysisOptions({ ...DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS, start: -1, stride: 0 }).errors)
      .toEqual(['The first frame must be 0 or more.', 'The frame step must be 1 or more.']);
  });

  it('needs a ligand for a trajectory and a known interaction', () => {
    expect(validateInteractionFingerprintOptions(DEFAULT_INTERACTION_FINGERPRINT_OPTIONS, 'trajectory').errors)
      .toEqual(['The ligand needs an atom selection.']);
    expect(validateInteractionFingerprintOptions(
      { ...DEFAULT_INTERACTION_FINGERPRINT_OPTIONS, interactions: ['WaterBridge' as 'HBDonor'] }, 'poses').errors)
      .toEqual(['WaterBridge is not an interaction this tool detects.']);
    expect(validateInteractionFingerprintOptions({ ...DEFAULT_INTERACTION_FINGERPRINT_OPTIONS, interactions: [] }, 'poses')
      .errors).toEqual(['Choose at least one interaction.']);
  });

  it('says exactly what the runner says and offers exactly what it accepts', () => {
    expect(pythonStrings('SCIENTIFIC_NOTICE').join('')).toBe(MOLECULAR_ANALYSIS_INTERPRETATION_NOTICE);
    expect(pythonStrings('DEFAULT_INTERACTIONS')).toEqual([...PROLIF_DEFAULT_INTERACTIONS]);
    expect([...pythonStrings('DEFAULT_INTERACTIONS'), ...pythonStrings('OFFERED_INTERACTIONS')])
      .toEqual([...PROLIF_OFFERED_INTERACTIONS]);
  });
});

describe('molecular analysis release candidate', () => {
  const metadata = MOLECULAR_ANALYSIS_RELEASE_CANDIDATE_METADATA;

  it('matches the signed scroll exactly, as the installer requires', () => {
    expect(scroll.boxId).toBe(MOLECULAR_ANALYSIS_BOX_ID);
    expect(scroll.labels).toEqual({ model: MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID, runtime: MOLECULAR_ANALYSIS_RUNTIME_ID });
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
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id)).not.toContain(MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID);
    expect(resolveRuntimeBoxReleaseCandidate(MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID))
      .toEqual({ kind: 'tool-runtime', metadata });
  });
});
