import {
  AUTODOCK_VINA_VERSION,
  DEFAULT_DOCKING_OPTIONS,
  DEFAULT_RECEPTOR_PREPARATION_OPTIONS,
  LIATIR_STRUCTURE_PROFILE_V1,
  MEEKO_VERSION,
  MOLECULAR_DOCKING_BOX_ID,
  MOLECULAR_DOCKING_INTERPRETATION_NOTICE,
  MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
  MOLECULAR_DOCKING_RUNTIME_ID,
  MOLECULAR_DOCKING_TOOL_ID,
  PDBFIXER_VERSION,
  RECEPTOR_PREPARATION_TOOL_ID,
  RINGTAIL_VERSION,
  estimateHardwareResources,
  liatirArtifactLineageSource,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  validateDockingOptions,
  validateDockingPoseRows,
  validateDockingSite,
  validateReceptorPreparationOptions,
  type JsonValue,
  type LiatirDockingExperimentIdentity,
  type LiatirDockingOptions,
  type LiatirDockingPoseRow,
  type LiatirDockingSite,
  type LiatirHardwareHostMemory,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourceExtrapolation,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirPhase3ResultProvenance,
  type LiatirReceptorPreparationOptions,
  type LiatirRuntimeBoxActivationMetadata,
  type LiatirRuntimeComponentPythonRunResult,
  type LiatirStepDefinition,
  type LiatirToolRuntimeRecord,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import { inspectStructureArtifact } from '$lib/scientific-artifacts';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
import {
  toolRuntimeDirectRunMetadata,
  type ToolRuntimeDirectRunContext,
} from '$lib/tool-runtimes/direct-run-context';
import { runToolRuntimePython } from '$lib/tool-runtimes/runtime';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { MOLECULAR_DOCKING_SCRIPT } from './python-scripts/docking';

export type DockingToolMode = 'prepare-receptor' | 'dock';

/** Either accepted outcome may start a run; only the measured one carries real figures. */
export type DockingAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

const structureRequirement = {
  profiles: [{ ...LIATIR_STRUCTURE_PROFILE_V1 }],
  formats: ['pdb', 'mmcif'],
  scientificTypes: ['molecular-structure'],
  validation: 'valid-or-partial' as const,
};

const structureArtifact = (format: 'pdb' | 'sdf') => ({
  profile: { ...LIATIR_STRUCTURE_PROFILE_V1 }, format, scientificType: 'molecular-structure',
});

export const receptorPreparationDefinition: LiatirStepDefinition = {
  id: RECEPTOR_PREPARATION_TOOL_ID,
  type: 'tool-runtime',
  label: 'Receptor Preparation',
  description: 'Repair and protonate a protein structure and write the receptor file AutoDock Vina docks into.',
  category: 'Molecular Docking',
  inputSchema: {
    inputStructure: {
      type: 'file', label: 'Protein structure', required: true, accept: ['pdb', 'cif', 'mmcif'],
      artifact: structureRequirement,
    },
    keepChains: {
      type: 'string', label: 'Chains to keep (empty keeps all)', required: false, default: '', connectable: false,
      description: 'Comma-separated chain identifiers, for example A.',
    },
    removeWaters: {
      type: 'boolean', label: 'Remove crystallographic waters', required: false, default: true, connectable: false,
    },
    removeResidueNames: {
      type: 'string', label: 'Residues to remove', required: false, default: '', connectable: false,
      description: 'Comma-separated residue names, for example the co-crystallized ligand you will dock again.',
    },
    addMissingAtoms: {
      type: 'boolean', label: 'Repair missing heavy atoms', required: false, default: true, connectable: false,
    },
    addMissingResidues: {
      type: 'boolean', label: 'Model missing internal residues', required: false, default: false, connectable: false,
    },
    replaceNonstandardResidues: {
      type: 'boolean', label: 'Replace non-standard residues', required: false, default: false, connectable: false,
    },
    ph: { type: 'number', label: 'Protonation pH', required: true, default: 7.4, connectable: false },
  },
  outputSchema: {
    preparedReceptor: { type: 'file', label: 'Prepared receptor', ext: ['pdb'], artifact: structureArtifact('pdb') },
    receptorPdbqt: { type: 'file', label: 'Receptor for docking', ext: ['pdbqt'] },
    preparationReport: { type: 'file', label: 'Preparation report', ext: ['json'] },
    receptorAtoms: { type: 'number', label: 'Receptor atoms', format: 'integer' },
    netPartialCharge: { type: 'number', label: 'Net partial charge', format: 'decimal' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

export const molecularDockingDefinition: LiatirStepDefinition = {
  id: MOLECULAR_DOCKING_TOOL_ID,
  type: 'tool-runtime',
  label: 'Molecular Docking',
  description: 'Dock one ligand or a library into a prepared receptor with AutoDock Vina and rank the poses.',
  category: 'Molecular Docking',
  inputSchema: {
    receptorPdbqt: { type: 'file', label: 'Receptor for docking (PDBQT)', required: true, accept: ['pdbqt'] },
    receptorStructure: {
      type: 'file', label: 'Prepared receptor (PDB, optional)', required: false, accept: ['pdb'],
      description: 'The PDB written together with the PDBQT; adds a receptor-plus-pose complex to the Result.',
    },
    ligandsSdf: { type: 'file', label: 'Ligands (SDF)', required: true, accept: ['sdf'] },
    siteMode: {
      type: 'string', label: 'Binding site', required: true, default: 'reference-ligand', connectable: false,
      options: [
        { value: 'reference-ligand', label: 'Around a reference ligand' },
        { value: 'box', label: 'Explicit box' },
      ],
    },
    referenceLigand: {
      type: 'file', label: 'Reference ligand (SDF)', required: false, accept: ['sdf'],
      description: 'A ligand placed in the pocket, for example the co-crystallized one.',
    },
    paddingAngstrom: { type: 'number', label: 'Box padding (Å)', required: false, default: 5, connectable: false },
    centerX: { type: 'number', label: 'Box centre x (Å)', required: false, connectable: false },
    centerY: { type: 'number', label: 'Box centre y (Å)', required: false, connectable: false },
    centerZ: { type: 'number', label: 'Box centre z (Å)', required: false, connectable: false },
    sizeX: { type: 'number', label: 'Box size x (Å)', required: false, default: 20, connectable: false },
    sizeY: { type: 'number', label: 'Box size y (Å)', required: false, default: 20, connectable: false },
    sizeZ: { type: 'number', label: 'Box size z (Å)', required: false, default: 20, connectable: false },
    scoringFunction: {
      type: 'string', label: 'Scoring function', required: true, default: 'vina', connectable: false,
      options: [{ value: 'vina', label: 'Vina' }, { value: 'vinardo', label: 'Vinardo' }],
    },
    exhaustiveness: { type: 'number', label: 'Exhaustiveness', required: true, default: 8, connectable: false },
    numPoses: { type: 'number', label: 'Poses per ligand', required: true, default: 9, connectable: false },
    energyRangeKcalPerMol: {
      type: 'number', label: 'Energy range (kcal/mol)', required: true, default: 3, connectable: false,
    },
    seed: { type: 'number', label: 'Seed', required: true, default: 42, connectable: false },
    cpuThreads: { type: 'number', label: 'CPU threads', required: true, default: 4, connectable: false },
    addLigandHydrogens: {
      type: 'boolean', label: 'Add missing ligand hydrogens', required: false, default: true, connectable: false,
    },
    screeningDatabase: {
      type: 'file', label: 'Screening database to extend (optional)', required: false, accept: ['db'],
      description: 'Only a database from the same receptor, binding site and settings is accepted.',
    },
  },
  outputSchema: {
    dockedPoses: { type: 'file', label: 'Docked poses', ext: ['sdf'], artifact: structureArtifact('sdf') },
    bestPoseComplex: { type: 'file', label: 'Receptor with best pose', ext: ['pdb'], artifact: structureArtifact('pdb') },
    scoresCsv: { type: 'file', label: 'Docking scores', ext: ['csv'] },
    screeningDatabase: { type: 'file', label: 'Screening database', ext: ['db'] },
    dockingSummary: { type: 'file', label: 'Docking summary', ext: ['json'] },
    bestScore: { type: 'number', label: 'Best Vina score (kcal/mol)', format: 'decimal' },
    dockedLigands: { type: 'number', label: 'Docked ligands', format: 'integer' },
    rejectedLigands: { type: 'number', label: 'Rejected ligands', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface DockingPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.molecular-docking-preflight';
  action: DockingToolMode;
  inputBytes: number;
  networkAccess: false;
  chains?: string[];
  heterogens?: Array<{ name: string; kind: 'water' | 'ion' | 'ligand-or-cofactor'; residues: number }>;
  ligandCount?: number;
  maxLigandHeavyAtoms?: number;
  oversizedLigands?: string[];
  site?: { center: number[]; size: number[]; volumeCubicAngstrom: number; largeSearchSpace: boolean };
}

export interface DockingResourcePreflight {
  metrics: DockingPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface DockingFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface ReceptorPreparationSummary {
  kind: 'liatir.receptor-preparation-report';
  options: LiatirReceptorPreparationOptions;
  before: { atoms: number; residues: number; chains: Record<string, number>; heterogens: HeterogenRow[] };
  after: { atoms: number; residues: number; chains: Record<string, number>; heterogens: HeterogenRow[] };
  changes: Array<Record<string, JsonValue> & { step: string }>;
  protonationTemplates: Record<string, number>;
  receptorPdbqtAtoms: number;
  receptorPdbqtSha256: string;
  netPartialCharge: number;
  versions: Record<string, string>;
  networkAccess: false;
  hardwareEstimate: DockingAcceptedEstimate;
}

interface HeterogenRow {
  residue: string;
  name: string;
  kind: 'water' | 'ion' | 'ligand-or-cofactor';
  atoms: number;
}

interface DockingRankingRow extends LiatirDockingPoseRow {
  inputName: string;
  smiles: string;
}

interface DockingSummary {
  kind: 'liatir.docking-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: Record<string, string>;
  experiment: LiatirDockingExperimentIdentity;
  site: { mode: string; center: number[]; size: number[]; volumeCubicAngstrom: number; largeSearchSpace: boolean };
  options: LiatirDockingOptions;
  ligandCount: number;
  dockedLigands: number;
  rejectedLigands: Array<{ inputIndex: number; inputName: string; reason: string }>;
  poseCount: number;
  ranking: DockingRankingRow[];
  bestPoseComplex: { ligand: string; chain: string; receptorAtoms: number; ligandAtoms: number; scoreKcalPerMol: number } | null;
  database: { appended: boolean; sourceSha256: string | null; storedLigands: number; storedPoses: number };
  elapsedSeconds: number;
  networkAccess: false;
  hardwareEstimate: DockingAcceptedEstimate;
}

type DockingResultPayload = {
  schemaVersion: 1;
  kind: 'liatir.molecular-docking-result';
  action: 'prepare-receptor';
  paths: { preparedReceptorPdb: string; receptorPdbqt: string; reportJson: string };
  summary: ReceptorPreparationSummary;
} | {
  schemaVersion: 1;
  kind: 'liatir.molecular-docking-result';
  action: 'dock';
  paths: {
    posesSdf: string; scoresCsv: string; screeningDatabase: string; summaryJson: string;
    bestPoseComplexPdb?: string;
  };
  summary: DockingSummary;
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

function inputList(value: string | undefined, upper = false): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
    .map((item) => (upper ? item.toUpperCase() : item));
}

export function receptorPreparationOptions(inputs: Record<string, string>): LiatirReceptorPreparationOptions {
  const options: LiatirReceptorPreparationOptions = {
    keepChains: inputList(inputs.keepChains),
    removeWaters: inputBoolean(inputs.removeWaters, DEFAULT_RECEPTOR_PREPARATION_OPTIONS.removeWaters),
    removeResidueNames: inputList(inputs.removeResidueNames, true),
    addMissingAtoms: inputBoolean(inputs.addMissingAtoms, DEFAULT_RECEPTOR_PREPARATION_OPTIONS.addMissingAtoms),
    addMissingResidues: inputBoolean(inputs.addMissingResidues, DEFAULT_RECEPTOR_PREPARATION_OPTIONS.addMissingResidues),
    replaceNonstandardResidues: inputBoolean(inputs.replaceNonstandardResidues,
      DEFAULT_RECEPTOR_PREPARATION_OPTIONS.replaceNonstandardResidues),
    ph: inputNumber(inputs.ph, DEFAULT_RECEPTOR_PREPARATION_OPTIONS.ph, 'Protonation pH'),
  };
  const validation = validateReceptorPreparationOptions(options);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return options;
}

export function dockingSite(inputs: Record<string, string>): LiatirDockingSite {
  const mode = inputs.siteMode || 'reference-ligand';
  const site: LiatirDockingSite = mode === 'box'
    ? {
        mode: 'box',
        center: [
          inputNumber(inputs.centerX, Number.NaN, 'Box centre x'),
          inputNumber(inputs.centerY, Number.NaN, 'Box centre y'),
          inputNumber(inputs.centerZ, Number.NaN, 'Box centre z'),
        ],
        size: [
          inputNumber(inputs.sizeX, 20, 'Box size x'),
          inputNumber(inputs.sizeY, 20, 'Box size y'),
          inputNumber(inputs.sizeZ, 20, 'Box size z'),
        ],
      }
    : mode === 'reference-ligand'
      ? { mode: 'reference-ligand', referenceLigand: inputs.referenceLigand ?? '',
          paddingAngstrom: inputNumber(inputs.paddingAngstrom, 5, 'Box padding') }
      : (() => { throw new Error('The binding site must be a reference ligand or an explicit box.'); })();
  const validation = validateDockingSite(site);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return site;
}

export function dockingOptions(inputs: Record<string, string>): LiatirDockingOptions {
  const scoring = inputs.scoringFunction || DEFAULT_DOCKING_OPTIONS.scoringFunction;
  if (scoring !== 'vina' && scoring !== 'vinardo') throw new Error('The scoring function must be vina or vinardo.');
  const options: LiatirDockingOptions = {
    scoringFunction: scoring,
    exhaustiveness: inputNumber(inputs.exhaustiveness, DEFAULT_DOCKING_OPTIONS.exhaustiveness, 'Exhaustiveness'),
    numPoses: inputNumber(inputs.numPoses, DEFAULT_DOCKING_OPTIONS.numPoses, 'Poses per ligand'),
    energyRangeKcalPerMol: inputNumber(inputs.energyRangeKcalPerMol, DEFAULT_DOCKING_OPTIONS.energyRangeKcalPerMol,
      'Energy range'),
    minRmsdAngstrom: DEFAULT_DOCKING_OPTIONS.minRmsdAngstrom,
    seed: inputNumber(inputs.seed, DEFAULT_DOCKING_OPTIONS.seed, 'Seed'),
    cpu: inputNumber(inputs.cpuThreads, DEFAULT_DOCKING_OPTIONS.cpu, 'CPU threads'),
    addLigandHydrogens: inputBoolean(inputs.addLigandHydrogens, DEFAULT_DOCKING_OPTIONS.addLigandHydrogens),
  };
  const validation = validateDockingOptions(options);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return options;
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
  if (!activation) throw new Error('The installed docking Runtime Box has no verified activation identity.');
  return activation;
}

function pythonInput(
  action: 'preflight-receptor' | 'preflight-dock' | DockingToolMode,
  mode: DockingToolMode,
  inputs: Record<string, string>,
  activation: LiatirRuntimeBoxActivationMetadata,
  options: { outputDir?: string; estimate?: DockingAcceptedEstimate } = {},
): Record<string, JsonValue> {
  const common = {
    action,
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
  if (mode === 'prepare-receptor') {
    return {
      ...common,
      inputStructure: inputs.inputStructure,
      preparation: receptorPreparationOptions(inputs) as unknown as JsonValue,
    };
  }
  const site = dockingSite(inputs);
  return {
    ...common,
    receptorPdbqt: inputs.receptorPdbqt,
    receptorStructure: inputs.receptorStructure || '',
    ligandsSdf: inputs.ligandsSdf,
    screeningDatabase: inputs.screeningDatabase || '',
    site: site as unknown as JsonValue,
    docking: dockingOptions(inputs) as unknown as JsonValue,
  };
}

/** Lightweight standard-library preflight, then the measured envelope for this exact release and target. */
export async function preflightDockingWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  mode: DockingToolMode,
  inputs: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<DockingResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) {
    throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  }
  if (mode === 'prepare-receptor' && !inputs.inputStructure) throw new Error('A PDB or mmCIF protein structure is required.');
  if (mode === 'dock' && (!inputs.receptorPdbqt || !inputs.ligandsSdf)) {
    throw new Error('A receptor PDBQT and a ligand SDF are required.');
  }
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(
    runtime,
    MOLECULAR_DOCKING_SCRIPT,
    pythonInput(mode === 'prepare-receptor' ? 'preflight-receptor' : 'preflight-dock', mode, inputs, activation),
    { trackJob: false, timeoutSeconds: 120 },
  );
  if (!result.ok) throw new Error(result.stderr || `Docking preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<DockingPreflightPayload>(result.stdout, 'Docking preflight');
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.molecular-docking-preflight' || metrics.action !== mode) {
    throw new Error('Docking preflight returned an unsupported result contract.');
  }
  const profile = phase3HardwareValidationProfile({
    componentId: runtime.id,
    componentVersion: runtime.version,
    runtimeBoxRelease: activation.release.version,
    target: activation.selectedTarget,
  });
  const estimate: LiatirHardwareResourcePreflight = profile
    ? estimateHardwareResources(metrics, profile, host)
    : {
        accepted: false,
        reason: 'no-evidence',
        error: 'No retained measured hardware envelope is available for this exact docking release and target.',
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
  scientific?: RunOutputFile['scientific'],
): Promise<RunOutputFile> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const size = await api.invoke('lia_file_size', { path }) as number;
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(`${label} is empty or unreadable.`);
  return { label, path, ext, fieldKey, role: 'final', size, ...(scientific ? { scientific } : {}) };
}

function provenanceFor(
  activation: LiatirRuntimeBoxActivationMetadata,
  estimate: DockingAcceptedEstimate,
  seed: number,
  computeDevice: string,
  model: LiatirPhase3ResultProvenance['model'],
): LiatirPhase3ResultProvenance {
  if (!estimate?.accepted || !estimate.hardwareProfileId) {
    throw new Error('The docking result has no accepted measured hardware envelope.');
  }
  return {
    schemaVersion: 1,
    componentId: MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
    model,
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice,
    precision: 'double',
    seed,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: MOLECULAR_DOCKING_BOX_ID,
      runtimeId: MOLECULAR_DOCKING_RUNTIME_ID,
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: estimate.hardwareProfileId,
    hardwareEvidence: estimate.evidence,
  };
}

function provenanceRows(provenance: LiatirPhase3ResultProvenance, extra: Array<[string, string | number]>) {
  return [
    ...extra,
    ['Compute', provenance.computeDevice],
    ['Network access', 'Disabled'],
    ['Hardware evidence', provenance.hardwareProfileId],
    ['Within measured evidence', provenance.hardwareEvidence === 'measured'
      ? 'Yes'
      : 'No — the user confirmed a run larger than any retained measurement'],
    ['Runtime Box', `${provenance.scrollcase.releaseVersion} · ${runtimeBoxTargetId(provenance.scrollcase.target)}`],
    ['Runtime Box archive SHA-256', provenance.scrollcase.archiveSha256],
  ] satisfies (string | number)[][];
}

function assertRuntimeIdentity(
  runtime: LiatirToolRuntimeRecord,
  activation: LiatirRuntimeBoxActivationMetadata,
  versions: Record<string, string>,
  summary: { runtimeBoxRelease?: string; targetId?: string },
): void {
  if (runtime.id !== MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID) throw new Error('Unexpected Tool Runtime for a docking result.');
  if (versions.vina !== AUTODOCK_VINA_VERSION || versions.meeko !== MEEKO_VERSION || versions.ringtail !== RINGTAIL_VERSION) {
    throw new Error('The docking result came from a different scientific runtime.');
  }
  if (versions.pdbfixer !== undefined && versions.pdbfixer !== PDBFIXER_VERSION) {
    throw new Error('Receptor preparation used an unreviewed PDBFixer.');
  }
  if (summary.runtimeBoxRelease !== undefined && summary.runtimeBoxRelease !== activation.release.version) {
    throw new Error('The docking result release does not match the verified Runtime Box activation.');
  }
  if (summary.targetId !== undefined && summary.targetId !== runtimeBoxTargetId(activation.selectedTarget)) {
    throw new Error('The docking result target does not match the verified Runtime Box activation.');
  }
}

function changeDetail(change: Record<string, JsonValue> & { step: string }): string {
  if (change.step === 'remove-input-hydrogens') return `${change.count} input hydrogens replaced`;
  if (change.step === 'add-hydrogens') return `Re-protonated at pH ${change.ph}`;
  if (change.step === 'remove-chains') return `Removed chains ${(change.chains as string[]).join(', ')}`;
  if (change.step === 'remove-residues') {
    const removed = change.residues as Array<{ residue: string }>;
    return `Removed ${removed.length}: ${removed.slice(0, 8).map((item) => item.residue).join(', ')}${removed.length > 8 ? '…' : ''}`;
  }
  if (change.step === 'add-missing-atoms') {
    const residues = (change.residues as Array<{ residue: string }>) ?? [];
    const terminals = (change.terminals as Array<{ residue: string; atoms: string[] }>) ?? [];
    return [
      residues.length ? `${residues.length} residues completed` : '',
      ...terminals.map((item) => `${item.residue}: ${item.atoms.join(' ')}`),
    ].filter(Boolean).join('; ') || 'Missing atoms added';
  }
  if (change.step === 'add-missing-residues') return 'Internal gaps modelled';
  if (change.step === 'replace-nonstandard-residues') return 'Non-standard residues replaced';
  return change.step;
}

export async function finalizeReceptorPreparationResult(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<DockingFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `Receptor preparation exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<DockingResultPayload>(result.stdout, 'Receptor preparation');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.molecular-docking-result' || parsed.action !== 'prepare-receptor') {
    throw new Error('Receptor preparation returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  assertRuntimeIdentity(runtime, activation, summary.versions, {});
  if (summary.networkAccess !== false) throw new Error('Receptor preparation left its offline boundary.');
  await dataFiles.init();
  const paths = {
    prepared: safeOutputPath(parsed.paths.preparedReceptorPdb, outputDir, 'Prepared receptor'),
    pdbqt: safeOutputPath(parsed.paths.receptorPdbqt, outputDir, 'Receptor PDBQT'),
    report: safeOutputPath(parsed.paths.reportJson, outputDir, 'Preparation report'),
  };
  const inputScientific = await inspectStructureArtifact(inputs.inputStructure, {
    format: inputs.inputStructure.toLowerCase().endsWith('.pdb') ? 'pdb' : 'mmcif',
    recognizedFormat: true, atomCount: summary.before.atoms, modelCount: 1, finiteCoordinates: true,
  });
  await dataFiles.setScientific(inputs.inputStructure, inputScientific);
  const lineage = {
    sources: [liatirArtifactLineageSource(inputScientific, 'input', 'inputStructure')],
    transformation: {
      id: receptorPreparationDefinition.id,
      label: receptorPreparationDefinition.label,
      version: '1',
      sourceRevision: `pdbfixer-${PDBFIXER_VERSION}+meeko-${MEEKO_VERSION}`,
      parameters: summary.options as unknown as Record<string, JsonValue>,
    },
  };
  const preparedScientific = await inspectStructureArtifact(paths.prepared, {
    format: 'pdb', recognizedFormat: true, atomCount: summary.after.atoms, modelCount: 1, finiteCoordinates: true,
  }, { lineage, viewerHints: { preferredViewer: 'structure-viewer' } });
  // PDBFixer places repaired atoms with seed 1 in the runner, so that is the seed this Result records.
  const provenance = provenanceFor(activation, summary.hardwareEstimate, 1,
    'OpenMM CPU platform (PDBFixer) · 1 thread', null);
  const removedHeterogens = new Set(summary.changes
    .filter((change) => change.step === 'remove-residues')
    .flatMap((change) => (change.residues as Array<{ residue: string }>).map((item) => item.residue)));
  const heterogenRows = summary.before.heterogens.slice(0, 200).map((item) => [
    item.residue, item.kind, item.atoms, removedHeterogens.has(item.residue) ? 'Removed' : 'Kept',
  ]);
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Atoms before', value: summary.before.atoms },
      { label: 'Atoms after', value: summary.after.atoms },
      { label: 'Receptor PDBQT atoms', value: summary.receptorPdbqtAtoms },
      { label: 'Net partial charge', value: summary.netPartialCharge.toFixed(2) },
    ] },
    { type: 'table', label: 'Changes made', headers: ['Step', 'Detail'],
      rows: summary.changes.map((change) => [change.step, changeDetail(change)]) },
    ...(heterogenRows.length ? [{ type: 'table' as const, label: 'Non-polymer residues in the input',
      headers: ['Residue', 'Kind', 'Atoms', 'Outcome'], rows: heterogenRows }] : []),
    { type: 'table', label: 'Protonation states assigned', headers: ['Residue template', 'Count'],
      rows: Object.entries(summary.protonationTemplates).map(([template, count]) => [template, count]) },
    { type: 'structure-viewer', label: 'Prepared receptor', path: paths.prepared, format: 'pdb',
      style: 'cartoon', colorScheme: 'chain', height: 460 },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows(provenance, [
      ['Tool Runtime', `PDBFixer ${PDBFIXER_VERSION} · Meeko ${MEEKO_VERSION}`],
      ['Protonation', `OpenMM rules at pH ${summary.options.ph}; input hydrogens replaced`],
    ]) },
  ] };
  return {
    outputFiles: [
      await outputFile('Prepared receptor', paths.prepared, 'pdb', 'preparedReceptor', preparedScientific),
      await outputFile('Receptor for docking', paths.pdbqt, 'pdbqt', 'receptorPdbqt'),
      await outputFile('Preparation report', paths.report, 'json', 'preparationReport'),
    ],
    output,
    metrics: { receptorAtoms: summary.receptorPdbqtAtoms, netPartialCharge: summary.netPartialCharge },
    values: {
      receptorAtoms: summary.receptorPdbqtAtoms,
      netPartialCharge: summary.netPartialCharge,
      provenance: provenance as unknown as JsonValue,
    },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function finalizeDockingResult(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<DockingFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `Docking exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<DockingResultPayload>(result.stdout, 'Docking');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.molecular-docking-result' || parsed.action !== 'dock') {
    throw new Error('Docking returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  assertRuntimeIdentity(runtime, activation, summary.versions, summary);
  if (summary.networkAccess !== false || summary.runtimeId !== MOLECULAR_DOCKING_RUNTIME_ID) {
    throw new Error('The docking result runtime or offline boundary is invalid.');
  }
  const rows = validateDockingPoseRows(summary.ranking);
  if (!rows.valid) throw new Error(rows.errors.join(' '));
  if (summary.dockedLigands + summary.rejectedLigands.length !== summary.ligandCount) {
    throw new Error('Every input ligand must be docked or rejected exactly once.');
  }
  await dataFiles.init();
  const paths = {
    poses: safeOutputPath(parsed.paths.posesSdf, outputDir, 'Docked poses'),
    scores: safeOutputPath(parsed.paths.scoresCsv, outputDir, 'Docking scores'),
    summary: safeOutputPath(parsed.paths.summaryJson, outputDir, 'Docking summary'),
    complex: parsed.paths.bestPoseComplexPdb
      ? safeOutputPath(parsed.paths.bestPoseComplexPdb, outputDir, 'Best pose complex')
      : null,
  };
  // An extended database is a new copy in this run's Results; the selected one is left as it was.
  const database = safeOutputPath(parsed.paths.screeningDatabase, outputDir, 'Screening database');
  const ligandScientific = await inspectStructureArtifact(inputs.ligandsSdf, {
    format: 'sdf', recognizedFormat: true, modelCount: summary.ligandCount, finiteCoordinates: true,
  });
  await dataFiles.setScientific(inputs.ligandsSdf, ligandScientific);
  const lineage = {
    sources: [liatirArtifactLineageSource(ligandScientific, 'input', 'ligandsSdf')],
    transformation: {
      id: molecularDockingDefinition.id,
      label: molecularDockingDefinition.label,
      version: '1',
      sourceRevision: `vina-${AUTODOCK_VINA_VERSION}+meeko-${MEEKO_VERSION}`,
      parameters: {
        experiment: summary.experiment as unknown as JsonValue,
        seed: summary.options.seed,
        cpu: summary.options.cpu,
        numPoses: summary.options.numPoses,
      },
    },
  };
  const posesScientific = await inspectStructureArtifact(paths.poses, {
    format: 'sdf', recognizedFormat: true, modelCount: summary.poseCount, finiteCoordinates: true,
  }, { lineage });
  const complexScientific = paths.complex && summary.bestPoseComplex
    ? await inspectStructureArtifact(paths.complex, {
        format: 'pdb', recognizedFormat: true, modelCount: 1, finiteCoordinates: true,
        atomCount: summary.bestPoseComplex.receptorAtoms + summary.bestPoseComplex.ligandAtoms,
      }, { lineage, viewerHints: { preferredViewer: 'structure-viewer' } })
    : null;
  const provenance = provenanceFor(activation, summary.hardwareEstimate, summary.options.seed,
    `AutoDock Vina CPU · ${summary.options.cpu} threads`,
    { id: `autodock-vina-${summary.options.scoringFunction}`, version: AUTODOCK_VINA_VERSION });
  const best = summary.ranking[0];
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Ligands docked', value: summary.dockedLigands },
      { label: 'Ligands rejected', value: summary.rejectedLigands.length },
      { label: 'Best Vina score', value: `${best.scoreKcalPerMol.toFixed(3)} kcal/mol` },
      { label: 'Poses', value: summary.poseCount },
    ] },
    { type: 'text', label: 'Interpretation', content: MOLECULAR_DOCKING_INTERPRETATION_NOTICE },
    ...(paths.complex && summary.bestPoseComplex ? [{
      type: 'structure-viewer' as const,
      label: `Receptor with the best pose (${summary.bestPoseComplex.ligand}, chain ${summary.bestPoseComplex.chain})`,
      path: paths.complex, format: 'pdb' as const, style: 'cartoon' as const, colorScheme: 'chain' as const, height: 460,
    }] : []),
    { type: 'table', label: 'Ligand ranking (best pose each)',
      headers: ['Rank', 'Ligand', 'Vina score (kcal/mol)', 'Ligand efficiency', 'Heavy atoms'],
      rows: summary.ranking.slice(0, 50).map((row, index) => [
        index + 1, row.ligand, row.scoreKcalPerMol.toFixed(3), row.ligandEfficiency.toFixed(3), row.heavyAtoms,
      ]) },
    ...(summary.rejectedLigands.length ? [{ type: 'table' as const, label: 'Rejected ligands',
      headers: ['Input', 'Name', 'Reason'],
      rows: summary.rejectedLigands.slice(0, 200).map((item) => [item.inputIndex, item.inputName || '—', item.reason]) }] : []),
    { type: 'table', label: 'Search settings', headers: ['Setting', 'Value'], rows: [
      ['Box centre (Å)', summary.site.center.map((value) => value.toFixed(3)).join(', ')],
      ['Box size (Å)', summary.site.size.map((value) => value.toFixed(3)).join(', ')],
      ['Search volume', `${Math.round(summary.site.volumeCubicAngstrom).toLocaleString()} Å³${summary.site.largeSearchSpace ? ' (above Vina’s 27,000 Å³ warning)' : ''}`],
      ['Scoring function', summary.options.scoringFunction],
      ['Exhaustiveness', summary.options.exhaustiveness],
      ['Poses per ligand', summary.options.numPoses],
      ['Energy range', `${summary.options.energyRangeKcalPerMol} kcal/mol`],
      ['Seed', summary.options.seed],
      ['Screening database', summary.database.appended ? `Extended (${summary.database.storedLigands} ligands)` : 'New'],
    ] },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows(provenance, [
      ['Tool Runtime', `AutoDock Vina ${AUTODOCK_VINA_VERSION} · Meeko ${MEEKO_VERSION} · Ringtail ${RINGTAIL_VERSION}`],
      ['Receptor PDBQT SHA-256', summary.experiment.receptorPdbqtSha256],
    ]) },
  ] };
  return {
    outputFiles: [
      await outputFile('Docked poses', paths.poses, 'sdf', 'dockedPoses', posesScientific),
      ...(paths.complex && complexScientific
        ? [await outputFile('Receptor with best pose', paths.complex, 'pdb', 'bestPoseComplex', complexScientific)]
        : []),
      await outputFile('Docking scores', paths.scores, 'csv', 'scoresCsv'),
      await outputFile('Screening database', database, 'db', 'screeningDatabase'),
      await outputFile('Docking summary', paths.summary, 'json', 'dockingSummary'),
    ],
    output,
    metrics: {
      dockedLigands: summary.dockedLigands,
      rejectedLigands: summary.rejectedLigands.length,
      bestScoreKcalPerMol: best.scoreKcalPerMol,
      poseCount: summary.poseCount,
    },
    values: {
      bestScore: best.scoreKcalPerMol,
      dockedLigands: summary.dockedLigands,
      rejectedLigands: summary.rejectedLigands.length,
      provenance: provenance as unknown as JsonValue,
    },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runDockingWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  mode: DockingToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
): Promise<DockingFinalizedResult> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) {
    throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  }
  const activation = activationFor(runtime);
  const preflight = await preflightDockingWithRuntime(runtime, mode, inputs, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  // Enforced here as well as on the screen: a pipeline step must not start an unmeasured run unconfirmed.
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This run is larger than any retained measurement and was not confirmed.');
  }
  const definition = mode === 'prepare-receptor' ? receptorPreparationDefinition : molecularDockingDefinition;
  onLog(`tool-runtime ${runtime.id}`);
  onLog(mode === 'prepare-receptor'
    ? `input ${basename(inputs.inputStructure)} · ${preflight.metrics.atomCount} atoms`
    : `ligands ${preflight.metrics.tokenCount} · receptor ${preflight.metrics.atomCount} atoms`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runToolRuntimePython(
    runtime,
    MOLECULAR_DOCKING_SCRIPT,
    pythonInput(mode, mode, inputs, activation, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: mode === 'prepare-receptor' ? 3_600 : 7 * 24 * 3_600,
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
  return mode === 'prepare-receptor'
    ? finalizeReceptorPreparationResult(runtime, inputs, outputDir, result, onLog)
    : finalizeDockingResult(runtime, inputs, outputDir, result, onLog);
}

async function runDockingStep(
  mode: DockingToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The molecular docking Tool Runtime has not completed publication for this Liatir release.');
  return runDockingWithRuntime(runtime, mode, inputs, outputDir, onLog, runContext);
}

export function runReceptorPreparationStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  return runDockingStep('prepare-receptor', inputs, outputDir, onLog, runContext);
}

export function runMolecularDockingStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  return runDockingStep('dock', inputs, outputDir, onLog, runContext);
}
