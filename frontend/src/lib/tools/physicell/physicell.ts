import {
  DEFAULT_PHYSICELL_OPTIONS,
  PHYSICELL_BOX_ID,
  PHYSICELL_INTERPRETATION_NOTICE,
  PHYSICELL_RUNTIME_COMPONENT_ID,
  PHYSICELL_RUNTIME_ID,
  PHYSICELL_TOOL_ID,
  PHYSICELL_VERSION,
  estimateHardwareResources,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  validatePhysiCellOptions,
  type JsonValue,
  type LiatirHardwareHostMemory,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourceExtrapolation,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirPhase3ResultProvenance,
  type LiatirPhysiCellOptions,
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
import { PHYSICELL_SCRIPT } from './python-scripts/physicell';

/** Either accepted outcome may start a run; only the measured one carries real figures. */
export type PhysiCellAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

export const multicellularSimulationDefinition: LiatirStepDefinition = {
  id: PHYSICELL_TOOL_ID,
  type: 'tool-runtime',
  label: 'Multicellular Simulation',
  description: 'Simulate how a population of cells grows, moves, dies and shapes its environment, cell by cell.',
  category: 'Systems Biology',
  inputSchema: {
    source: {
      type: 'string', label: 'Model', required: true, default: 'builtin', connectable: false,
      options: [{ value: 'builtin', label: 'PhysiCell’s template model' }, { value: 'settings', label: 'A PhysiCell settings file' }],
    },
    settings: { type: 'file', label: 'PhysiCell settings (XML)', required: false, accept: ['xml'] },
    cells: { type: 'file', label: 'Initial cell positions (CSV, if the settings use them)', required: false, accept: ['csv'] },
    rules: { type: 'file', label: 'Cell rules (CSV, if the settings use them)', required: false, accept: ['csv'] },
    maxTime: { type: 'number', label: 'Simulated time in minutes (empty: the settings’ own)', required: false, connectable: false },
    seed: { type: 'number', label: 'Random seed', required: false, default: 0, connectable: false },
    threads: { type: 'number', label: 'Threads (1 repeats a run exactly)', required: false, default: 1, connectable: false },
  },
  outputSchema: {
    populationCsv: { type: 'file', label: 'Cells over time', ext: ['csv'] },
    finalCellsCsv: { type: 'file', label: 'Cells at the end', ext: ['csv'] },
    substratesCsv: { type: 'file', label: 'Substrates over time', ext: ['csv'] },
    finalSvg: { type: 'file', label: 'Final snapshot', ext: ['svg'] },
    summaryJson: { type: 'file', label: 'Simulation summary', ext: ['json'] },
    liveCells: { type: 'number', label: 'Live cells at the end', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface PhysiCellModel {
  source: 'builtin' | 'settings';
  cellTypes: string[];
  substrates: string[];
  twoDimensional: boolean;
  voxels: number;
  initialCells: number;
  rulesEnabled: boolean;
  cellPositionsEnabled: boolean;
}

interface PhysiCellPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.physicell-preflight';
  action: 'simulate-physicell';
  model: PhysiCellModel;
  options: LiatirPhysiCellOptions & { maxTime: number };
  inputBytes: number;
  networkAccess: false;
}

export interface PhysiCellResourcePreflight {
  metrics: PhysiCellPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface PhysiCellFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface PhysiCellSummary {
  kind: 'liatir.physicell-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: { physicell: string; executableSha256: string };
  model: PhysiCellModel & { settingsSha256: string; runSettingsSha256: string };
  options: LiatirPhysiCellOptions & { maxTime: number };
  snapshots: number;
  finalTime: number;
  final: Record<string, { live: number; dead: number }>;
  method: string;
  networkAccess: false;
  hardwareEstimate: PhysiCellAcceptedEstimate;
}

interface PhysiCellResultPayload {
  schemaVersion: 1;
  kind: 'liatir.physicell-result';
  action: 'simulate-physicell';
  paths: { populationCsv: string; substratesCsv: string; finalCellsCsv: string; plot: string; tissuePlot: string;
    summaryJson: string; finalSvg?: string };
  summary: PhysiCellSummary;
}

/** Logical processors the host offers; the runner checks the count against its own machine as well. */
function hostThreads(): number {
  return Math.max(1, globalThis.navigator?.hardwareConcurrency ?? 1);
}

export function physiCellOptions(inputs: Record<string, string>): LiatirPhysiCellOptions {
  const number = (value: string | undefined, fallback: number) => (value === undefined || value.trim() === '' ? fallback : Number(value));
  const options: LiatirPhysiCellOptions = {
    ...(inputs.maxTime?.trim() ? { maxTime: Number(inputs.maxTime) } : {}),
    seed: number(inputs.seed, DEFAULT_PHYSICELL_OPTIONS.seed),
    threads: number(inputs.threads, DEFAULT_PHYSICELL_OPTIONS.threads),
  };
  const validation = validatePhysiCellOptions(options, hostThreads());
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return options;
}

function modelInput(inputs: Record<string, string>): Record<string, JsonValue> {
  if ((inputs.source || 'builtin') === 'builtin') return { source: 'builtin' };
  if (!inputs.settings) throw new Error('Choose a PhysiCell settings file.');
  return {
    source: 'settings',
    settings: inputs.settings,
    ...(inputs.cells ? { cells: inputs.cells } : {}),
    ...(inputs.rules ? { rules: inputs.rules } : {}),
  };
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
  if (!activation) throw new Error('The installed PhysiCell Runtime Box has no verified activation identity.');
  return activation;
}

function pythonInput(
  preflight: boolean,
  inputs: Record<string, string>,
  activation: LiatirRuntimeBoxActivationMetadata,
  options: { outputDir?: string; estimate?: PhysiCellAcceptedEstimate } = {},
): Record<string, JsonValue> {
  return {
    action: preflight ? 'preflight-physicell' : 'simulate-physicell',
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    ...modelInput(inputs),
    physicell: physiCellOptions(inputs) as unknown as JsonValue,
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
}

/** Standard-library preflight, then the measured envelope for this exact release and target. */
export async function preflightPhysiCellWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<PhysiCellResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(runtime, PHYSICELL_SCRIPT, pythonInput(true, inputs, activation),
    { trackJob: false, timeoutSeconds: 300 });
  if (!result.ok) throw new Error(result.stderr || `PhysiCell preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<PhysiCellPreflightPayload>(result.stdout, 'PhysiCell preflight');
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.physicell-preflight') {
    throw new Error('PhysiCell preflight returned an unsupported result contract.');
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
        error: 'No retained measured hardware envelope is available for this exact PhysiCell release and target.',
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
    throw new Error('PhysiCell plot data is invalid.');
  }
  return { data: value.data as object[], ...(value.layout && typeof value.layout === 'object' ? { layout: value.layout as object } : {}) };
}

export async function finalizePhysiCellResult(
  runtime: LiatirToolRuntimeRecord,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<PhysiCellFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `PhysiCell exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<PhysiCellResultPayload>(result.stdout, 'PhysiCell');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.physicell-result' || parsed.action !== 'simulate-physicell') {
    throw new Error('PhysiCell returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  if (runtime.id !== PHYSICELL_RUNTIME_COMPONENT_ID || summary.runtimeId !== PHYSICELL_RUNTIME_ID
    || summary.versions.physicell !== PHYSICELL_VERSION) {
    throw new Error('The simulation result came from a different scientific runtime.');
  }
  if (summary.runtimeBoxRelease !== activation.release.version
    || summary.targetId !== runtimeBoxTargetId(activation.selectedTarget) || summary.networkAccess !== false) {
    throw new Error('The simulation result does not match the verified Runtime Box activation or left its offline boundary.');
  }
  const estimate = summary.hardwareEstimate;
  if (!estimate?.accepted || !estimate.hardwareProfileId) throw new Error('The simulation result has no accepted measured hardware envelope.');
  const threads = summary.options.threads;
  const provenance: LiatirPhase3ResultProvenance = {
    schemaVersion: 1,
    componentId: PHYSICELL_RUNTIME_COMPONENT_ID,
    model: null,
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: `CPU · ${threads} thread${threads === 1 ? '' : 's'}`,
    precision: 'double',
    seed: summary.options.seed,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: PHYSICELL_BOX_ID,
      runtimeId: PHYSICELL_RUNTIME_ID,
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: estimate.hardwareProfileId,
    hardwareEvidence: estimate.evidence,
  };
  const population = await readPlot(safeOutputPath(parsed.paths.plot, outputDir, 'Plot'));
  const tissue = await readPlot(safeOutputPath(parsed.paths.tissuePlot, outputDir, 'Tissue plot'));
  const live = Object.values(summary.final).reduce((total, counts) => total + counts.live, 0);
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Model', value: summary.model.source === 'builtin' ? 'PhysiCell template' : 'Settings file' },
      { label: 'Live cells at the end', value: live.toLocaleString() },
      { label: 'Simulated time', value: `${summary.finalTime.toLocaleString()} min` },
      { label: 'Run', value: `seed ${summary.options.seed} · ${threads} thread${threads === 1 ? '' : 's'}` },
    ] },
    { type: 'text', label: 'Interpretation', content: PHYSICELL_INTERPRETATION_NOTICE },
    { type: 'plotly', plotlyType: 'scatter', title: 'Live cells over time', data: population.data, layout: population.layout },
    { type: 'plotly', plotlyType: 'scatter', title: 'Cells at the end', data: tissue.data, layout: tissue.layout },
    { type: 'table', label: 'Cells at the end', headers: ['Cell type', 'Live', 'Dead'],
      rows: Object.entries(summary.final).map(([name, counts]) => [name, counts.live, counts.dead]) },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: [
      ['Tool Runtime', `PhysiCell ${PHYSICELL_VERSION} (template engine)`],
      ['Method', summary.method],
      ['Domain', `${summary.model.voxels.toLocaleString()} voxels, ${summary.model.twoDimensional ? '2D' : '3D'}`],
      ['Cell types', summary.model.cellTypes.join(', ')],
      ['Substrates', summary.model.substrates.join(', ') || 'None'],
      ['Settings SHA-256', summary.model.settingsSha256],
      ['Settings run (paths and run controls set by Liatir) SHA-256', summary.model.runSettingsSha256],
      ['PhysiCell executable SHA-256', summary.versions.executableSha256],
      ['Network access', 'Disabled'],
      ['Hardware evidence', provenance.hardwareProfileId],
      ['Within measured evidence', provenance.hardwareEvidence === 'measured' ? 'Yes' : 'No — the user confirmed a run larger than any retained measurement'],
      ['Runtime Box', `${provenance.scrollcase.releaseVersion} · ${runtimeBoxTargetId(provenance.scrollcase.target)}`],
      ['Runtime Box archive SHA-256', provenance.scrollcase.archiveSha256],
    ] },
  ] };
  const files: Array<[string, string | undefined, string, string, RunOutputFile['role']]> = [
    ['Cells over time', parsed.paths.populationCsv, 'csv', 'populationCsv', 'final'],
    ['Cells at the end', parsed.paths.finalCellsCsv, 'csv', 'finalCellsCsv', 'final'],
    ['Substrates over time', parsed.paths.substratesCsv, 'csv', 'substratesCsv', 'final'],
    ['Final snapshot', parsed.paths.finalSvg, 'svg', 'finalSvg', 'final'],
    ['Simulation summary', parsed.paths.summaryJson, 'json', 'summaryJson', 'final'],
    ['Population plot data', parsed.paths.plot, 'json', 'plotJson', 'intermediate'],
    ['Tissue plot data', parsed.paths.tissuePlot, 'json', 'tissuePlotJson', 'intermediate'],
  ];
  const outputFiles: RunOutputFile[] = [];
  for (const [label, path, ext, key, role] of files) {
    if (path) outputFiles.push(await outputFile(label, safeOutputPath(path, outputDir, label), ext, key, role));
  }
  return {
    outputFiles,
    output,
    metrics: { liveCells: live },
    values: { liveCells: live, provenance: provenance as unknown as JsonValue },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runPhysiCellWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
): Promise<PhysiCellFinalizedResult> {
  const activation = activationFor(runtime);
  const preflight = await preflightPhysiCellWithRuntime(runtime, inputs, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  // Enforced here as well as on the screen: a pipeline step must not start an unmeasured run unconfirmed.
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This run is larger than any retained measurement and was not confirmed.');
  }
  onLog(`tool-runtime ${runtime.id}`);
  onLog(`model ${preflight.metrics.model.cellTypes.length} cell types · ${preflight.metrics.model.initialCells} starting cells · ${preflight.metrics.model.voxels} voxels`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runToolRuntimePython(
    runtime,
    PHYSICELL_SCRIPT,
    pythonInput(false, inputs, activation, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: 7 * 24 * 3_600,
      jobLabel: runContext?.runKind === 'pipeline-step'
        ? `${runContext.pipelineName}: ${multicellularSimulationDefinition.label}`
        : multicellularSimulationDefinition.label,
      metadata: {
        toolId: multicellularSimulationDefinition.id,
        ...(runContext
          ? runContext.runKind === 'tool-runtime-direct' ? toolRuntimeDirectRunMetadata(runContext) : aiRunMetadata(runContext)
          : {}),
      },
      signal: runContext?.signal,
      onJobId: runContext?.onJobId,
    },
  );
  return finalizePhysiCellResult(runtime, outputDir, result, onLog);
}

export async function runMulticellularSimulationStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === PHYSICELL_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The PhysiCell Tool Runtime has not completed publication for this Liatir release.');
  return runPhysiCellWithRuntime(runtime, inputs, outputDir, onLog, runContext);
}
