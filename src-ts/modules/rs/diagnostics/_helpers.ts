// src-ts/_dev_diagnostics.ts
import { DesktoprAPI } from "../../../types";
import { DiagnosticsArea, DiagnosticsTestFunctions, PrivacySettings, PrivacySettingsCamelCase } from "./_types";
import { Num } from "../../../utils";
import { getAppVersion } from "../../../helpers";

export const diagnosticsSettings = async (core: { invoke: DesktoprAPI["invoke"] }, settings?: PrivacySettings): Promise<PrivacySettingsCamelCase> => {
  // Accept both camelCase (SDK input) and snake_case (Rust return format)
  const s = settings as any;
  const retDaysAnalytics = s?.retentionDaysAnalytics ?? s?.retention_days_analytics;
  const retDaysLogs      = s?.retentionDaysLogs      ?? s?.retention_days_logs;
  const retDaysCrashes   = s?.retentionDaysCrashes   ?? s?.retention_days_crashes;

  if(retDaysAnalytics != null && !Num.isU32(retDaysAnalytics)) throw("[retentionDaysAnalytics] the value must be a U32 integer number");
  if(retDaysLogs      != null && !Num.isU32(retDaysLogs))      throw("[retentionDaysLogs] the value must be a U32 integer number");
  if(retDaysCrashes   != null && !Num.isU32(retDaysCrashes))   throw("[retentionDaysCrashes] the value must be a U32 integer number");

  return await core.invoke("dtr_logs_set_privacy", {
    patch: {
      analytics_enabled:        s?.analyticsEnabled     ?? s?.analytics_enabled,
      crash_reports_enabled:    s?.crashReportsEnabled  ?? s?.crash_reports_enabled,
      retention_days_analytics: retDaysAnalytics,
      retention_days_logs:      retDaysLogs,
      retention_days_crashes:   retDaysCrashes,
    }
  });
}

export const deriveAppVersion = async (v?: string): Promise<string> => {
  if(v) return v;

  const version = await getAppVersion();

  return version;
}

// ==============================
// Test functions
// ==============================

export function buildDiagnosticsTestFunctions(core: { invoke: DesktoprAPI["invoke"] }): DiagnosticsTestFunctions {
  return {
    testGenerateRecords: (n = 200) =>
      core.invoke<void>("dtr_logs_test_record_n", { n }),

    // Questa può semplicemente lanciare un errore JS: non serve invoke.
    testThrowJsError: async () => {
      throw new Error("DEV: test JS error");
    },

    testPanicRust: () => core.invoke<void>("dtr_logs_test_panic", {}),

    testExportZip: () =>
      core.invoke<string>("dtr_logs_export_zip", {}),

    testForceRetention: (area: DiagnosticsArea) =>
      core.invoke<void>("dtr_logs_test_force_retention", { area }),
  };
}