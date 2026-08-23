import type {
  JsonValue,
  LiatirExecutionIdentity,
  LiatirExecutionLogEntry,
  LiatirExecutionTerminalStatus,
  LiatirRunMetadata,
  LiatirRunStatus,
  RunOutputFile,
} from '@liatir/core';
import {
  LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX,
  LIATIR_RUN_RECORD_SCHEMA_VERSION,
} from '@liatir/core';
import {
  analysisRuns,
  type AnalysisRun,
  type AnalysisRunMeta,
} from '$lib/stores/analysisRuns.svelte';
import {
  executionRuns,
  EXECUTION_INTERRUPTED_MESSAGE,
} from '$lib/stores/executionRuns.svelte';
import {
  listRunOutputs,
  writeRunLog,
  writeRunMetadata,
  type RunOutputEntry,
} from '$lib/execution/run-storage';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { safeResultName } from '$lib/utils/results';

function resultStatus(status: LiatirExecutionTerminalStatus): LiatirRunStatus {
  return status === 'interrupted' ? 'error' : status;
}

function stringInputs(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function recordParams(value: JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Renders one execution log entry for the run's durable transcript.
 *
 * Streams are marked rather than flattened away: reading a failure back later, "which of these lines
 * came from stderr" is usually the whole question, and the answer is gone once the arrays are
 * concatenated. `system` lines are Liatir's own narration and stay unmarked, since they are already
 * distinguishable by being the only ones that read like sentences.
 */
function renderLogEntry(entry: LiatirExecutionLogEntry): string {
  return entry.stream === 'stderr' ? `[stderr] ${entry.message}` : entry.message;
}

/**
 * The transcript a run is recorded with.
 *
 * It comes from the execution spine, never from the caller. Every native process line already flows
 * there through `runNativeTool`, and a caller's own array is a display transcript — filtered, capped
 * at a few hundred lines, formatted for a terminal widget. Persisting that instead would keep the
 * prettier copy and throw away the complete one, which is the opposite of what a run record is for.
 */
function runTranscript(logs: LiatirExecutionLogEntry[], fallback: string[] | undefined): string[] {
  return logs.length > 0 ? logs.map(renderLogEntry) : (fallback ?? []);
}

/** Compression suffixes that are part of the extension rather than the whole of it. */
const COMPOUND_SUFFIXES = new Set(['gz', 'bz2', 'xz', 'zst']);

/** `reads.fastq.gz` → `fastq.gz`, `report.html` → `html`, `Makefile` → `file`. */
function extensionOf(name: string): string {
  const parts = name.split('.');
  if (parts.length < 2) return 'file';
  const last = parts[parts.length - 1];
  if (COMPOUND_SUFFIXES.has(last) && parts.length > 2) {
    return `${parts[parts.length - 2]}.${last}`;
  }
  return last;
}

/**
 * Files found in the run's own directory that nobody declared.
 *
 * This is what makes an empty `sideEffects` checkable instead of merely stated. A tool writes into
 * a directory Liatir owns for that run, so at this point Liatir can simply look: anything present
 * and unaccounted for is recorded anyway, under its own filename, rather than existing on the
 * user's disk with nothing in the app admitting it.
 *
 * Matching is by filename, not by path: the declared paths are built with forward slashes while the
 * enumeration returns the platform's own separators, and comparing those directly would report
 * every declared file as undeclared on Windows.
 */
function undeclaredRunOutputs(
  found: RunOutputEntry[],
  declared: RunOutputFile[],
): RunOutputFile[] {
  const declaredNames = new Set(declared.map((file) => file.path.split(/[\\/]/).pop()));
  return found
    .filter((entry) => !declaredNames.has(entry.name))
    .map((entry) => ({
      label: entry.name,
      path: entry.path,
      ext: extensionOf(entry.name),
      ...(entry.size != null ? { size: entry.size } : {}),
      role: 'intermediate' as const,
    }));
}

/**
 * Everything a run left on disk, in one list, each file carrying an honest role.
 *
 * `outputFiles` is what the run was asked to produce; `sideEffects` is what it produced anyway.
 * Both are recorded, because a user cannot inspect a run whose by-products were never written down
 * — and by-products are exactly what you need when a result looks wrong.
 *
 * A file that names its own role keeps it: `bwa`'s reference index is reused by later runs, which
 * makes it `cache` rather than a per-run intermediate.
 */
function mergeRunArtifacts(
  outputFiles: RunOutputFile[] | undefined,
  sideEffects: RunOutputFile[],
): RunOutputFile[] {
  // The declaration is required by the type, and every caller is TypeScript — but this runs on the
  // path that commits a Result, and a thrown TypeError here would lose the whole run record over a
  // missing field. The compiler is where the rule is enforced; here it only has to not make things
  // worse.
  return [
    ...(outputFiles ?? []),
    ...(sideEffects ?? []).map((file) => ({ ...file, role: file.role ?? 'intermediate' as const })),
  ];
}

/** The `parent` block of a run's metadata, present only for a run that is a node inside another. */
function runParent(identity: LiatirExecutionIdentity): Pick<LiatirRunMetadata, 'parent'> {
  const parent = {
    ...(identity.pipelineRunId ? { pipelineRunId: identity.pipelineRunId } : {}),
    ...(identity.pipelineId !== undefined ? { pipelineId: identity.pipelineId } : {}),
    ...(identity.parentRunId ? { parentRunId: identity.parentRunId } : {}),
    ...(identity.nodeId ? { nodeId: identity.nodeId } : {}),
  };
  return Object.keys(parent).length > 0 ? { parent } : {};
}

function resultToolId(identity: LiatirExecutionIdentity): string {
  if (identity.runKind === 'external-workflow' && identity.entityId) {
    return `${LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX}${identity.entityId}`;
  }
  return identity.entityId ?? identity.runKind;
}

/**
 * What a caller must state about the run it is finalizing.
 *
 * `sideEffects` is required and has no default, because an optional field is the one every new tool
 * forgets. But it is no longer the only thing standing between a by-product and oblivion: anything
 * written into the run's own output directory is discovered by enumeration at finalization, so an
 * empty list here is checked rather than believed.
 *
 * What enumeration cannot see is a file written somewhere else — and some tools have no choice, an
 * aligner index has to sit beside the reference for the aligner to find it. That is what this field
 * is now for, and it is why `[]` still has to be said out loud rather than defaulted.
 */
export interface FinalizedRunResult extends Omit<AnalysisRun, 'execution' | 'status'> {
  /**
   * Files the run left outside its own output directory: an index built beside the user's data, or
   * anything else Liatir cannot find by looking where it put the run.
   */
  sideEffects: RunOutputFile[];
}

/**
 * Registers a run's results in the Data library — and only its results.
 *
 * The Data library is what the user browses, so `Results/<Tool>/` has to mean "the things this tool
 * produced for me", not "every file that passed through". The distinction has always been in the
 * data as each artifact's `role`; what was missing is anything reading it. Pipeline steps stamped
 * `final` on everything they touched and registered all of it, while standalone tools avoided the
 * problem only because each page happened to hand-pick one path.
 *
 * Deciding it here means a new tool cannot get it wrong, and cannot get it right by accident either.
 * By-products are reachable from the run itself, which is where they belong.
 */
export async function registerResultsInDataLibrary(
  files: RunOutputFile[],
  toolLabel: string,
): Promise<void> {
  const results = files.filter((file) => (file.role ?? 'final') === 'final');
  if (results.length === 0) return;
  const folder = `Results/${safeResultName(toolLabel)}`;
  await dataFiles.createFolder('Results');
  await dataFiles.createFolder(folder);
  for (const file of results) {
    await dataFiles.add(file.path, folder, file.scientific);
  }
}

/**
 * Commit a scientific Result, then settle its execution identity. If the app
 * exits between those writes, startup reconciliation adopts the durable Result.
 *
 * This is the one place every run in Liatir is written down — native tools, AI Tools, plugins, API
 * requests, external workflows, pipelines — so it is where the recording rule is enforced rather
 * than repeated: the run's directory is written, the complete execution transcript is kept, every
 * file the run touched is listed with an honest role, and only the results reach the Data library.
 * None of it depends on the caller remembering.
 */
export async function finalizeExecutionResult(
  runId: string,
  status: Exclude<LiatirExecutionTerminalStatus, 'interrupted'>,
  result: FinalizedRunResult,
): Promise<AnalysisRunMeta> {
  const execution = executionRuns.byId(runId);
  if (!execution) throw new Error(`Execution not found: ${runId}`);
  if (execution.resultPolicy !== 'own') {
    throw new Error(`Execution ${runId} does not own a Result.`);
  }

  const { sideEffects, ...run } = result;
  const declared = mergeRunArtifacts(run.outputFiles, sideEffects);
  // Checked, not trusted: whatever is in the run's own directory is recorded whether or not the
  // caller mentioned it. Declaration still carries the files a tool had to write elsewhere, and the
  // better labels for the ones it did mention.
  const discovered = undeclaredRunOutputs(await listRunOutputs(run.id), declared);
  const outputFiles = [...declared, ...discovered];

  // The run's own directory is written before the index entry: it is the durable record, and an
  // index that named a run with nothing behind it would be worse than one that missed a run.
  await writeRunMetadata({
    schemaVersion: LIATIR_RUN_RECORD_SCHEMA_VERSION,
    runId: run.id,
    runKind: execution.identity.runKind,
    ...(execution.identity.entityId ? { entityId: execution.identity.entityId } : {}),
    label: run.label,
    status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    error: run.error,
    inputs: run.inputs,
    params: run.params as Record<string, JsonValue>,
    ...(execution.identity.workspaceId ? { workspaceId: execution.identity.workspaceId } : {}),
    ...(runParent(execution.identity)),
  });
  await writeRunLog(run.id, execution.logs);

  await analysisRuns.add({
    ...run,
    status,
    execution: execution.identity,
    jobIds: execution.jobIds,
    outputFiles,
    log: runTranscript(execution.logs, run.log),
  });
  await registerResultsInDataLibrary(outputFiles, run.label);

  const committed = analysisRuns.runs.find((item) => item.id === result.id);
  if (!committed) throw new Error(`Result ${result.id} was not committed.`);
  await executionRuns.finish(runId, committed.status, committed.error, committed.endedAt);
  await executionRuns.markResultFinalized(runId, committed.id, committed.endedAt);
  return committed;
}

/**
 * Reconcile executions left across an app restart. Existing Results win; a
 * genuinely interrupted top-level run receives one diagnostic Result.
 */
export async function reconcileExecutionResults(): Promise<void> {
  await Promise.all([executionRuns.init(), analysisRuns.init()]);

  for (const execution of executionRuns.records) {
    if (execution.resultPolicy !== 'own' || execution.finalizedAt !== undefined) continue;
    const resultId = execution.resultId ?? execution.identity.runId;
    const existing = analysisRuns.runs.find((item) => item.id === resultId);
    if (existing) {
      await executionRuns.reconcileWithResult(execution.identity.runId, existing);
      continue;
    }

    if (
      execution.status !== 'interrupted' &&
      execution.status !== 'error' &&
      execution.status !== 'cancelled'
    ) continue;

    const endedAt = execution.endedAt ?? Date.now();
    const error = execution.error ?? (
      execution.status === 'cancelled' ? 'Execution was cancelled.' : EXECUTION_INTERRUPTED_MESSAGE
    );
    await analysisRuns.add({
      id: resultId,
      tool: resultToolId(execution.identity),
      label: execution.label,
      inputs: stringInputs(execution.inputs),
      params: recordParams(execution.params),
      status: resultStatus(execution.status),
      startedAt: execution.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - execution.startedAt),
      output: null,
      error,
      log: runTranscript(execution.logs, undefined),
      execution: execution.identity,
      jobIds: execution.jobIds,
    });
    // Same directory, same contract: a run recovered after a restart is still a run, and the one
    // thing it can still say — what it had managed to print — belongs where every other run's
    // transcript is looked for.
    await writeRunLog(resultId, execution.logs);
    await executionRuns.markResultFinalized(execution.identity.runId, resultId, endedAt);
  }
}
