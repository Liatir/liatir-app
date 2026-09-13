/**
 * Runs Boltz-2 and Protenix base v1.0.0 from a structure draft, and turns their output into a Result.
 *
 * The draft owns what the user typed; a run owns an immutable string snapshot of it (`params`), so a
 * Job that finishes after the user navigated away — or after the app restarted — can still be
 * finalized from its metadata alone. Both models share this path because they share the complex
 * contract in core; only the adapter, the embedded script and the summary fields differ.
 */
import {
  BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID,
  BOLTZ_2_MODEL_ID,
  BOLTZ_2_PRODUCT_RECYCLING_STEPS,
  BOLTZ_2_PRODUCT_SAMPLING_STEPS,
  LIATIR_STRUCTURE_PROFILE_V1,
  PROTEIN_LIGAND_AFFINITY_TOOL_ID,
  PROTENIX_BASE_V1_MODEL_ID,
  PROTENIX_PRODUCT_DIFFUSION_STEPS,
  PROTENIX_PRODUCT_RECYCLING_STEPS,
  PROTENIX_PRODUCT_SEED_COUNT,
  adaptBoltz2Input,
  adaptProtenixInput,
  estimateHardwareResources,
  isLiatirStructureModelId,
  parseLiatirComplexSpecDraftJson,
  phase3HardwareValidationProfile,
  runtimeBoxTargetId,
  structurePredictionWorkloadMetrics,
  validateProteinLigandAffinityComplex,
  validateProteinLigandAffinityValues,
  type JsonValue,
  type LiatirAIModelRecord,
  type LiatirAIToolDefinition,
  type LiatirFileArtifactRole,
  type LiatirHardwareHostMemory,
  type LiatirHardwareResourceEstimate,
  type LiatirHardwareResourceExtrapolation,
  type LiatirHardwareResourcePreflight,
  type LiatirHardwareValidationProfile,
  type LiatirHardwareWorkloadMetrics,
  type LiatirPhase3MsaProvenance,
  type LiatirPhase3ResultProvenance,
  type LiatirRuntimeBoxActivationMetadata,
  type LiatirStructureModelId,
  type LiatirStructureMsaSelection,
  type LiatirStructurePredictionRequest,
  type LiatirStructureToolDraft,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import { cachePathForModel, runAIPython, type AIPythonRunResult } from '$lib/ai/runtime';
import { inspectStructureArtifact } from '$lib/scientific-artifacts';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { BOLTZ_STRUCTURE_SCRIPT } from './python-scripts/boltz-structure';
import { PROTENIX_STRUCTURE_SCRIPT } from './python-scripts/protenix-structure';

/** Only a run that stayed inside, or was confirmed past, the measured evidence may start. */
export type StructureAcceptedEstimate = LiatirHardwareResourceEstimate | LiatirHardwareResourceExtrapolation;

const structureInputSchema: LiatirAIToolDefinition['inputSchema'] = {
  modelId: { type: 'string', label: 'AI Model', required: true },
  specJson: { type: 'string', label: 'Molecules', required: true, connectable: false },
  msaJson: { type: 'string', label: 'Alignment choices', required: true, connectable: false },
  seed: { type: 'number', label: 'Seed', required: true, default: 17, connectable: false },
  modelCount: {
    type: 'number', label: 'Number of predicted structures', required: true, default: 1, connectable: false,
  },
};

const structureOutputSchema: LiatirAIToolDefinition['outputSchema'] = {
  predictedStructure: {
    type: 'file', label: 'Predicted structure', ext: ['cif'],
    artifact: {
      profile: { ...LIATIR_STRUCTURE_PROFILE_V1 }, format: 'mmcif', scientificType: 'molecular-structure',
    },
  },
  confidenceJson: { type: 'file', label: 'Confidence', ext: ['json'] },
  plddt: { type: 'number', label: 'Confidence (pLDDT)', format: 'decimal' },
  provenance: { type: 'json', label: 'Provenance' },
};

export const structurePredictionDefinition: LiatirAIToolDefinition = {
  id: BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID,
  type: 'ai-tool',
  label: 'Biomolecular Structure Prediction',
  description: 'Predict how proteins and other molecules fit together, locally.',
  category: 'AI Tools',
  inputSchema: structureInputSchema,
  outputSchema: structureOutputSchema,
  modelInputKey: 'modelId',
  supportedCapabilities: ['protein-structure-prediction'],
  supportedModelIds: [BOLTZ_2_MODEL_ID, PROTENIX_BASE_V1_MODEL_ID],
};

export const proteinLigandAffinityDefinition: LiatirAIToolDefinition = {
  id: PROTEIN_LIGAND_AFFINITY_TOOL_ID,
  type: 'ai-tool',
  label: 'Protein–Ligand Affinity',
  description: 'Estimate how a protein and a small molecule may bind, locally.',
  category: 'AI Tools',
  inputSchema: structureInputSchema,
  outputSchema: {
    ...structureOutputSchema,
    affinityJson: { type: 'file', label: 'Affinity', ext: ['json'] },
    bindingProbability: { type: 'number', label: 'Binding probability', format: 'decimal' },
    log10MicromolarIc50: { type: 'number', label: 'Log10(IC50), micromolar', format: 'decimal' },
  },
  modelInputKey: 'modelId',
  supportedCapabilities: ['protein-binding'],
  supportedModelIds: [BOLTZ_2_MODEL_ID],
};

export function structureToolDefinition(toolId: string): LiatirAIToolDefinition {
  if (toolId === PROTEIN_LIGAND_AFFINITY_TOOL_ID) return proteinLigandAffinityDefinition;
  if (toolId === BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID) return structurePredictionDefinition;
  throw new Error(`Unsupported structure tool: ${toolId}`);
}

/** The immutable string snapshot a run carries in its Job metadata and Result. */
export function structureRunParams(
  draft: LiatirStructureToolDraft,
  spec: unknown,
): Record<string, string> {
  return {
    modelId: draft.modelId,
    toolId: draft.toolId,
    specJson: JSON.stringify(spec),
    msaJson: JSON.stringify(draft.msa),
    seed: draft.seed.trim(),
    modelCount: draft.modelCount.trim(),
  };
}

interface AdaptedStructureRequest {
  modelId: LiatirStructureModelId;
  toolId: string;
  affinity: boolean;
  seed: number;
  modelCount: number;
  script: string;
  modelInput: Record<string, JsonValue>;
  msa: LiatirPhase3MsaProvenance;
}

/** Rebuilds the model input from a run snapshot, refusing anything the box cannot honour. */
function adaptStructureRequest(params: Record<string, string>): AdaptedStructureRequest {
  const modelId = params.modelId;
  if (!modelId || !isLiatirStructureModelId(modelId)) throw new Error('Unsupported structure AI Model.');
  const toolId = params.toolId || BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID;
  structureToolDefinition(toolId);
  const spec = parseLiatirComplexSpecDraftJson(params.specJson ?? '').spec;
  if (!spec) throw new Error('The molecule description is not valid.');
  const msa = JSON.parse(params.msaJson || '{}') as LiatirStructureMsaSelection;
  const request: LiatirStructurePredictionRequest = {
    modelId, spec, msa,
    seed: params.seed ? Number(params.seed) : Number.NaN,
    modelCount: params.modelCount ? Number(params.modelCount) : Number.NaN,
  };
  const affinity = toolId === PROTEIN_LIGAND_AFFINITY_TOOL_ID;
  if (affinity) {
    if (modelId !== BOLTZ_2_MODEL_ID) throw new Error('Protein–ligand affinity is predicted by Boltz-2 only.');
    const shape = validateProteinLigandAffinityComplex(spec);
    if (shape.length) throw new Error(shape.join(' '));
  }

  const singleSequenceEntityIds = [...msa.singleSequenceEntityIds];
  const localA3mEntityIds = spec.entities
    .filter((entity) => entity.type === 'protein' && entity.msa)
    .map((entity) => entity.id);
  const provenanceMsa = msaProvenance(localA3mEntityIds, singleSequenceEntityIds);

  if (modelId === BOLTZ_2_MODEL_ID) {
    const binder = affinity ? spec.entities.find((entity) => entity.type === 'ligand')?.id : undefined;
    const adapted = adaptBoltz2Input(request, binder);
    if (!adapted.input) throw new Error(adapted.errors.join(' '));
    return {
      modelId, toolId, affinity, seed: request.seed, modelCount: request.modelCount,
      script: BOLTZ_STRUCTURE_SCRIPT,
      modelInput: {
        boltzInput: adapted.input as unknown as JsonValue,
        seed: request.seed,
        diffusionSamples: request.modelCount,
        recyclingSteps: BOLTZ_2_PRODUCT_RECYCLING_STEPS,
        samplingSteps: BOLTZ_2_PRODUCT_SAMPLING_STEPS,
      },
      msa: provenanceMsa,
    };
  }

  if (modelId !== PROTENIX_BASE_V1_MODEL_ID) {
    throw new Error('This Protenix checkpoint has no validated Runtime Box.');
  }
  const adapted = adaptProtenixInput(request);
  if (!adapted.input) throw new Error(adapted.errors.join(' '));
  // The box forces alignment and template search off, because it has no server to build them with.
  // A supplied A3M or template would be silently ignored, and the Result would look as if it had
  // been used; refusing is the only answer that does not mislead.
  if (adapted.input.useMsa || adapted.input.useTemplate) {
    throw new Error(
      'Protenix predicts from sequence alone in Liatir, because an offline box has no alignment server. '
      + 'Remove the local alignment or template, or choose Boltz-2, which can use them.',
    );
  }
  return {
    modelId, toolId, affinity, seed: request.seed, modelCount: request.modelCount,
    script: PROTENIX_STRUCTURE_SCRIPT,
    modelInput: {
      protenixInput: adapted.input.document as unknown as JsonValue,
      seed: request.seed,
      seedCount: PROTENIX_PRODUCT_SEED_COUNT,
      sampleCount: request.modelCount,
      recyclingSteps: PROTENIX_PRODUCT_RECYCLING_STEPS,
      diffusionSteps: PROTENIX_PRODUCT_DIFFUSION_STEPS,
    },
    msa: provenanceMsa,
  };
}

function msaProvenance(local: string[], single: string[]): LiatirPhase3MsaProvenance {
  if (local.length && single.length) return { mode: 'mixed', localA3mEntityIds: local, singleSequenceEntityIds: single };
  if (local.length) return { mode: 'local-a3m', localA3mEntityIds: local, singleSequenceEntityIds: [] };
  return { mode: 'single-sequence', localA3mEntityIds: [], singleSequenceEntityIds: single };
}

function activationFor(model: LiatirAIModelRecord): LiatirRuntimeBoxActivationMetadata {
  if (!model.runtimeBoxActivation) {
    throw new Error(`The installed ${model.name} Runtime Box has no verified activation identity.`);
  }
  return model.runtimeBoxActivation;
}

function requireInstalled(model: LiatirAIModelRecord): string {
  if (model.status !== 'installed' || !model.runtimePath) throw new Error(`AI Model is not installed: ${model.name}`);
  return model.runtimePath;
}

function pythonPayload(
  model: LiatirAIModelRecord,
  adapted: AdaptedStructureRequest,
  activation: LiatirRuntimeBoxActivationMetadata,
  action: 'preflight' | 'run',
  outputDir?: string,
): Record<string, JsonValue> {
  return {
    action,
    runtimePath: requireInstalled(model),
    modelCacheDir: cachePathForModel(model),
    runtimeId: model.install.runtimeId,
    runtimeBoxRelease: activation.release.version,
    targetId: runtimeBoxTargetId(activation.selectedTarget),
    accelerator: activation.selectedTarget.accelerator,
    jobName: 'prediction',
    ...(outputDir ? { outputDir } : {}),
    ...adapted.modelInput,
  };
}

function parsePythonJson<T>(stdout: string, label: string): T {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { return JSON.parse(lines[index]) as T; } catch { /* keep scanning earlier log lines */ }
  }
  throw new Error(`${label} did not return a structured result.`);
}

