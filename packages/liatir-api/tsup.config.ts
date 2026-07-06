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
  // Inline the .d.ts of internal @liatir packages only.
  dts: { resolve: [/@liatir\//] },
  clean: true,
  
  // Keep internal Liatir packages bundled.
  noExternal: ["@liatir/core", "@liatir/output-parser"],

  // Do NOT bundle native / platform-specific / runtime packages.
  external: [
    "fsevents",
    "fsevents/*",
    "chokidar",
    "chokidar/*",
    "@tauri-apps/api",
    "@tauri-apps/api/*",
    "node:*",
    "fs",
    "fs/promises",
    "path",
    "os",
    "crypto",
    "events",
    "stream",
    "util",
    "buffer",
    "url"
  ],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      "@liatir/core": CORE_ENTRY,
      "@liatir/output-parser": PARSER_ENTRY,
    };

    options.external = [
      ...(options.external ?? []),
      "fsevents",
      "chokidar",
      "@tauri-apps/api"
    ];

    options.loader = {
      ...(options.loader ?? {}),
      ".node": "file"
    };

  },
});
