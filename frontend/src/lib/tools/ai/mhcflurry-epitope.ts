import {
  LIATIR_FASTA_PROFILE_V1,
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
  MHCFLURRY_EPITOPE_TOOL_ID,
  ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE,
  liatirArtifactLineageSource,
  parseMhcClassIAlleles,
  parseMhcClassIPeptideLengths,
  runtimeBoxTargetId,
  type JsonValue,
  type LiatirAIModelRecord,
  type LiatirAIProvenance,
  type LiatirAIToolDefinition,
  type LiatirFileArtifactRole,
} from '@liatir/core';
import { liatir } from '$lib/api';
import type { AIRunContext } from '$lib/ai/direct-run-context';
import { aiRunMetadata } from '$lib/ai/direct-run-context';
import { cachePathForModel, runAIPython, type AIPythonRunResult } from '$lib/ai/runtime';
import { runtimeBoxResultProvenance } from '$lib/ai/runtime-box-provenance';
import { inspectFastaArtifact } from '$lib/scientific-artifacts';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { MHCFLURRY_EPITOPE_SCRIPT } from './python-scripts/mhcflurry-epitope';

export const mhcFlurryEpitopeDefinition: LiatirAIToolDefinition = {
  id: MHCFLURRY_EPITOPE_TOOL_ID,
  type: 'ai-tool',
  label: 'MHC-I Epitope Prediction',
  description: 'Rank local MHC Class I peptide candidates with bundled MHCflurry models.',
  category: 'AI Tools',
  inputSchema: {
    modelId: { type: 'string', label: 'AI Model', required: true },
    inputKind: {
      type: 'string', label: 'Input type', required: true, default: 'fasta', connectable: false,
      options: [
        { value: 'fasta', label: 'Protein FASTA' },
        { value: 'peptide-table', label: 'Peptide table' },
      ],
    },
    inputFile: {
      type: 'file', label: 'Protein FASTA or peptide table', required: true,
      accept: ['fasta', 'fa', 'faa', 'csv', 'tsv'],
    },
    alleles: {
      type: 'string', label: 'HLA Class I alleles', required: true,
      description: 'Comma-separated names such as HLA-A*02:01,HLA-B*07:02.',
    },
    peptideLengths: {
      type: 'string', label: 'Peptide lengths', required: true, default: '8,9,10,11',
      connectable: false,
    },
    mode: {
      type: 'string', label: 'Prediction mode', required: true, default: 'presentation',
      connectable: false,
      options: [
        { value: 'presentation', label: 'Presentation' },
        { value: 'binding', label: 'Binding' },
      ],
    },
    topCount: {
      type: 'number', label: 'Top peptides', required: false, default: 50, connectable: false,
    },
  },
  outputSchema: {
    predictionsCsv: { type: 'file', label: 'Ranked predictions', ext: ['csv'] },
    bestPeptidesFasta: {
      type: 'file', label: 'Top peptides', ext: ['fasta'],
      artifact: {
        profile: { ...LIATIR_FASTA_PROFILE_V1 },
        format: 'fasta',
        scientificType: 'biological-sequences',
        qualifiers: { sequence: { alphabet: 'protein' } },
      },
    },
    summaryJson: { type: 'file', label: 'Prediction summary', ext: ['json'] },
    predictionCount: { type: 'number', label: 'Predictions', format: 'integer' },
    topPeptideCount: { type: 'number', label: 'Top peptides', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
  modelInputKey: 'modelId',
  supportedCapabilities: ['mhc-class-i-epitope-prediction'],
  supportedModelIds: [MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID],
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function parsePythonJson<T>(stdout: string): T {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { return JSON.parse(lines[index]) as T; } catch { /* keep scanning */ }
  }
  throw new Error('MHCflurry did not return a structured result.');
}

function tableCell(value: JsonValue | undefined): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

async function outputFile(
  label: string,
  path: string,
  ext: string,
  fieldKey: string,
  role: LiatirFileArtifactRole = 'final',
  scientific?: RunOutputFile['scientific'],
): Promise<RunOutputFile> {
  let size: number | undefined;
  try { size = await liatir()?.invoke('lia_file_size', { path }) as number; } catch { /* optional */ }
  return { label, path, ext, size, fieldKey, role, ...(scientific ? { scientific } : {}) };
}

interface MhcFlurryPayload {
  predictionsPath: string;
  bestFastaPath: string;
  summaryPath: string;
  summary: {
    inputKind: 'fasta' | 'peptide-table';
    inputRows: number;
    sequenceCount: number | null;
    totalResidues: number | null;
    alleles: string[];
    peptideLengths: number[];
    mode: 'binding' | 'presentation';
    requestedTopCount: number;
    predictionCount: number;
    topPeptideCount: number;
    rankColumn: string;
    accelerator: string;
    mhcflurryVersion: string;
    networkAccess: false;
  };
  preview: Record<string, JsonValue>[];
}

export async function finalizeMhcFlurryEpitopeResult(
  model: LiatirAIModelRecord,
  inputs: Record<string, string>,
  result: AIPythonRunResult,
  onLog: (line: string) => void,
): Promise<{
  outputFiles: RunOutputFile[];
  sideEffects: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  executionEvidence: Record<string, JsonValue>;
}> {
  if (!result.ok) throw new Error(result.stderr || `MHCflurry exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<MhcFlurryPayload>(result.stdout);
  await dataFiles.init();

  let inputScientific = dataFiles.files.find((file) => file.path === inputs.inputFile)?.scientific;
  if (parsed.summary.inputKind === 'fasta') {
    inputScientific = await inspectFastaArtifact(inputs.inputFile, {
      headerPresent: true,
      sequenceCount: parsed.summary.sequenceCount ?? undefined,
      alphabet: 'protein',
      validCharacters: true,
      aligned: false,
    });
    await dataFiles.setScientific(inputs.inputFile, inputScientific);
  }
  const bestScientific = await inspectFastaArtifact(parsed.bestFastaPath, {
    headerPresent: true,
    sequenceCount: parsed.summary.topPeptideCount,
    alphabet: 'protein',
    validCharacters: true,
    aligned: false,
  }, inputScientific ? {
    lineage: {
      sources: [liatirArtifactLineageSource(inputScientific, 'input', 'inputFile')],
      transformation: {
        id: mhcFlurryEpitopeDefinition.id,
        label: mhcFlurryEpitopeDefinition.label,
        version: '1',
        sourceRevision: model.install.revision,
        parameters: {
          modelId: model.id,
          mode: parsed.summary.mode,
          alleles: parsed.summary.alleles,
          peptideLengths: parsed.summary.peptideLengths,
          topCount: parsed.summary.requestedTopCount,
        },
      },
    },
  } : {});

  const activation = result.runtimeBoxActivation ?? model.runtimeBoxActivation;
  const modelProvenance = {
    modelId: model.id,
    modelName: model.name,
    modelVersion: model.version ?? null,
    runtimeKind: model.runtime.kind,
    runtimeName: model.runtime.name,
    runtimeVersion: model.runtime.version ?? null,
    ...runtimeBoxResultProvenance({ runtimeBoxActivation: activation }),
  };

  const provenanceRows: (string | number)[][] = [
    ['AI Model', `${model.name} ${model.version ?? ''}`.trim()],
    ['Runtime', `${model.runtime.name} ${model.runtime.version ?? ''}`.trim()],
    ['MHCflurry', parsed.summary.mhcflurryVersion],
    ['Input', basename(inputs.inputFile)],
    ['Input type', parsed.summary.inputKind === 'fasta' ? 'Protein FASTA' : 'Peptide table'],
    ['Mode', parsed.summary.mode === 'presentation' ? 'Presentation' : 'Binding'],
    ['HLA Class I alleles', parsed.summary.alleles.join(', ')],
    ['Peptide lengths', parsed.summary.peptideLengths.join(', ')],
    ['Requested top peptides', parsed.summary.requestedTopCount],
    ['Accelerator', parsed.summary.accelerator],
    ['Network access', 'Disabled'],
  ];
  if (activation) {
    provenanceRows.push(
      ['Runtime Box', `${activation.release.version} · ${runtimeBoxTargetId(activation.selectedTarget)}`],
      ['Runtime Box archive SHA-256', activation.release.archive.sha256],
    );
  }
  const provenance: LiatirAIProvenance = {
    toolId: mhcFlurryEpitopeDefinition.id,
    toolLabel: mhcFlurryEpitopeDefinition.label,
    ...modelProvenance,
    models: [modelProvenance],
    localOnly: true,
    inputSummary: {
      inputFile: basename(inputs.inputFile),
      inputKind: parsed.summary.inputKind,
      inputRows: parsed.summary.inputRows,
      sequenceCount: parsed.summary.sequenceCount,
      totalResidues: parsed.summary.totalResidues,
    },
    parameters: {
      mode: parsed.summary.mode,
      alleles: parsed.summary.alleles,
      peptideLengths: parsed.summary.peptideLengths,
      topCount: parsed.summary.requestedTopCount,
      accelerator: parsed.summary.accelerator,
      networkAccess: parsed.summary.networkAccess,
    },
    generatedAt: new Date().toISOString(),
  };

  const previewHeaders = parsed.preview.length > 0 ? Object.keys(parsed.preview[0]) : [];
  return {
    outputFiles: [
      await outputFile('Ranked MHC-I predictions', parsed.predictionsPath, 'csv', 'predictionsCsv'),
      await outputFile('Top peptide candidates', parsed.bestFastaPath, 'fasta', 'bestPeptidesFasta', 'final', bestScientific),
      await outputFile('Prediction summary', parsed.summaryPath, 'json', 'summaryJson'),
    ],
    sideEffects: [],
    output: {
      sections: [
        {
          type: 'stats', cols: 4, items: [
            { label: 'Predictions', value: parsed.summary.predictionCount },
            { label: 'Top peptides', value: parsed.summary.topPeptideCount },
            { label: 'Alleles', value: parsed.summary.alleles.length },
            { label: 'Mode', value: parsed.summary.mode === 'presentation' ? 'Presentation' : 'Binding' },
          ],
        },
        {
          type: 'text', label: 'Interpretation', content: ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE,
        },
        ...(previewHeaders.length > 0 ? [{
          type: 'table' as const,
          label: 'Top predictions',
          headers: previewHeaders,
          rows: parsed.preview.map((row) => previewHeaders.map((header) => tableCell(row[header]))),
        }] : []),
        {
          type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows,
        },
      ],
    },
    metrics: {
      predictionCount: parsed.summary.predictionCount,
      topPeptideCount: parsed.summary.topPeptideCount,
    },
    values: {
      predictionCount: parsed.summary.predictionCount,
      topPeptideCount: parsed.summary.topPeptideCount,
      provenance: provenance as unknown as JsonValue,
    },
    executionEvidence: provenance as unknown as Record<string, JsonValue>,
  };
}

export async function runMhcFlurryEpitopeStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext,
) {
  await aiModelsStore.init();
  const model = aiModelsStore.byId(inputs.modelId?.trim());
  if (!model || model.id !== MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID) {
    throw new Error('MHC-I Epitope Prediction requires the MHCflurry Class I Presentation AI Model.');
  }
  if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
  if (!model.runtimePath) throw new Error(`AI Model Runtime Box path is unavailable: ${model.name}`);
  if (!inputs.inputFile) throw new Error('A protein FASTA or peptide table is required.');
  const inputKind = inputs.inputKind === 'peptide-table' ? 'peptide-table' : 'fasta';
  const alleles = parseMhcClassIAlleles(inputs.alleles ?? '');
  const peptideLengths = parseMhcClassIPeptideLengths(inputs.peptideLengths || '8,9,10,11');
  const mode = inputs.mode === 'binding' ? 'binding' : 'presentation';
  const topCount = boundedInteger(inputs.topCount, 50, 1, 5000);

  onLog(`ai-tool ${mhcFlurryEpitopeDefinition.id}`);
  onLog(`model ${model.id}`);
  onLog(`input ${basename(inputs.inputFile)}`);
  onLog(`mode ${mode}`);
  const result = await runAIPython(model, MHCFLURRY_EPITOPE_SCRIPT, {
    inputFile: inputs.inputFile,
    inputKind,
    outputDir,
    modelCacheDir: cachePathForModel(model),
    runtimePath: model.runtimePath,
    alleles,
    peptideLengths,
    mode,
    topCount,
  }, {
    timeoutSeconds: 14_400,
    jobLabel: runContext?.runKind === 'pipeline-step'
      ? `${runContext.pipelineName}: ${mhcFlurryEpitopeDefinition.label}`
      : mhcFlurryEpitopeDefinition.label,
    metadata: {
      toolId: mhcFlurryEpitopeDefinition.id,
      ...(runContext ? aiRunMetadata(runContext) : {}),
    },
    signal: runContext?.signal,
    onJobId: runContext?.onJobId,
  });
  return finalizeMhcFlurryEpitopeResult(model, inputs, result, onLog);
}
