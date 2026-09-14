import { describe, expect, it } from 'vitest';
import {
  BOLTZ_2_MODEL_ID,
  BOLTZ_AFFINITY_MAX_LIGAND_ATOMS,
  OPENMM_RUNTIME_ID,
  OPENMM_FORCE_FIELD_ID,
  PROTENIX_MINI_DEFAULT_MODEL_ID,
  PROTENIX_V2_MODEL_ID,
  adaptBoltz2Input,
  adaptProtenixInput,
  estimateHardwareResources,
  molecularDynamicsDurationPs,
  publishedVramRequirements,
  validateMolecularDynamicsOptions,
  validateMolecularDynamicsRunOptions,
  validateOpenMMCheckpointResume,
  validateProteinLigandAffinityComplex,
  validateProteinLigandAffinityRequest,
  validateProteinLigandAffinityValues,
  validateRelaxationEnergyReduction,
  validateStructureModelRows,
  validateStructurePredictionRequest,
  type LiatirHardwareValidationProfile,
  type LiatirOpenMMCheckpointIdentity,
  type LiatirProteinLigandAffinityRequest,
  type LiatirStructurePredictionRequest,
} from '@liatir/core';

function structureRequest(): LiatirStructurePredictionRequest {
  return {
    modelId: BOLTZ_2_MODEL_ID,
    spec: {
      schemaVersion: 1,
      kind: 'liatir-complex-spec',
      entities: [
        { id: 'target', type: 'protein', sequence: 'MSTNPKPQR', msa: { format: 'a3m', path: '/data/target.a3m' } },
        { id: 'ligand', type: 'ligand', smiles: 'CC(=O)O' },
      ],
    },
    msa: { singleSequenceEntityIds: [], lowerAccuracyAccepted: false },
    seed: 7,
    modelCount: 2,
  };
}

function hardwareProfile(): LiatirHardwareValidationProfile {
  return {
    schemaVersion: 1,
    profileId: 'boltz-linux-cuda-fixtures-v1',
    componentId: BOLTZ_2_MODEL_ID,
    componentVersion: '2.2.1',
    runtimeBoxRelease: '2.2.1-beta.1',
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' },
    precision: 'bf16',
    measuredAt: '2026-09-02T00:00:00Z',
    evidenceRecord: 'runtime-boxes/measurements/boltz-linux-cuda.json',
    samples: [
      {
        fixtureId: 'small',
        workloadId: 'structure-prediction',
        maxStepCount: 200,
        maxTokenCount: 256,
        maxAtomCount: 2_000,
        maxOutputItemCount: 2,
        peakRamBytes: 4_000_000_000,
        peakVramBytes: 8_000_000_000,
        elapsedMs: 60_000,
        outputBytes: 20_000_000,
      },
      {
        fixtureId: 'large',
        workloadId: 'structure-prediction',
        maxStepCount: 200,
        maxTokenCount: 512,
        maxAtomCount: 4_000,
        maxOutputItemCount: 5,
        peakRamBytes: 8_000_000_000,
        peakVramBytes: 12_000_000_000,
        elapsedMs: 180_000,
        outputBytes: 80_000_000,
      },
    ],
  };
}

