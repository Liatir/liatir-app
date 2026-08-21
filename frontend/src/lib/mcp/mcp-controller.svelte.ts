import type { LiatirExecutionTerminalStatus, LiatirMcpRunRequest } from '@liatir/core';
import { isLiatirExecutionTerminalStatus } from '@liatir/core';
import { liatir } from '$lib/api';
import { pipelineStore } from '$lib/stores/pipeline.svelte';
import { executionRuns } from '$lib/stores/executionRuns.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { toast } from '$lib/stores/toast.svelte';

const AUTHORIZATION_EVENT = 'mcp:authorization-requested';
const CANCEL_EVENT = 'mcp:cancel-requested';
const STATE_EVENT = 'mcp:state-changed';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminalStatus(status: string): LiatirExecutionTerminalStatus | null {
  return isLiatirExecutionTerminalStatus(status as LiatirExecutionTerminalStatus)
    ? status as LiatirExecutionTerminalStatus
    : null;
}

function createMcpController() {
  let requests = $state<LiatirMcpRunRequest[]>([]);
  let resolving = $state(false);
  let lastError = $state<string | null>(null);
  let initialized = false;
  let refreshPromise: Promise<void> | null = null;
  const executing = new Set<string>();
  const unlisten: Array<() => void> = [];

  async function refresh(): Promise<void> {
    const api = liatir();
    if (!api || !workspaceStore.activeId) {
      requests = [];
      return;
    }
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      requests = (await api.desktop.mcp.pendingRequests())
        .filter((request) => request.status === 'awaiting-authorization')
        .sort((a, b) => a.requestedAt - b.requestedAt);
    })();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function finishFromExecution(request: LiatirMcpRunRequest): Promise<void> {
    const api = liatir();
    if (!api) return;
    const execution = executionRuns.byId(request.runId);
    if (execution) {
      const recoveredStatus = terminalStatus(execution.status);
      if (recoveredStatus) {
        await api.desktop.mcp.finishRun(
          request.runId,
          recoveredStatus,
          execution.resultId,
          execution.error,
        );
        return;
      }
    }
    if (request.status === 'cancel-requested') {
      await api.desktop.mcp.finishRun(
        request.runId,
        'cancelled',
        undefined,
        'The run was cancelled before execution could resume.',
      );
      return;
    }
    await api.desktop.mcp.finishRun(
      request.runId,
      'interrupted',
      undefined,
      'The app restarted or changed workspace before this approved run could settle.',
    );
  }

  async function reconcile(): Promise<void> {
    const api = liatir();
    if (!api || !workspaceStore.activeId) return;
    const durable = await api.desktop.mcp.requests();
    for (const request of durable) {
      if (
        request.status === 'queued' || request.status === 'running' ||
        request.status === 'cancel-requested'
      ) {
        await finishFromExecution(request).catch(() => {});
      }
    }
  }

  async function executeApproved(request: LiatirMcpRunRequest): Promise<void> {
    const api = liatir();
    if (!api || executing.has(request.runId)) return;
    executing.add(request.runId);
    try {
      await api.desktop.mcp.markStarted(request.runId);
      const execution = await pipelineStore.runSavedPipeline(
        request.pipelineId,
        request.pipelineRevision,
        request.runId,
        {
          kind: 'mcp',
          requestId: request.runId,
          clientName: request.client.name,
          ...(request.client.version ? { clientVersion: request.client.version } : {}),
        },
        request.inputSchema,
        request.inputs,
      );
      const status = terminalStatus(execution.status) ?? 'error';
      await api.desktop.mcp.finishRun(
        request.runId,
        status,
        execution.resultId,
        execution.error,
      );
      if (status === 'done') toast.success(`${request.pipelineName} finished.`);
    } catch (error) {
      const message = errorMessage(error);
      const current = (await api.desktop.mcp.requests().catch(() => []))
        .find((candidate) => candidate.runId === request.runId);
      const status = current?.status === 'cancel-requested' ? 'cancelled' : 'error';
      await api.desktop.mcp.finishRun(
        request.runId,
        status,
        undefined,
        status === 'cancelled' ? 'The run was cancelled.' : message,
      ).catch(() => {});
      if (status === 'error') toast.error(`MCP pipeline run failed: ${message}`);
    } finally {
      executing.delete(request.runId);
      await refresh().catch(() => {});
    }
  }

  async function handleCancel(request: LiatirMcpRunRequest): Promise<void> {
    if (request.workspaceId !== workspaceStore.activeId) return;
    await pipelineStore.cancelRun(request.pipelineId, request.runId);
  }

  return {
    get current() { return requests[0] ?? null; },
    get pendingCount() { return requests.length; },
    get resolving() { return resolving; },
    get lastError() { return lastError; },

    async init(): Promise<void> {
      if (initialized) {
        await this.activate();
        return;
      }
      const api = liatir();
      if (!api) return;
      initialized = true;
      unlisten.push(await api.desktop.events.on(AUTHORIZATION_EVENT, () => {
        void refresh();
      }));
      unlisten.push(await api.desktop.events.on(CANCEL_EVENT, (payload) => {
        void handleCancel(payload as LiatirMcpRunRequest);
      }));
      unlisten.push(await api.desktop.events.on(STATE_EVENT, () => {
        void refresh();
      }));
      await this.activate();
    },

    async activate(): Promise<void> {
      await Promise.all([pipelineStore.init(), dataFiles.init()]);
      await reconcile();
      await refresh();
    },

    reset(): void {
      requests = [];
      resolving = false;
      lastError = null;
    },

    destroy(): void {
      unlisten.splice(0).forEach((off) => off());
      initialized = false;
      this.reset();
    },

    async approve(): Promise<void> {
      const api = liatir();
      const request = requests[0];
      if (!api || !request || resolving) return;
      resolving = true;
      lastError = null;
      try {
        const approved = await api.desktop.mcp.resolveAuthorization(request.runId, true);
        requests = requests.filter((candidate) => candidate.runId !== request.runId);
        void executeApproved(approved);
      } catch (error) {
        lastError = errorMessage(error);
        await refresh().catch(() => {});
      } finally {
        resolving = false;
      }
    },

    async deny(): Promise<void> {
      const api = liatir();
      const request = requests[0];
      if (!api || !request || resolving) return;
      resolving = true;
      lastError = null;
      try {
        await api.desktop.mcp.resolveAuthorization(request.runId, false);
        requests = requests.filter((candidate) => candidate.runId !== request.runId);
      } catch (error) {
        lastError = errorMessage(error);
        await refresh().catch(() => {});
      } finally {
        resolving = false;
      }
    },
  };
}

export const mcpController = createMcpController();
