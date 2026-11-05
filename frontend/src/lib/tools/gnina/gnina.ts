import {
  GNINA_BOX_ID,
  GNINA_INTERPRETATION_NOTICE,
  GNINA_RUNTIME_COMPONENT_ID,
  GNINA_RUNTIME_ID,
  GNINA_VERSION,
  NEURAL_POSE_RESCORING_TOOL_ID,
  estimateHardwareResources,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  type JsonValue,
  type LiatirGninaLigandComparison,
  type LiatirHardwareHostMemory,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourceExtrapolation,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirPhase3ResultProvenance,
  type LiatirRuntimeBoxActivationMetadata,
  type LiatirRuntimeComponentPythonRunResult,
  type LiatirStepDefinition,
  type LiatirToolRuntimeRecord,
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
import { structureArtifact } from '$lib/tools/molecular-docking/docking';
import { GNINA_SCRIPT } from './python-scripts/gnina';

/** Either accepted outcome may start a run; only the measured one carries real figures. */
export type GninaAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

/** Ligands listed in the comparison table; the scores table always holds every pose. */
const MAX_TABLE_LIGANDS = 50;

export const neuralPoseRescoringDefinition: LiatirStepDefinition = {
  id: NEURAL_POSE_RESCORING_TOOL_ID,
  type: 'tool-runtime',
  label: 'Neural Pose Rescoring',
  description: 'Rescore docked poses with GNINA’s neural networks and compare them with their Vina scores.',
  category: 'Molecular Docking',
  inputSchema: {
    posesSdf: { type: 'file', label: 'Docked poses (SDF)', required: true, accept: ['sdf'],
      description: 'The poses Molecular Docking wrote.' },
    receptorPdbqt: { type: 'file', label: 'Receptor the poses were docked into (PDBQT)', required: true, accept: ['pdbqt'] },
  },
  outputSchema: {
    rescoredPosesSdf: { type: 'file', label: 'Rescored poses', ext: ['sdf'], artifact: structureArtifact('sdf') },
    scoresCsv: { type: 'file', label: 'Vina and GNINA scores', ext: ['csv'] },
    summaryJson: { type: 'file', label: 'Rescoring summary', ext: ['json'] },
    agreeingLigands: { type: 'number', label: 'Ligands whose best pose Vina and GNINA agree on', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface GninaPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.gnina-preflight';
  action: 'rescore-poses';
  ligands: number;
  inputBytes: number;
  networkAccess: false;
}

export interface GninaResourcePreflight {
  metrics: GninaPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface GninaFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface GninaSummary {
  kind: 'liatir.gnina-rescoring-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: { gnina: string; build: string; executableSha256: string };
  device: { index: number; name: string; computeCapability: string; driverCudaVersion: string };
  inputs: { posesSha256: string; receptorPdbqtSha256: string; poses: number; ligands: number };
  command: string[];
  ligands: LiatirGninaLigandComparison[];
  agreeing: number;
  method: string;
  networkAccess: false;
  hardwareEstimate: GninaAcceptedEstimate;
}

interface GninaResultPayload {
  schemaVersion: 1;
  kind: 'liatir.gnina-result';
  action: 'rescore-poses';
  paths: { rescoredPosesSdf: string; scoresCsv: string; plot: string; summaryJson: string; gninaLog: string };
  summary: GninaSummary;
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
  if (!activation) throw new Error('The installed GNINA Runtime Box has no verified activation identity.');
  return activation;
}

function rescoringInput(inputs: Record<string, string>): Record<string, JsonValue> {
  if (!inputs.posesSdf) throw new Error('Choose the docked poses to rescore.');
  if (!inputs.receptorPdbqt) throw new Error('Choose the receptor PDBQT the poses were docked into.');
  return { posesSdf: inputs.posesSdf, receptorPdbqt: inputs.receptorPdbqt };
}

function pythonInput(
  preflight: boolean,
  inputs: Record<string, string>,
  activation: LiatirRuntimeBoxActivationMetadata,
  options: { outputDir?: string; estimate?: GninaAcceptedEstimate } = {},
): Record<string, JsonValue> {
  return {
    action: preflight ? 'preflight-rescore-poses' : 'rescore-poses',
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    ...rescoringInput(inputs),
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
}

/** Standard-library preflight, then the measured envelope for this exact release and target. */
export async function preflightGninaWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<GninaResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(runtime, GNINA_SCRIPT, pythonInput(true, inputs, activation),
    { trackJob: false, timeoutSeconds: 300 });
  if (!result.ok) throw new Error(result.stderr || `GNINA preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<GninaPreflightPayload>(result.stdout, 'GNINA preflight');
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.gnina-preflight') {
    throw new Error('GNINA preflight returned an unsupported result contract.');
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
        error: 'No retained measured hardware envelope is available for this exact GNINA release and target.',
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

async function readPlot(path: string): Promise<{ data: object[]; layout?: object }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const value = JSON.parse(await api.invoke('lia_read_file_text', { path }) as string) as { data?: unknown; layout?: unknown };
  if (!Array.isArray(value.data) || !value.data.every((item) => item && typeof item === 'object')) {
    throw new Error('GNINA plot data is invalid.');
  }
  return { data: value.data as object[], ...(value.layout && typeof value.layout === 'object' ? { layout: value.layout as object } : {}) };
}

export async function finalizeGninaResult(
  runtime: LiatirToolRuntimeRecord,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<GninaFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `GNINA exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<GninaResultPayload>(result.stdout, 'GNINA');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.gnina-result' || parsed.action !== 'rescore-poses') {
    throw new Error('GNINA returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  if (runtime.id !== GNINA_RUNTIME_COMPONENT_ID || summary.runtimeId !== GNINA_RUNTIME_ID
    || summary.versions.gnina !== GNINA_VERSION) {
    throw new Error('The rescoring result came from a different scientific runtime.');
  }
  if (summary.runtimeBoxRelease !== activation.release.version
    || summary.targetId !== runtimeBoxTargetId(activation.selectedTarget) || summary.networkAccess !== false) {
    throw new Error('The rescoring result does not match the verified Runtime Box activation or left its offline boundary.');
  }
  const estimate = summary.hardwareEstimate;
  if (!estimate?.accepted || !estimate.hardwareProfileId) throw new Error('The rescoring result has no accepted measured hardware envelope.');
  const provenance: LiatirPhase3ResultProvenance = {
    schemaVersion: 1,
    componentId: GNINA_RUNTIME_COMPONENT_ID,
    model: { id: 'gnina-default-cnn-ensemble', version: GNINA_VERSION },
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: `${summary.device.name} · compute capability ${summary.device.computeCapability}`,
    precision: 'upstream default',
    seed: 0,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: GNINA_BOX_ID,
      runtimeId: GNINA_RUNTIME_ID,
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: estimate.hardwareProfileId,
    hardwareEvidence: estimate.evidence,
  };
  const plot = await readPlot(safeOutputPath(parsed.paths.plot, outputDir, 'Plot'));
  const shown = summary.ligands.slice(0, MAX_TABLE_LIGANDS);
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Poses rescored', value: summary.inputs.poses.toLocaleString() },
      { label: 'Ligands', value: summary.inputs.ligands.toLocaleString() },
      { label: 'Same best pose as Vina', value: `${summary.agreeing} of ${summary.ligands.length}` },
      { label: 'GPU', value: summary.device.name },
    ] },
    { type: 'text', label: 'Interpretation', content: GNINA_INTERPRETATION_NOTICE },
    { type: 'plotly', plotlyType: 'scatter', title: 'Vina score and CNN pose score', data: plot.data, layout: plot.layout },
    { type: 'table', label: summary.ligands.length > shown.length
      ? `Best pose per ligand (first ${shown.length} of ${summary.ligands.length}; the scores table has every pose)`
      : 'Best pose per ligand',
    headers: ['Ligand', 'Poses', 'Vina’s best', 'GNINA’s best (Vina rank)', 'CNN pose score', 'CNN affinity (pK)', 'Same pose'],
    rows: shown.map((row) => [row.ligand, row.poses, `rank ${row.bestVinaPoseRank}`, `rank ${row.bestCnnPoseRank}`,
      row.bestCnnPoseScore.toFixed(3), row.bestCnnAffinityPk.toFixed(2), row.agree ? 'Yes' : 'No']) },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: [
      ['Tool Runtime', `GNINA ${GNINA_VERSION} (${summary.versions.build})`],
      ['Method', summary.method],
      ['GPU', `${summary.device.name} · compute capability ${summary.device.computeCapability} · driver CUDA ${summary.device.driverCudaVersion}`],
      ['GNINA command', summary.command.join(' ')],
      ['GNINA program SHA-256', summary.versions.executableSha256],
      ['Docked poses SHA-256', summary.inputs.posesSha256],
      ['Receptor PDBQT SHA-256', summary.inputs.receptorPdbqtSha256],
      ['Network access', 'Disabled'],
      ['Hardware evidence', provenance.hardwareProfileId],
      ['Within measured evidence', provenance.hardwareEvidence === 'measured' ? 'Yes' : 'No — the user confirmed a run larger than any retained measurement'],
      ['Runtime Box', `${provenance.scrollcase.releaseVersion} · ${runtimeBoxTargetId(provenance.scrollcase.target)}`],
      ['Runtime Box archive SHA-256', provenance.scrollcase.archiveSha256],
    ] },
  ] };
  const files: Array<[string, string, string, string, RunOutputFile['role']]> = [
    ['Rescored poses', parsed.paths.rescoredPosesSdf, 'sdf', 'rescoredPosesSdf', 'final'],
    ['Vina and GNINA scores', parsed.paths.scoresCsv, 'csv', 'scoresCsv', 'final'],
    ['Rescoring summary', parsed.paths.summaryJson, 'json', 'summaryJson', 'final'],
    ['Rescoring plot data', parsed.paths.plot, 'json', 'plotJson', 'intermediate'],
    ['GNINA log', parsed.paths.gninaLog, 'log', 'gninaLog', 'intermediate'],
  ];
  const outputFiles: RunOutputFile[] = [];
  for (const [label, path, ext, key, role] of files) {
    outputFiles.push(await outputFile(label, safeOutputPath(path, outputDir, label), ext, key, role));
  }
  return {
    outputFiles,
    output,
    metrics: { agreeingLigands: summary.agreeing },
    values: { agreeingLigands: summary.agreeing, provenance: provenance as unknown as JsonValue },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runGninaWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
): Promise<GninaFinalizedResult> {
  const activation = activationFor(runtime);
  const preflight = await preflightGninaWithRuntime(runtime, inputs, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  // Enforced here as well as on the screen: a pipeline step must not start an unmeasured run unconfirmed.
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This run is larger than any retained measurement and was not confirmed.');
  }
  onLog(`tool-runtime ${runtime.id}`);
  onLog(`poses ${preflight.metrics.tokenCount} of ${preflight.metrics.ligands} ligands · receptor ${preflight.metrics.atomCount} atoms`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runToolRuntimePython(
    runtime,
    GNINA_SCRIPT,
    pythonInput(false, inputs, activation, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: 7 * 24 * 3_600,
      jobLabel: runContext?.runKind === 'pipeline-step'
        ? `${runContext.pipelineName}: ${neuralPoseRescoringDefinition.label}`
        : neuralPoseRescoringDefinition.label,
      metadata: {
        toolId: neuralPoseRescoringDefinition.id,
        ...(runContext
          ? runContext.runKind === 'tool-runtime-direct' ? toolRuntimeDirectRunMetadata(runContext) : aiRunMetadata(runContext)
          : {}),
      },
      signal: runContext?.signal,
      onJobId: runContext?.onJobId,
    },
  );
  return finalizeGninaResult(runtime, outputDir, result, onLog);
}

export async function runNeuralPoseRescoringStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === GNINA_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The GNINA Tool Runtime has not completed publication for this Liatir release.');
  return runGninaWithRuntime(runtime, inputs, outputDir, onLog, runContext);
}
