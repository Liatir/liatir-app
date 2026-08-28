import type { AiRuntimePackageCheck, JsonValue, LiatirRuntimeBoxInstall, LiatirRuntimeComponentInstallResult, LiatirRuntimeComponentKind, LiatirRuntimeComponentPythonRunResult, LiatirRuntimeComponentRollbackResult, LiatirRuntimeComponentStatus, LiatirRuntimeComponentUpdateRequest } from '@liatir/core';
export interface RuntimeComponentPythonRunInput {
    componentKind: LiatirRuntimeComponentKind;
    runtimeId: string;
    script: string;
    args?: string[];
    inputJson: Record<string, JsonValue>;
    timeoutSeconds?: number;
}
export interface RuntimeComponentPythonSpawnInput extends Omit<RuntimeComponentPythonRunInput, 'timeoutSeconds'> {
    workspaceId?: string | null;
    label?: string;
    metadata?: Record<string, JsonValue>;
}
export interface RuntimeComponentStatusInput {
    componentKind: LiatirRuntimeComponentKind;
    runtimeId: string;
    packages?: AiRuntimePackageCheck[];
    update?: LiatirRuntimeComponentUpdateRequest;
}
export interface RuntimeComponentInstallInput extends LiatirRuntimeBoxInstall {
    componentKind: LiatirRuntimeComponentKind;
    componentId: string;
    downloadId: string;
}
/** Signed, app-global Runtime Component lifecycle. Checks never activate or download archives. */
export interface RuntimeBoxesInterface {
    status(input: RuntimeComponentStatusInput): Promise<LiatirRuntimeComponentStatus>;
    install(input: RuntimeComponentInstallInput): Promise<LiatirRuntimeComponentInstallResult>;
    rollback(componentKind: LiatirRuntimeComponentKind, runtimeId: string): Promise<LiatirRuntimeComponentRollbackResult>;
    remove(componentKind: LiatirRuntimeComponentKind, runtimeId: string, boxId: string): Promise<boolean>;
    runPython(input: RuntimeComponentPythonRunInput): Promise<LiatirRuntimeComponentPythonRunResult>;
    spawnPython(input: RuntimeComponentPythonSpawnInput): Promise<{
        jobId: string;
    }>;
    cancelDownload(downloadId: string): Promise<boolean>;
}
