import {
  DEFAULT_INTERACTION_FINGERPRINT_OPTIONS,
  DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS,
  INTERACTION_FINGERPRINT_TOOL_ID,
  LIATIR_STRUCTURE_PROFILE_V1,
  MDANALYSIS_VERSION,
  MOLECULAR_ANALYSIS_BOX_ID,
  MOLECULAR_ANALYSIS_INTERPRETATION_NOTICE,
  MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID,
  MOLECULAR_ANALYSIS_RUNTIME_ID,
  PROLIF_OFFERED_INTERACTIONS,
  PROLIF_VERSION,
  TRAJECTORY_ANALYSIS_TOOL_ID,
  estimateHardwareResources,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  validateInteractionFingerprintOptions,
  validateTrajectoryAnalysisOptions,
  type JsonValue,
  type LiatirHardwareHostMemory,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourceExtrapolation,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirInteractionFingerprintOptions,
  type LiatirInteractionFingerprintSource,
  type LiatirLigandCandidate,
  type LiatirPhase3ResultProvenance,
  type LiatirProlifInteraction,
  type LiatirRuntimeBoxActivationMetadata,
  type LiatirRuntimeComponentPythonRunResult,
  type LiatirStepDefinition,
  type LiatirToolRuntimeRecord,
  type LiatirTrajectoryAnalysisOptions,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
import {
  toolRuntimeDirectRunMetadata,
  type ToolRuntimeDirectRunContext,
} from '$lib/tool-runtimes/direct-run-context';
import { runToolRuntimePython } from '$lib/tool-runtimes/runtime';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { MOLECULAR_ANALYSIS_SCRIPT } from './python-scripts/analysis';

export type AnalysisToolMode = 'trajectory' | 'fingerprint';

/** Either accepted outcome may start a run; only the measured one carries real figures. */
export type AnalysisAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

export const trajectoryAnalysisDefinition: LiatirStepDefinition = {
  id: TRAJECTORY_ANALYSIS_TOOL_ID,
  type: 'tool-runtime',
  label: 'Trajectory Analysis',
  description: 'Measure how a simulated protein and its ligand move: RMSD, per-residue fluctuation and distances.',
  category: 'Molecular Analysis',
  inputSchema: {
    topology: { type: 'file', label: 'Topology (PDB)', required: true, accept: ['pdb'],
      description: 'The structure written with the trajectory, with the same atoms in the same order.' },
    trajectory: { type: 'file', label: 'Trajectory (DCD or XTC)', required: true, accept: ['dcd', 'xtc'] },
    stateCsv: { type: 'file', label: 'Simulation state record (optional)', required: false, accept: ['csv'],
      description: 'OpenMM’s energy and temperature file; every frame time is checked against it.' },
    ligandSelection: { type: 'string', label: 'Ligand', required: false, default: '', connectable: false,
      description: 'Adds the ligand’s RMSD, measured after superposing the protein.' },
    rmsf: { type: 'boolean', label: 'Per-residue fluctuation (RMSF)', required: false, default: true, connectable: false },
    fitSelection: { type: 'string', label: 'Superpose on', required: false, connectable: false,
      default: DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS.fitSelection },
    distanceLabel: { type: 'string', label: 'Distance name', required: false, default: '', connectable: false },
    distanceA: { type: 'string', label: 'Distance from (atom selection)', required: false, default: '', connectable: false },
    distanceB: { type: 'string', label: 'Distance to (atom selection)', required: false, default: '', connectable: false },
    start: { type: 'number', label: 'First frame', required: false, default: 0, connectable: false },
    stop: { type: 'number', label: 'Stop before frame (empty for all)', required: false, connectable: false },
    stride: { type: 'number', label: 'Every Nth frame', required: false, default: 1, connectable: false },
  },
  outputSchema: {
    rmsdCsv: { type: 'file', label: 'RMSD', ext: ['csv'] },
    rmsfCsv: { type: 'file', label: 'RMSF', ext: ['csv'] },
    distancesCsv: { type: 'file', label: 'Distances', ext: ['csv'] },
    summaryJson: { type: 'file', label: 'Analysis summary', ext: ['json'] },
    framesAnalysed: { type: 'number', label: 'Frames analysed', format: 'integer' },
    proteinRmsdFinal: { type: 'number', label: 'Final protein RMSD (Å)', format: 'decimal' },
    ligandRmsdMaximum: { type: 'number', label: 'Largest ligand RMSD (Å)', format: 'decimal' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

export const interactionFingerprintDefinition: LiatirStepDefinition = {
  id: INTERACTION_FINGERPRINT_TOOL_ID,
  type: 'tool-runtime',
  label: 'Interaction Fingerprint',
  description: 'List the contacts between a ligand and its protein, frame by frame or pose by pose, with ProLIF.',
  category: 'Molecular Analysis',
  inputSchema: {
    source: { type: 'string', label: 'Read from', required: true, default: 'trajectory', connectable: false,
      options: [{ value: 'trajectory', label: 'A simulation trajectory' }, { value: 'poses', label: 'Docked poses' }] },
    topology: { type: 'file', label: 'Topology (PDB)', required: false, accept: ['pdb'] },
    trajectory: { type: 'file', label: 'Trajectory (DCD or XTC)', required: false, accept: ['dcd', 'xtc'] },
    ligandSelection: { type: 'string', label: 'Ligand', required: false, default: '', connectable: false },
    ligandReferenceSdf: { type: 'file', label: 'Ligand as simulated (SDF, optional)', required: false, accept: ['sdf'],
      description: 'The molecule the simulation started from; the ligand read from the trajectory must be the same.' },
    receptor: { type: 'file', label: 'Receptor with hydrogens (PDB)', required: false, accept: ['pdb'],
      artifact: { profiles: [{ ...LIATIR_STRUCTURE_PROFILE_V1 }], formats: ['pdb'], scientificTypes: ['molecular-structure'],
        validation: 'valid-or-partial' } },
    poses: { type: 'file', label: 'Docked poses (SDF)', required: false, accept: ['sdf'] },
    interactions: { type: 'string', label: 'Interactions', required: false, connectable: false,
      default: DEFAULT_INTERACTION_FINGERPRINT_OPTIONS.interactions.join(','),
      description: `Comma-separated, from: ${PROLIF_OFFERED_INTERACTIONS.join(', ')}.` },
    start: { type: 'number', label: 'First frame', required: false, default: 0, connectable: false },
    stop: { type: 'number', label: 'Stop before frame (empty for all)', required: false, connectable: false },
    stride: { type: 'number', label: 'Every Nth frame', required: false, default: 1, connectable: false },
  },
  outputSchema: {
    interactionsCsv: { type: 'file', label: 'Interactions', ext: ['csv'] },
    frequenciesCsv: { type: 'file', label: 'Interaction frequencies', ext: ['csv'] },
    matrixCsv: { type: 'file', label: 'Fingerprint matrix', ext: ['csv'] },
    summaryJson: { type: 'file', label: 'Fingerprint summary', ext: ['json'] },
    distinctInteractions: { type: 'number', label: 'Distinct interactions', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface AnalysisPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.molecular-analysis-preflight';
  action: 'analyze-trajectory' | 'fingerprint';
  source?: LiatirInteractionFingerprintSource;
  topology: { atoms: number; residues: number; hydrogens: number; proteinResidues: number; ligandCandidates: LiatirLigandCandidate[] };
  trajectory?: { format: 'dcd' | 'xtc'; atoms: number; frames: number; periodic: boolean; startTimePs: number; frameIntervalPs: number | null };
  poses?: { poses: number; maxPoseAtoms: number };
  inputBytes: number;
  networkAccess: false;
}

export interface AnalysisResourcePreflight {
  metrics: AnalysisPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface AnalysisFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface SeriesStatistics { minimum: number; maximum: number; mean: number; final: number }

interface TrajectorySummary {
  kind: 'liatir.trajectory-analysis-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: Record<string, string>;
  trajectory: NonNullable<AnalysisPreflightPayload['trajectory']>;
  framesAnalysed: number;
  periodic: boolean;
  periodicTreatment: string | null;
  stateRecordChecked: boolean;
  reference: { frame: number; timePs: number };
  superposition: { selection: string; atoms: number };
  rmsd: Array<SeriesStatistics & { label: string; selection: string; atoms: number }>;
  rmsf: { selection: string; atoms: number; maximum: number; mean: number } | null;
  distances: Array<{ label: string; minimumDistance: SeriesStatistics; centroidDistance: SeriesStatistics }>;
  networkAccess: false;
  hardwareEstimate: AnalysisAcceptedEstimate;
}

interface FingerprintSummary {
  kind: 'liatir.interaction-fingerprint-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: Record<string, string>;
  source: LiatirInteractionFingerprintSource;
  interactions: string[];
  ligandReference: string | null;
  bonds: { protein: 'topology' | 'distance-derived'; ligand: 'topology' | 'sdf' };
  periodicTreatment: string | null;
  count: number;
  distinctInteractions: number;
  mostFrequent: Array<{ ligandResidue: string; proteinResidue: string; interaction: string; count: number; fraction: number }>;
  networkAccess: false;
  hardwareEstimate: AnalysisAcceptedEstimate;
}

type AnalysisResultPayload = {
  schemaVersion: 1;
  kind: 'liatir.molecular-analysis-result';
  action: 'analyze-trajectory';
  paths: Partial<Record<'rmsdCsv' | 'rmsfCsv' | 'distancesCsv' | 'rmsdPlot' | 'rmsfPlot' | 'distancesPlot', string>>
    & { summaryJson: string };
  summary: TrajectorySummary;
} | {
  schemaVersion: 1;
  kind: 'liatir.molecular-analysis-result';
  action: 'fingerprint';
  paths: { interactionsCsv: string; frequenciesCsv: string; matrixCsv: string; plot: string; summaryJson: string };
  summary: FingerprintSummary;
};

function basename(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

function inputInteger(value: string | undefined, fallback: number | null, label: string): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} must be a whole number.`);
  return number;
}

function frameWindow(inputs: Record<string, string>) {
  return {
    start: inputInteger(inputs.start, 0, 'First frame') ?? 0,
    stop: inputInteger(inputs.stop, null, 'Frame range end'),
    stride: inputInteger(inputs.stride, 1, 'Frame step') ?? 1,
  };
}

export function trajectoryAnalysisOptions(inputs: Record<string, string>): LiatirTrajectoryAnalysisOptions {
  const ligand = (inputs.ligandSelection ?? '').trim();
  const options: LiatirTrajectoryAnalysisOptions = {
    fitSelection: (inputs.fitSelection ?? '').trim() || DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS.fitSelection,
    rmsd: [
      ...DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS.rmsd,
      ...(ligand ? [{ label: 'Ligand', selection: `(${ligand}) and not element H` }] : []),
    ],
    rmsf: inputs.rmsf === 'false' ? null : DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS.rmsf,
    distances: inputs.distanceA?.trim() && inputs.distanceB?.trim()
      ? [{ label: inputs.distanceLabel?.trim() || 'Distance', selectionA: inputs.distanceA.trim(),
          selectionB: inputs.distanceB.trim() }]
      : [],
    ...frameWindow(inputs),
  };
  const validation = validateTrajectoryAnalysisOptions(options);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return options;
}

export function interactionFingerprintOptions(inputs: Record<string, string>): LiatirInteractionFingerprintOptions {
  const source = fingerprintSource(inputs);
  const requested = (inputs.interactions ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const options: LiatirInteractionFingerprintOptions = {
    ligandSelection: (inputs.ligandSelection ?? '').trim(),
    proteinSelection: DEFAULT_INTERACTION_FINGERPRINT_OPTIONS.proteinSelection,
    interactions: (requested.length ? requested : DEFAULT_INTERACTION_FINGERPRINT_OPTIONS.interactions) as LiatirProlifInteraction[],
    ...frameWindow(inputs),
  };
  const validation = validateInteractionFingerprintOptions(options, source);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return options;
}

function fingerprintSource(inputs: Record<string, string>): LiatirInteractionFingerprintSource {
  const source = inputs.source || 'trajectory';
  if (source !== 'trajectory' && source !== 'poses') throw new Error('Interaction fingerprints read a trajectory or docked poses.');
  return source;
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
  if (!activation) throw new Error('The installed analysis Runtime Box has no verified activation identity.');
  return activation;
}

function pythonInput(
  mode: AnalysisToolMode,
  preflight: boolean,
  inputs: Record<string, string>,
  activation: LiatirRuntimeBoxActivationMetadata,
  options: { outputDir?: string; estimate?: AnalysisAcceptedEstimate } = {},
): Record<string, JsonValue> {
  const common = {
    action: mode === 'trajectory'
      ? (preflight ? 'preflight-trajectory' : 'analyze-trajectory')
      : (preflight ? 'preflight-fingerprint' : 'fingerprint'),
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
  if (mode === 'trajectory') {
    return { ...common, topology: inputs.topology, trajectory: inputs.trajectory, stateCsv: inputs.stateCsv || '',
      analysis: trajectoryAnalysisOptions(inputs) as unknown as JsonValue };
  }
  const source = fingerprintSource(inputs);
  return {
    ...common,
    source,
    ...(source === 'trajectory'
      ? { topology: inputs.topology, trajectory: inputs.trajectory, ligandReferenceSdf: inputs.ligandReferenceSdf || '' }
      : { receptor: inputs.receptor, poses: inputs.poses }),
    fingerprint: interactionFingerprintOptions(inputs) as unknown as JsonValue,
  };
}

function requiredInputs(mode: AnalysisToolMode, inputs: Record<string, string>): void {
  if (mode === 'trajectory' || fingerprintSource(inputs) === 'trajectory') {
    if (!inputs.topology || !inputs.trajectory) throw new Error('A topology PDB and its trajectory are required.');
  } else if (!inputs.receptor || !inputs.poses) {
    throw new Error('A receptor PDB with hydrogens and the docked poses SDF are required.');
  }
}

/** Standard-library preflight, then the measured envelope for this exact release and target. */
export async function preflightAnalysisWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  mode: AnalysisToolMode,
  inputs: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<AnalysisResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  requiredInputs(mode, inputs);
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(runtime, MOLECULAR_ANALYSIS_SCRIPT, pythonInput(mode, true, inputs, activation),
    { trackJob: false, timeoutSeconds: 300 });
  if (!result.ok) throw new Error(result.stderr || `Analysis preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<AnalysisPreflightPayload>(result.stdout, 'Analysis preflight');
  const expected = mode === 'trajectory' ? 'analyze-trajectory' : 'fingerprint';
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.molecular-analysis-preflight' || metrics.action !== expected) {
    throw new Error('Analysis preflight returned an unsupported result contract.');
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
        error: 'No retained measured hardware envelope is available for this exact analysis release and target.',
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

async function outputFile(label: string, path: string, ext: string, fieldKey: string, role: RunOutputFile['role'] = 'final'):
Promise<RunOutputFile> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const size = await api.invoke('lia_file_size', { path }) as number;
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(`${label} is empty or unreadable.`);
  return { label, path, ext, fieldKey, role, size };
}

async function readPlot(path: string, label: string): Promise<{ data: object[]; layout?: object }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const value = JSON.parse(await api.invoke('lia_read_file_text', { path }) as string) as { data?: unknown; layout?: unknown };
  if (!Array.isArray(value.data) || !value.data.every((item) => item && typeof item === 'object')) {
    throw new Error(`${label} plot data is invalid.`);
  }
  return { data: value.data as object[], ...(value.layout && typeof value.layout === 'object' ? { layout: value.layout as object } : {}) };
}

function provenanceFor(activation: LiatirRuntimeBoxActivationMetadata, estimate: AnalysisAcceptedEstimate): LiatirPhase3ResultProvenance {
  if (!estimate?.accepted || !estimate.hardwareProfileId) throw new Error('The analysis result has no accepted measured hardware envelope.');
  return {
    schemaVersion: 1,
    componentId: MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID,
    model: null,
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: 'CPU · 1 process',
    precision: 'double',
    // Nothing in these analyses is random.
    seed: 0,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: MOLECULAR_ANALYSIS_BOX_ID,
      runtimeId: MOLECULAR_ANALYSIS_RUNTIME_ID,
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
    ['Tool Runtime', `MDAnalysis ${MDANALYSIS_VERSION} · ProLIF ${PROLIF_VERSION}`],
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
  summary: { runtimeId: string; runtimeBoxRelease: string; targetId: string; versions: Record<string, string>; networkAccess: false },
): void {
  if (runtime.id !== MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID || summary.runtimeId !== MOLECULAR_ANALYSIS_RUNTIME_ID) {
    throw new Error('Unexpected Tool Runtime for an analysis result.');
  }
  if (summary.versions.MDAnalysis !== MDANALYSIS_VERSION || summary.versions.prolif !== PROLIF_VERSION) {
    throw new Error('The analysis result came from a different scientific runtime.');
  }
  if (summary.runtimeBoxRelease !== activation.release.version
    || summary.targetId !== runtimeBoxTargetId(activation.selectedTarget)) {
    throw new Error('The analysis result does not match the verified Runtime Box activation.');
  }
  if (summary.networkAccess !== false) throw new Error('The analysis left its offline boundary.');
}

function parseResult(result: LiatirRuntimeComponentPythonRunResult, action: AnalysisResultPayload['action'], label: string) {
  if (!result.ok) throw new Error(result.stderr || `${label} exited with code ${result.exitCode}`);
  const parsed = parsePythonJson<AnalysisResultPayload>(result.stdout, label);
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.molecular-analysis-result' || parsed.action !== action) {
    throw new Error(`${label} returned an unsupported result contract.`);
  }
  return parsed;
}

const fixed = (value: number, digits = 2) => value.toFixed(digits);

export async function finalizeTrajectoryAnalysisResult(
  runtime: LiatirToolRuntimeRecord,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<AnalysisFinalizedResult> {
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parseResult(result, 'analyze-trajectory', 'Trajectory analysis');
  if (parsed.action !== 'analyze-trajectory') throw new Error('Trajectory analysis returned another action.');
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  assertRuntimeIdentity(runtime, activation, summary);
  const provenance = provenanceFor(activation, summary.hardwareEstimate);
  const protein = summary.rmsd.find((item) => item.label === 'Protein C-alpha') ?? summary.rmsd[0] ?? null;
  const ligand = summary.rmsd.find((item) => item.label === 'Ligand') ?? null;
  const files: Array<[string, string | undefined, string, string, RunOutputFile['role']]> = [
    ['RMSD', parsed.paths.rmsdCsv, 'csv', 'rmsdCsv', 'final'],
    ['RMSF', parsed.paths.rmsfCsv, 'csv', 'rmsfCsv', 'final'],
    ['Distances', parsed.paths.distancesCsv, 'csv', 'distancesCsv', 'final'],
    ['Analysis summary', parsed.paths.summaryJson, 'json', 'summaryJson', 'final'],
    ['RMSD plot data', parsed.paths.rmsdPlot, 'json', 'rmsdPlotJson', 'intermediate'],
    ['RMSF plot data', parsed.paths.rmsfPlot, 'json', 'rmsfPlotJson', 'intermediate'],
    ['Distance plot data', parsed.paths.distancesPlot, 'json', 'distancesPlotJson', 'intermediate'],
  ];
  const outputFiles: RunOutputFile[] = [];
  for (const [label, path, ext, key, role] of files) {
    if (path) outputFiles.push(await outputFile(label, safeOutputPath(path, outputDir, label), ext, key, role));
  }
  const plots: ToolOutput['sections'] = [];
  for (const [title, path] of [['RMSD from the first analysed frame', parsed.paths.rmsdPlot],
    ['Fluctuation of each atom (RMSF)', parsed.paths.rmsfPlot], ['Distances', parsed.paths.distancesPlot]] as const) {
    if (!path) continue;
    const plot = await readPlot(safeOutputPath(path, outputDir, title), title);
    plots.push({ type: 'plotly', plotlyType: 'scatter', title, data: plot.data, layout: plot.layout });
  }
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Frames analysed', value: summary.framesAnalysed },
      { label: 'Final protein RMSD', value: protein ? `${fixed(protein.final)} Å` : '—' },
      { label: 'Largest ligand RMSD', value: ligand ? `${fixed(ligand.maximum)} Å` : '—' },
      { label: 'Periodic box', value: summary.periodic ? 'Yes (unwrapped)' : 'No' },
    ] },
    { type: 'text', label: 'Interpretation', content: MOLECULAR_ANALYSIS_INTERPRETATION_NOTICE },
    ...plots,
    { type: 'table', label: 'Measurements', headers: ['Measurement', 'Atoms', 'Minimum', 'Mean', 'Maximum', 'Final'],
      rows: [
        ...summary.rmsd.map((item) => [`${item.label} RMSD (Å)`, item.atoms, fixed(item.minimum), fixed(item.mean), fixed(item.maximum), fixed(item.final)]),
        ...summary.distances.flatMap((item) => [
          [`${item.label}, closest atoms (Å)`, '—', fixed(item.minimumDistance.minimum), fixed(item.minimumDistance.mean), fixed(item.minimumDistance.maximum), fixed(item.minimumDistance.final)],
          [`${item.label}, centres (Å)`, '—', fixed(item.centroidDistance.minimum), fixed(item.centroidDistance.mean), fixed(item.centroidDistance.maximum), fixed(item.centroidDistance.final)],
        ]),
        ...(summary.rmsf ? [[`RMSF (Å)`, summary.rmsf.atoms, '—', fixed(summary.rmsf.mean), fixed(summary.rmsf.maximum), '—']] : []),
      ] },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows(provenance, [
      ['Trajectory', `${summary.trajectory.format.toUpperCase()} · ${summary.trajectory.frames} frames · ${summary.trajectory.atoms.toLocaleString()} atoms`],
      ['Reference frame', `${summary.reference.frame} (${fixed(summary.reference.timePs, 3)} ps)`],
      ['Superposed on', `${summary.superposition.selection} (${summary.superposition.atoms} atoms)`],
      ['Periodic box', summary.periodicTreatment ?? 'None'],
      ['Frame times', summary.stateRecordChecked ? 'Checked against the simulation’s state record' : 'As recorded in the trajectory'],
    ]) },
  ] };
  return {
    outputFiles,
    output,
    metrics: { framesAnalysed: summary.framesAnalysed, ...(protein ? { proteinRmsdFinal: protein.final } : {}),
      ...(ligand ? { ligandRmsdMaximum: ligand.maximum } : {}) },
    values: { framesAnalysed: summary.framesAnalysed, ...(protein ? { proteinRmsdFinal: protein.final } : {}),
      ...(ligand ? { ligandRmsdMaximum: ligand.maximum } : {}), provenance: provenance as unknown as JsonValue },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function finalizeInteractionFingerprintResult(
  runtime: LiatirToolRuntimeRecord,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<AnalysisFinalizedResult> {
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parseResult(result, 'fingerprint', 'Interaction fingerprint');
  if (parsed.action !== 'fingerprint') throw new Error('Interaction fingerprint returned another action.');
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  assertRuntimeIdentity(runtime, activation, summary);
  const provenance = provenanceFor(activation, summary.hardwareEstimate);
  const unit = summary.source === 'trajectory' ? 'frames' : 'poses';
  const plot = await readPlot(safeOutputPath(parsed.paths.plot, outputDir, 'Interaction plot'), 'Interaction');
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: summary.source === 'trajectory' ? 'Frames' : 'Poses', value: summary.count },
      { label: 'Distinct interactions', value: summary.distinctInteractions },
      { label: 'Interaction types', value: summary.interactions.length },
      { label: 'Protein bonds', value: summary.bonds.protein === 'topology' ? 'From the file' : 'From atom distances' },
    ] },
    { type: 'text', label: 'Interpretation', content: MOLECULAR_ANALYSIS_INTERPRETATION_NOTICE },
    { type: 'plotly', plotlyType: 'bar', title: `How often each interaction occurs, across ${summary.count} ${unit}`,
      data: plot.data, layout: plot.layout },
    { type: 'table', label: 'Most frequent interactions', headers: ['Protein residue', 'Interaction', `Share of ${unit}`],
      rows: summary.mostFrequent.map((item) => [item.proteinResidue, item.interaction, `${Math.round(item.fraction * 100)}%`]) },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows(provenance, [
      ['Read from', summary.source === 'trajectory' ? 'Simulation trajectory' : 'Docked poses'],
      ['Interactions', summary.interactions.join(', ')],
      ['Ligand checked against', summary.ligandReference ?? 'Not supplied'],
      ['Periodic box', summary.periodicTreatment ?? 'None'],
    ]) },
  ] };
  const outputFiles = [
    await outputFile('Interactions', safeOutputPath(parsed.paths.interactionsCsv, outputDir, 'Interactions'), 'csv', 'interactionsCsv'),
    await outputFile('Interaction frequencies', safeOutputPath(parsed.paths.frequenciesCsv, outputDir, 'Frequencies'), 'csv', 'frequenciesCsv'),
    await outputFile('Fingerprint matrix', safeOutputPath(parsed.paths.matrixCsv, outputDir, 'Matrix'), 'csv', 'matrixCsv'),
    await outputFile('Fingerprint summary', safeOutputPath(parsed.paths.summaryJson, outputDir, 'Summary'), 'json', 'summaryJson'),
    await outputFile('Interaction plot data', safeOutputPath(parsed.paths.plot, outputDir, 'Plot'), 'json', 'plotJson', 'intermediate'),
  ];
  return {
    outputFiles,
    output,
    metrics: { count: summary.count, distinctInteractions: summary.distinctInteractions },
    values: { distinctInteractions: summary.distinctInteractions, provenance: provenance as unknown as JsonValue },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runAnalysisWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  mode: AnalysisToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
): Promise<AnalysisFinalizedResult> {
  const activation = activationFor(runtime);
  const preflight = await preflightAnalysisWithRuntime(runtime, mode, inputs, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  // Enforced here as well as on the screen: a pipeline step must not start an unmeasured run unconfirmed.
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This run is larger than any retained measurement and was not confirmed.');
  }
  const definition = mode === 'trajectory' ? trajectoryAnalysisDefinition : interactionFingerprintDefinition;
  onLog(`tool-runtime ${runtime.id}`);
  onLog(preflight.metrics.trajectory
    ? `trajectory ${basename(inputs.trajectory)} · ${preflight.metrics.trajectory.frames} frames · ${preflight.metrics.atomCount} atoms`
    : `poses ${basename(inputs.poses)} · ${preflight.metrics.stepCount} poses`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runToolRuntimePython(
    runtime,
    MOLECULAR_ANALYSIS_SCRIPT,
    pythonInput(mode, false, inputs, activation, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: 7 * 24 * 3_600,
      jobLabel: runContext?.runKind === 'pipeline-step' ? `${runContext.pipelineName}: ${definition.label}` : definition.label,
      metadata: {
        toolId: definition.id,
        ...(runContext
          ? runContext.runKind === 'tool-runtime-direct' ? toolRuntimeDirectRunMetadata(runContext) : aiRunMetadata(runContext)
          : {}),
      },
      signal: runContext?.signal,
      onJobId: runContext?.onJobId,
    },
  );
  return mode === 'trajectory'
    ? finalizeTrajectoryAnalysisResult(runtime, outputDir, result, onLog)
    : finalizeInteractionFingerprintResult(runtime, outputDir, result, onLog);
}

async function runAnalysisStep(
  mode: AnalysisToolMode,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The molecular analysis Tool Runtime has not completed publication for this Liatir release.');
  return runAnalysisWithRuntime(runtime, mode, inputs, outputDir, onLog, runContext);
}

export function runTrajectoryAnalysisStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  return runAnalysisStep('trajectory', inputs, outputDir, onLog, runContext);
}

export function runInteractionFingerprintStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  return runAnalysisStep('fingerprint', inputs, outputDir, onLog, runContext);
}
