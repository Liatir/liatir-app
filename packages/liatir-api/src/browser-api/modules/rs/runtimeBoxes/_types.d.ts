import type { AiRuntimePackageCheck, LiatirRuntimeBoxInstall, LiatirRuntimeComponentInstallResult, LiatirRuntimeComponentKind, LiatirRuntimeComponentRollbackResult, LiatirRuntimeComponentStatus, LiatirRuntimeComponentUpdateRequest } from '@liatir/core';
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
    cancelDownload(downloadId: string): Promise<boolean>;
}
