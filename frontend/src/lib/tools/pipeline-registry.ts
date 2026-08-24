import { liatir } from '$lib/api';
import { runNativeTool } from '$lib/utils/native-tool';
import { fastpDefinition, parseFastpJson, fastpToToolOutput } from './qc/fastp';
import { seqkitStatsDefinition, parseSeqkitStats, seqkitStatsToToolOutput } from './qc/seqkit';
import { samtoolsFlagstatDefinition, parseFlagstatResult, flagstatToToolOutput } from './alignment/samtools';
import { bwaMemDefinition, parseBwaMemStats, bwaMemToToolOutput } from './alignment/bwa';
import { minimap2Definition, parseMinimap2Stats, minimap2ToToolOutput } from './alignment/minimap2';
import { bcftoolsStatsDefinition, bcftoolsFilterDefinition, parseBcftoolsStats, bcftoolsStatsToToolOutput } from './variants/bcftools';
import { snpeffDefinition, parseSnpEffStats, buildSnpEffOutput } from './variants/snpeff';
import { singleCellEmbeddingDefinition, runSingleCellEmbeddingStep } from './ai/single-cell-embedding';
import {
  runSimpleafIndexStep,
  runSimpleafQuantStep,
  simpleafIndexDefinition,
  simpleafQuantDefinition,
} from './single-cell/simpleaf';
import {
  genomeViewerDefinition,
  runGenomeViewerStep,
  runSingleCellViewerStep,
  runStructureViewerStep,
  singleCellViewerDefinition,
  structureViewerDefinition,
} from './viewers/scientific-viewers';
import { snpEffStore } from '$lib/stores/snpeff.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { ToolOutput } from '$lib/types/tool-output';
import type { PipelineRegistryEntry, PipelineStepDefinition, RunOutputFile } from '$lib/types/pipeline';
import { liaPluginsStore } from '$lib/stores/lia-plugins.svelte';
import {
  LEGACY_LIA_PLUGIN_STEP_PREFIX,
  LIA_PLUGIN_STEP_PREFIX,
  pluginToRegistryEntry,
  pluginToDefinition,
} from './plugin-step';
import type { JsonValue } from '@liatir/core';
import { threadInputSchema, threadParam } from '$lib/utils/execution-resources';
import type { AIRunContext } from '$lib/ai/direct-run-context';
import { aiRunMetadata } from '$lib/ai/direct-run-context';
import type { NativeRunOptions } from '$lib/utils/native-tool';
import { externalWorkflowsStore } from '$lib/stores/externalWorkflows.svelte';
import {
  LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX,
  externalWorkflowToStepDefinition,
  type LiatirExternalWorkflowDefinition,
} from '@liatir/core';
import { runExternalWorkflowDefinition } from '$lib/external-workflows/nextflow';

type StepResult = {
  outputFiles: RunOutputFile[];
  output?: ToolOutput;
  metrics?: Record<string, number>;
  values?: Record<string, JsonValue>;
  executionEvidence?: Record<string, JsonValue>;
};

function basename(p: string) { return p.split(/[\\/]/).pop() ?? p; }

function nativePipelineJobOptions(context?: AIRunContext): NativeRunOptions {
  if (!context || context.runKind !== 'pipeline-step') return {};
  return {
    label: context.label,
    kind: 'pipeline-step',
    metadata: aiRunMetadata(context),
    signal: context.signal,
    onSpawn: context.onJobId,
  };
}

// ── definitions that don't live in a tool file ───────────────────────────────

const fastqcDefinition: PipelineStepDefinition = {
  id: 'fastqc',
  type: 'native-tool',
  label: 'FastQC',
  description: 'Quality-control report for FASTQ files (runs in-app via WASM).',
  category: 'Quality Control',
  inputSchema: {
    input: { type: 'file', label: 'FASTQ file', required: true, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
  },
  outputSchema: {
    stats: { type: 'stats', label: 'QC report' },
  },
};

const samtoolsFaidxDefinition: PipelineStepDefinition = {
  id: 'samtools-faidx',
  type: 'native-tool',
  label: 'Samtools faidx',
  description: 'Build a FASTA index (.fai) next to the input file.',
  category: 'Alignment',
  inputSchema: {
    inputFile: { type: 'file', label: 'FASTA file', required: true, accept: ['fasta', 'fa', 'fna', 'fasta.gz', 'fa.gz'] },
    threads: threadInputSchema('Additional worker threads for samtools faidx. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    faiIndex: { type: 'file', label: 'FASTA index', ext: ['fai'] },
  },
};

function textOutput(label: string, content: string): ToolOutput {
  return { sections: [{ type: 'text', label, content, mono: true }] };
}

// ── auto-connect helpers ─────────────────────────────────────────────────────

export function autoConnectInputs(
  prevOutputFiles: RunOutputFile[],
  nextDef: PipelineStepDefinition
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, schema] of Object.entries(nextDef.inputSchema)) {
    if (schema.type !== 'file' || !schema.accept) continue;
    const match = prevOutputFiles.find(f =>
      schema.accept!.some(a => f.ext === a || f.path.endsWith(`.${a}`))
    );
    if (match) result[key] = match.path;
  }
  return result;
}

