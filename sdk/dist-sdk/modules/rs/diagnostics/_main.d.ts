import { LiatirAPI } from "../../../types";
import { DiagnosticsInterface } from "./_types";
export declare function buildDiagnostics(core: {
    invoke: LiatirAPI["invoke"];
}): DiagnosticsInterface;
