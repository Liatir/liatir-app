import {
  LIATIR_DCD_TRAJECTORY_PROFILE_V1,
  LIATIR_STRUCTURE_PROFILE_V1,
  MOLECULAR_DYNAMICS_TOOL_ID,
  MOLECULAR_RELAXATION_TOOL_ID,
  OPENMM_BOX_ID,
  OPENMM_FORCE_FIELD_ID,
  OPENMM_INTERPRETATION_NOTICE,
  OPENMM_NAGL_CHARGE_MODEL_SHA256,
  OPENMM_RUNTIME_COMPONENT_ID,
  OPENMM_RUNTIME_ID,
  OPENMM_TIMESTEP_FEMTOSECONDS,
  OPENMM_VERSION,
  estimateHardwareResources,
  liatirArtifactLineageSource,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  validateMolecularDynamicsRunOptions,
  validateMolecularRelaxationOptions,
  validateRelaxationEnergyReduction,
  type JsonValue,
  type LiatirFileArtifactRole,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirMolecularDynamicsRunOptions,
  type LiatirMolecularRelaxationOptions,
  type LiatirOpenMMPreparationOptions,
  type LiatirPhase3ResultProvenance,
  type LiatirRuntimeBoxActivationMetadata,
  type LiatirRuntimeComponentPythonRunResult,
  type LiatirStepDefinition,
  type LiatirToolRuntimeRecord,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import {
  toolRuntimeDirectRunMetadata,
  type ToolRuntimeDirectRunContext,
} from '$lib/tool-runtimes/direct-run-context';
import { runToolRuntimePython } from '$lib/tool-runtimes/runtime';
import {
  inspectDcdTrajectoryArtifact,
  inspectStructureArtifact,
} from '$lib/scientific-artifacts';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { OPENMM_SCRIPT } from './python-scripts/openmm';

export type OpenMMToolMode = 'relaxation' | 'dynamics';

const structureRequirement = {
  profiles: [{ ...LIATIR_STRUCTURE_PROFILE_V1 }],
  formats: ['pdb', 'mmcif'],
  scientificTypes: ['molecular-structure'],
  validation: 'valid-or-partial' as const,
};

const commonInputSchema: LiatirStepDefinition['inputSchema'] = {
  inputStructure: {
    type: 'file', label: 'Input structure', required: true, accept: ['pdb', 'cif', 'mmcif'],
    artifact: structureRequirement,
  },
  ligandSdf: {
    type: 'file', label: 'Ligand parameters (optional SDF)', required: false, accept: ['sdf'],
    description: 'One ligand already present in the selected structure.',
  },
  addHydrogens: {
    type: 'boolean', label: 'Add missing hydrogens', required: false, default: true, connectable: false,
  },
  ph: { type: 'number', label: 'Preparation pH', required: true, default: 7.4, connectable: false },
  solvent: {
    type: 'string', label: 'Solvent', required: true, default: 'none', connectable: false,
    options: [
      { value: 'none', label: 'No explicit solvent' },
      { value: 'tip3p-fb', label: 'TIP3P-FB water' },
    ],
  },
  solventPaddingNm: {
    type: 'number', label: 'Water padding (nm)', required: false, default: 1, connectable: false,
  },
  ionicStrengthM: {
    type: 'number', label: 'Ionic strength (M)', required: false, default: 0.15, connectable: false,
  },
};

export const molecularRelaxationDefinition: LiatirStepDefinition = {
  id: MOLECULAR_RELAXATION_TOOL_ID,
  type: 'tool-runtime',
  label: 'Molecular Relaxation',
  description: 'Prepare and minimize a local molecular structure with OpenMM.',
  category: 'Molecular Simulation',
  inputSchema: {
    ...commonInputSchema,
    maxIterations: {
      type: 'number', label: 'Maximum minimization iterations', required: true, default: 5000,
      connectable: false,
    },
    toleranceKilojoulePerMoleNanometer: {
      type: 'number', label: 'Energy tolerance (kJ/mol/nm)', required: true, default: 10,
      connectable: false,
    },
    seed: { type: 'number', label: 'Seed', required: true, default: 17, connectable: false },
  },
  outputSchema: {
    relaxedStructure: {
      type: 'file', label: 'Relaxed structure', ext: ['cif'],
      artifact: {
        profile: { ...LIATIR_STRUCTURE_PROFILE_V1 }, format: 'mmcif', scientificType: 'molecular-structure',
      },
    },
    preparedStructure: { type: 'file', label: 'Prepared structure', ext: ['cif'] },
    topologyPdb: { type: 'file', label: 'Viewer topology', ext: ['pdb'] },
    metricsJson: { type: 'file', label: 'Relaxation metrics', ext: ['json'] },
    initialPotentialEnergy: { type: 'number', label: 'Initial potential energy', format: 'decimal' },
    finalPotentialEnergy: { type: 'number', label: 'Final potential energy', format: 'decimal' },
    energyReduction: { type: 'number', label: 'Potential-energy reduction', format: 'decimal' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

export const molecularDynamicsDefinition: LiatirStepDefinition = {
  id: MOLECULAR_DYNAMICS_TOOL_ID,
  type: 'tool-runtime',
  label: 'Molecular Dynamics',
  description: 'Run a bounded local OpenMM trajectory from a prepared molecular structure.',
  category: 'Molecular Simulation',
  inputSchema: {
    ...commonInputSchema,
    preset: {
      type: 'string', label: 'Duration', required: true, default: 'verification-10ps', connectable: false,
      options: [
        { value: 'verification-10ps', label: '10 ps verification' },
        { value: 'short-100ps', label: '100 ps short run' },
        { value: 'custom', label: 'Custom duration' },
      ],
    },
    customDurationPs: {
      type: 'number', label: 'Custom duration (ps)', required: false, connectable: false,
    },
    temperatureKelvin: {
      type: 'number', label: 'Temperature (K)', required: true, default: 300, connectable: false,
    },
    pressureBar: { type: 'number', label: 'Pressure (bar, optional)', required: false, connectable: false },
    saveIntervalPs: {
      type: 'number', label: 'Save interval (ps)', required: true, default: 1, connectable: false,
    },
    seed: { type: 'number', label: 'Seed', required: true, default: 17, connectable: false },
    checkpointPath: {
      type: 'file', label: 'Resume checkpoint (optional)', required: false, accept: ['chk'],
    },
    checkpointMetadataPath: {
      type: 'file', label: 'Checkpoint metadata (required with checkpoint)', required: false, accept: ['json'],
    },
  },
  outputSchema: {
    trajectoryDcd: {
      type: 'file', label: 'Trajectory', ext: ['dcd'],
      artifact: {
        profile: { ...LIATIR_DCD_TRAJECTORY_PROFILE_V1 }, format: 'dcd',
        scientificType: 'molecular-dynamics-trajectory',
      },
    },
    finalStructure: {
      type: 'file', label: 'Final structure', ext: ['cif'],
      artifact: {
        profile: { ...LIATIR_STRUCTURE_PROFILE_V1 }, format: 'mmcif', scientificType: 'molecular-structure',
      },
    },
    topologyPdb: { type: 'file', label: 'Trajectory topology', ext: ['pdb'] },
    stateCsv: { type: 'file', label: 'Energy and temperature', ext: ['csv'] },
    checkpoint: { type: 'file', label: 'Resume checkpoint', ext: ['chk'] },
    checkpointMetadata: { type: 'file', label: 'Checkpoint metadata', ext: ['json'] },
    metricsJson: { type: 'file', label: 'Dynamics metrics', ext: ['json'] },
    energyPlotJson: { type: 'file', label: 'Energy plot data', ext: ['json'] },
    temperaturePlotJson: { type: 'file', label: 'Temperature plot data', ext: ['json'] },
    frameCount: { type: 'number', label: 'Saved frames', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface ParsedOpenMMInputs {
  preparation: LiatirOpenMMPreparationOptions;
  relaxation?: LiatirMolecularRelaxationOptions;
  dynamics?: LiatirMolecularDynamicsRunOptions;
}

interface OpenMMPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.openmm-preflight';
  mode: OpenMMToolMode;
  ligandAtomCount: number;
  inputBytes: number;
  networkAccess: false;
}

export interface OpenMMResourcePreflight {
  metrics: OpenMMPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface OpenMMFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface OpenMMCommonSummary {
  openmmVersion: string;
  openmmforcefieldsVersion: string;
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  accelerator: string;
  platform: string;
  platformProperties: Record<string, string>;
  precision: string;
  forceField: {
    protein: string;
    water: string | null;
    ligand: string | null;
    ligandCharges: string | null;
    id: string;
  };
  naglModelSha256: string | null;
  topologySha256: string;
  systemSha256: string;
  atomCount: number;
  preparedAtomCount: number;
  ligandAtomCount: number;
  networkAccess: false;
  hardwareEstimate: LiatirHardwareResourceEstimate;
  seed: number;
  preparation: LiatirOpenMMPreparationOptions;
}

interface OpenMMRelaxationSummary extends OpenMMCommonSummary {
  mode: 'relaxation';
  relaxation: LiatirMolecularRelaxationOptions;
  initialPotentialEnergyKilojoulePerMole: number;
  finalPotentialEnergyKilojoulePerMole: number;
  energyReductionKilojoulePerMole: number;
}

interface OpenMMDynamicsSummary extends OpenMMCommonSummary {
  mode: 'dynamics';
  dynamics: LiatirMolecularDynamicsRunOptions;
  durationPs: number;
  timestepFs: number;
  saveIntervalPs: number;
  frameCount: number;
  totalSteps: number;
  finalPotentialEnergyKilojoulePerMole: number;
  trajectoryFiniteCoordinates: boolean;
  resumed: boolean;
  checkpoint: Record<string, JsonValue>;
}

type OpenMMResultPayload = {
  schemaVersion: 1;
  kind: 'liatir.openmm-result';
  mode: 'relaxation';
  paths: {
    preparedStructurePath: string;
    finalStructurePath: string;
    topologyPdbPath: string;
    metricsJsonPath: string;
  };
  summary: OpenMMRelaxationSummary;
} | {
  schemaVersion: 1;
  kind: 'liatir.openmm-result';
  mode: 'dynamics';
  paths: {
    trajectoryDcdPath: string;
    preparedStructurePath: string;
    finalStructurePath: string;
    topologyPdbPath: string;
    stateCsvPath: string;
    checkpointPath: string;
    checkpointMetadataPath: string;
    metricsJsonPath: string;
    energyPlotPath: string;
    temperaturePlotPath: string;
  };
  summary: OpenMMDynamicsSummary;
};

function basename(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

function inputBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function inputNumber(value: string | undefined, fallback: number, label: string): number {
  const number = value === undefined || value.trim() === '' ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function parsedInputs(mode: OpenMMToolMode, inputs: Record<string, string>): ParsedOpenMMInputs {
  const solvent = inputs.solvent || 'none';
  if (solvent !== 'none' && solvent !== 'tip3p-fb') throw new Error('Solvent must be none or TIP3P-FB.');
  const preparation: LiatirOpenMMPreparationOptions = {
    addHydrogens: inputBoolean(inputs.addHydrogens, true),
    ph: inputNumber(inputs.ph, 7.4, 'Preparation pH'),
    solvent,
    ...(solvent === 'tip3p-fb' ? {
      solventPaddingNm: inputNumber(inputs.solventPaddingNm, 1, 'Water padding'),
      ionicStrengthM: inputNumber(inputs.ionicStrengthM, 0.15, 'Ionic strength'),
    } : {}),
  };
  if (mode === 'relaxation') {
    const relaxation: LiatirMolecularRelaxationOptions = {
      preparation,
      maxIterations: inputNumber(inputs.maxIterations, 5000, 'Maximum minimization iterations'),
      toleranceKilojoulePerMoleNanometer: inputNumber(
        inputs.toleranceKilojoulePerMoleNanometer, 10, 'Energy tolerance',
      ),
      seed: inputNumber(inputs.seed, 17, 'Seed'),
    };
    const validation = validateMolecularRelaxationOptions(relaxation);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    return { preparation, relaxation };
  }
  const preset = inputs.preset || 'verification-10ps';
  if (preset !== 'verification-10ps' && preset !== 'short-100ps' && preset !== 'custom') {
    throw new Error('Molecular dynamics duration preset is not supported.');
  }
  const dynamics: LiatirMolecularDynamicsRunOptions = {
    preparation,
    preset,
    ...(preset === 'custom' ? {
      customDurationPs: inputNumber(inputs.customDurationPs, Number.NaN, 'Custom duration'),
    } : {}),
    temperatureKelvin: inputNumber(inputs.temperatureKelvin, 300, 'Temperature'),
    ...(inputs.pressureBar?.trim() ? {
      pressureBar: inputNumber(inputs.pressureBar, Number.NaN, 'Pressure'),
    } : {}),
    saveIntervalPs: inputNumber(inputs.saveIntervalPs, 1, 'Save interval'),
    seed: inputNumber(inputs.seed, 17, 'Seed'),
  };
  const validation = validateMolecularDynamicsRunOptions(dynamics);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  if (Boolean(inputs.checkpointPath) !== Boolean(inputs.checkpointMetadataPath)) {
    throw new Error('Checkpoint bytes and checkpoint metadata must be selected together.');
  }
  return { preparation, dynamics };
}

function parsePythonJson<T>(stdout: string, label: string): T {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { return JSON.parse(lines[index]) as T; } catch { /* scan earlier log lines */ }
  }
  throw new Error(`${label} did not return a structured result.`);
}

function activationFor(runtime: LiatirToolRuntimeRecord): LiatirRuntimeBoxActivationMetadata {
  const activation = runtimeBoxActivationFromMetadata(runtime);
  if (!activation) throw new Error('The installed OpenMM Runtime Box has no verified activation identity.');
  return activation;
}

function pythonInput(
  action: 'preflight' | 'run',
  mode: OpenMMToolMode,
  inputs: Record<string, string>,
  parsed: ParsedOpenMMInputs,
  activation: LiatirRuntimeBoxActivationMetadata,
  runtimePath: string,
  options: { outputDir?: string; estimate?: LiatirHardwareResourceEstimate } = {},
): Record<string, JsonValue> {
  return {
    action,
    mode,
    inputStructure: inputs.inputStructure,
    ligandSdf: inputs.ligandSdf || '',
    preparation: parsed.preparation as unknown as JsonValue,
    ...(parsed.relaxation ? { relaxation: parsed.relaxation as unknown as JsonValue } : {}),
    ...(parsed.dynamics ? { dynamics: parsed.dynamics as unknown as JsonValue } : {}),
    checkpointPath: inputs.checkpointPath || '',
    checkpointMetadataPath: inputs.checkpointMetadataPath || '',
    runtimePath,
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    accelerator: activation.selectedTarget.accelerator,
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
}

export async function preflightOpenMMWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  mode: OpenMMToolMode,
  inputs: Record<string, string>,
): Promise<OpenMMResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) {
    throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  }
  if (!inputs.inputStructure) throw new Error('A PDB or mmCIF input structure is required.');
  const parsed = parsedInputs(mode, inputs);
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(
    runtime,
    OPENMM_SCRIPT,
    pythonInput('preflight', mode, inputs, parsed, activation, runtime.runtimePath),
    { trackJob: false, timeoutSeconds: 60 },
  );
  if (!result.ok) throw new Error(result.stderr || `OpenMM preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<OpenMMPreflightPayload>(result.stdout, 'OpenMM preflight');
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.openmm-preflight' || metrics.mode !== mode) {
    throw new Error('OpenMM preflight returned an unsupported result contract.');
  }
  const profile = phase3HardwareValidationProfile({
    componentId: runtime.id,
    componentVersion: runtime.version,
    runtimeBoxRelease: activation.release.version,
    target: activation.selectedTarget,
  });
  const estimate: LiatirHardwareResourcePreflight = profile
    ? estimateHardwareResources(metrics, profile)
    : {
        accepted: false,
        error: 'No retained measured hardware envelope is available for this exact OpenMM release and target.',
        maxValidatedTokenCount: 0,
        maxValidatedAtomCount: 0,
        maxValidatedStepCount: 0,
        maxValidatedOutputItemCount: 0,
      };
  return { metrics, profile, estimate };
}

function safeOutputPath(path: string, outputDir: string, label: string): string {
  const normalizedRoot = outputDir.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const normalized = path.replace(/\\/gu, '/');
  if (!normalizedRoot || normalized.includes('/../') || !normalized.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`${label} is outside this run's Results directory.`);
  }
  return path;
}

async function outputFile(
  label: string,
  path: string,
  ext: string,
  fieldKey: string,
  role: LiatirFileArtifactRole,
  scientific?: RunOutputFile['scientific'],
): Promise<RunOutputFile> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const size = await api.invoke('lia_file_size', { path }) as number;
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(`${label} is empty or unreadable.`);
  return { label, path, ext, fieldKey, role, size, ...(scientific ? { scientific } : {}) };
}

async function readPlot(path: string, label: string): Promise<{ data: object[]; layout?: object }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const text = await api.invoke('lia_read_file_text', { path }) as string;
  const value = JSON.parse(text) as { data?: unknown; layout?: unknown };
  if (!Array.isArray(value.data) || !value.data.every((item) => item && typeof item === 'object')) {
    throw new Error(`${label} plot data is invalid.`);
  }
  return {
    data: value.data as object[],
    ...(value.layout && typeof value.layout === 'object' ? { layout: value.layout as object } : {}),
  };
}

function structureFormat(path: string): 'pdb' | 'mmcif' | 'sdf' {
  const name = path.toLowerCase();
  if (name.endsWith('.pdb')) return 'pdb';
  if (name.endsWith('.sdf')) return 'sdf';
  return 'mmcif';
}

function assertCommonSummary(
  summary: OpenMMCommonSummary,
  runtime: LiatirToolRuntimeRecord,
  activation: LiatirRuntimeBoxActivationMetadata,
): void {
  const expectedTarget = runtimeBoxTargetId(activation.selectedTarget);
  if (summary.openmmVersion !== OPENMM_VERSION || summary.openmmforcefieldsVersion !== '0.16.0'
    || summary.runtimeId !== OPENMM_RUNTIME_ID) {
    throw new Error('OpenMM result came from a different scientific runtime.');
  }
  if (summary.runtimeBoxRelease !== activation.release.version || summary.targetId !== expectedTarget) {
    throw new Error('OpenMM result release or target does not match the verified Runtime Box activation.');
  }
  if (summary.accelerator !== activation.selectedTarget.accelerator) {
    throw new Error('OpenMM result accelerator does not match the selected Runtime Box target.');
  }
  if (summary.forceField.id !== OPENMM_FORCE_FIELD_ID || summary.networkAccess !== false) {
    throw new Error('OpenMM result force field or offline boundary is invalid.');
  }
  if (!Number.isSafeInteger(summary.atomCount) || summary.atomCount < 1
    || !Number.isSafeInteger(summary.preparedAtomCount) || summary.preparedAtomCount < summary.atomCount) {
    throw new Error('OpenMM result atom counts are invalid.');
  }
  if (!summary.hardwareEstimate?.accepted || !summary.hardwareEstimate.hardwareProfileId) {
    throw new Error('OpenMM result has no accepted measured hardware envelope.');
  }
  if (summary.forceField.ligand && summary.naglModelSha256 !== OPENMM_NAGL_CHARGE_MODEL_SHA256) {
    throw new Error('OpenMM ligand parameterization used an unreviewed charge model.');
  }
  if (runtime.id !== OPENMM_RUNTIME_COMPONENT_ID) throw new Error('Unexpected Tool Runtime for OpenMM result.');
}

function phase3Provenance(
  summary: OpenMMCommonSummary,
  activation: LiatirRuntimeBoxActivationMetadata,
): LiatirPhase3ResultProvenance {
  return {
    schemaVersion: 1,
    componentId: OPENMM_RUNTIME_COMPONENT_ID,
    model: null,
    forceField: {
      protein: summary.forceField.protein,
      water: summary.forceField.water,
      ligand: summary.forceField.ligand,
    },
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: `OpenMM ${summary.platform} platform`,
    precision: summary.precision,
    seed: summary.seed,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: OPENMM_BOX_ID,
      runtimeId: OPENMM_RUNTIME_ID,
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: summary.hardwareEstimate.hardwareProfileId,
  };
}

function provenanceRows(summary: OpenMMCommonSummary, provenance: LiatirPhase3ResultProvenance) {
  return [
    ['Tool Runtime', `OpenMM ${summary.openmmVersion}`],
    ['Compute', `${provenance.computeDevice} · ${provenance.precision}`],
    ['Seed', provenance.seed],
    ['Protein force field', summary.forceField.protein],
    ['Water model', summary.forceField.water ?? 'No explicit solvent'],
    ['Ligand force field', summary.forceField.ligand ?? 'No ligand SDF'],
    ['Network access', 'Disabled'],
    ['Hardware evidence', summary.hardwareEstimate.hardwareProfileId],
    ['Runtime Box', `${provenance.scrollcase.releaseVersion} · ${runtimeBoxTargetId(provenance.scrollcase.target)}`],
    ['Runtime Box archive SHA-256', provenance.scrollcase.archiveSha256],
  ] satisfies (string | number)[][];
}

export async function finalizeOpenMMResult(
  runtime: LiatirToolRuntimeRecord,
  mode: OpenMMToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<OpenMMFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `OpenMM exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<OpenMMResultPayload>(result.stdout, 'OpenMM');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.openmm-result' || parsed.mode !== mode) {
    throw new Error('OpenMM returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  assertCommonSummary(parsed.summary, runtime, activation);
  await dataFiles.init();

  const inputScientific = await inspectStructureArtifact(inputs.inputStructure, {
    format: structureFormat(inputs.inputStructure),
    recognizedFormat: true,
    atomCount: parsed.summary.atomCount,
    modelCount: 1,
    finiteCoordinates: true,
  });
  await dataFiles.setScientific(inputs.inputStructure, inputScientific);
  if (inputs.ligandSdf) {
    const ligandScientific = await inspectStructureArtifact(inputs.ligandSdf, {
      format: 'sdf', recognizedFormat: true, atomCount: parsed.summary.ligandAtomCount,
      modelCount: 1, finiteCoordinates: true,
    });
    await dataFiles.setScientific(inputs.ligandSdf, ligandScientific);
  }
  const lineage = {
    sources: [liatirArtifactLineageSource(inputScientific, 'input', 'inputStructure')],
    transformation: {
      id: mode === 'relaxation' ? molecularRelaxationDefinition.id : molecularDynamicsDefinition.id,
      label: mode === 'relaxation' ? molecularRelaxationDefinition.label : molecularDynamicsDefinition.label,
      version: '1',
      sourceRevision: OPENMM_VERSION,
      parameters: {
        runtimeBoxRelease: activation.release.version,
        targetId: runtimeBoxTargetId(activation.selectedTarget),
        forceFieldId: OPENMM_FORCE_FIELD_ID,
        seed: parsed.summary.seed,
      },
    },
  };
  const provenance = phase3Provenance(parsed.summary, activation);

  if (parsed.mode === 'relaxation') {
    const paths = {
      prepared: safeOutputPath(parsed.paths.preparedStructurePath, outputDir, 'Prepared structure'),
      final: safeOutputPath(parsed.paths.finalStructurePath, outputDir, 'Relaxed structure'),
      topology: safeOutputPath(parsed.paths.topologyPdbPath, outputDir, 'Viewer topology'),
      metrics: safeOutputPath(parsed.paths.metricsJsonPath, outputDir, 'Relaxation metrics'),
    };
    const energy = validateRelaxationEnergyReduction({
      ...parsed.paths,
      initialPotentialEnergyKilojoulePerMole: parsed.summary.initialPotentialEnergyKilojoulePerMole,
      finalPotentialEnergyKilojoulePerMole: parsed.summary.finalPotentialEnergyKilojoulePerMole,
    });
    if (!energy.valid) throw new Error(energy.errors.join(' '));
    const preparedScientific = await inspectStructureArtifact(paths.prepared, {
      format: 'mmcif', recognizedFormat: true, atomCount: parsed.summary.preparedAtomCount,
      modelCount: 1, finiteCoordinates: true,
    }, { lineage });
    const finalScientific = await inspectStructureArtifact(paths.final, {
      format: 'mmcif', recognizedFormat: true, atomCount: parsed.summary.preparedAtomCount,
      modelCount: 1, finiteCoordinates: true,
    }, { lineage, viewerHints: { preferredViewer: 'structure-viewer' } });
    const topologyScientific = await inspectStructureArtifact(paths.topology, {
      format: 'pdb', recognizedFormat: true, atomCount: parsed.summary.preparedAtomCount,
      modelCount: 1, finiteCoordinates: true,
    }, { lineage });
    const reduction = parsed.summary.energyReductionKilojoulePerMole;
    const output: ToolOutput = { sections: [
      { type: 'stats', cols: 4, items: [
        { label: 'Atoms', value: parsed.summary.preparedAtomCount },
        { label: 'Initial potential energy', value: parsed.summary.initialPotentialEnergyKilojoulePerMole.toFixed(3) },
        { label: 'Final potential energy', value: parsed.summary.finalPotentialEnergyKilojoulePerMole.toFixed(3) },
        { label: 'Energy reduction', value: `${reduction.toFixed(3)} kJ/mol` },
      ] },
      { type: 'text', label: 'Interpretation', content: OPENMM_INTERPRETATION_NOTICE },
      {
        type: 'structure-viewer', label: 'Relaxed structure', path: paths.final, format: 'mmcif',
        style: 'cartoon', colorScheme: 'chain', height: 460,
      },
      { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows(parsed.summary, provenance) },
    ] };
    return {
      outputFiles: [
        await outputFile('Relaxed structure', paths.final, 'cif', 'relaxedStructure', 'final', finalScientific),
        await outputFile('Prepared structure', paths.prepared, 'cif', 'preparedStructure', 'intermediate', preparedScientific),
        await outputFile('Viewer topology', paths.topology, 'pdb', 'topologyPdb', 'intermediate', topologyScientific),
        await outputFile('Relaxation metrics', paths.metrics, 'json', 'metricsJson', 'final'),
      ],
      output,
      metrics: {
        atomCount: parsed.summary.preparedAtomCount,
        initialPotentialEnergyKilojoulePerMole: parsed.summary.initialPotentialEnergyKilojoulePerMole,
        finalPotentialEnergyKilojoulePerMole: parsed.summary.finalPotentialEnergyKilojoulePerMole,
        energyReductionKilojoulePerMole: reduction,
      },
      values: {
        initialPotentialEnergy: parsed.summary.initialPotentialEnergyKilojoulePerMole,
        finalPotentialEnergy: parsed.summary.finalPotentialEnergyKilojoulePerMole,
        energyReduction: reduction,
        provenance: provenance as unknown as JsonValue,
      },
      executionEvidence: provenance as unknown as Record<string, JsonValue>,
    };
  }

  if (!Number.isSafeInteger(parsed.summary.frameCount) || parsed.summary.frameCount < 1
    || parsed.summary.timestepFs !== OPENMM_TIMESTEP_FEMTOSECONDS
    || parsed.summary.trajectoryFiniteCoordinates !== true) {
    throw new Error('OpenMM trajectory frame, timestep, or finite-coordinate validation failed.');
  }
  const paths = {
    trajectory: safeOutputPath(parsed.paths.trajectoryDcdPath, outputDir, 'Trajectory'),
    prepared: safeOutputPath(parsed.paths.preparedStructurePath, outputDir, 'Prepared structure'),
    final: safeOutputPath(parsed.paths.finalStructurePath, outputDir, 'Final structure'),
    topology: safeOutputPath(parsed.paths.topologyPdbPath, outputDir, 'Trajectory topology'),
    state: safeOutputPath(parsed.paths.stateCsvPath, outputDir, 'State CSV'),
    checkpoint: safeOutputPath(parsed.paths.checkpointPath, outputDir, 'Checkpoint'),
    checkpointMetadata: safeOutputPath(parsed.paths.checkpointMetadataPath, outputDir, 'Checkpoint metadata'),
    metrics: safeOutputPath(parsed.paths.metricsJsonPath, outputDir, 'Dynamics metrics'),
    energyPlot: safeOutputPath(parsed.paths.energyPlotPath, outputDir, 'Energy plot'),
    temperaturePlot: safeOutputPath(parsed.paths.temperaturePlotPath, outputDir, 'Temperature plot'),
  };
  const preparedScientific = await inspectStructureArtifact(paths.prepared, {
    format: 'mmcif', recognizedFormat: true, atomCount: parsed.summary.preparedAtomCount,
    modelCount: 1, finiteCoordinates: true,
  }, { lineage });
  const topologyScientific = await inspectStructureArtifact(paths.topology, {
    format: 'pdb', recognizedFormat: true, atomCount: parsed.summary.preparedAtomCount,
    modelCount: 1, finiteCoordinates: true,
  }, { lineage });
  const finalScientific = await inspectStructureArtifact(paths.final, {
    format: 'mmcif', recognizedFormat: true, atomCount: parsed.summary.preparedAtomCount,
    modelCount: 1, finiteCoordinates: true,
  }, { lineage, viewerHints: { preferredViewer: 'structure-viewer' } });
  const trajectoryScientific = await inspectDcdTrajectoryArtifact(paths.trajectory, {
    frameCount: parsed.summary.frameCount,
    atomCount: parsed.summary.preparedAtomCount,
    topologyAtomCount: parsed.summary.preparedAtomCount,
    finiteCoordinates: true,
    timestepFs: parsed.summary.timestepFs,
    initialStructureArtifactId: topologyScientific.physical.artifactId,
    initialStructureDigest: topologyScientific.physical.digest,
  }, { lineage, viewerHints: { preferredViewer: 'molecular-trajectory-viewer' } });
  const energyPlot = await readPlot(paths.energyPlot, 'Energy');
  const temperaturePlot = await readPlot(paths.temperaturePlot, 'Temperature');
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Atoms', value: parsed.summary.preparedAtomCount },
      { label: 'Saved frames', value: parsed.summary.frameCount },
      { label: 'Duration', value: `${parsed.summary.durationPs} ps` },
      { label: 'Temperature', value: `${parsed.summary.dynamics.temperatureKelvin} K` },
    ] },
    { type: 'text', label: 'Interpretation', content: OPENMM_INTERPRETATION_NOTICE },
    {
      type: 'molecular-trajectory-viewer', label: 'Molecular dynamics trajectory',
      trajectoryPath: paths.trajectory, trajectoryFormat: 'dcd',
      structurePath: paths.topology, structureFormat: 'pdb',
      frameCount: parsed.summary.frameCount, timestepFs: parsed.summary.timestepFs,
      frameStride: Math.round(parsed.summary.saveIntervalPs * 1000 / parsed.summary.timestepFs),
      style: 'cartoon', colorScheme: 'chain', height: 500,
    },
    {
      type: 'structure-viewer', label: 'Final structure', path: paths.final, format: 'mmcif',
      style: 'cartoon', colorScheme: 'chain', height: 460,
    },
    { type: 'plotly', plotlyType: 'scatter', title: 'Potential energy', data: energyPlot.data, layout: energyPlot.layout },
    { type: 'plotly', plotlyType: 'scatter', title: 'Temperature', data: temperaturePlot.data, layout: temperaturePlot.layout },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows(parsed.summary, provenance) },
  ] };
  return {
    outputFiles: [
      await outputFile('Molecular dynamics trajectory', paths.trajectory, 'dcd', 'trajectoryDcd', 'final', trajectoryScientific),
      await outputFile('Final structure', paths.final, 'cif', 'finalStructure', 'final', finalScientific),
      await outputFile('Trajectory topology', paths.topology, 'pdb', 'topologyPdb', 'final', topologyScientific),
      await outputFile('Energy and temperature', paths.state, 'csv', 'stateCsv', 'final'),
      await outputFile('Resume checkpoint', paths.checkpoint, 'chk', 'checkpoint', 'final'),
      await outputFile('Checkpoint metadata', paths.checkpointMetadata, 'json', 'checkpointMetadata', 'final'),
      await outputFile('Prepared structure', paths.prepared, 'cif', 'preparedStructure', 'intermediate', preparedScientific),
      await outputFile('Dynamics metrics', paths.metrics, 'json', 'metricsJson', 'final'),
      await outputFile('Energy plot data', paths.energyPlot, 'json', 'energyPlotJson', 'intermediate'),
      await outputFile('Temperature plot data', paths.temperaturePlot, 'json', 'temperaturePlotJson', 'intermediate'),
    ],
    output,
    metrics: {
      atomCount: parsed.summary.preparedAtomCount,
      frameCount: parsed.summary.frameCount,
      durationPs: parsed.summary.durationPs,
      finalPotentialEnergyKilojoulePerMole: parsed.summary.finalPotentialEnergyKilojoulePerMole,
    },
    values: {
      frameCount: parsed.summary.frameCount,
      provenance: provenance as unknown as JsonValue,
    },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runOpenMMWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  mode: OpenMMToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  if (runtime.status !== 'installed' || !runtime.runtimePath) {
    throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  }
  const runtimePath = runtime.runtimePath;
  const parsed = parsedInputs(mode, inputs);
  const activation = activationFor(runtime);
  const preflight = await preflightOpenMMWithRuntime(runtime, mode, inputs);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  onLog(`tool-runtime ${runtime.id}`);
  onLog(`input ${basename(inputs.inputStructure)}`);
  onLog(`preflight ${preflight.metrics.atomCount} atoms · ${preflight.metrics.outputItemCount} output items`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId}`);
  const definition = mode === 'relaxation' ? molecularRelaxationDefinition : molecularDynamicsDefinition;
  const result = await runToolRuntimePython(
    runtime,
    OPENMM_SCRIPT,
    pythonInput('run', mode, inputs, parsed, activation, runtimePath, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: mode === 'relaxation' ? 7_200 : 28_800,
      jobLabel: runContext?.runKind === 'pipeline-step'
        ? `${runContext.pipelineName}: ${definition.label}`
        : definition.label,
      metadata: {
        toolId: definition.id,
        ...(runContext
          ? runContext.runKind === 'tool-runtime-direct'
            ? toolRuntimeDirectRunMetadata(runContext)
            : aiRunMetadata(runContext)
          : {}),
      },
      signal: runContext?.signal,
      onJobId: runContext?.onJobId,
    },
  );
  return finalizeOpenMMResult(runtime, mode, inputs, outputDir, result, onLog);
}

async function runOpenMMStep(
  mode: OpenMMToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === OPENMM_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The OpenMM Tool Runtime has not completed publication for this Liatir release.');
  return runOpenMMWithRuntime(runtime, mode, inputs, outputDir, onLog, runContext);
}

export function runMolecularRelaxationStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  return runOpenMMStep('relaxation', inputs, outputDir, onLog, runContext);
}

export function runMolecularDynamicsStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  return runOpenMMStep('dynamics', inputs, outputDir, onLog, runContext);
}