// ── step run functions ───────────────────────────────────────────────────────

async function runFastqcStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  onLog(`$ fastqc ${basename(inputs.input)}`);
  const jobId = context?.runKind === 'pipeline-step' ? crypto.randomUUID() : null;
  if (jobId) context?.onJobId?.(jobId);
  const output = await api.qc.fastqc.run(
    { input: inputs.input },
    jobId && context ? {
      jobId,
      workspaceId: context.execution.workspaceId,
      jobLabel: context.label,
      jobKind: 'pipeline-step',
      metadata: aiRunMetadata(context),
    } : undefined,
  ) as ToolOutput;
  return { outputFiles: [], output };
}

async function runFastpStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const jsonPath  = `${outputDir}/fastp-${runId}.json`;
  const out1Path  = `${outputDir}/fastp-${runId}-R1.fastq.gz`;
  const out2Path  = `${outputDir}/fastp-${runId}-R2.fastq.gz`;
  const { threads } = threadParam(inputs.threads);

  const args = ['--in1', inputs.r1, '--out1', out1Path, '--json', jsonPath, '--html', '/dev/null', '--thread', String(threads)];
  if (inputs.r2) args.push('--in2', inputs.r2, '--out2', out2Path);

  onLog(`$ fastp --thread ${threads} --in1 ${basename(inputs.r1)}${inputs.r2 ? ' --in2 ' + basename(inputs.r2) : ''}`);
  const result = await runNativeTool(
    'fastp',
    args,
    undefined,
    (l) => { if (l.trim()) onLog(l); },
    nativePipelineJobOptions(context),
  );

  if (!result.ok) throw new Error(result.stderr || `fastp exited with code ${result.exitCode}`);

  const jsonText = await api.invoke('lia_read_file_text', { path: jsonPath }) as string;
  const summary = parseFastpJson(jsonText);
  const output = fastpToToolOutput(summary);

  const outputFiles: RunOutputFile[] = [{ label: 'Trimmed R1', path: out1Path, ext: 'fastq.gz' }];
  if (inputs.r2) outputFiles.push({ label: 'Trimmed R2', path: out2Path, ext: 'fastq.gz' });
  const passRate = summary.before.totalReads > 0 ? (summary.filtering.passed / summary.before.totalReads) * 100 : 0;
  return { outputFiles, output, metrics: { readsBefore: summary.before.totalReads, q30After: summary.after.q30Rate, passRate } };
}

async function runSeqkitStatsStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const { threads } = threadParam(inputs.threads);
  onLog(`$ seqkit stats -j ${threads} ${basename(inputs.inputFile)}`);
  const result = await runNativeTool(
    'seqkit',
    ['stats', '-j', String(threads), inputs.inputFile],
    undefined,
    (l) => { if (l.trim()) onLog(l); },
    nativePipelineJobOptions(context),
  );

  if (!result.ok && result.stdout.trim() === '') {
    throw new Error(result.stderr || `seqkit exited with code ${result.exitCode}`);
  }
  const parsed = parseSeqkitStats(result.stdout);
  return {
    outputFiles: [],
    output: parsed ? seqkitStatsToToolOutput(parsed, result.stdout) : undefined,
    metrics: parsed ? { numSeqs: parsed.numSeqs, gcPct: parsed.gcPct ?? 0, n50: parsed.n50 ?? 0 } : undefined,
  };
}

async function runSamtoolsFlagstatStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const { threads } = threadParam(inputs.threads);
  onLog(`$ samtools flagstat -@ ${threads} ${basename(inputs.inputFile)}`);
  const result = await runNativeTool(
    'samtools',
    ['flagstat', '-@', String(threads), inputs.inputFile],
    undefined,
    (l) => { if (l.trim()) onLog(l); },
    nativePipelineJobOptions(context),
  );

  if (!result.ok && result.stdout.trim() === '') {
    throw new Error(result.stderr || `samtools exited with code ${result.exitCode}`);
  }
  const parsed = parseFlagstatResult(result.stdout);
  return {
    outputFiles: [],
    output: flagstatToToolOutput(parsed, result.stdout),
    metrics: { total: parsed.total, mappedPct: parsed.mappedPct ?? 0, duplicatesPct: parsed.duplicatesPct ?? 0 },
  };
}

