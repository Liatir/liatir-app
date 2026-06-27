import { PluginsInterface } from "../../rs/plugins/_types";
import { SidecarInterface } from "../../rs/sidecar/_types";
import { PipelineInterface } from "./_types";
export declare function buildPipeline(deps: {
    plugins: PluginsInterface;
    sidecar: SidecarInterface;
}): PipelineInterface;
