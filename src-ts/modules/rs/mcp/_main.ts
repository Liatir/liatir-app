import type { LiatirAPI } from '../../../types';
import type {
  LiatirMcpAuditRecord,
  LiatirMcpRunRequest,
  LiatirMcpServerStatus,
} from '@liatir/core';
import type { LiatirMcpTerminalRunStatus, McpInterface } from './_types';

/** Native-only MCP administration. These commands are not exposed to .lia plugin IPC. */
export function buildMcp(core: { invoke: LiatirAPI['invoke'] }): McpInterface {
  return {
    status: () => core.invoke<LiatirMcpServerStatus>('lia_mcp_status'),
    setEnabled: (enabled) =>
      core.invoke<LiatirMcpServerStatus>('lia_mcp_set_enabled', { enabled }),
    rotateToken: () => core.invoke<LiatirMcpServerStatus>('lia_mcp_rotate_token'),
    allowPipeline: (workspaceId, pipelineId, inputs) =>
      core.invoke<LiatirMcpServerStatus>('lia_mcp_allow_pipeline', {
        workspaceId,
        pipelineId,
        inputs,
      }),
    revokePipeline: (workspaceId, pipelineId) =>
      core.invoke<LiatirMcpServerStatus>('lia_mcp_revoke_pipeline', { workspaceId, pipelineId }),
    setReadResults: (enabled) =>
      core.invoke<LiatirMcpServerStatus>('lia_mcp_set_read_results', { enabled }),
    allowDataFile: (workspaceId, artifactId) =>
      core.invoke<LiatirMcpServerStatus>('lia_mcp_allow_data_file', { workspaceId, artifactId }),
    revokeDataFile: (workspaceId, artifactId) =>
      core.invoke<LiatirMcpServerStatus>('lia_mcp_revoke_data_file', { workspaceId, artifactId }),
    pendingRequests: () =>
      core.invoke<LiatirMcpRunRequest[]>('lia_mcp_pending_requests'),
    requests: () => core.invoke<LiatirMcpRunRequest[]>('lia_mcp_requests'),
    resolveAuthorization: (runId, approved) =>
      core.invoke<LiatirMcpRunRequest>('lia_mcp_resolve_authorization', { runId, approved }),
    markStarted: (runId) =>
      core.invoke<LiatirMcpRunRequest>('lia_mcp_mark_started', { runId }),
    finishRun: (
      runId: string,
      status: LiatirMcpTerminalRunStatus,
      resultId?: string,
      error?: string | null,
    ) => core.invoke<LiatirMcpRunRequest>('lia_mcp_finish_run', {
      runId,
      status,
      resultId: resultId ?? null,
      error: error ?? null,
    }),
    auditRecords: () => core.invoke<LiatirMcpAuditRecord[]>('lia_mcp_audit_records'),
  };
}
