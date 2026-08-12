import {
  createLiatirRootExecutionIdentity,
  type JsonValue,
  type LiatirExecutionIdentity,
  type LiatirRunStatus,
} from '@liatir/core';
import { finalizeExecutionResult } from '$lib/execution/finalization';
import { isRunCancelled } from '$lib/pipeline/cancellation';
import { executionRuns } from '$lib/stores/executionRuns.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import type { AnalysisRun } from '$lib/stores/analysisRuns.svelte';
import type { NativeRunOptions } from '$lib/utils/native-tool';

export interface BeginDirectNativeToolRunInput {
  runId: string;
  toolId: string;
  label: string;
  inputs: string[];
  params?: JsonValue;
  startedAt?: number;
}

type DirectNativeToolResult = Omit<AnalysisRun, 'execution' | 'status'>;

/**
 * One standalone Native Tool run. The identity is allocated before any file,
 * process, or WASM work starts and is then reused by Jobs and Results.
 */
export interface DirectNativeToolRun {
  identity: LiatirExecutionIdentity;
  signal: AbortSignal | undefined;
  nativeOptions: (overrides?: NativeRunOptions) => NativeRunOptions;
  attachJob: (jobId: string) => Promise<void>;
  appendLog: (
    message: string,
    stream?: 'stdout' | 'stderr' | 'system',
    level?: 'info' | 'warn' | 'error' | 'debug',
  ) => Promise<void>;
  cancel: () => Promise<void>;
  isCancelled: (error?: unknown) => boolean;
  finalize: (status: LiatirRunStatus, result: DirectNativeToolResult) => Promise<void>;
}

export async function beginDirectNativeToolRun(
  input: BeginDirectNativeToolRunInput,
): Promise<DirectNativeToolRun> {
  const workspaceId = workspaceStore.activeId;
  if (!workspaceId) throw new Error('No active workspace.');

  const identity = createLiatirRootExecutionIdentity({
    runId: input.runId,
    runKind: 'native-tool',
    workspaceId,
    entityId: input.toolId,
  });
  await executionRuns.begin({
    identity,
    label: input.label,
    resultPolicy: 'own',
    resultId: input.runId,
    inputs: input.inputs,
    ...(input.params !== undefined ? { params: input.params } : {}),
    startedAt: input.startedAt,
  });

  const signal = executionRuns.signal(identity.runId);
  return {
    identity,
    signal,
    nativeOptions(overrides = {}) {
      return {
        ...overrides,
        label: overrides.label ?? input.label,
        kind: overrides.kind ?? 'native-tool',
        execution: identity,
        signal: overrides.signal ?? signal,
      };
    },
    attachJob(jobId) {
      return executionRuns.attachJob(identity.runId, jobId);
    },
    appendLog(message, stream = 'system', level = 'info') {
      return executionRuns.appendLog(identity.runId, message, { stream, level });
    },
    cancel() {
      return executionRuns.cancel(identity.runId);
    },
    isCancelled(error) {
      return executionRuns.byId(identity.runId)?.status === 'cancelling'
        || isRunCancelled(error, signal);
    },
    async finalize(status, result) {
      await finalizeExecutionResult(identity.runId, status, result);
    },
  };
}
