import {
  BIOCHEMICAL_BUILTIN_MODELS,
  BIOCHEMICAL_METHODS,
  BIOCHEMICAL_SIMULATION_BOX_ID,
  BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE,
  BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
  BIOCHEMICAL_SIMULATION_RUNTIME_ID,
  BIOCHEMICAL_SIMULATION_TOOL_ID,
  BIONETGEN_VERSION,
  DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS,
  PYSB_VERSION,
  estimateHardwareResources,
  parseParameterChanges,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  validateBiochemicalSimulationOptions,
  type JsonValue,
  type LiatirBiochemicalMethod,
  type LiatirBiochemicalSimulationOptions,
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
import { BIOCHEMICAL_SIMULATION_SCRIPT } from './python-scripts/biochemical';

/** Either accepted outcome may start a run; only the measured one carries real figures. */
export type BiochemicalAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

export const METHOD_LABELS: Record<LiatirBiochemicalMethod, string> = {
  ode: 'Deterministic (ODE, LSODA)',
  ssa: 'Stochastic (Gillespie SSA)',
};

/**
 * The preflight generates the reaction network. BioNetGen is stopped after five minutes of CPU time;
 * on a busy computer those take longer on the clock, so the preflight waits up to three times as long.
 */
const PREFLIGHT_TIMEOUT_SECONDS = 900;

export const biochemicalSimulationDefinition: LiatirStepDefinition = {
  id: BIOCHEMICAL_SIMULATION_TOOL_ID,
  type: 'tool-runtime',
  label: 'Biochemical Simulation',
  description: 'Simulate how the amounts of molecules in a reaction network change over time, deterministically or stochastically.',
  category: 'Systems Biology',
  inputSchema: {
    source: {
      type: 'string', label: 'Model', required: true, default: 'builtin', connectable: false,
      options: [{ value: 'builtin', label: 'A model that ships with PySB' }, { value: 'bngl', label: 'A BNGL file' }],
    },
    builtinModel: {
      type: 'string', label: 'Built-in model', required: false, default: 'robertson', connectable: false,
      options: Object.entries(BIOCHEMICAL_BUILTIN_MODELS).map(([value, label]) => ({ value, label })),
    },
    bngl: { type: 'file', label: 'BNGL model', required: false, accept: ['bngl'] },
    method: {
      type: 'string', label: 'Method', required: true, default: 'ode', connectable: false,
      options: BIOCHEMICAL_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] })),
    },
    tEnd: { type: 'number', label: 'End time (the model’s time unit)', required: true, default: 100, connectable: false },
    points: { type: 'number', label: 'Output points', required: false, default: 101, connectable: false },
    spacing: {
      type: 'string', label: 'Time spacing', required: false, default: 'linear', connectable: false,
      options: [{ value: 'linear', label: 'Even' }, { value: 'log', label: 'Logarithmic (deterministic only)' }],
    },
    tFirst: { type: 'number', label: 'Logarithmic: first output time', required: false, connectable: false },
    rtol: { type: 'number', label: 'Deterministic: relative tolerance', required: false, default: 1e-8, connectable: false },
    atol: { type: 'number', label: 'Deterministic: absolute tolerance', required: false, default: 1e-12, connectable: false },
    runs: { type: 'number', label: 'Stochastic: runs', required: false, default: 100, connectable: false },
    seed: { type: 'number', label: 'Stochastic: seed of the first run', required: false, default: 1, connectable: false },
    parameters: { type: 'string', label: 'Parameter changes', required: false, default: '', connectable: false,
      description: 'One per line: name value, for example kA_syn 2.' },
  },
  outputSchema: {
    observablesCsv: { type: 'file', label: 'Observables over time', ext: ['csv'] },
    runsCsv: { type: 'file', label: 'Every stochastic run', ext: ['csv'] },
    networkNet: { type: 'file', label: 'Reaction network', ext: ['net'] },
    summaryJson: { type: 'file', label: 'Simulation summary', ext: ['json'] },
    species: { type: 'number', label: 'Species', format: 'integer' },
    reactions: { type: 'number', label: 'Reactions', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface BiochemicalModel {
  format: 'builtin' | 'bngl';
  name?: string;
  description?: string;
  rules?: number;
  observables?: number;
  ignoredActions?: string[];
}

interface BiochemicalNetwork {
  species: number;
  reactions: number;
  observables: number;
  iterations: number;
  sha256: string;
}

interface BiochemicalPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.biochemical-simulation-preflight';
  action: 'simulate-network';
  model: BiochemicalModel;
  network: BiochemicalNetwork;
  inputBytes: number;
  networkAccess: false;
}

export interface BiochemicalResourcePreflight {
  metrics: BiochemicalPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface BiochemicalFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface BiochemicalSummary {
  kind: 'liatir.biochemical-simulation-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: Record<string, string>;
  model: BiochemicalModel & { sha256?: string };
  network: BiochemicalNetwork;
  options: LiatirBiochemicalSimulationOptions;
  method: string;
  final: Record<string, number | { mean: number; sd: number }>;
  networkAccess: false;
  hardwareEstimate: BiochemicalAcceptedEstimate;
}

interface BiochemicalResultPayload {
  schemaVersion: 1;
  kind: 'liatir.biochemical-simulation-result';
  action: 'simulate-network';
  paths: { observablesCsv: string; runsCsv?: string; networkNet: string; plot: string; summaryJson: string };
  summary: BiochemicalSummary;
}

function number(value: string | undefined, fallback: number): number {
  return value === undefined || value.trim() === '' ? fallback : Number(value);
}

export function biochemicalSimulationOptions(inputs: Record<string, string>): LiatirBiochemicalSimulationOptions {
  const defaults = DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS;
  const options: LiatirBiochemicalSimulationOptions = {
    method: (inputs.method || defaults.method) as LiatirBiochemicalMethod,
    tEnd: number(inputs.tEnd, defaults.tEnd),
    points: number(inputs.points, defaults.points),
    spacing: inputs.spacing === 'log' ? 'log' : 'linear',
    ...(inputs.spacing === 'log' && inputs.tFirst?.trim() ? { tFirst: Number(inputs.tFirst) } : {}),
    rtol: number(inputs.rtol, defaults.rtol),
    atol: number(inputs.atol, defaults.atol),
    runs: number(inputs.runs, defaults.runs),
    seed: number(inputs.seed, defaults.seed),
    parameters: parseParameterChanges(inputs.parameters ?? ''),
  };
  const validation = validateBiochemicalSimulationOptions(options);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return options;
}

function modelInput(inputs: Record<string, string>): Record<string, JsonValue> {
  if ((inputs.source || 'builtin') === 'builtin') return { source: 'builtin', builtinModel: inputs.builtinModel || 'robertson' };
  if (!inputs.bngl) throw new Error('Choose a BNGL model file.');
  return { source: 'bngl', bngl: inputs.bngl };
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
  if (!activation) throw new Error('The installed biochemical simulation Runtime Box has no verified activation identity.');
  return activation;
}

function pythonInput(
  preflight: boolean,
  inputs: Record<string, string>,
  activation: LiatirRuntimeBoxActivationMetadata,
  options: { outputDir?: string; estimate?: BiochemicalAcceptedEstimate } = {},
): Record<string, JsonValue> {
  return {
    action: preflight ? 'preflight-network' : 'simulate-network',
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    ...modelInput(inputs),
    simulation: biochemicalSimulationOptions(inputs) as unknown as JsonValue,
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
}

/** Generates the reaction network, whose size the measured envelope is matched on. */
export async function preflightBiochemicalWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<BiochemicalResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(runtime, BIOCHEMICAL_SIMULATION_SCRIPT, pythonInput(true, inputs, activation),
    { trackJob: false, timeoutSeconds: PREFLIGHT_TIMEOUT_SECONDS });
  if (!result.ok) throw new Error(result.stderr || `Biochemical preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<BiochemicalPreflightPayload>(result.stdout, 'Biochemical preflight');
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.biochemical-simulation-preflight') {
    throw new Error('Biochemical preflight returned an unsupported result contract.');
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
        error: 'No retained measured hardware envelope is available for this exact biochemical simulation release and target.',
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
    throw new Error('Simulation plot data is invalid.');
  }
  return { data: value.data as object[], ...(value.layout && typeof value.layout === 'object' ? { layout: value.layout as object } : {}) };
}

function finalValue(value: number | { mean: number; sd: number }): string {
  return typeof value === 'number' ? value.toPrecision(6) : `${value.mean.toPrecision(6)} ± ${value.sd.toPrecision(3)} (SD)`;
}

export async function finalizeBiochemicalResult(
  runtime: LiatirToolRuntimeRecord,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<BiochemicalFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `Biochemical simulation exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<BiochemicalResultPayload>(result.stdout, 'Biochemical simulation');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.biochemical-simulation-result' || parsed.action !== 'simulate-network') {
    throw new Error('Biochemical simulation returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  if (runtime.id !== BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID || summary.runtimeId !== BIOCHEMICAL_SIMULATION_RUNTIME_ID
    || summary.versions.pysb !== PYSB_VERSION || !summary.versions.bionetgen?.includes(BIONETGEN_VERSION)) {
    throw new Error('The simulation result came from a different scientific runtime.');
  }
  if (summary.runtimeBoxRelease !== activation.release.version
    || summary.targetId !== runtimeBoxTargetId(activation.selectedTarget) || summary.networkAccess !== false) {
    throw new Error('The simulation result does not match the verified Runtime Box activation or left its offline boundary.');
  }
  const estimate = summary.hardwareEstimate;
  if (!estimate?.accepted || !estimate.hardwareProfileId) throw new Error('The simulation result has no accepted measured hardware envelope.');
  const stochastic = summary.options.method === 'ssa';
  const provenance: LiatirPhase3ResultProvenance = {
    schemaVersion: 1,
    componentId: BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
    model: null,
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: 'CPU · 1 process',
    precision: 'double',
    // Integration draws nothing at random; stochastic run i used this seed plus i.
    seed: stochastic ? summary.options.seed : 0,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: BIOCHEMICAL_SIMULATION_BOX_ID,
      runtimeId: BIOCHEMICAL_SIMULATION_RUNTIME_ID,
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: estimate.hardwareProfileId,
    hardwareEvidence: estimate.evidence,
  };
  const plot = await readPlot(safeOutputPath(parsed.paths.plot, outputDir, 'Plot'));
  const modelLabel = summary.model.format === 'builtin'
    ? `${summary.model.name} (PySB)`
    : `BNGL · ${summary.model.rules ?? 0} rules`;
  const ignored = summary.model.ignoredActions ?? [];
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Method', value: METHOD_LABELS[summary.options.method] },
      { label: 'Network', value: `${summary.network.species.toLocaleString()} species · ${summary.network.reactions.toLocaleString()} reactions` },
      { label: 'Model', value: modelLabel },
      { label: stochastic ? 'Runs' : 'Tolerances', value: stochastic
        ? `${summary.options.runs.toLocaleString()} (seeds ${summary.options.seed}–${summary.options.seed + summary.options.runs - 1})`
        : `rtol ${summary.options.rtol} · atol ${summary.options.atol}` },
    ] },
    { type: 'text', label: 'Interpretation', content: BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE },
    { type: 'plotly', plotlyType: 'scatter', title: stochastic ? 'Observables (mean of the runs)' : 'Observables',
      data: plot.data, layout: plot.layout },
    { type: 'table', label: `At the end time (${summary.options.tEnd})`, headers: ['Observable', stochastic ? 'Mean ± SD' : 'Value'],
      rows: Object.entries(summary.final).slice(0, 200).map(([name, value]) => [name, finalValue(value)]) },
    ...(ignored.length ? [{ type: 'text' as const, label: 'Not run from the BNGL file',
      content: `The file's own actions were read but not run: ${ignored.join(', ')}. This tool generates the network and simulates it with the settings above.` }] : []),
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: [
      ['Tool Runtime', `PySB ${PYSB_VERSION} · BioNetGen ${BIONETGEN_VERSION}`],
      ['Method', summary.method],
      ['Parameter changes', summary.options.parameters.length
        ? summary.options.parameters.map((item) => `${item.name} = ${item.value}`).join('; ') : 'None'],
      ['Network generation', `${summary.network.iterations} rounds of rule application`],
      ['Reaction network SHA-256', summary.network.sha256],
      ...(summary.model.sha256 ? [['BNGL file SHA-256', summary.model.sha256]] : []),
      ['Network access', 'Disabled'],
      ['Hardware evidence', provenance.hardwareProfileId],
      ['Within measured evidence', provenance.hardwareEvidence === 'measured' ? 'Yes' : 'No — the user confirmed a run larger than any retained measurement'],
      ['Runtime Box', `${provenance.scrollcase.releaseVersion} · ${runtimeBoxTargetId(provenance.scrollcase.target)}`],
      ['Runtime Box archive SHA-256', provenance.scrollcase.archiveSha256],
    ] },
  ] };
  const files: Array<[string, string | undefined, string, string, RunOutputFile['role']]> = [
    [stochastic ? 'Observables (mean and SD)' : 'Observables over time', parsed.paths.observablesCsv, 'csv', 'observablesCsv', 'final'],
    ['Every stochastic run', parsed.paths.runsCsv, 'csv', 'runsCsv', 'final'],
    ['Reaction network', parsed.paths.networkNet, 'net', 'networkNet', 'final'],
    ['Simulation summary', parsed.paths.summaryJson, 'json', 'summaryJson', 'final'],
    ['Plot data', parsed.paths.plot, 'json', 'plotJson', 'intermediate'],
  ];
  const outputFiles: RunOutputFile[] = [];
  for (const [label, path, ext, key, role] of files) {
    if (path) outputFiles.push(await outputFile(label, safeOutputPath(path, outputDir, label), ext, key, role));
  }
  const counts = { species: summary.network.species, reactions: summary.network.reactions };
  return {
    outputFiles,
    output,
    metrics: counts,
    values: { ...counts, provenance: provenance as unknown as JsonValue },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runBiochemicalWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
): Promise<BiochemicalFinalizedResult> {
  const activation = activationFor(runtime);
  const preflight = await preflightBiochemicalWithRuntime(runtime, inputs, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  // Enforced here as well as on the screen: a pipeline step must not start an unmeasured run unconfirmed.
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This run is larger than any retained measurement and was not confirmed.');
  }
  onLog(`tool-runtime ${runtime.id}`);
  onLog(`network ${preflight.metrics.network.species} species · ${preflight.metrics.network.reactions} reactions · ${preflight.metrics.stepCount} output samples`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runToolRuntimePython(
    runtime,
    BIOCHEMICAL_SIMULATION_SCRIPT,
    pythonInput(false, inputs, activation, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: 7 * 24 * 3_600,
      jobLabel: runContext?.runKind === 'pipeline-step'
        ? `${runContext.pipelineName}: ${biochemicalSimulationDefinition.label}`
        : biochemicalSimulationDefinition.label,
      metadata: {
        toolId: biochemicalSimulationDefinition.id,
        ...(runContext
          ? runContext.runKind === 'tool-runtime-direct' ? toolRuntimeDirectRunMetadata(runContext) : aiRunMetadata(runContext)
          : {}),
      },
      signal: runContext?.signal,
      onJobId: runContext?.onJobId,
    },
  );
  return finalizeBiochemicalResult(runtime, outputDir, result, onLog);
}

export async function runBiochemicalSimulationStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The biochemical simulation Tool Runtime has not completed publication for this Liatir release.');
  return runBiochemicalWithRuntime(runtime, inputs, outputDir, onLog, runContext);
}
