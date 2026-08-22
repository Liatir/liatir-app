import type {
  JsonValue,
  LiatirExecutionIdentity,
  LiatirExecutionLogEntry,
  LiatirExecutionTerminalStatus,
  LiatirRunStatus,
  RunOutputFile,
} from '@liatir/core';
import { LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX } from '@liatir/core';
import {
  analysisRuns,
  type AnalysisRun,
  type AnalysisRunMeta,
} from '$lib/stores/analysisRuns.svelte';
import {
  executionRuns,
  EXECUTION_INTERRUPTED_MESSAGE,
} from '$lib/stores/executionRuns.svelte';

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

function resultToolId(identity: LiatirExecutionIdentity): string {
  if (identity.runKind === 'external-workflow' && identity.entityId) {
    return `${LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX}${identity.entityId}`;
  }
  return identity.entityId ?? identity.runKind;
}

/**
 * What a caller must state about the run it is finalizing.
 *
 * `sideEffects` is required and has no default. `[]` is a real answer — "this run left nothing
 * behind" — but it is a claim someone has to make deliberately, which is the point: an optional
 * field is one every new tool forgets, and the files then exist on the user's disk with nothing in
 * Liatir admitting they are there.
 */
export interface FinalizedRunResult extends Omit<AnalysisRun, 'execution' | 'status'> {
  /**
   * Files the run left on disk that are not among its declared outputs: a report it wrote but does
   * not return, an index it built beside the user's data, scratch it did not clean up.
   */
  sideEffects: RunOutputFile[];
}

/**
 * Commit a scientific Result, then settle its execution identity. If the app
 * exits between those writes, startup reconciliation adopts the durable Result.
 *
 * This is the one place every run in Liatir is written down — native tools, AI Tools, plugins, API
 * requests, external workflows, pipelines — so it is where the recording rule is enforced rather
 * than repeated: the complete execution transcript is kept, and every file the run touched is
 * listed with an honest role. Neither depends on the caller remembering.
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
  await analysisRuns.add({
    ...run,
    status,
    execution: execution.identity,
    jobIds: execution.jobIds,
    outputFiles: mergeRunArtifacts(run.outputFiles, sideEffects),
    log: runTranscript(execution.logs, run.log),
  });

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
    await executionRuns.markResultFinalized(execution.identity.runId, resultId, endedAt);
  }
}
