import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import { withArtifactsMetadata } from '$lib/utils/artifacts';
import type { ToolOutput } from '$lib/types/tool-output';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { LiatirArtifactParentRunKind, LiatirArtifactProducerKind } from '@liatir/core';

export type { RunOutputFile };

export interface AnalysisRunMeta {
  id: string;
  tool: string;
  label: string;
  inputs: string[];
  inputSizes?: number[];
  outputSize?: number;
  outputFiles?: RunOutputFile[];
  params: Record<string, unknown>;
  status: 'done' | 'error';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  error: string | null;
}

export interface AnalysisRun extends AnalysisRunMeta {
  output: ToolOutput | null;
  log?: string[];
}

const MAX_RUNS = 200;
const LOG_TTL_MS = 7 * 24 * 3600 * 1000;
const NATIVE_ANALYSIS_TOOLS = new Set([
  'fastp',
  'fastqc',
  'seqkit',
  'seqkit-stats',
  'samtools',
  'samtools-flagstat',
  'samtools-faidx',
  'bwa',
  'bwa-mem',
  'minimap2',
  'bcftools',
  'bcftools-stats',
  'bcftools-filter',
  'snpeff',
]);
const AI_ANALYSIS_TOOLS = new Set([
  'ai-celltypist-annotate',
  'ai-sequence-embedding',
  'ai-single-cell-embedding',
  'ai-genomic-variant-effect',
  'ai-regulatory-prediction',
  'ai-protein-structure',
  'ai-mock-inference',
]);

function producerKindFor(tool: string): LiatirArtifactProducerKind {
  if (tool === 'pipeline') return 'pipeline';
  if (NATIVE_ANALYSIS_TOOLS.has(tool)) return 'native-tool';
  if (AI_ANALYSIS_TOOLS.has(tool)) return 'ai-tool';
  return 'unknown';
}

function parentRunKindFor(tool: string): LiatirArtifactParentRunKind {
  if (tool === 'pipeline') return 'pipeline';
  if (AI_ANALYSIS_TOOLS.has(tool)) return 'ai-model-direct';
  return 'tool';
}

function getDir() { return `${getDataPrefix()}analysis-runs`; }
function getIndex() { return `${getDir()}/index.json`; }
function runPath(id: string) { return `${getDir()}/${id}.json`; }
function logPath(id: string) { return `${getDir()}/${id}.log.json`; }

function createAnalysisRunsStore() {
  let runs = $state<AnalysisRunMeta[]>([]);
  let initialized = false;
  const outputCache = new Map<string, ToolOutput | null>();

  async function persistIndex() {
    await appStorage.writeText(getIndex(), JSON.stringify(runs), { createDirs: true });
  }

  return {
    get runs() { return runs; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        const exists = await appStorage.exists(getIndex());
        if (exists) {
          const raw = await appStorage.readText(getIndex());
          const parsed = JSON.parse(raw) as AnalysisRunMeta[];
          const seen = new Set<string>();
          runs = parsed.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        }
      } catch { runs = []; }
      // Clean up log files older than TTL
      const cutoff = Date.now() - LOG_TTL_MS;
      for (const run of runs) {
        if (run.endedAt < cutoff) {
          appStorage.remove(logPath(run.id)).catch(() => {});
        }
      }
    },

    async add(run: AnalysisRun) {
      const api = liatir();
      if (!api) return;

      const outputFiles = withArtifactsMetadata(run.outputFiles, {
        role: 'final',
        createdAt: run.endedAt,
        producer: {
          kind: producerKindFor(run.tool),
          id: run.tool,
          label: run.label,
        },
        parentRun: {
          runKind: parentRunKindFor(run.tool),
          runId: run.id,
          analysisRunId: run.id,
        },
      });
      const normalizedRun: AnalysisRun = { ...run, outputFiles };

      const serialized = JSON.stringify(normalizedRun.output);

      // Write output to its own file
      await appStorage.writeText(runPath(normalizedRun.id), serialized, { createDirs: true });

      // Persist log if present
      if (normalizedRun.log && normalizedRun.log.length > 0) {
        await appStorage.writeText(logPath(normalizedRun.id), JSON.stringify(normalizedRun.log), { createDirs: true });
      }

      // Cache it immediately so the first view is instant
      outputCache.set(normalizedRun.id, normalizedRun.output);

      // Get output file size
      let outputSize: number | undefined;
      try {
        const appPath = await appStorage.path();
        outputSize = (await api.invoke('lia_file_size', {
          path: `${appPath}/${runPath(normalizedRun.id)}`,
        })) as number;
      } catch { /* size stays undefined */ }

      // Update index (meta only, no output/log)
      const { output: _output, log: _log, ...meta } = normalizedRun;
      runs = [{ ...meta, outputSize }, ...runs.filter(r => r.id !== normalizedRun.id)].slice(0, MAX_RUNS);
      await persistIndex();
    },

    async remove(id: string) {
      try {
        await appStorage.remove(runPath(id));
      } catch { /* file may not exist */ }

      outputCache.delete(id);
      runs = runs.filter(r => r.id !== id);
      await persistIndex();
    },

    async loadOutput(id: string): Promise<ToolOutput | null> {
      if (outputCache.has(id)) return outputCache.get(id)!;
      if (!liatir()) return null;

      try {
        const exists = await appStorage.exists(runPath(id));
        if (!exists) return null;
        const raw = await appStorage.readText(runPath(id));
        const output = JSON.parse(raw) as ToolOutput | null;
        outputCache.set(id, output);
        return output;
      } catch { return null; }
    },

    reset() {
      initialized = false;
      runs = [];
      outputCache.clear();
    },

    byTool(tool: string): AnalysisRunMeta[] {
      return runs.filter(r => r.tool === tool);
    },

    async loadLog(id: string): Promise<string[] | null> {
      if (!liatir()) return null;
      try {
        const exists = await appStorage.exists(logPath(id));
        if (!exists) return null;
        const raw = await appStorage.readText(logPath(id));
        return JSON.parse(raw) as string[];
      } catch { return null; }
    },
  };
}

export const analysisRuns = createAnalysisRunsStore();
