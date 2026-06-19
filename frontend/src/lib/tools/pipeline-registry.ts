import { liatir } from '$lib/api';
import { runNativeTool } from '$lib/utils/native-tool';
import { fastpDefinition, parseFastpJson, fastpToToolOutput } from './qc/fastp';
import { samtoolsFlagstatDefinition, parseFlagstatResult, flagstatToToolOutput } from './alignment/samtools';
import { bwaMemDefinition, parseBwaMemStats, bwaMemToToolOutput } from './alignment/bwa';
import { minimap2Definition, parseMinimap2Stats, minimap2ToToolOutput } from './alignment/minimap2';
import type { PipelineRegistryEntry, PipelineStepDefinition, RunOutputFile } from '$lib/types/pipeline';

function basename(p: string) { return p.split(/[\\/]/).pop() ?? p; }

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

async function runFastpStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void
): Promise<{ outputFiles: RunOutputFile[] }> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const jsonPath  = `${outputDir}/fastp-${runId}.json`;
  const out1Path  = `${outputDir}/fastp-${runId}-R1.fastq.gz`;
  const out2Path  = `${outputDir}/fastp-${runId}-R2.fastq.gz`;

  const args = ['--in1', inputs.r1, '--out1', out1Path, '--json', jsonPath, '--html', '/dev/null'];
  if (inputs.r2) args.push('--in2', inputs.r2, '--out2', out2Path);

  onLog(`$ fastp --in1 ${basename(inputs.r1)}${inputs.r2 ? ' --in2 ' + basename(inputs.r2) : ''}`);
  const result = await runNativeTool('fastp', args, undefined, (l) => { if (l.trim()) onLog(l); });

  if (!result.ok) throw new Error(result.stderr || `fastp exited with code ${result.exitCode}`);

  const jsonText = await api.invoke('lia_read_file_text', { path: jsonPath }) as string;
  const parsed = parseFastpJson(jsonText);
  fastpToToolOutput(parsed); // validate parse succeeds

  const outputFiles: RunOutputFile[] = [{ label: 'Trimmed R1', path: out1Path, ext: 'fastq.gz' }];
  if (inputs.r2) outputFiles.push({ label: 'Trimmed R2', path: out2Path, ext: 'fastq.gz' });
  return { outputFiles };
}

async function runSamtoolsFlagstatStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (l: string) => void
): Promise<{ outputFiles: RunOutputFile[] }> {
  onLog(`$ samtools flagstat ${basename(inputs.inputFile)}`);
  const result = await runNativeTool('samtools', ['flagstat', inputs.inputFile], undefined, (l) => { if (l.trim()) onLog(l); });

  if (!result.ok && result.stdout.trim() === '') {
    throw new Error(result.stderr || `samtools exited with code ${result.exitCode}`);
  }
  const parsed = parseFlagstatResult(result.stdout);
  flagstatToToolOutput(parsed, result.stdout); // validate
  return { outputFiles: [] };
}

async function runBwaMemStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void
): Promise<{ outputFiles: RunOutputFile[] }> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const outPath = `${outputDir}/bwa-${runId}.sam`;
  const jid = `bwa-${runId}`;

  onLog(`$ bwa mem ${basename(inputs.reference)} ${basename(inputs.readsR1)}`);

  const offStderr = await api.desktop.events.on(`jobs:stderr:${jid}`, (line: string) => {
    if (typeof line === 'string' && line.trim()) onLog(line);
  }) as unknown as () => void;

  try {
    const result = await api.invoke('lia_bwa_mem', {
      reference: inputs.reference,
      readsR1: inputs.readsR1,
      readsR2: inputs.readsR2 || null,
      outputSam: outPath,
      jobId: jid,
    } as any) as { ok: boolean; exitCode: number | null; stderr: string[] };

    if (!result.ok) throw new Error(result.stderr.slice(-5).join('\n') || `bwa failed`);

    const size = await api.invoke('lia_file_size', { path: outPath }) as number;
    const stats = parseBwaMemStats(result.stderr);
    bwaMemToToolOutput(stats, result.stderr.join('\n'), outPath);
    return { outputFiles: [{ label: 'Output SAM', path: outPath, ext: 'sam', size }] };
  } finally {
    offStderr();
  }
}

async function runMinimap2Step(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (l: string) => void
): Promise<{ outputFiles: RunOutputFile[] }> {
  const api = liatir()!;
  const runId = crypto.randomUUID();
  const outPath = `${outputDir}/minimap2-${runId}.sam`;
  const jid = `minimap2-${runId}`;
  const preset = inputs.preset || 'sr';

  onLog(`$ minimap2 -ax ${preset} ${basename(inputs.reference)} ${basename(inputs.reads)}`);

  const offStderr = await api.desktop.events.on(`jobs:stderr:${jid}`, (line: string) => {
    if (typeof line === 'string' && line.trim()) onLog(line);
  }) as unknown as () => void;

  try {
    const result = await api.invoke('lia_minimap2', {
      preset,
      reference: inputs.reference,
      readsR1: inputs.reads,
      readsR2: null,
      outputSam: outPath,
      jobId: jid,
    } as any) as { ok: boolean; exitCode: number | null; stderr: string[] };

    if (!result.ok) throw new Error(result.stderr.slice(-5).join('\n') || `minimap2 failed`);

    const size = await api.invoke('lia_file_size', { path: outPath }) as number;
    const stats = parseMinimap2Stats(result.stderr);
    minimap2ToToolOutput(stats, result.stderr.join('\n'), outPath, preset);
    return { outputFiles: [{ label: 'Output SAM', path: outPath, ext: 'sam', size }] };
  } finally {
    offStderr();
  }
}

// ── registry ─────────────────────────────────────────────────────────────────

export const PIPELINE_REGISTRY: Record<string, PipelineRegistryEntry> = {
  'fastp':              { definition: fastpDefinition,             run: runFastpStep },
  'samtools-flagstat':  { definition: samtoolsFlagstatDefinition,  run: runSamtoolsFlagstatStep },
  'bwa-mem':            { definition: bwaMemDefinition,            run: runBwaMemStep },
  'minimap2':           { definition: minimap2Definition,          run: runMinimap2Step },
};
