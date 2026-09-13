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
import {
  readRunLog,
  readRunResult,
  removeRunDir,
  writeRunResult,
} from '$lib/execution/run-storage';

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

/**
 * No cap, and nothing is removed on Liatir's own initiative.
 *
 * The history used to keep the most recent 200 and drop the rest. That was safe while a run record
 * was only bookkeeping; it is not safe now that a run owns a directory containing files the user
 * made and may still be using. A list growing long is not a reason to destroy someone's work, so
 * pruning is an action the user takes deliberately — see `removeMany`.
 */
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
  'snpsift-filter',
]);
const AI_ANALYSIS_TOOLS = new Set([
  'ai-single-cell-embedding',
  'ai-mhc-class-i-epitope-prediction',
  'biomolecular-structure-prediction',
  'protein-ligand-affinity',
]);
const TOOL_RUNTIME_ANALYSIS_TOOLS = new Set([
  'neoantigen-prioritization',
  'molecular-relaxation',
  'molecular-dynamics',
]);

function producerKindFor(tool: string): LiatirArtifactProducerKind {
  if (tool === 'pipeline') return 'pipeline';
  if (NATIVE_ANALYSIS_TOOLS.has(tool)) return 'native-tool';
  if (AI_ANALYSIS_TOOLS.has(tool)) return 'ai-tool';
  if (TOOL_RUNTIME_ANALYSIS_TOOLS.has(tool)) return 'tool-runtime';
  return 'unknown';
}

function artifactProducerKind(run: AnalysisRun): LiatirArtifactProducerKind {
  const kind = run.execution?.runKind;
  if (
    kind === 'native-tool' || kind === 'tool-runtime' || kind === 'ai-model' || kind === 'ai-tool' ||
    kind === 'lia-plugin' || kind === 'api-request' || kind === 'dependency' ||
    kind === 'external-workflow' || kind === 'pipeline'
  ) return kind;
  return producerKindFor(run.tool);
}

function parentRunKindFor(tool: string): LiatirArtifactParentRunKind {
  if (tool === 'pipeline') return 'pipeline';
  if (AI_ANALYSIS_TOOLS.has(tool)) return 'ai-model-direct';
  if (TOOL_RUNTIME_ANALYSIS_TOOLS.has(tool)) return 'tool-runtime';
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

/**
 * The index is a lookup over the run directories, not the record itself.
 *
 * Every run's durable truth is `runs/<runId>/` — its metadata, its transcript, its files. This file
 * exists so the history list can be shown without stat-ing thousands of directories at startup.
 */
function getIndex() { return `${getDataPrefix()}analysis-runs/index.json`; }

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

      // The parsed output goes in the run's own directory, beside its metadata, transcript and
      // files. The transcript is not written here: `finalizeExecutionResult` already wrote the rich
      // entries, streams and all, and re-flattening them from this store's `string[]` would replace
      // the better copy with the poorer one.
      await writeRunResult(normalizedRun.id, normalizedRun.output);

      // Cache it immediately so the first view is instant
      outputCache.set(normalizedRun.id, normalizedRun.output);

      // Update index (meta only, no output/log)
      const { output: _output, log: _log, ...meta } = normalizedRun;
      runs = [meta, ...runs.filter(r => r.id !== normalizedRun.id)];
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
      await removeRunDir(id);
      outputCache.delete(id);
      runs = runs.filter(r => r.id !== id);
      await persistIndex();
    },

    /**
     * Delete several runs at once, for the explicit prune action.
     *
     * One index write rather than one per run: pruning hundreds of runs individually would rewrite
     * the whole index hundreds of times.
     */
    async removeMany(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      for (const id of ids) {
        await removeRunDir(id);
        outputCache.delete(id);
      }
      runs = runs.filter((run) => !doomed.has(run.id));
      await persistIndex();
    },

    async loadOutput(id: string): Promise<ToolOutput | null> {
      if (outputCache.has(id)) return outputCache.get(id)!;
      const output = await readRunResult<ToolOutput | null>(id);
      if (output === null) return null;
      outputCache.set(id, output);
      return output;
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

    /**
     * The run's transcript, rendered for the log viewer.
     *
     * `stderr` is marked rather than dropped: reading a failure back, which lines came from the
     * error stream is usually the whole question, and the stored entries still carry it.
     */
    async loadLog(id: string): Promise<string[] | null> {
      const entries = await readRunLog(id);
      if (!entries) return null;
      return entries.map((entry) =>
        entry.stream === 'stderr' ? `[stderr] ${entry.message}` : entry.message
      );
    },
  };
}

export const analysisRuns = createAnalysisRunsStore();
