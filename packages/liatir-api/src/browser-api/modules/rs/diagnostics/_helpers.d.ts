import { LiatirAPI } from "../../../types";
import { DiagnosticsTestFunctions, PrivacySettings, PrivacySettingsCamelCase } from "./_types";
export declare const diagnosticsSettings: (core: {
    invoke: LiatirAPI["invoke"];
}, settings?: PrivacySettings) => Promise<PrivacySettingsCamelCase>;
export declare const deriveAppVersion: (v?: string) => Promise<string>;
export declare function buildDiagnosticsTestFunctions(core: {
    invoke: LiatirAPI["invoke"];
}): DiagnosticsTestFunctions;