async function runSamtoolsFaidxStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  const { threads } = threadParam(inputs.threads);
  onLog(`$ samtools faidx -@ ${threads} ${basename(inputs.inputFile)}`);
  const result = await runNativeTool(
    'samtools',
    ['faidx', '-@', String(threads), inputs.inputFile],
    undefined,
    (l) => { if (l.trim()) onLog(l); },
    nativePipelineJobOptions(context),
  );

  if (!result.ok) throw new Error(result.stderr || `samtools faidx exited with code ${result.exitCode}`);

  const faiPath = `${inputs.inputFile}.fai`;
  let size: number | undefined;
  try { size = await api.invoke('lia_file_size', { path: faiPath }) as number; } catch { /* ok */ }
  return {
    outputFiles: [{ label: 'FASTA index', path: faiPath, ext: 'fai', size }],
    output: textOutput('samtools faidx', `Indexed ${basename(inputs.inputFile)}\n→ ${basename(faiPath)}`),
  };
}

async function runBwaMemStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const outPath = `${outputDir}/bwa-${runId}.sam`;
  const { threads } = threadParam(inputs.threads);

  let indexed = true;
  try {
    await api.invoke('lia_file_size', { path: `${inputs.reference}.amb` });
  } catch {
    indexed = false;
  }
  if (!indexed) {
    onLog(`$ bwa index ${basename(inputs.reference)}`);
    const indexResult = await runNativeTool(
      'bwa',
      ['index', inputs.reference],
      undefined,
      (line) => { if (line.trim()) onLog(line); },
      nativePipelineJobOptions(context),
    );
    if (!indexResult.ok) {
      throw new Error(indexResult.stderr || `bwa index exited with code ${indexResult.exitCode}`);
    }
  }

  const args = ['mem', '-t', String(threads), inputs.reference, inputs.readsR1];
  if (inputs.readsR2) args.push(inputs.readsR2);
  onLog(`$ bwa mem -t ${threads} ${basename(inputs.reference)} ${basename(inputs.readsR1)}`);
  const result = await runNativeTool(
    'bwa',
    args,
    undefined,
    (line) => { if (line.trim()) onLog(line); },
    { ...nativePipelineJobOptions(context), stdoutPath: outPath },
  );
  if (!result.ok) throw new Error(result.stderr || `bwa failed with code ${result.exitCode}`);

  const size = await api.invoke('lia_file_size', { path: outPath }) as number;
  const stderr = result.stderr.split(/\r?\n/).filter(Boolean);
  const stats = parseBwaMemStats(stderr);
  const output = bwaMemToToolOutput(stats, result.stderr, outPath);
  return { outputFiles: [{ label: 'Output SAM', path: outPath, ext: 'sam', size }], output };
}

async function runMinimap2Step(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const outPath = `${outputDir}/minimap2-${runId}.sam`;
  const preset = inputs.preset || 'sr';
  const { threads } = threadParam(inputs.threads);

  onLog(`$ minimap2 -t ${threads} -ax ${preset} ${basename(inputs.reference)} ${basename(inputs.reads)}`);
  const result = await runNativeTool(
    'minimap2',
    ['-t', String(threads), '-ax', preset, inputs.reference, inputs.reads],
    undefined,
    (line) => { if (line.trim()) onLog(line); },
    { ...nativePipelineJobOptions(context), stdoutPath: outPath },
  );
  if (!result.ok) throw new Error(result.stderr || `minimap2 failed with code ${result.exitCode}`);

  const size = await api.invoke('lia_file_size', { path: outPath }) as number;
  const stderr = result.stderr.split(/\r?\n/).filter(Boolean);
  const stats = parseMinimap2Stats(stderr);
  const output = minimap2ToToolOutput(stats, result.stderr, outPath, preset);
  return { outputFiles: [{ label: 'Output SAM', path: outPath, ext: 'sam', size }], output };
}