export interface StructurePreflight {
  metrics: LiatirHardwareWorkloadMetrics;
  profile: LiatirHardwareValidationProfile | null;
  estimate: LiatirHardwareResourcePreflight;
}

interface StructurePreflightPayload {
  kind: string;
  tokenEstimate: number;
  workloadId?: string;
  diffusionSamples?: number;
  structureCount?: number;
}

/** Sizes a request inside the box, before any checkpoint is loaded, and judges it against evidence. */
export async function preflightStructurePrediction(
  model: LiatirAIModelRecord,
  params: Record<string, string>,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): Promise<StructurePreflight> {
  const adapted = adaptStructureRequest(params);
  const activation = activationFor(model);
  const result = await runAIPython(model, adapted.script, pythonPayload(model, adapted, activation, 'preflight'), {
    trackJob: false, timeoutSeconds: 120,
  });
  if (!result.ok) throw new Error(result.stderr || `${model.name} preflight exited with code ${result.exitCode}`);
  const payload = parsePythonJson<StructurePreflightPayload>(result.stdout, `${model.name} preflight`);
  const boltz = adapted.modelId === BOLTZ_2_MODEL_ID;
  if (payload.kind !== (boltz ? 'liatir.boltz-2-preflight' : 'liatir.protenix-preflight')) {
    throw new Error(`${model.name} preflight returned an unsupported result contract.`);
  }
  const metrics = structurePredictionWorkloadMetrics(adapted.modelId, {
    tokenEstimate: payload.tokenEstimate,
    structureCount: (boltz ? payload.diffusionSamples : payload.structureCount) ?? 0,
    steps: boltz ? BOLTZ_2_PRODUCT_SAMPLING_STEPS : PROTENIX_PRODUCT_DIFFUSION_STEPS,
    affinity: boltz && payload.workloadId === 'affinity',
  });
  const profile = phase3HardwareValidationProfile({
    componentId: model.id,
    componentVersion: model.version ?? '',
    runtimeBoxRelease: activation.release.version,
    target: activation.selectedTarget,
  });
  const estimate: LiatirHardwareResourcePreflight = profile
    ? estimateHardwareResources(metrics, profile, host)
    : {
        accepted: false,
        reason: 'no-evidence',
        error: `No retained measured hardware envelope is available for this exact ${model.name} release and target.`,
        maxValidatedTokenCount: 0,
        maxValidatedAtomCount: 0,
        maxValidatedStepCount: 0,
        maxValidatedOutputItemCount: 0,
      };
  return { metrics, profile, estimate };
}