describe('Phase 3 scientific contracts', () => {
  it('refuses enormous valid-integer copy counts before allocating chain descriptors', () => {
    const request = structureRequest();
    request.spec.entities[0].copies = Number.MAX_SAFE_INTEGER;
    expect(adaptBoltz2Input(request).input).toBeNull();
    request.modelId = PROTENIX_V2_MODEL_ID;
    expect(adaptProtenixInput(request).errors.join(' ')).toMatch(/chain-description limit/);
  });
  it.each([BOLTZ_2_MODEL_ID, PROTENIX_V2_MODEL_ID, PROTENIX_MINI_DEFAULT_MODEL_ID])(
    'rejects invalid copy counts before %s allocates output chains', (modelId) => {
      const request = structureRequest();
      request.modelId = modelId;
      for (const copies of [-1, 0, 1.5, Infinity, NaN]) {
        request.spec.entities[0].copies = copies;
        const result = modelId === BOLTZ_2_MODEL_ID ? adaptBoltz2Input(request) : adaptProtenixInput(request);
        expect(result.valid).toBe(false);
        expect(result.input).toBeNull();
        expect(result.errors.join(' ')).toMatch(/copies must be a positive integer/);
      }
    },
  );

  it.each([BOLTZ_2_MODEL_ID, PROTENIX_V2_MODEL_ID, PROTENIX_MINI_DEFAULT_MODEL_ID])(
    'preserves distinct chain ownership for %s', (modelId) => {
      const request = structureRequest();
      request.modelId = modelId;
      request.spec.entities[0].copies = 2;
      request.spec.entities[1].id = 'target_1';
      const result = modelId === BOLTZ_2_MODEL_ID ? adaptBoltz2Input(request) : adaptProtenixInput(request);
      expect(result.valid).toBe(false);
      expect(result.input).toBeNull();
      expect(result.errors.join(' ')).toMatch(/conflicts with a generated copy/);
      request.spec.entities[1].id = 'target_3';
      expect(validateStructurePredictionRequest(request).valid).toBe(true);
      request.spec.entities[1].id = 'target_01';
      expect(validateStructurePredictionRequest(request).valid).toBe(true);
    },
  );

  it('requires an explicit lower-accuracy choice for every protein without local A3M', () => {
    const request = structureRequest();
    delete (request.spec.entities[0] as { msa?: unknown }).msa;

    const implicit = validateStructurePredictionRequest(request);
    expect(implicit.valid).toBe(false);
    expect(implicit.errors.join(' ')).toMatch(/explicitly select single-sequence/);

    request.msa = { singleSequenceEntityIds: ['target'], lowerAccuracyAccepted: true };
    const explicit = validateStructurePredictionRequest(request);
    expect(explicit.valid).toBe(true);
    expect(explicit.warnings.join(' ')).toMatch(/less accurate/);
  });

  it('translates local MSA, copies, templates, bonds and affinity into Boltz YAML data', () => {
    const request = structureRequest();
    request.spec.templates = [{
      id: 'template',
      entityId: 'target',
      path: '/data/template.cif',
      format: 'mmcif',
      chainId: 'X',
    }];
    request.spec.constraints = [{
      type: 'bond',
      left: { entityId: 'target', residue: 2, atom: 'CA' },
      right: { entityId: 'ligand', atom: 'C1' },
    }];
    const adapted = adaptBoltz2Input(request, 'ligand');
    expect(adapted.valid).toBe(true);
    expect(adapted.input).toMatchObject({
      version: 1,
      sequences: [
        { protein: { id: 'A', sequence: 'MSTNPKPQR', msa: '/data/target.a3m' } },
        { ligand: { id: 'B', smiles: 'CC(=O)O' } },
      ],
      constraints: [{ bond: { atom1: ['A', 2, 'CA'], atom2: ['B', 1, 'C1'] } }],
      templates: [{ cif: '/data/template.cif', chain_id: 'A', template_id: 'X' }],
      properties: [{ affinity: { binder: 'B' } }],
    });
  });

  it('uses the literal Boltz empty MSA marker only after explicit acknowledgement', () => {
    const request = structureRequest();
    delete (request.spec.entities[0] as { msa?: unknown }).msa;
    request.msa = { singleSequenceEntityIds: ['target'], lowerAccuracyAccepted: true };
    expect(adaptBoltz2Input(request).input?.sequences[0]).toEqual({
      protein: { id: 'A', sequence: 'MSTNPKPQR', msa: 'empty' },
    });
  });

  // Boltz keeps five characters of a chain name; the product editor's own id, "protein", became
  // "prote" and the real app run died on the alignment lookup the full name keyed.
  it('names Boltz chains within its five-character limit whatever the entity ids are', () => {
    const request = structureRequest();
    request.spec.entities[0].id = 'protein';
    request.spec.entities[0].copies = 2;
    delete (request.spec.entities[0] as { msa?: unknown }).msa;
    request.spec.entities[1].id = 'acetate-ligand';
    request.msa = { singleSequenceEntityIds: ['protein'], lowerAccuracyAccepted: true };
    const adapted = adaptBoltz2Input(request, 'acetate-ligand');
    expect(adapted.valid).toBe(true);
    expect(adapted.input).toMatchObject({
      sequences: [
        { protein: { id: ['A', 'B'], sequence: 'MSTNPKPQR', msa: 'empty' } },
        { ligand: { id: 'C', smiles: 'CC(=O)O' } },
      ],
      properties: [{ affinity: { binder: 'C' } }],
    });
  });

  it('translates Protenix v2 inputs and keeps Mini free of templates and ESM', () => {
    const request = structureRequest();
    request.modelId = PROTENIX_V2_MODEL_ID;
    request.spec.templates = [{
      id: 'template',
      entityId: 'target',
      path: '/data/template.hhr',
      format: 'hhr',
    }];
    const full = adaptProtenixInput(request);
    expect(full.valid).toBe(true);
    expect(full.input).toMatchObject({
      useMsa: true,
      useTemplate: true,
      document: [{
        sequences: [
          { proteinChain: {
            sequence: 'MSTNPKPQR',
            count: 1,
            id: ['target'],
            unpairedMsaPath: '/data/target.a3m',
            templatesPath: '/data/template.hhr',
          } },
          { ligand: { ligand: 'CC(=O)O', count: 1, id: ['ligand'] } },
        ],
      }],
    });

    request.modelId = PROTENIX_MINI_DEFAULT_MODEL_ID;
    const mini = adaptProtenixInput(request);
    expect(mini.valid).toBe(false);
    expect(mini.errors.join(' ')).toMatch(/does not support templates/);
    expect(JSON.stringify(mini)).not.toMatch(/esm/i);
  });

  it('rejects contact constraints for the two selected Protenix models', () => {
    const request = structureRequest();
    request.modelId = PROTENIX_V2_MODEL_ID;
    request.spec.constraints = [{
      type: 'contact',
      left: { entityId: 'target', residue: 2 },
      right: { entityId: 'ligand', atom: 'C1' },
      maxDistanceAngstrom: 6,
    }];
    const result = adaptProtenixInput(request);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not supported by Protenix v2/);
  });

  it('rejects ambiguous MSA choices instead of silently changing model input', () => {
    const request = structureRequest();
    request.msa = { singleSequenceEntityIds: ['target'], lowerAccuracyAccepted: true };
    const result = validateStructurePredictionRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/already has a local A3M/);
  });

  it('enforces Boltz affinity composition and its 56/128 atom boundaries', () => {
    const request: LiatirProteinLigandAffinityRequest = {
      ...structureRequest(),
      modelId: BOLTZ_2_MODEL_ID,
      ligandAtomCount: 57,
    };
    const warning = validateProteinLigandAffinityRequest(request);
    expect(warning.valid).toBe(true);
    expect(warning.warnings.join(' ')).toMatch(/more than 56 atoms/);

    request.ligandAtomCount = BOLTZ_AFFINITY_MAX_LIGAND_ATOMS + 1;
    const rejected = validateProteinLigandAffinityRequest(request);
    expect(rejected.valid).toBe(false);
    expect(rejected.errors.join(' ')).toMatch(/above 128 atoms/);
  });

  it('shares one complex-shape rule between the editor and the affinity request', () => {
    const request: LiatirProteinLigandAffinityRequest = {
      ...structureRequest(),
      modelId: BOLTZ_2_MODEL_ID,
      ligandAtomCount: 9,
    };
    expect(validateProteinLigandAffinityComplex(request.spec)).toEqual([]);

    // The editor applies this while the user types, with no ligand atom count available yet.
    const twoCopies = structuredClone(request.spec);
    twoCopies.entities[0].copies = 2;
    expect(validateProteinLigandAffinityComplex(twoCopies).join(' ')).toMatch(/one copy of the protein/);

    const extraProtein = structuredClone(request.spec);
    extraProtein.entities.push({ id: 'second', type: 'protein', sequence: 'MKV' });
    expect(validateProteinLigandAffinityComplex(extraProtein).join(' '))
      .toMatch(/exactly one protein and one small ligand/);
    expect(validateProteinLigandAffinityRequest({ ...request, spec: extraProtein }).errors.join(' '))
      .toMatch(/exactly one protein and one small ligand/);
  });

  it('keeps binding probability distinct from log10 micromolar IC50', () => {
    expect(validateProteinLigandAffinityValues({ bindingProbability: 0.82, log10MicromolarIc50: -1.4 }).valid)
      .toBe(true);
    expect(validateProteinLigandAffinityValues({ bindingProbability: 2, log10MicromolarIc50: Number.NaN }).errors)
      .toHaveLength(2);
  });

  it('uses a measured envelope inside it and asks for confirmation beyond it', () => {
    const profile = hardwareProfile();
    const metrics = { workloadId: 'structure-prediction', stepCount: 200, tokenCount: 200, atomCount: 1_500, outputItemCount: 2 };
    expect(estimateHardwareResources(metrics, profile)).toMatchObject({
      ...metrics,
      accepted: true,
      evidence: 'measured',
      confirmationRequired: false,
      sampleFixtureId: 'small',
      estimatedVramBytes: 8_000_000_000,
    });

    // Past every measured point the run is still allowed, but only after an explicit choice, and
    // it is never given invented figures: the floor is the heaviest sample it already exceeds.
    const beyond = { ...metrics, tokenCount: 600, atomCount: 5_000, outputItemCount: 6 };
    expect(estimateHardwareResources(beyond, profile)).toMatchObject({
      ...beyond,
      accepted: true,
      evidence: 'beyond-evidence',
      confirmationRequired: true,
      floorFixtureId: 'large',
      maxValidatedTokenCount: 512,
      maxValidatedAtomCount: 4_000,
      maxValidatedOutputItemCount: 5,
    });
    expect('estimatedRamBytes' in estimateHardwareResources(beyond, profile)).toBe(false);

    // A workload with no measurement at all still fails closed: there is nothing to judge with.
    expect(estimateHardwareResources({ ...metrics, workloadId: 'protein-ligand-affinity' }, profile))
      .toMatchObject({ accepted: false, reason: 'no-evidence' });
  });

  it('refuses only a run whose measured floor exceeds the memory this computer has', () => {
    const profile = hardwareProfile();
    const beyond = { workloadId: 'structure-prediction', stepCount: 200, tokenCount: 600, atomCount: 5_000, outputItemCount: 6 };
    const floorBytes = 8_000_000_000; // the 'large' sample's peak RAM, the heaviest one it exceeds

    expect(estimateHardwareResources(beyond, profile, { totalMemoryBytes: floorBytes - 1 }))
      .toMatchObject({ accepted: false, reason: 'impossible' });
    expect(estimateHardwareResources(beyond, profile, { totalMemoryBytes: floorBytes * 8 }))
      .toMatchObject({ accepted: true, evidence: 'beyond-evidence' });
    // An unknown host figure proves nothing, so it must not become a refusal.
    expect(estimateHardwareResources(beyond, profile, { totalMemoryBytes: null }))
      .toMatchObject({ accepted: true, evidence: 'beyond-evidence' });
    // Inside the envelope a small machine is still never blocked by this rule.
    expect(estimateHardwareResources(
      { ...beyond, tokenCount: 200, atomCount: 1_500, outputItemCount: 2 },
      profile,
      { totalMemoryBytes: 1_000 },
    )).toMatchObject({ accepted: true, evidence: 'measured' });
  });

  it('derives published VRAM from the measured peak with the required margins', () => {
    expect(publishedVramRequirements(hardwareProfile())).toEqual({
      measuredPeakVramBytes: 12_000_000_000,
      minimumVramBytes: 15_000_000_000,
      recommendedVramBytes: 18_000_000_000,
    });
  });

  it('validates confidence ranges and non-negative PAE/PDE distances', () => {
    expect(validateStructureModelRows([{
      rank: 1,
      mmcifPath: '/results/model_0.cif',
      confidence: 0.9,
      ptm: 0.8,
      meanPaeAngstrom: 3.1,
      meanPdeAngstrom: 1.2,
    }]).valid).toBe(true);
    expect(validateStructureModelRows([{
      rank: 1,
      mmcifPath: '/results/model_0.cif',
      confidence: 1.2,
      meanPaeAngstrom: -1,
    }]).errors).toHaveLength(2);
  });

  it('resolves the two fixed MD presets and validates custom duration controls', () => {
    const verification = {
      preset: 'verification-10ps' as const,
      temperatureKelvin: 300,
      saveIntervalPs: 1,
      seed: 11,
    };
    expect(molecularDynamicsDurationPs(verification)).toBe(10);
    expect(validateMolecularDynamicsOptions(verification).valid).toBe(true);
    expect(molecularDynamicsDurationPs({ ...verification, preset: 'short-100ps' })).toBe(100);
    expect(validateMolecularDynamicsOptions({
      ...verification,
      preset: 'custom',
      customDurationPs: 0,
    }).errors.join(' ')).toMatch(/duration must be positive/);
    expect(validateMolecularDynamicsRunOptions({
      ...verification,
      pressureBar: 1,
      preparation: { addHydrogens: true, ph: 7, solvent: 'none' },
    }).errors.join(' ')).toMatch(/pressure requires an explicitly solvated/);
    for (const seed of [0, -1, 2_147_483_648]) {
      expect(validateMolecularDynamicsOptions({ ...verification, seed }).valid).toBe(false);
    }
  });

  it('rejects OpenMM checkpoints from a different release or target explicitly', () => {
    const expected: LiatirOpenMMCheckpointIdentity = {
      schemaVersion: 1,
      kind: 'liatir.openmm-checkpoint',
      runtimeId: OPENMM_RUNTIME_ID,
      runtimeBoxRelease: '8.5.1-beta.1',
      targetId: 'linux-x86_64-cuda12.9',
      topologySha256: 'a'.repeat(64),
      systemSha256: 'b'.repeat(64),
      integratorSha256: 'c'.repeat(64),
      configurationSha256: 'd'.repeat(64),
      forceFieldId: OPENMM_FORCE_FIELD_ID,
    };
    const mismatch = validateOpenMMCheckpointResume({
      ...expected,
      runtimeBoxRelease: '8.5.1-beta.2',
      targetId: 'windows-x86_64-cuda12.8',
    }, expected);
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errors.join(' ')).toMatch(/runtime version/);
    expect(mismatch.errors.join(' ')).toMatch(/target/);
  });

  it('requires relaxation to lower finite potential energy', () => {
    const base = {
      preparedStructurePath: '/results/prepared.cif',
      finalStructurePath: '/results/relaxed.cif',
      topologyPdbPath: '/results/topology.pdb',
      metricsJsonPath: '/results/metrics.json',
      initialPotentialEnergyKilojoulePerMole: -100,
      finalPotentialEnergyKilojoulePerMole: -150,
    };
    expect(validateRelaxationEnergyReduction(base).valid).toBe(true);
    expect(validateRelaxationEnergyReduction({
      ...base,
      finalPotentialEnergyKilojoulePerMole: -50,
    }).errors.join(' ')).toMatch(/did not reduce/);
  });
});
