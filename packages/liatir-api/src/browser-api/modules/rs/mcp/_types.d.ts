import type { LiatirMcpAuditRecord, LiatirMcpRunRequest, LiatirMcpServerStatus, LiatirMcpRunStatus, LiatirMcpPipelineInputDescriptor } from '@liatir/core';
export type LiatirMcpTerminalRunStatus = Extract<LiatirMcpRunStatus, 'done' | 'error' | 'cancelled' | 'interrupted'>;
/** App-internal administration for the narrow local MCP server. */
export interface McpInterface {
    status(): Promise<LiatirMcpServerStatus>;
    setEnabled(enabled: boolean): Promise<LiatirMcpServerStatus>;
    rotateToken(): Promise<LiatirMcpServerStatus>;
    allowPipeline(workspaceId: string, pipelineId: string, inputs: LiatirMcpPipelineInputDescriptor[]): Promise<LiatirMcpServerStatus>;
    revokePipeline(workspaceId: string, pipelineId: string): Promise<LiatirMcpServerStatus>;
    setReadResults(enabled: boolean): Promise<LiatirMcpServerStatus>;
    allowDataFile(workspaceId: string, artifactId: string): Promise<LiatirMcpServerStatus>;
    revokeDataFile(workspaceId: string, artifactId: string): Promise<LiatirMcpServerStatus>;
    /** Allow or revoke many registered files in one atomic change. */
    setDataFilesAllowed(workspaceId: string, artifactIds: string[], allowed: boolean): Promise<LiatirMcpServerStatus>;
    /** Grant or withdraw standing access to one Data folder, including files added later. */
    setDataFolderAllowed(workspaceId: string, folder: string, allowed: boolean): Promise<LiatirMcpServerStatus>;
    /** Withdraw every Data file and folder grant in the workspace. Results stay separate. */
    revokeAllDataAccess(workspaceId: string): Promise<LiatirMcpServerStatus>;
    pendingRequests(): Promise<LiatirMcpRunRequest[]>;
    requests(): Promise<LiatirMcpRunRequest[]>;
    resolveAuthorization(runId: string, approved: boolean): Promise<LiatirMcpRunRequest>;
    markStarted(runId: string): Promise<LiatirMcpRunRequest>;
    finishRun(runId: string, status: LiatirMcpTerminalRunStatus, resultId?: string, error?: string | null): Promise<LiatirMcpRunRequest>;
    auditRecords(): Promise<LiatirMcpAuditRecord[]>;
}
