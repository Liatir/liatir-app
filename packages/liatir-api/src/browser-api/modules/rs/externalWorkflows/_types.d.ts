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
export interface ExternalWorkflowRuntimeDependency {
    available: boolean;
    path: string | null;
    version: string | null;
}
export interface ExternalWorkflowRuntimeInfo {
    backend: 'native' | 'wsl2';
    available: boolean;
    platform: 'macos' | 'linux' | 'windows';
    architecture: string;
    distribution: string | null;
    kernelVersion: string | null;
    nextflow: ExternalWorkflowRuntimeDependency;
    java: ExternalWorkflowRuntimeDependency;
    error: string | null;
}
export interface ExternalWorkflowExecutionLayout {
    backend: 'native' | 'wsl2';
    runtime: ExternalWorkflowRuntimeInfo;
    command: string;
    argumentsPrefix: string[];
    launchDirectory: string;
    workDirectory: string;
    outputDirectory: string;
    sourceMainScript?: string | null;
    stagedConfigFile?: string | null;
    stagedInputs: Array<{
        key: string;
        path: string;
    }>;
    paramsFile: string;
    logFile: string;
    traceFile: string;
    reportFile: string;
    timelineFile: string;
    dagFile: string;
    resumeWorkDirectory?: string | null;
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
    execution: ExternalWorkflowExecutionLayout;
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
    resumeWorkDirectory?: string;
}
export interface SpawnExternalWorkflowNextflowOptions {
    workspaceId: string;
    definitionId: string;
    runId: string;
    args: string[];
    label?: string;
    kind?: string;
    metadata?: Record<string, unknown>;
}
export interface CollectExternalWorkflowOutputsOptions {
    workspaceId: string;
    definitionId: string;
    runId: string;
    outputs: ExternalWorkflowDeclaredOutput[];
}
export interface ExternalWorkflowsInterface {
    runtimeInfo: () => Promise<ExternalWorkflowRuntimeInfo>;
    prepareRun: (options: PrepareExternalWorkflowRunOptions) => Promise<ExternalWorkflowRunLayout>;
    spawnNextflow: (options: SpawnExternalWorkflowNextflowOptions) => Promise<{
        jobId: string;
    }>;
    collectOutputs: (options: CollectExternalWorkflowOutputsOptions) => Promise<ExternalWorkflowCollectedOutput[]>;
}
