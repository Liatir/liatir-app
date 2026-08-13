export interface ExternalWorkflowStageInput {
    key: string;
    path: string;
}
export interface ExternalWorkflowDeclaredOutput {
    key: string;
    relativePath: string;
}
export interface ExternalWorkflowStagedInput {
    key: string;
    originalPath: string;
    stagedPath: string;
    sizeBytes: number;
    sha256: string;
}
export interface ExternalWorkflowRunLayout {
    runDirectory: string;
    launchDirectory: string;
    workDirectory: string;
    outputDirectory: string;
    sourceSnapshot?: string | null;
    sourceMainScript?: string | null;
    sourceSnapshotSha256?: string | null;
    stagedConfigFile?: string | null;
    configSha256?: string | null;
    stagedInputs: ExternalWorkflowStagedInput[];
    paramsFile: string;
    logFile: string;
    traceFile: string;
    reportFile: string;
    timelineFile: string;
    dagFile: string;
}
export interface ExternalWorkflowCollectedOutput {
    key: string;
    path: string;
    sizeBytes: number;
    sha256: string;
}
export interface PrepareExternalWorkflowRunOptions {
    workspaceId: string;
    definitionId: string;
    runId: string;
    sourceMainScript?: string;
    inputFiles: ExternalWorkflowStageInput[];
    configFile?: string;
}
export interface CollectExternalWorkflowOutputsOptions {
    workspaceId: string;
    definitionId: string;
    runId: string;
    outputs: ExternalWorkflowDeclaredOutput[];
}
export interface ExternalWorkflowsInterface {
    prepareRun: (options: PrepareExternalWorkflowRunOptions) => Promise<ExternalWorkflowRunLayout>;
    collectOutputs: (options: CollectExternalWorkflowOutputsOptions) => Promise<ExternalWorkflowCollectedOutput[]>;
}
