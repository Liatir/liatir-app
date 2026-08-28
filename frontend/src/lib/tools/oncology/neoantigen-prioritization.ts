import {
  LIATIR_FASTA_PROFILE_V1,
  LIATIR_NEOANTIGEN_TSV_PROFILE_V1,
  LIATIR_VEP_TUMOR_VCF_PROFILE_V1,
  NEOANTIGEN_PRIORITIZATION_TOOL_ID,
  ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE,
  PVACTOOLS_RUNTIME_COMPONENT_ID,
  liatirArtifactLineageSource,
  parseMhcClassIAlleles,
  parseMhcClassIPeptideLengths,
  runtimeBoxTargetId,
  type JsonValue,
  type LiatirFileArtifactRole,
  type LiatirRuntimeComponentPythonRunResult,
  type LiatirStepDefinition,
  type LiatirToolRuntimeRecord,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import {
  toolRuntimeDirectRunMetadata,
  type ToolRuntimeDirectRunContext,
} from '$lib/tool-runtimes/direct-run-context';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import { runToolRuntimePython } from '$lib/tool-runtimes/runtime';
import { inspectFastaArtifact, inspectNeoantigenTsvArtifact, inspectVepTumorVcfArtifact } from '$lib/scientific-artifacts';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { PVACSEQ_SCRIPT } from './python-scripts/pvacseq';

export const neoantigenPrioritizationDefinition: LiatirStepDefinition = {
  id: NEOANTIGEN_PRIORITIZATION_TOOL_ID,
  type: 'tool-runtime',
  label: 'Neoantigen Prioritization',
  description: 'Prioritize local MHC Class I neoantigen candidates from a VEP-annotated tumor VCF.',
  category: 'Oncology',
  inputSchema: {
    inputVcf: {
      type: 'file', label: 'VEP-annotated tumor VCF', required: true,
      accept: ['vcf', 'vcf.gz'],
      artifact: {
        profiles: [{ ...LIATIR_VEP_TUMOR_VCF_PROFILE_V1 }],
        formats: ['vcf'],
        scientificTypes: ['vep-annotated-tumor-variants'],
        validation: 'valid',
      },
    },
    tumorSample: { type: 'string', label: 'Tumor sample', required: true },
    normalSample: { type: 'string', label: 'Normal sample', required: false },
    alleles: {
      type: 'string', label: 'HLA Class I alleles', required: true,
      description: 'Comma-separated names such as HLA-A*02:01,HLA-B*07:02.',
    },
    proximalVcf: {
      type: 'file', label: 'Phased proximal variants VCF', required: false,
      accept: ['vcf.gz'],
    },
    peptideLengths: {
      type: 'string', label: 'Peptide lengths', required: true, default: '8,9,10,11',
      connectable: false,
    },
    passOnly: {
      type: 'boolean', label: 'Use PASS variants only', required: false, default: false,
      connectable: false,
    },
    topCount: {
      type: 'number', label: 'Candidate peptides', required: false, default: 100,
      connectable: false,
    },
    threads: {
      type: 'number', label: 'Worker threads', required: false, default: 1,
      connectable: false,
    },
  },
  outputSchema: {
    allEpitopes: { type: 'file', label: 'All epitopes', ext: ['tsv'] },
    filteredEpitopes: { type: 'file', label: 'Filtered epitopes', ext: ['tsv'] },
    aggregateReport: {
      type: 'file', label: 'Aggregated candidates', ext: ['tsv'],
      artifact: {
        profile: { ...LIATIR_NEOANTIGEN_TSV_PROFILE_V1 },
        format: 'tsv',
        scientificType: 'neoantigen-candidate-report',
      },
    },
    aggregateMetrics: { type: 'file', label: 'Aggregated metrics', ext: ['json'] },
    candidateFasta: {
      type: 'file', label: 'Candidate peptides', ext: ['fasta'],
      artifact: {
        profile: { ...LIATIR_FASTA_PROFILE_V1 },
        format: 'fasta',
        scientificType: 'biological-sequences',
        qualifiers: { sequence: { alphabet: 'protein' } },
      },
    },
    summaryJson: { type: 'file', label: 'Run summary', ext: ['json'] },
    aggregateCount: { type: 'number', label: 'Aggregated candidates', format: 'integer' },
    filteredCount: { type: 'number', label: 'Filtered epitopes', format: 'integer' },
    provenance: { type: 'json', label: 'Provenance' },
  },
};

interface PvacseqInputInspection {
  vcfHeader: boolean;
  csqHeader: boolean;
  genotypeFormat: boolean;
  sampleIds: string[];
  tumorSample: string | null;
  normalSample: string | null;
  variantCount: number;
  wildtypeProteinAnnotation: boolean;
  frameshiftSequenceAnnotation: boolean;
}

interface PvacseqPayload {
  allPath: string;
  filteredPath: string;
  aggregatePath: string;
  metricsPath: string;
  candidatesPath: string;
  summaryPath: string;
  summary: {
    pvactoolsVersion: '7.1.2';
    mhcflurryVersion: '2.0.6';
    predictors: ['MHCflurry', 'MHCflurryEL'];
    alleles: string[];
    peptideLengths: number[];
    threads: number;
    passOnly: boolean;
    requestedTopCount: number;
    networkAccess: false;
    inputInspection: PvacseqInputInspection & { tumorSample: string };
    proximalInputInspection: PvacseqInputInspection | null;
    allEpitopeCount: number;
    filteredCount: number;
    aggregateCount: number;
    candidateCount: number;
    aggregateColumns: string[];
    requiredAggregateColumns: string[];
    finiteScores: boolean;
  };
  preview: Record<string, string>[];
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function parsePythonJson<T>(stdout: string): T {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { return JSON.parse(lines[index]) as T; } catch { /* keep scanning */ }
  }
  throw new Error('pVACseq did not return a structured result.');
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function inputBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
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
  return { label, path, ext, fieldKey, role, size, ...(scientific ? { scientific } : {}) };
}

export async function finalizeNeoantigenPrioritizationResult(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  result: LiatirRuntimeComponentPythonRunResult,
  onLog: (line: string) => void,
) {
  if (!result.ok) throw new Error(result.stderr || `pVACseq exited with code ${result.exitCode}`);
  if (result.stderr.trim()) onLog(result.stderr.trim());
  const parsed = parsePythonJson<PvacseqPayload>(result.stdout);
  await dataFiles.init();

  const inputInspection = {
    ...parsed.summary.inputInspection,
    ...(parsed.summary.inputInspection.normalSample
      ? { normalSample: parsed.summary.inputInspection.normalSample }
      : { normalSample: undefined }),
  };
  const inputScientific = await inspectVepTumorVcfArtifact(inputs.inputVcf, inputInspection);
  await dataFiles.setScientific(inputs.inputVcf, inputScientific);
  const lineage = {
    sources: [liatirArtifactLineageSource(inputScientific, 'input', 'inputVcf')],
    transformation: {
      id: neoantigenPrioritizationDefinition.id,
      label: neoantigenPrioritizationDefinition.label,
      version: '1',
      sourceRevision: runtime.version,
      parameters: {
        runtimeId: runtime.id,
        predictors: parsed.summary.predictors,
        alleles: parsed.summary.alleles,
        peptideLengths: parsed.summary.peptideLengths,
        tumorSample: parsed.summary.inputInspection.tumorSample,
        normalSample: parsed.summary.inputInspection.normalSample,
        proximalVcf: inputs.proximalVcf ? basename(inputs.proximalVcf) : null,
        passOnly: parsed.summary.passOnly,
        topCount: parsed.summary.requestedTopCount,
        threads: parsed.summary.threads,
      },
    },
  };
  const aggregateScientific = await inspectNeoantigenTsvArtifact(parsed.aggregatePath, {
    tabDelimited: true,
    columns: parsed.summary.aggregateColumns,
    requiredColumns: parsed.summary.requiredAggregateColumns,
    rowCount: parsed.summary.aggregateCount,
    finiteScores: parsed.summary.finiteScores,
  }, { lineage });
  const candidatesScientific = parsed.summary.candidateCount > 0
    ? await inspectFastaArtifact(parsed.candidatesPath, {
        headerPresent: true,
        sequenceCount: parsed.summary.candidateCount,
        alphabet: 'protein',
        validCharacters: true,
        aligned: false,
      }, { lineage })
    : undefined;
  const activation = result.runtimeBoxActivation
    ?? runtimeBoxActivationFromMetadata(runtime);
  const provenance: Record<string, JsonValue> = {
    toolId: neoantigenPrioritizationDefinition.id,
    toolRuntimeId: runtime.id,
    toolRuntimeVersion: runtime.version,
    pvactoolsVersion: parsed.summary.pvactoolsVersion,
    mhcflurryVersion: parsed.summary.mhcflurryVersion,
    predictors: parsed.summary.predictors,
    localOnly: true,
    networkAccess: false,
    inputSummary: {
      inputVcf: basename(inputs.inputVcf),
      proximalVcf: inputs.proximalVcf ? basename(inputs.proximalVcf) : null,
      primaryInspection: { ...parsed.summary.inputInspection },
      proximalInspection: parsed.summary.proximalInputInspection
        ? { ...parsed.summary.proximalInputInspection }
        : null,
    },
    parameters: {
      tumorSample: parsed.summary.inputInspection.tumorSample,
      normalSample: parsed.summary.inputInspection.normalSample,
      alleles: parsed.summary.alleles,
      peptideLengths: parsed.summary.peptideLengths,
      predictors: parsed.summary.predictors,
      passOnly: parsed.summary.passOnly,
      topCount: parsed.summary.requestedTopCount,
      threads: parsed.summary.threads,
    },
    generatedAt: new Date().toISOString(),
    ...(activation ? { runtimeBoxActivation: activation as unknown as JsonValue } : {}),
  };

  const provenanceRows: (string | number)[][] = [
    ['Tool Runtime', `${runtime.name} ${runtime.version}`],
    ['pVACtools', parsed.summary.pvactoolsVersion],
    ['MHCflurry', parsed.summary.mhcflurryVersion],
    ['Predictors', parsed.summary.predictors.join(', ')],
    ['Input VCF', basename(inputs.inputVcf)],
    ['Proximal VCF', inputs.proximalVcf ? basename(inputs.proximalVcf) : 'Not provided'],
    ['Tumor sample', parsed.summary.inputInspection.tumorSample],
    ['Normal sample', parsed.summary.inputInspection.normalSample ?? 'Not provided'],
    ['HLA Class I alleles', parsed.summary.alleles.join(', ')],
    ['Peptide lengths', parsed.summary.peptideLengths.join(', ')],
    ['Use PASS variants only', parsed.summary.passOnly ? 'Yes' : 'No'],
    ['Requested candidate peptides', parsed.summary.requestedTopCount],
    ['Worker threads', parsed.summary.threads],
    ['Network access', 'Disabled'],
  ];
  if (activation) {
    provenanceRows.push(
      ['Runtime Box', `${activation.release.version} · ${runtimeBoxTargetId(activation.selectedTarget)}`],
      ['Runtime Box archive SHA-256', activation.release.archive.sha256],
    );
  }

  const previewHeaders = ['Gene', 'AA Change', 'Best Peptide', 'Allele', 'IC50 MT', 'Tier'];
  const output: ToolOutput = {
    sections: [
      {
        type: 'stats', cols: 4, items: [
          { label: 'All epitopes', value: parsed.summary.allEpitopeCount },
          { label: 'Filtered', value: parsed.summary.filteredCount },
          { label: 'Aggregated', value: parsed.summary.aggregateCount },
          { label: 'Candidate peptides', value: parsed.summary.candidateCount },
        ],
      },
      { type: 'text', label: 'Interpretation', content: ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE },
      ...(parsed.preview.length > 0 ? [{
        type: 'table' as const,
        label: 'Prioritized candidates',
        headers: previewHeaders,
        rows: parsed.preview.map((row) => previewHeaders.map((header) => row[header] ?? '')),
      }] : []),
      {
        type: 'table', label: 'Provenance', headers: ['Field', 'Value'], rows: provenanceRows,
      },
    ],
  };
  return {
    outputFiles: [
      await outputFile('All pVACseq epitopes', parsed.allPath, 'tsv', 'allEpitopes'),
      await outputFile('Filtered pVACseq epitopes', parsed.filteredPath, 'tsv', 'filteredEpitopes'),
      await outputFile('Aggregated neoantigen candidates', parsed.aggregatePath, 'tsv', 'aggregateReport', 'final', aggregateScientific),
      await outputFile('Aggregated metrics', parsed.metricsPath, 'json', 'aggregateMetrics'),
      await outputFile('Candidate peptides', parsed.candidatesPath, 'fasta', 'candidateFasta', 'final', candidatesScientific),
      await outputFile('pVACseq summary', parsed.summaryPath, 'json', 'summaryJson'),
    ],
    output,
    metrics: {
      allEpitopeCount: parsed.summary.allEpitopeCount,
      filteredCount: parsed.summary.filteredCount,
      aggregateCount: parsed.summary.aggregateCount,
      candidateCount: parsed.summary.candidateCount,
    },
    values: {
      aggregateCount: parsed.summary.aggregateCount,
      filteredCount: parsed.summary.filteredCount,
      provenance,
    },
    executionEvidence: provenance,
  };
}

export async function runNeoantigenPrioritizationWithRuntime(
  runtime: LiatirToolRuntimeRecord,
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  if (runtime.status !== 'installed' || !runtime.runtimePath) {
    throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  }
  if (!inputs.inputVcf) throw new Error('A VEP-annotated tumor VCF is required.');
  if (!inputs.tumorSample?.trim()) throw new Error('A tumor sample name is required.');
  const alleles = parseMhcClassIAlleles(inputs.alleles ?? '');
  const peptideLengths = parseMhcClassIPeptideLengths(inputs.peptideLengths || '8,9,10,11');
  const topCount = boundedInteger(inputs.topCount, 100, 1, 5000);
  const threads = boundedInteger(inputs.threads, 1, 1, 32);

  onLog(`tool-runtime ${runtime.id}`);
  onLog(`input ${basename(inputs.inputVcf)}`);
  onLog('predictors MHCflurry,MHCflurryEL');
  const result = await runToolRuntimePython(runtime, PVACSEQ_SCRIPT, {
    runtimePath: runtime.runtimePath,
    inputVcf: inputs.inputVcf,
    tumorSample: inputs.tumorSample.trim(),
    normalSample: inputs.normalSample?.trim() || '',
    proximalVcf: inputs.proximalVcf || '',
    alleles,
    peptideLengths,
    predictors: ['MHCflurry', 'MHCflurryEL'],
    passOnly: inputBoolean(inputs.passOnly),
    topCount,
    threads,
    outputDir,
  }, {
    timeoutSeconds: 28_800,
    jobLabel: runContext?.runKind === 'pipeline-step'
      ? `${runContext.pipelineName}: ${neoantigenPrioritizationDefinition.label}`
      : neoantigenPrioritizationDefinition.label,
    metadata: {
      toolId: neoantigenPrioritizationDefinition.id,
      ...(runContext
        ? runContext.runKind === 'tool-runtime-direct'
          ? toolRuntimeDirectRunMetadata(runContext)
          : aiRunMetadata(runContext)
        : {}),
    },
    signal: runContext?.signal,
    onJobId: runContext?.onJobId,
  });
  return finalizeNeoantigenPrioritizationResult(runtime, inputs, result, onLog);
}

export async function runNeoantigenPrioritizationStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  runContext?: AIRunContext | ToolRuntimeDirectRunContext,
) {
  await toolRuntimesStore.init();
  const runtime = toolRuntimesStore.runtimes.find((item) => item.id === PVACTOOLS_RUNTIME_COMPONENT_ID);
  if (!runtime) {
    throw new Error('The pVACseq Tool Runtime has not completed publication for this Liatir release.');
  }
  return runNeoantigenPrioritizationWithRuntime(runtime, inputs, outputDir, onLog, runContext);
}
