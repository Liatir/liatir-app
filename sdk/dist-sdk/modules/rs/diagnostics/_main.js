"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDiagnostics = buildDiagnostics;
const _helpers_1 = require("./_helpers");
function buildDiagnostics(core) {
    return {
        settings: {
            // set: mappa ai parametri snake_case attesi da Rust (tutti opzionali)
            set: (settings) => (0, _helpers_1.diagnosticsSettings)(core, settings),
            get: () => core.invoke("dtr_logs_get_privacy", {}),
        },
        // SOLO analytics (Rust vuole AnalyticsRecord), usa key record_type
        newRecord: async (recordType, payload, env, appVersion) => {
            const v = await (0, _helpers_1.deriveAppVersion)(appVersion);
            return await core.invoke("dtr_logs_new_record", {
                recordType,
                payload,
                env,
                appVersion: v
            });
        },
        newError: {
            js: async (payload, appVersion) => {
                const v = await (0, _helpers_1.deriveAppVersion)(appVersion);
                return await core.invoke("dtr_logs_record_js_error", { payload, appVersion: v });
            },
            native: async (payload, appVersion) => {
                const v = await (0, _helpers_1.deriveAppVersion)(appVersion);
                return await core.invoke("dtr_logs_record_native_error", { payload, appVersion: v });
            },
            // Rust richiede 'env' obbligatorio: di default "generic" se non passato
            generic: async (payload, env = "generic", appVersion) => {
                const v = await (0, _helpers_1.deriveAppVersion)(appVersion);
                return await core.invoke("dtr_logs_record_error", { payload, env, appVersion: v });
            },
        },
        readRecordsFile: (relPath) => core.invoke("dtr_logs_read_file", { relPath }),
        // qui avevi chiamato dtr_logs_read_file: correggo su dtr_logs_list_files
        listRecordsFiles: (area) => core.invoke("dtr_logs_list_files", { area }),
        runRetention: () => core.invoke("dtr_logs_run_retention", {}),
        export: () => core.invoke("dtr_logs_export_zip", {}),
        test: (0, _helpers_1.buildDiagnosticsTestFunctions)(core),
    };
}
