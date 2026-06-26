#!/usr/bin/env node
import { init } from "./commands/init.js";
import { dev } from "./commands/dev.js";
import { build } from "./commands/build.js";

const [, , command, ...rest] = process.argv;

async function main() {
  switch (command) {
    case "init": {
      // First non-flag arg is the project name; --wasm selects the WASM runtime.
      const name = rest.find((a) => !a.startsWith("-"));
      if (!name) {
        console.error("Usage: liatir init <name> [--wasm]");
        process.exit(1);
      }
      const runtime = rest.includes("--wasm") || rest.includes("--runtime=wasm") ? "wasm" : "node";
      await init(name, runtime);
      break;
    }
    case "dev":
      await dev();
      break;
    case "build":
      await build();
      break;
    default:
      console.log(`liatir — develop and build .lia modules & custom tools

Usage:
  liatir init <name>          Scaffold a new Node (.lia) module
  liatir init <name> --wasm   Scaffold a new WASM custom tool (Rust)
  liatir dev                  Watch mode: rebuild on save, run against live Liatir app
  liatir build                Bundle and package as <name>.lia
`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