/**
 * Starts one prediction as a tracked Job.
 *
 * The acknowledgement and the checked estimate are enforced here, not only on the screen, and the
 * estimate the page recorded must be the one this run re-derives: a Result then cannot claim evidence
 * for an input that was changed after it was checked.
 */
export async function runStructurePrediction(
  model: LiatirAIModelRecord,
  params: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext,
  options: { host?: LiatirHardwareHostMemory; confirmedBeyondEvidence?: boolean } = {},
) {
  requireInstalled(model);
  const adapted = adaptStructureRequest(params);
  const activation = activationFor(model);
  const preflight = await preflightStructurePrediction(model, params, options.host);
  if (!preflight.estimate.accepted) throw new Error(preflight.estimate.error);
  if (preflight.estimate.confirmationRequired && !options.confirmedBeyondEvidence) {
    throw new Error('This prediction is larger than any retained measurement and was not confirmed.');
  }
  if (params.hardwareEstimate !== JSON.stringify(preflight.estimate)) {
    throw new Error('The prediction changed after it was checked. Check the run again.');
  }
  const definition = structureToolDefinition(adapted.toolId);
  onLog(`ai-tool ${definition.id}`);
  onLog(`model ${model.id}`);
  onLog(`preflight ${preflight.metrics.tokenCount} tokens · ${preflight.metrics.outputItemCount} structures`);
  onLog(`hardware evidence ${preflight.estimate.hardwareProfileId} (${preflight.estimate.evidence})`);
  const result = await runAIPython(model, adapted.script, pythonPayload(model, adapted, activation, 'run', outputDir), {
    timeoutSeconds: 14_400,
    jobLabel: runContext?.runKind === 'pipeline-step'
      ? `${runContext.pipelineName}: ${definition.label}`
      : definition.label,
    metadata: {
      toolId: definition.id,
      ...(runContext ? aiRunMetadata(runContext) : {}),
    },
    signal: runContext?.signal,
    onJobId: runContext?.onJobId,
  });
  return finalizeStructurePredictionResult(model, params, result, onLog, outputDir);
}

