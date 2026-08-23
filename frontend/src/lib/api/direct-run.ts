import {
  createLiatirRootExecutionIdentity,
  liatirExecutionMetadata,
  type JsonValue,
  type RunOutputFile,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { ApiConnectorError } from '$lib/api/response-validation';
import { finalizeExecutionResult } from '$lib/execution/finalization';
import { apiConnections, inferSchema, sendApiRequest } from '$lib/stores/apiConnections.svelte';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { executionRuns } from '$lib/stores/executionRuns.svelte';
import { jobsStore } from '$lib/stores/jobs.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import type {
  ApiOutputSchemaField,
  ApiRequest,
  ApiResponse,
} from '$lib/types/api-connection';
import { withArtifactsMetadata } from '$lib/utils/artifacts';
import { ensureRunOutputDir } from '$lib/execution/run-storage';

export interface DirectApiRunResult {
  response: ApiResponse;
  schema: Record<string, ApiOutputSchemaField>;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function persistResponseArtifact(
  req: ApiRequest,
  identity: ReturnType<typeof createLiatirRootExecutionIdentity>,
  response: ApiResponse,
): Promise<RunOutputFile[]> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const absDir = await ensureRunOutputDir(identity.runId);
  let ext = 'txt';
  try { JSON.parse(response.body); ext = 'json'; } catch { /* text response */ }
  // The run owns this directory, so the run id no longer has to be part of the filename.
  const path = `${absDir}/response.${ext}`;
  await api.invoke('lia_write_file_path', { path, content: response.body });
  await api.invoke('lia_file_size', { path });
  // Registration in the Data library happens once, at finalization, where the role decides what
  // counts as a result. Doing it here as well would put by-products in front of the user.
  return withArtifactsMetadata([{ label: 'Response Body', path, ext }], {
    role: 'final',
    createdAt: Date.now(),
    producer: { kind: 'api-request', id: req.id, label: req.name },
    parentRun: {
      runKind: 'api-request',
      runId: identity.runId,
      analysisRunId: identity.runId,
    },
  });
}

/** Execute a saved API Connector as a standalone, cancellable Job and Result. */
export async function runApiConnectorDirect(
  runId: string,
  req: ApiRequest,
  overrides: Record<string, string> = {},
): Promise<DirectApiRunResult> {
  const workspaceId = workspaceStore.activeId;
  if (!workspaceId) throw new Error('No active workspace.');
  const provider = apiConnections.collectionById(req.collectionId) ?? undefined;
  const startedAt = Date.now();
  const identity = createLiatirRootExecutionIdentity({
    runId,
    runKind: 'api-request',
    workspaceId,
    entityId: req.id,
  });
  const params = {
    requestId: req.id,
    collectionId: req.collectionId,
    method: req.method,
    urlTemplate: req.url,
    authType: req.auth.type === 'inherit' ? (provider?.auth.type ?? 'none') : req.auth.type,
    parameterKeys: Object.keys(overrides),
  };
  await executionRuns.begin({
    identity,
    label: req.name,
    resultPolicy: 'own',
    resultId: runId,
    params: params as JsonValue,
    startedAt,
  });

  let logicalJobId: string | null = null;
  let response: ApiResponse | undefined;
  try {
    const logical = await jobsStore.beginLogical('api-connector', {
      label: req.name,
      kind: 'api-request',
      metadata: {
        ...liatirExecutionMetadata(identity),
        requestId: req.id,
        collectionId: req.collectionId,
        method: req.method,
      },
    });
    if (!logical) throw new Error('Could not create API Connector Job.');
    logicalJobId = logical.jobId;
    await executionRuns.attachJob(runId, logicalJobId);
    const requestLog = `${req.method} ${req.url}`;
    await Promise.all([
      executionRuns.appendLog(runId, requestLog, { stream: 'system' }),
      jobsStore.appendLogicalOutput(logicalJobId, 'stdout', requestLog),
      jobsStore.setProgress(logicalJobId, { current: 0, total: 1, label: 'Requesting', done: false }),
    ]);

    response = await sendApiRequest(req, {
      provider,
      paramOverrides: overrides,
      envVars: apiConnections.activeEnvVars,
      signal: executionRuns.signal(runId),
    });
    const outputFiles = await persistResponseArtifact(req, identity, response);
    await apiConnections.storeLastResponse(req.id, response);
    let schema: Record<string, ApiOutputSchemaField> = {};
    try { schema = inferSchema(JSON.parse(response.body)); } catch { /* unstructured response */ }
    const completionLog = `HTTP ${response.status} ${response.statusText} in ${response.durationMs}ms`;
    await Promise.all([
      executionRuns.appendLog(runId, completionLog, { stream: 'stdout' }),
      jobsStore.appendLogicalOutput(logicalJobId, 'stdout', completionLog),
      jobsStore.setProgress(logicalJobId, { current: 1, total: 1, label: 'Completed', done: true }),
    ]);
    await jobsStore.finishLogical(logicalJobId, true);

    const endedAt = Date.now();
    await finalizeExecutionResult(runId, 'done', {
      id: runId,
      tool: req.id,
      label: req.name,
      inputs: [],
      params,
      outputFiles,
      // An API request writes only what it was asked to save; nothing else reaches the disk.
      sideEffects: [],
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      output: {
        sections: [{
          type: 'text',
          label: 'API Connector',
          content: completionLog,
        }],
      },
      error: null,
    });
    return { response, schema };
  } catch (error) {
    const cancelled = executionRuns.byId(runId)?.status === 'cancelling' || isAbort(error);
    const apiError = error instanceof ApiConnectorError ? error : null;
    response = response ?? apiError?.response;
    let outputFiles: RunOutputFile[] = [];
    if (response) {
      outputFiles = await persistResponseArtifact(req, identity, response).catch(() => []);
      await apiConnections.storeLastResponse(req.id, response).catch(() => {});
    }
    const message = cancelled
      ? 'API Connector run was cancelled.'
      : error instanceof Error ? error.message : String(error);
    await executionRuns.appendLog(runId, message, {
      stream: 'stderr',
      level: cancelled ? 'warn' : 'error',
    }).catch(() => {});
    if (logicalJobId) {
      await jobsStore.appendLogicalOutput(logicalJobId, 'stderr', message).catch(() => {});
      await jobsStore.setProgress(logicalJobId, {
        current: 0,
        total: 1,
        label: cancelled ? 'Cancelled' : 'Failed',
        done: true,
      }).catch(() => {});
      await jobsStore.finishLogical(logicalJobId, false).catch(() => {});
    }
    const endedAt = Date.now();
    await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
      id: runId,
      tool: req.id,
      label: req.name,
      inputs: [],
      params: {
        ...params,
        ...(apiError ? { errorKind: apiError.kind, httpStatus: apiError.response?.status } : {}),
      },
      outputFiles,
      // An API request writes only what it was asked to save; nothing else reaches the disk.
      sideEffects: [],
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      output: null,
      error: message,
    });
    throw error;
  }
}