async function runBcftoolsStatsStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const { threads } = threadParam(inputs.threads);
  onLog(`$ bcftools stats --threads ${threads} ${basename(inputs.inputFile)}`);
  const result = await runNativeTool(
    'bcftools',
    ['stats', '--threads', String(threads), inputs.inputFile],
    undefined,
    (l) => { if (l.trim()) onLog(l); },
    nativePipelineJobOptions(context),
  );

  if (!result.ok && result.stdout.trim() === '') {
    throw new Error(result.stderr || `bcftools exited with code ${result.exitCode}`);
  }
  const parsed = parseBcftoolsStats(result.stdout);
  return {
    outputFiles: [],
    output: bcftoolsStatsToToolOutput(parsed, result.stdout),
    metrics: { records: parsed.records, snps: parsed.snps, indels: parsed.indels, tstv: parsed.tstv ?? 0 },
  };
}

async function runBcftoolsFilterStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const outPath = `${outputDir}/bcftools-filter-${runId}.vcf.gz`;
  const expr = inputs.expression?.trim() || 'QUAL>20';
  const { threads } = threadParam(inputs.threads);

  onLog(`$ bcftools filter --threads ${threads} -i '${expr}' -O z -o ${basename(outPath)} ${basename(inputs.inputFile)}`);
  const result = await runNativeTool(
    'bcftools',
    ['filter', '--threads', String(threads), '-i', expr, '-O', 'z', '-o', outPath, inputs.inputFile],
    undefined,
    (l) => { if (l.trim()) onLog(l); },
    nativePipelineJobOptions(context),
  );

  if (!result.ok) throw new Error(result.stderr || `bcftools filter exited with code ${result.exitCode}`);

  let size: number | undefined;
  try { size = await api.invoke('lia_file_size', { path: outPath }) as number; } catch { /* ok */ }
  return {
    outputFiles: [{ label: 'Filtered VCF', path: outPath, ext: 'vcf.gz', size }],
    output: textOutput('bcftools filter', `Expression: ${expr}\nOutput: ${basename(outPath)}`),
  };
}

async function runSnpeffStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void,
  context?: AIRunContext,
): Promise<StepResult> {
  const api = liatir()!;
  await snpEffStore.init();
  await settingsStore.init();

  const jarPath = snpEffStore.config.jarPath;
  if (!jarPath) {
    throw new Error('SnpEff is not configured — open the SnpEff tool and set the JAR path first.');
  }
  const genome = inputs.genome?.trim() || 'hg38';
  const runId = crypto.randomUUID();
  const outPath = `${outputDir}/snpeff-${runId}.vcf`;
  const statsBase = outPath.replace(/\.vcf$/, '');
  const statsHtml = `${statsBase}-summary.html`;
  const statsGenes = `${statsBase}-summary.genes.txt`;

  onLog(`$ java -Xmx${snpEffStore.jvmHeap} -jar snpEff.jar ann ${genome} ${basename(inputs.inputFile)}`);

  const java = settingsStore.javaPath || 'java';
  const result = await runNativeTool(
    java,
    [
      `-Xmx${snpEffStore.jvmHeap}`,
      '-jar',
      jarPath,
      'ann',
      '-dataDir',
      snpEffStore.config.dataDir,
      '-noLog',
      '-stats',
      statsHtml,
      genome,
      inputs.inputFile,
    ],
    undefined,
    (line) => { if (line.trim()) onLog(line); },
    { ...nativePipelineJobOptions(context), stdoutPath: outPath },
  );
  if (!result.ok) {
    throw new Error(result.stderr || `SnpEff exited with code ${result.exitCode}`);
  }

  const outputFiles: RunOutputFile[] = [];
  let size: number | undefined;
  try { size = await api.invoke('lia_file_size', { path: outPath }) as number; } catch { /* ok */ }
  outputFiles.push({ label: 'Annotated VCF', path: outPath, ext: 'vcf', size });

  for (const [label, path, ext] of [
    ['Summary (HTML)', statsHtml, 'html'],
    ['Gene stats', statsGenes, 'txt'],
  ] as const) {
    try {
      const fileSize = await api.invoke('lia_file_size', { path }) as number;
      outputFiles.push({ label, path, ext, size: fileSize });
    } catch { /* not generated */ }
  }

  const summary = parseSnpEffStats(result.stderr);
  const output = buildSnpEffOutput(summary, basename(inputs.inputFile));
  await snpEffStore.touchGenome(genome);
  return {
    outputFiles,
    output,
    metrics: { totalVariants: summary.totalVariants, highImpact: summary.highImpact, moderateImpact: summary.moderateImpact, lowImpact: summary.lowImpact },
  };
}

// ── registry ─────────────────────────────────────────────────────────────────

