import {
  COBRAPY_VERSION,
  DEFAULT_METABOLIC_OPTIONS,
  HIGHS_VERSION,
  METABOLIC_ANALYSES,
  METABOLIC_MODELING_BOX_ID,
  METABOLIC_MODELING_INTERPRETATION_NOTICE,
  METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
  METABOLIC_MODELING_RUNTIME_ID,
  METABOLIC_MODELING_TOOL_ID,
  estimateHardwareResources,
  parseFluxBoundChanges,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  validateMetabolicOptions,
  type JsonValue,
  type LiatirHardwareHostMemory,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourceExtrapolation,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirMetabolicAnalysis,
  type LiatirMetabolicOptions,
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
import { METABOLIC_MODELING_SCRIPT } from './python-scripts/metabolic';

/** Either accepted outcome may start a run; only the measured one carries real figures. */
export type MetabolicAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

const ANALYSIS_LABELS: Record<LiatirMetabolicAnalysis, string> = {
  fba: 'Flux balance analysis (FBA)',
  fva: 'Flux variability analysis (FVA)',
  'gene-deletion': 'Single gene deletions',
  'reaction-deletion': 'Single reaction deletions',
};

export const metabolicModelingDefinition: LiatirStepDefinition = {
  id: METABOLIC_MODELING_TOOL_ID,
  type: 'tool-runtime',
  label: 'Metabolic Modeling',
  description: 'Predict growth and metabolic fluxes from a genome-scale model, and which genes it cannot do without.',
  category: 'Systems Biology',
  inputSchema: {
    model: { type: 'file', label: 'Metabolic model (SBML or COBRA JSON)', required: true, accept: ['xml', 'sbml', 'gz', 'json'] },
    analysis: {
      type: 'string', label: 'Analysis', required: true, default: 'fba', connectable: false,
      options: METABOLIC_ANALYSES.map((value) => ({ value, label: ANALYSIS_LABELS[value] })),
    },
    objective: { type: 'string', label: 'Reaction to optimize (empty: the model’s own)', required: false, default: '', connectable: false },
    direction: {
      type: 'string', label: 'Direction', required: false, default: 'max', connectable: false,
      options: [{ value: 'max', label: 'Maximize' }, { value: 'min', label: 'Minimize' }],
    },
    bounds: { type: 'string', label: 'Bound changes', required: false, default: '', connectable: false,
      description: 'One per line: reaction lower upper, for example EX_glc__D_e -10 1000.' },
    knockouts: { type: 'string', label: 'Genes to knock out', required: false, default: '', connectable: false,
      description: 'Comma-separated gene identifiers as the model names them.' },
    fractionOfOptimum: { type: 'number', label: 'FVA: fraction of the optimum to keep', required: false, default: 1, connectable: false },
    pfba: { type: 'boolean', label: 'FBA: least total flux among the optimal solutions (pFBA)', required: false, default: false, connectable: false },
    crossCheck: { type: 'boolean', label: 'Confirm with a second solver (GLPK)', required: false, default: true, connectable: false },
  },
  outputSchema: {
    fluxesCsv: { type: 'file', label: 'Fluxes', ext: ['csv'] },
    variabilityCsv: { type: 'file', label: 'Flux ranges', ext: ['csv'] },
    deletionsCsv: { type: 'file', label: 'Deletions', ext: ['csv'] },
    summaryJson: { type: 'file', label: 'Metabolic summary', ext: ['json'] },
    objectiveValue: { type: 'number', label: 'Objective value', format: 'decimal' },
    essentialCount: { type: 'number', label: 'Essential genes or reactions', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface MetabolicPreflightPayload extends LiatirHardwareWorkloadMetrics {
  schemaVersion: 1;
  kind: 'liatir.metabolic-modeling-preflight';
  action: 'analyze-metabolic';
  model: { format: 'sbml' | 'cobra-json'; reactions: number; metabolites: number; genes: number; hasObjective: boolean };
  inputBytes: number;
  networkAccess: false;
}

export interface MetabolicResourcePreflight {
  metrics: MetabolicPreflightPayload;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

export interface MetabolicFinalizedResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}

interface MetabolicSummary {
  kind: 'liatir.metabolic-modeling-summary';
  runtimeId: string;
  runtimeBoxRelease: string;
  targetId: string;
  versions: Record<string, string>;
  solver: string;
  crossCheck: {
    solver: string;
    values: number;
    maxAbsoluteDifference: number;
    tolerance: number;
    settledByExactArithmetic: Array<{ value: string; highs: number | null; glpk: number | null; exact: number | null }>;
  } | null;
  model: MetabolicPreflightPayload['model'] & { id: string; sha256: string };
  options: LiatirMetabolicOptions;
  objective: { expression: string; direction: 'max' | 'min'; value: number };
  exchanges: Array<{ reaction: string; flux: number }>;
  variability?: { reactions: number; fractionOfOptimum: number; blocked: number; fixed: number };
  deletions?: { count: number; essential: string[]; threshold: number };
  parsimonious?: { totalFlux: number };
  networkAccess: false;
  hardwareEstimate: MetabolicAcceptedEstimate;
}

interface MetabolicResultPayload {
  schemaVersion: 1;
  kind: 'liatir.metabolic-modeling-result';
  action: 'analyze-metabolic';
  paths: Partial<Record<'variabilityCsv' | 'deletionsCsv', string>> & { fluxesCsv: string; plot: string; summaryJson: string };
  summary: MetabolicSummary;
}

function basename(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

export function metabolicOptions(inputs: Record<string, string>): LiatirMetabolicOptions {
  const analysis = (inputs.analysis || DEFAULT_METABOLIC_OPTIONS.analysis) as LiatirMetabolicAnalysis;
  const fraction = inputs.fractionOfOptimum === undefined || inputs.fractionOfOptimum === ''
    ? DEFAULT_METABOLIC_OPTIONS.fractionOfOptimum
    : Number(inputs.fractionOfOptimum);
  const options: LiatirMetabolicOptions = {
    analysis,
    objective: (inputs.objective ?? '').trim(),
    direction: inputs.direction === 'min' ? 'min' : 'max',
    bounds: parseFluxBoundChanges(inputs.bounds ?? ''),
    knockouts: (inputs.knockouts ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    fractionOfOptimum: fraction,
    pfba: inputs.pfba === 'true',
    crossCheck: inputs.crossCheck !== 'false',
  };
  const validation = validateMetabolicOptions(options);
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
  if (!activation) throw new Error('The installed metabolic modeling Runtime Box has no verified activation identity.');
  return activation;
}

function pythonInput(
  preflight: boolean,
  inputs: Record<string, string>,
  activation: LiatirRuntimeBoxActivationMetadata,
  options: { outputDir?: string; estimate?: MetabolicAcceptedEstimate } = {},
): Record<string, JsonValue> {
  return {
    action: preflight ? 'preflight-metabolic' : 'analyze-metabolic',
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    model: inputs.model,
    metabolic: metabolicOptions(inputs) as unknown as JsonValue,
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.estimate ? { hardwareEstimate: options.estimate as unknown as JsonValue } : {}),
  };
}

/** Standard-library preflight, then the measured envelope for this exact release and target. */
export async function preflightMetabolicWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<MetabolicResourcePreflight> {
  if (runtime.status !== 'installed' || !runtime.runtimePath) throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  if (!inputs.model) throw new Error('An SBML or COBRA JSON metabolic model is required.');
  const activation = activationFor(runtime);
  const result = await runToolRuntimePython(runtime, METABOLIC_MODELING_SCRIPT, pythonInput(true, inputs, activation),
    { trackJob: false, timeoutSeconds: 300 });
  if (!result.ok) throw new Error(result.stderr || `Metabolic preflight exited with code ${result.exitCode}`);
  const metrics = parsePythonJson<MetabolicPreflightPayload>(result.stdout, 'Metabolic preflight');
  if (metrics.schemaVersion !== 1 || metrics.kind !== 'liatir.metabolic-modeling-preflight') {
    throw new Error('Metabolic preflight returned an unsupported result contract.');
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
        error: 'No retained measured hardware envelope is available for this exact metabolic modeling release and target.',
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
    throw new Error('Metabolic plot data is invalid.');
  }
  return { data: value.data as object[], ...(value.layout && typeof value.layout === 'object' ? { layout: value.layout as object } : {}) };
}

export async function finalizeMetabolicResult(
  runtime: LiatirToolRuntimeRecord,
  outputDir: string,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
): Promise<MetabolicFinalizedResult> {
  if (!result.ok) throw new Error(result.stderr || `Metabolic modeling exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<MetabolicResultPayload>(result.stdout, 'Metabolic modeling');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'liatir.metabolic-modeling-result' || parsed.action !== 'analyze-metabolic') {
    throw new Error('Metabolic modeling returned an unsupported result contract.');
  }
  const activation = result.runtimeBoxActivation ?? activationFor(runtime);
  const summary = parsed.summary;
  if (runtime.id !== METABOLIC_MODELING_RUNTIME_COMPONENT_ID || summary.runtimeId !== METABOLIC_MODELING_RUNTIME_ID
    || summary.versions.cobra !== COBRAPY_VERSION || summary.versions.highspy !== HIGHS_VERSION) {
    throw new Error('The metabolic result came from a different scientific runtime.');
  }
  if (summary.runtimeBoxRelease !== activation.release.version
    || summary.targetId !== runtimeBoxTargetId(activation.selectedTarget) || summary.networkAccess !== false) {
    throw new Error('The metabolic result does not match the verified Runtime Box activation or left its offline boundary.');
  }
  const estimate = summary.hardwareEstimate;
  if (!estimate?.accepted || !estimate.hardwareProfileId) throw new Error('The metabolic result has no accepted measured hardware envelope.');
  const provenance: LiatirPhase3ResultProvenance = {
    schemaVersion: 1,
    componentId: METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
    model: null,
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: 'CPU · 1 process',
    precision: 'double',
    // Linear programs are solved exactly as posed; nothing is drawn at random.
    seed: 0,
    msa: { mode: 'not-applicable', localA3mEntityIds: [], singleSequenceEntityIds: [] },
    scrollcase: {
      boxId: METABOLIC_MODELING_BOX_ID,
      runtimeId: METABOLIC_MODELING_RUNTIME_ID,
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: estimate.hardwareProfileId,
    hardwareEvidence: estimate.evidence,
  };
  const plot = await readPlot(safeOutputPath(parsed.paths.plot, outputDir, 'Plot'));
  const essential = summary.deletions?.essential ?? [];
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: [
      { label: 'Analysis', value: ANALYSIS_LABELS[summary.options.analysis] },
      { label: summary.options.direction === 'max' ? 'Maximum objective' : 'Minimum objective', value: summary.objective.value.toPrecision(8) },
      { label: 'Model', value: `${summary.model.reactions.toLocaleString()} reactions · ${summary.model.genes.toLocaleString()} genes` },
      { label: 'Second solver', value: summary.crossCheck
        ? summary.crossCheck.settledByExactArithmetic.length
          ? `Confirmed (${summary.crossCheck.settledByExactArithmetic.length} settled exactly)`
          : `Agrees (max difference ${summary.crossCheck.maxAbsoluteDifference.toExponential(1)})`
        : 'Not asked' },
    ] },
    { type: 'text', label: 'Interpretation', content: METABOLIC_MODELING_INTERPRETATION_NOTICE },
    { type: 'plotly', plotlyType: 'bar', title: 'Overview', data: plot.data, layout: plot.layout },
    ...(summary.deletions ? [{ type: 'table' as const, label: `Essential ${summary.options.analysis === 'gene-deletion' ? 'genes' : 'reactions'} (${essential.length})`,
      headers: ['Identifier'], rows: essential.slice(0, 500).map((item) => [item]) }] : []),
    ...(summary.variability ? [{ type: 'table' as const, label: 'Flux variability', headers: ['Measure', 'Value'], rows: [
      ['Reactions', summary.variability.reactions], ['Blocked (no flux possible)', summary.variability.blocked],
      ['Fixed (one flux only)', summary.variability.fixed], ['Fraction of the optimum kept', summary.variability.fractionOfOptimum],
    ] }] : []),
    { type: 'table', label: 'Exchange fluxes (negative: uptake)', headers: ['Reaction', 'Flux (mmol/gDW/h)'],
      rows: summary.exchanges.slice(0, 100).map((item) => [item.reaction, item.flux.toPrecision(6)]) },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: [
      ['Tool Runtime', `COBRApy ${COBRAPY_VERSION} · HiGHS ${HIGHS_VERSION}`],
      ['Objective', `${summary.objective.direction === 'max' ? 'Maximize' : 'Minimize'} ${summary.objective.expression}`],
      ['Bound changes', summary.options.bounds.length ? summary.options.bounds.map((item) => `${item.reaction} [${item.lower}, ${item.upper}]`).join('; ') : 'None'],
      ['Knocked-out genes', summary.options.knockouts.join(', ') || 'None'],
      ['Second solver', summary.crossCheck
        ? `GLPK agreed on ${summary.crossCheck.values - summary.crossCheck.settledByExactArithmetic.length} values within ${summary.crossCheck.tolerance}`
          + (summary.crossCheck.settledByExactArithmetic.length
            ? `; exact arithmetic confirmed HiGHS on the other ${summary.crossCheck.settledByExactArithmetic.length}`
            : '')
        : 'Not asked'],
      ['Model SHA-256', summary.model.sha256],
      ['Network access', 'Disabled'],
      ['Hardware evidence', provenance.hardwareProfileId],
      ['Within measured evidence', provenance.hardwareEvidence === 'measured' ? 'Yes' : 'No — the user confirmed a run larger than any retained measurement'],
      ['Runtime Box', `${provenance.scrollcase.releaseVersion} · ${runtimeBoxTargetId(provenance.scrollcase.target)}`],
      ['Runtime Box archive SHA-256', provenance.scrollcase.archiveSha256],
    ] },
  ] };
  const files: Array<[string, string | undefined, string, string, RunOutputFile['role']]> = [
    ['Fluxes', parsed.paths.fluxesCsv, 'csv', 'fluxesCsv', 'final'],
    ['Flux ranges', parsed.paths.variabilityCsv, 'csv', 'variabilityCsv', 'final'],
    ['Deletions', parsed.paths.deletionsCsv, 'csv', 'deletionsCsv', 'final'],
    ['Metabolic summary', parsed.paths.summaryJson, 'json', 'summaryJson', 'final'],
    ['Plot data', parsed.paths.plot, 'json', 'plotJson', 'intermediate'],
  ];
  const outputFiles: RunOutputFile[] = [];
  for (const [label, path, ext, key, role] of files) {
    if (path) outputFiles.push(await outputFile(label, safeOutputPath(path, outputDir, label), ext, key, role));
  }
  return {
    outputFiles,
    output,
    metrics: { objectiveValue: summary.objective.value, ...(summary.deletions ? { essentialCount: essential.length } : {}) },
    values: { objectiveValue: summary.objective.value, ...(summary.deletions ? { essentialCount: essential.length } : {}),
      provenance: provenance as unknown as JsonValue },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runMetabolicWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
): Promise<MetabolicFinalizedResult> {
  const activation = activationFor(runtime);
  const preflight = await preflightMetabolicWithRuntime(runtime, inputs, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  // Enforced here as well as on the screen: a pipeline step must not start an unmeasured run unconfirmed.
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This run is larger than any retained measurement and was not confirmed.');
  }
  onLog(`tool-runtime ${runtime.id}`);
  onLog(`model ${basename(inputs.model)} · ${preflight.metrics.model.reactions} reactions · ${preflight.metrics.stepCount} linear programs`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runToolRuntimePython(
    runtime,
    METABOLIC_MODELING_SCRIPT,
    pythonInput(false, inputs, activation, { outputDir, estimate: preflight.estimate }),
    {
      timeoutSeconds: 7 * 24 * 3_600,
      jobLabel: runContext?.runKind === 'pipeline-step'
        ? `${runContext.pipelineName}: ${metabolicModelingDefinition.label}`
        : metabolicModelingDefinition.label,
      metadata: {
        toolId: metabolicModelingDefinition.id,
        ...(runContext
          ? runContext.runKind === 'tool-runtime-direct' ? toolRuntimeDirectRunMetadata(runContext) : aiRunMetadata(runContext)
          : {}),
      },
      signal: runContext?.signal,
      onJobId: runContext?.onJobId,
    },
  );
  return finalizeMetabolicResult(runtime, outputDir, result, onLog);
}

export async function runMetabolicModelingStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === METABOLIC_MODELING_RUNTIME_COMPONENT_ID);
  if (!runtime) throw new Error('The metabolic modeling Tool Runtime has not completed publication for this Liatir release.');
  return runMetabolicWithRuntime(runtime, inputs, outputDir, onLog, runContext);
}
