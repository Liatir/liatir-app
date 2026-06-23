import { defineConfig } from "tsup";
import path from "path";

// Build config for the PUBLISHED @liatir/sdk package.
//
// Bundles the INTERNAL @liatir/output-parser into the output — both the JS and
// the .d.ts (via dts.resolve) — so the published package is self-contained and
// the parser package never has to go to npm.
const PARSER_ENTRY = path.resolve(process.cwd(), "../liatir-output-parser/src/index.ts");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: { resolve: true },
  clean: true,
  // Inline the internal shared package (node built-ins stay external by default).
  noExternal: ["@liatir/output-parser"],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      "@liatir/output-parser": PARSER_ENTRY,
    };
  },
});
