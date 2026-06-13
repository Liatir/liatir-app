"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveAppVersion = exports.diagnosticsSettings = void 0;
exports.buildDiagnosticsTestFunctions = buildDiagnosticsTestFunctions;
const utils_1 = require("../../../utils");
const helpers_1 = require("../../../helpers");
const diagnosticsSettings = async (core, settings) => {
    // Accept both camelCase (SDK input) and snake_case (Rust return format)
    const s = settings;
    const retDaysAnalytics = s?.retentionDaysAnalytics ?? s?.retention_days_analytics;
    const retDaysLogs = s?.retentionDaysLogs ?? s?.retention_days_logs;
    const retDaysCrashes = s?.retentionDaysCrashes ?? s?.retention_days_crashes;
    if (retDaysAnalytics != null && !utils_1.Num.isU32(retDaysAnalytics))
        throw ("[retentionDaysAnalytics] the value must be a U32 integer number");
    if (retDaysLogs != null && !utils_1.Num.isU32(retDaysLogs))
        throw ("[retentionDaysLogs] the value must be a U32 integer number");
    if (retDaysCrashes != null && !utils_1.Num.isU32(retDaysCrashes))
        throw ("[retentionDaysCrashes] the value must be a U32 integer number");
    return await core.invoke("dtr_logs_set_privacy", {
        patch: {
            analytics_enabled: s?.analyticsEnabled ?? s?.analytics_enabled,
            crash_reports_enabled: s?.crashReportsEnabled ?? s?.crash_reports_enabled,
            retention_days_analytics: retDaysAnalytics,
            retention_days_logs: retDaysLogs,
            retention_days_crashes: retDaysCrashes,
        }
    });
};
exports.diagnosticsSettings = diagnosticsSettings;
const deriveAppVersion = async (v) => {
    if (v)
        return v;
    const version = await (0, helpers_1.getAppVersion)();
    return version;
};
exports.deriveAppVersion = deriveAppVersion;
// ==============================
// Test functions
// ==============================
function buildDiagnosticsTestFunctions(core) {
    return {
        testGenerateRecords: (n = 200) => core.invoke("dtr_logs_test_record_n", { n }),
        // Questa può semplicemente lanciare un errore JS: non serve invoke.
        testThrowJsError: async () => {
            throw new Error("DEV: test JS error");
        },
        testPanicRust: () => core.invoke("dtr_logs_test_panic", {}),
        testExportZip: () => core.invoke("dtr_logs_export_zip", {}),
        testForceRetention: (area) => core.invoke("dtr_logs_test_force_retention", { area }),
    };
}
