import { DesktoprAPI } from "../../../types";
import { DiagnosticsTestFunctions, PrivacySettings, PrivacySettingsCamelCase } from "./_types";
export declare const diagnosticsSettings: (core: {
    invoke: DesktoprAPI["invoke"];
}, settings?: PrivacySettings) => Promise<PrivacySettingsCamelCase>;
export declare const deriveAppVersion: (v?: string) => Promise<string>;
export declare function buildDiagnosticsTestFunctions(core: {
    invoke: DesktoprAPI["invoke"];
}): DiagnosticsTestFunctions;
