import { PluginsInterface } from "../../rs/plugins/_types";
import { FastqcArgs, FastqcInterface, FastqcResult } from "./_types";

const MODULE = "fastqc.wasm";

function parentDir(filePath: string): string {
  const sep = filePath.includes("/") ? "/" : "\\";
  const idx = filePath.lastIndexOf(sep);
  return idx > 0 ? filePath.substring(0, idx) : sep;
}

export function buildFastqc(plugins: PluginsInterface): FastqcInterface {
  return {
    run: async (args: FastqcArgs): Promise<FastqcResult> => {
      const hostReadPaths = [parentDir(args.input)];

      const result = await plugins.call(
        MODULE,
        { fn: "run", args },
        undefined,
        hostReadPaths,
      );

      if (!result.ok) {
        throw new Error(result.error ?? result.stderr ?? "fastqc failed");
      }

      return result.value as unknown as FastqcResult;
    },
  };
}
