import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import { withArtifactsMetadata } from '$lib/utils/artifacts';
import { createAsyncStoreInitializer } from './async-store-initializer';
import type { ToolOutput } from '$lib/types/tool-output';
import type { RunOutputFile } from '$lib/types/pipeline';
import type {
  LiatirArtifactParentRunKind,
  LiatirArtifactProducerKind,
  LiatirExecutionIdentity,
  LiatirRunStatus,
} from '@liatir/core';
import { executionRuns } from './executionRuns.svelte';

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
  status: LiatirRunStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  error: string | null;
  /** Stable identity shared with Jobs and the durable execution spine. */
  execution?: LiatirExecutionIdentity;
  jobIds?: string[];
}

export interface AnalysisRun extends AnalysisRunMeta {
  output: ToolOutput | null;
  log?: string[];
}

const MAX_RUNS = 200;
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
  'ai-single-cell-embedding',
]);

function producerKindFor(tool: string): LiatirArtifactProducerKind {
  if (tool === 'pipeline') return 'pipeline';
  if (NATIVE_ANALYSIS_TOOLS.has(tool)) return 'native-tool';
  if (AI_ANALYSIS_TOOLS.has(tool)) return 'ai-tool';
  return 'unknown';
}

function artifactProducerKind(run: AnalysisRun): LiatirArtifactProducerKind {
  const kind = run.execution?.runKind;
  if (
    kind === 'native-tool' || kind === 'ai-model' || kind === 'ai-tool' ||
    kind === 'lia-plugin' || kind === 'api-request' || kind === 'dependency' ||
    kind === 'external-workflow' || kind === 'pipeline'
  ) return kind;
  return producerKindFor(run.tool);
}

function parentRunKindFor(tool: string): LiatirArtifactParentRunKind {
  if (tool === 'pipeline') return 'pipeline';
  if (AI_ANALYSIS_TOOLS.has(tool)) return 'ai-model-direct';
  return 'tool';
}

function artifactParentRun(run: AnalysisRun): {
  runKind: LiatirArtifactParentRunKind;
  runId: string;
  analysisRunId: string;
  pipelineId?: string | null;
  pipelineRunId?: string;
  externalWorkflowRunId?: string;
  parentRunId?: string;
  nodeId?: string;
} {
  const identity = run.execution;
  if (!identity) {
    return {
      runKind: parentRunKindFor(run.tool),
      runId: run.id,
      analysisRunId: run.id,
    };
  }
  return {
    runKind: identity.runKind === 'ai-model' ? 'ai-model' : identity.runKind,
    runId: identity.runId,
    analysisRunId: run.id,
    ...(identity.pipelineId !== undefined ? { pipelineId: identity.pipelineId } : {}),
    ...(identity.pipelineRunId ? { pipelineRunId: identity.pipelineRunId } : {}),
    ...(identity.externalWorkflowRunId
      ? { externalWorkflowRunId: identity.externalWorkflowRunId }
      : {}),
    ...(identity.parentRunId ? { parentRunId: identity.parentRunId } : {}),
    ...(identity.nodeId ? { nodeId: identity.nodeId } : {}),
  };
}

function getDir() { return `${getDataPrefix()}analysis-runs`; }
function getIndex() { return `${getDir()}/index.json`; }
function runPath(id: string) { return `${getDir()}/${id}.json`; }
function logPath(id: string) { return `${getDir()}/${id}.log.json`; }

/** Removes a run's two on-disk files. Missing files are the normal case, not a failure. */
async function discardRunFiles(id: string): Promise<void> {
  await appStorage.remove(runPath(id)).catch(() => {});
  await appStorage.remove(logPath(id)).catch(() => {});
}

function createAnalysisRunsStore() {
  let runs = $state<AnalysisRunMeta[]>([]);
  const initializer = createAsyncStoreInitializer();
  const outputCache = new Map<string, ToolOutput | null>();
  const addLocks = new Map<string, Promise<boolean>>();

  async function persistIndex() {
    await appStorage.writeText(getIndex(), JSON.stringify(runs), { createDirs: true });
  }

  return {
    get runs() { return runs; },

    async init() {
      await initializer.run(async (isCurrent) => {
        const api = liatir();
        if (!api) return;
        try {
          const exists = await appStorage.exists(getIndex());
          if (exists) {
            const raw = await appStorage.readText(getIndex());
            const parsed = JSON.parse(raw) as AnalysisRunMeta[];
            if (!isCurrent()) return;
            const seen = new Set<string>();
            runs = parsed.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
          }
        } catch {
          if (isCurrent()) runs = [];
        }

        // A run's transcript lives exactly as long as the run does. Logs used to be deleted after
        // seven days, which left older Results openable but mute — and the runs worth going back to
        // are precisely the old ones, whose numbers someone is now trying to explain. `MAX_RUNS`
        // already bounds how many can accumulate, so the age cutoff bought little and cost the
        // evidence.
      });
    },

    async add(run: AnalysisRun): Promise<boolean> {
      const pending = addLocks.get(run.id);
      if (pending) {
        await pending;
        return false;
      }

      const operation = (async () => {
      await this.init();
      const api = liatir();
      if (!api) return false;
      // First writer wins. This check is made after init and under the per-ID
      // in-flight lock, so page and background observers cannot both commit.
      if (runs.some((item) => item.id === run.id)) return false;

      const outputFiles = withArtifactsMetadata(run.outputFiles, {
        role: 'final',
        createdAt: run.endedAt,
        producer: {
          kind: artifactProducerKind(run),
          id: run.tool,
          label: run.label,
        },
        parentRun: artifactParentRun(run),
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
      const retained = [{ ...meta, outputSize }, ...runs.filter(r => r.id !== normalizedRun.id)];
      // Runs pushed past the cap lose their index entry, so their output and transcript files
      // become unreachable. Deleting them here is what keeps the transcripts unbounded in age
      // without being unbounded on disk.
      for (const evicted of retained.slice(MAX_RUNS)) {
        void discardRunFiles(evicted.id);
      }
      runs = retained.slice(0, MAX_RUNS);
      await persistIndex();
      const execution = executionRuns.byId(run.execution?.runId ?? run.id);
      if (execution) {
        await executionRuns.markResultFinalized(
          execution.identity.runId,
          normalizedRun.id,
          normalizedRun.endedAt,
        ).catch(() => {});
      }
      return true;
      })();

      addLocks.set(run.id, operation);
      try {
        return await operation;
      } finally {
        addLocks.delete(run.id);
      }
    },

    async remove(id: string) {
      await discardRunFiles(id);
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
      initializer.reset();
      runs = [];
      outputCache.clear();
      addLocks.clear();
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
