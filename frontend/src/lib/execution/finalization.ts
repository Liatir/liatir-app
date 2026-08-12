import type {
  JsonValue,
  LiatirExecutionTerminalStatus,
  LiatirRunStatus,
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
 * Commit a scientific Result, then settle its execution identity. If the app
 * exits between those writes, startup reconciliation adopts the durable Result.
 */
export async function finalizeExecutionResult(
  runId: string,
  status: Exclude<LiatirExecutionTerminalStatus, 'interrupted'>,
  result: Omit<AnalysisRun, 'execution' | 'status'>,
): Promise<AnalysisRunMeta> {
  const execution = executionRuns.byId(runId);
  if (!execution) throw new Error(`Execution not found: ${runId}`);
  if (execution.resultPolicy !== 'own') {
    throw new Error(`Execution ${runId} does not own a Result.`);
  }

  await analysisRuns.add({
    ...result,
    status,
    execution: execution.identity,
    jobIds: execution.jobIds,
    log: result.log ?? execution.logs.map((entry) => entry.message),
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
      tool: execution.identity.entityId ?? execution.identity.runKind,
      label: execution.label,
      inputs: stringInputs(execution.inputs),
      params: recordParams(execution.params),
      status: resultStatus(execution.status),
      startedAt: execution.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - execution.startedAt),
      output: null,
      error,
      log: execution.logs.map((entry) => entry.message),
      execution: execution.identity,
      jobIds: execution.jobIds,
    });
    await executionRuns.markResultFinalized(execution.identity.runId, resultId, endedAt);
  }
}
