import { DesktoprInstance } from "../../../main";
import { DesktoprAPI } from "../../../types";
import { buildDiagnosticsTestFunctions, deriveAppVersion, diagnosticsSettings } from "./_helpers";
import { AnalyticsPayload, DiagnosticsArea, DiagnosticsInterface, ErrorPayload, PrivacySettings } from "./_types";

export function buildDiagnostics(core: { invoke: DesktoprAPI["invoke"] }): DiagnosticsInterface {
  return {
    settings: {
      // set: mappa ai parametri snake_case attesi da Rust (tutti opzionali)
      set: (settings?: PrivacySettings) => diagnosticsSettings(core, settings),
      get: () => core.invoke("dtr_logs_get_privacy", {}),
    },

    // SOLO analytics (Rust vuole AnalyticsRecord), usa key record_type
    newRecord: async (
      recordType: string,
      payload: AnalyticsPayload,
      env: "js" | "native" | string,
      appVersion?: string
    ) => {
      const v = await deriveAppVersion(appVersion);
      return await core.invoke("dtr_logs_new_record", {
        recordType,
        payload,
        env,
        appVersion: v
      });
    },

    newError: {
      js: async (payload: ErrorPayload, appVersion?: string) => {
        const v = await deriveAppVersion(appVersion);
        return await core.invoke("dtr_logs_record_js_error", { payload, appVersion: v})
      },

      native: async (payload: ErrorPayload, appVersion?: string) => {
        const v = await deriveAppVersion(appVersion);
        return await core.invoke("dtr_logs_record_native_error", { payload, appVersion: v})
      },

      // Rust richiede 'env' obbligatorio: di default "generic" se non passato
      generic: async (payload: ErrorPayload, env = "generic", appVersion?: string) => {
        const v = await deriveAppVersion(appVersion);
        return await core.invoke("dtr_logs_record_error", { payload, env, appVersion: v})
      },
    },

    readRecordsFile: (relPath: string) =>
      core.invoke<string>("dtr_logs_read_file", { relPath }),

    // qui avevi chiamato dtr_logs_read_file: correggo su dtr_logs_list_files
    listRecordsFiles: (area: DiagnosticsArea) =>
      core.invoke("dtr_logs_list_files", { area }),

    runRetention: () => core.invoke("dtr_logs_run_retention", {}),

    export: () =>
      core.invoke<string>("dtr_logs_export_zip", {}),

    test: buildDiagnosticsTestFunctions(core),
  };
}