export const PIPELINE_REGISTRY: Record<string, PipelineRegistryEntry> = {
  'fastqc':             { definition: fastqcDefinition,            run: runFastqcStep },
  'fastp':              { definition: fastpDefinition,             run: runFastpStep },
  'seqkit-stats':       { definition: seqkitStatsDefinition,       run: runSeqkitStatsStep },
  'samtools-flagstat':  { definition: samtoolsFlagstatDefinition,  run: runSamtoolsFlagstatStep },
  'samtools-faidx':     { definition: samtoolsFaidxDefinition,     run: runSamtoolsFaidxStep },
  'bwa-mem':            { definition: bwaMemDefinition,            run: runBwaMemStep },
  'minimap2':           { definition: minimap2Definition,          run: runMinimap2Step },
  'bcftools-stats':     { definition: bcftoolsStatsDefinition,     run: runBcftoolsStatsStep },
  'bcftools-filter':    { definition: bcftoolsFilterDefinition,    run: runBcftoolsFilterStep },
  'snpeff':             { definition: snpeffDefinition,            run: runSnpeffStep },
  'simpleaf-index':     { definition: simpleafIndexDefinition,     run: runSimpleafIndexStep },
  'simpleaf-quant':     { definition: simpleafQuantDefinition,     run: runSimpleafQuantStep },
  'ai-single-cell-embedding': { definition: singleCellEmbeddingDefinition, run: runSingleCellEmbeddingStep },
  'viewer-structure-3d': { definition: structureViewerDefinition, run: runStructureViewerStep },
  'viewer-genome-track': { definition: genomeViewerDefinition, run: runGenomeViewerStep },
  'viewer-single-cell': { definition: singleCellViewerDefinition, run: runSingleCellViewerStep },
};

// ── Imported .lia plugins as pipeline steps ──────────────────────────────────
// .lia plugins are first-class pipeline steps alongside native tools.
// They are not in the static registry above — they are resolved on demand from
// the plugin import store so importing/removing one is reflected without a rebuild.

/** Resolve a step entry by id: a native tool OR an imported .lia plugin. */
export function resolveStepEntry(stepId: string): PipelineRegistryEntry | undefined {
  if (stepId.startsWith(LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX)) {
    const definition = externalWorkflowsStore.byId(
      stepId.slice(LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX.length),
    );
    return definition ? externalWorkflowRegistryEntry(definition) : undefined;
  }
  if (stepId.startsWith(LIA_PLUGIN_STEP_PREFIX)) {
    const plugin = liaPluginsStore.byId(stepId.slice(LIA_PLUGIN_STEP_PREFIX.length));
    return plugin ? pluginToRegistryEntry(plugin) : undefined;
  }
  if (stepId.startsWith(LEGACY_LIA_PLUGIN_STEP_PREFIX)) {
    const plugin = liaPluginsStore.byId(stepId.slice(LEGACY_LIA_PLUGIN_STEP_PREFIX.length));
    return plugin ? pluginToRegistryEntry(plugin) : undefined;
  }
  return PIPELINE_REGISTRY[stepId];
}

function externalWorkflowRegistryEntry(
  saved: LiatirExternalWorkflowDefinition,
): PipelineRegistryEntry {
  return {
    definition: externalWorkflowToStepDefinition(saved),
    async run(inputs, _outputDir, onLog, context) {
      if (!context) throw new Error('External Workflow pipeline context is missing.');
      return runExternalWorkflowDefinition(saved, inputs, onLog, {
        execution: context.execution,
        label: context.label,
        startedAt: context.startedAt,
        signal: context.signal,
        onJobId: context.onJobId,
        metadata: context.runKind === 'pipeline-step' ? {
          runKind: 'external-workflow',
          pipelineRunId: context.pipelineRunId,
          pipelineId: context.pipelineId,
          pipelineName: context.pipelineName,
          nodeId: context.nodeId,
        } : undefined,
      });
    },
  };
}

/** Step definitions for every imported .lia plugin — for the pipeline tool palette. */
export function pluginStepDefinitions(): PipelineStepDefinition[] {
  return liaPluginsStore.plugins.map(pluginToDefinition);
}

/** Definitions of all available steps (native tools + imported .lia plugins). */
export function allStepDefinitions(): PipelineStepDefinition[] {
  return [
    ...Object.values(PIPELINE_REGISTRY).map((e) => e.definition),
    ...pluginStepDefinitions(),
    ...externalWorkflowsStore.definitions.map(externalWorkflowToStepDefinition),
  ];
}
