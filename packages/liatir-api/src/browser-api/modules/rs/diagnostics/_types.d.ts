import type { U32, U64 } from "../../../utils/utils/_integerUtils";
export interface DiagnosticsInterface {
    settings: {
        set: (settings?: PrivacySettings) => Promise<PrivacySettingsCamelCase>;
        get: () => Promise<PrivacySettingsCamelCase>;
    };
    newRecord: (recordType: string, payload: AnalyticsPayload, env: "js" | "native" | string, appVersion?: string) => Promise<void>;
    newError: {
        js: (payload: ErrorPayload, appVersion?: string) => Promise<void>;
        native: (payload: ErrorPayload, appVersion?: string) => Promise<void>;
        generic: (payload: ErrorPayload, env?: string, appVersion?: string) => Promise<void>;
    };
    readRecordsFile: (relPath: string) => Promise<string>;
    listRecordsFiles: (area: DiagnosticsArea) => Promise<ListedFile[]>;
    runRetention: () => Promise<void>;
    export: () => Promise<string>;
    test: DiagnosticsTestFunctions;
}
export type DiagnosticsArea = "logs" | "crashes" | "runtime";
export type DiagnosticsTestFunctions = {
    testGenerateRecords: (n?: number) => Promise<void>;
    testThrowJsError: () => Promise<never>;
    testPanicRust: () => Promise<void>;
    testExportZip: () => Promise<string>;
    testForceRetention: (area: DiagnosticsArea) => Promise<void>;
};
export type ErrorPayload = {
    message: string;
    filename?: string;
    lineno?: U32;
    colno?: U32;
    stack?: string;
};
export type AnalyticsPayload = {
    name: string;
    props?: Record<string, unknown>;
};
export type ListedFile = {
    rel_path: string;
    bytes: U64;
    modified_ms: U64;
};
export type RecordPayload = ErrorPayload | AnalyticsPayload;
export type PrivacySettings = {
    analyticsEnabled?: boolean;
    crashReportsEnabled?: boolean;
    retentionDaysAnalytics?: U32;
    retentionDaysLogs?: U32;
    retentionDaysCrashes?: U32;
};
export type PrivacySettingsCamelCase = {
    analytics_enabled?: boolean;
    crash_reports_enabled?: boolean;
    retention_days_analytics?: U32;
    retention_days_logs?: U32;
    retention_days_crashes?: U32;
};
