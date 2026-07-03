import { defineConfig } from "tsup";
import path from "path";

// Build config for the PUBLISHED @liatir/api package.
//
// Bundles the INTERNAL @liatir/output-parser into the output — both the JS and
// the .d.ts (via dts.resolve) — so the published package is self-contained and
// the parser package never has to go to npm.
const PARSER_ENTRY = path.resolve(process.cwd(), "../liatir-output-parser/src/index.ts");
const CORE_ENTRY = path.resolve(process.cwd(), "../liatir-core/src/index.ts");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // Inline the .d.ts of internal @liatir packages only. src-ts is imported by
  // relative path so it is inlined regardless; external npm types (e.g. ajv,
  // pulled in by src-ts's JSON validation util) stay external and are
  // tree-shaken out of the public types instead of being (mis-)resolved.
  dts: { resolve: [/@liatir\//] },
  clean: true,
  // Inline the internal shared package (node built-ins stay external by default).
  noExternal: ["@liatir/core", "@liatir/output-parser"],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      "@liatir/core": CORE_ENTRY,
      "@liatir/output-parser": PARSER_ENTRY,
    };
  },
});