function safeOutputPath(path: string, outputDir: string | undefined, label: string): string {
  if (typeof path !== 'string' || !path) throw new Error(`${label} is missing from the result.`);
  if (!outputDir) return path;
  const root = outputDir.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const normalized = path.replace(/\\/gu, '/');
  if (!root || normalized.includes('/../') || !normalized.startsWith(`${root}/`)) {
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

interface StructureResultPayload {
  kind: string;
  summary: Record<string, JsonValue>;
  paths: Record<string, string>;
  warnings: string[];
}

function finiteFraction(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite value between 0 and 1.`);
  }
  return value;
}

function parseAcceptedEstimate(serialized: string | undefined): StructureAcceptedEstimate {
  const estimate = serialized ? JSON.parse(serialized) as LiatirHardwareResourcePreflight : null;
  if (!estimate?.accepted || !estimate.hardwareProfileId) {
    throw new Error('This prediction has no accepted measured hardware envelope.');
  }
  return estimate;
}

/** Converts one finished run into files, a rendered Result and scientific provenance. */
export async function finalizeStructurePredictionResult(
  model: LiatirAIModelRecord,
  params: Record<string, string>,
  result: AIPythonRunResult,
  onLog: (line: string) => void,
  outputDir?: string,
): Promise<{
  outputFiles: RunOutputFile[];
  sideEffects: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}> {
  if (!result.ok) throw new Error(result.stderr || `${model.name} exited with code ${result.exitCode}`);
  const adapted = adaptStructureRequest(params);
  if (adapted.modelId !== model.id) throw new Error('The result came from a different AI Model.');
  const boltz = adapted.modelId === BOLTZ_2_MODEL_ID;
  const parsed = parsePythonJson<StructureResultPayload>(result.stdout, model.name);
  if (parsed.kind !== (boltz ? 'liatir.boltz-2-result' : 'liatir.protenix-result')) {
    throw new Error(`${model.name} returned an unsupported result contract.`);
  }
  const activation = result.runtimeBoxActivation ?? activationFor(model);
  const summary = parsed.summary;
  const expectedTarget = runtimeBoxTargetId(activation.selectedTarget);
  if (summary.runtimeBoxRelease !== activation.release.version || summary.targetId !== expectedTarget) {
    throw new Error('The result release or target does not match the verified Runtime Box activation.');
  }
  if (summary.accelerator !== activation.selectedTarget.accelerator || summary.networkAccess !== false) {
    throw new Error('The result accelerator or offline boundary is invalid.');
  }
  // The three settings that make a Protenix Result reproducible and offline are reported by the run
  // itself, so a regression that quietly turned one back off cannot produce a Result.
  if (!boltz && (summary.deterministic !== true || summary.usedMsa !== false || summary.kernels !== 'torch')) {
    throw new Error('The Protenix result was not produced with its reproducible, offline settings.');
  }
  const estimate = parseAcceptedEstimate(params.hardwareEstimate);

  const plddt = finiteFraction(boltz ? summary.complexPlddt : summary.plddt, 'Confidence (pLDDT)');
  const ptm = finiteFraction(summary.ptm, 'pTM');
  const seed = Number(boltz ? summary.seed : summary.selectedSeed);
  const structureCount = Number(boltz ? summary.modelCount : summary.structureCount);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(structureCount) || structureCount < 1) {
    throw new Error('The result seed or structure count is invalid.');
  }
  const affinity = adapted.affinity ? {
    bindingProbability: Number(summary.affinityProbabilityBinary),
    log10MicromolarIc50: Number(summary.affinityPredValue),
  } : null;
  if (affinity) {
    const checked = validateProteinLigandAffinityValues(affinity);
    if (!checked.valid) throw new Error(checked.errors.join(' '));
  }

  const structurePath = safeOutputPath(parsed.paths.structure, outputDir, 'Predicted structure');
  const confidencePath = safeOutputPath(parsed.paths.confidence, outputDir, 'Confidence');
  const inputDocumentPath = safeOutputPath(parsed.paths.inputDocument, outputDir, 'Input document');
  const affinityPath = affinity ? safeOutputPath(parsed.paths.affinity, outputDir, 'Affinity') : null;
  const candidateKeys = Object.keys(parsed.paths)
    .filter((key) => /^(?:model|sample)\d+$/u.test(key))
    .sort((left, right) => Number(left.replace(/\D/gu, '')) - Number(right.replace(/\D/gu, '')));

  const structureScientific = await inspectStructureArtifact(structurePath, {
    format: 'mmcif', recognizedFormat: true, modelCount: 1,
  }, { viewerHints: { preferredViewer: 'structure-viewer' } });

  const provenance: LiatirPhase3ResultProvenance = {
    schemaVersion: 1,
    componentId: model.id,
    model: { id: model.id, version: model.version ?? '' },
    forceField: null,
    accelerator: activation.selectedTarget.accelerator,
    computeDevice: typeof summary.gpuModel === 'string' ? summary.gpuModel : activation.selectedTarget.accelerator,
    // Protenix's CLI default is bf16 and the product does not override it; Boltz-2's precision is
    // whatever its own predict command selects, which the product does not override either.
    precision: boltz ? 'upstream default' : 'bf16',
    seed,
    msa: adapted.msa,
    scrollcase: {
      boxId: model.install.runtimeBox.boxId,
      runtimeId: model.install.runtimeId ?? '',
      releaseVersion: activation.release.version,
      target: activation.selectedTarget,
      archiveSha256: activation.release.archive.sha256,
    },
    hardwareProfileId: estimate.hardwareProfileId,
    hardwareEvidence: estimate.evidence,
  };

  const seedRow = boltz
    ? String(seed)
    : `${seed}, the best-ranked of ${(summary.seedCount as number) ?? PROTENIX_PRODUCT_SEED_COUNT} seeds from ${adapted.seed}`;
  const provenanceRows: (string | number)[][] = [
    // Protenix's name already carries its checkpoint version; Boltz-2's does not.
    ['AI Model', model.version && !model.name.includes(model.version) ? `${model.name} ${model.version}` : model.name],
    ['Seed', seedRow],
    ['Structures drawn', structureCount],
    ['Alignment', adapted.msa.mode === 'single-sequence' ? 'None — predicted from sequence alone' : adapted.msa.mode],
    ['Network access', 'Disabled'],
    ['Hardware evidence', estimate.hardwareProfileId],
    ['Within measured evidence', estimate.evidence === 'measured'
      ? 'Yes'
      : 'No — the user confirmed a run larger than any retained measurement'],
    ['Runtime Box', `${activation.release.version} · ${expectedTarget}`],
    ['Runtime Box archive SHA-256', activation.release.archive.sha256],
  ];

  const stats = [
    { label: 'Confidence (pLDDT)', value: plddt.toFixed(2) },
    { label: 'pTM', value: ptm.toFixed(2) },
    { label: 'Structures drawn', value: structureCount },
    { label: 'Seed', value: seed },
  ];
  const output: ToolOutput = { sections: [
    { type: 'stats', cols: 4, items: stats },
    ...(affinity ? [{
      type: 'stats' as const, cols: 2, items: [
        { label: 'Binding probability', value: affinity.bindingProbability.toFixed(3) },
        { label: 'Log10(IC50), micromolar', value: affinity.log10MicromolarIc50.toFixed(3) },
      ],
    }] : []),
    { type: 'text', label: 'Interpretation', content: parsed.warnings.join('\n\n') },
    {
      type: 'structure-viewer', label: 'Predicted structure', path: structurePath, format: 'mmcif',
      style: 'cartoon', colorScheme: 'chain', height: 460,
    },
    { type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows },
  ] };

  const outputFiles = [
    await outputFile('Predicted structure', structurePath, 'cif', 'predictedStructure', 'final', structureScientific),
    await outputFile('Confidence', confidencePath, 'json', 'confidenceJson', 'final'),
    ...(affinityPath ? [await outputFile('Affinity', affinityPath, 'json', 'affinityJson', 'final')] : []),
    await outputFile('Model input document', inputDocumentPath, 'json', 'inputDocument', 'intermediate'),
  ];
  for (const [index, key] of candidateKeys.entries()) {
    const path = safeOutputPath(parsed.paths[key], outputDir, `Candidate structure ${index + 1}`);
    outputFiles.push(await outputFile(`Candidate structure ${index + 1}`, path, 'cif', key, 'intermediate'));
  }
  onLog(`${model.name}: pLDDT ${plddt.toFixed(3)} across ${structureCount} structures`);

  return {
    outputFiles,
    sideEffects: [],
    output,
    metrics: {
      plddt,
      ptm,
      structureCount,
      ...(affinity ? affinity : {}),
    },
    values: {
      plddt,
      ...(affinity ? affinity : {}),
      provenance: provenance as unknown as JsonValue,
    },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}
