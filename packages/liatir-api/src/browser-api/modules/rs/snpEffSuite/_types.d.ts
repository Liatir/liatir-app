import type { LiatirInstalledSnpEffDatabase, LiatirSnpEffDatabaseInstallResult, LiatirSnpEffSuiteInstallResult, LiatirSnpEffSuiteStatus } from '@liatir/core';
/** Verified, app-global lifecycle for the optional SnpEff and SnpSift suite. */
export interface SnpEffSuiteInterface {
    status(): Promise<LiatirSnpEffSuiteStatus>;
    install(version: string, downloadId: string, jobId: string): Promise<LiatirSnpEffSuiteInstallResult>;
    remove(): Promise<boolean>;
    installDatabase(id: string, suiteVersion: string, downloadId: string, jobId: string): Promise<LiatirSnpEffDatabaseInstallResult>;
    removeDatabase(database: Pick<LiatirInstalledSnpEffDatabase, 'id' | 'suiteVersion' | 'archiveSha256'>): Promise<boolean>;
}
