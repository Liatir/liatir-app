#!/usr/bin/env node
import { init } from "./commands/init.js";
import { dev } from "./commands/dev.js";
import { build } from "./commands/build.js";
import { update } from "./commands/update.js";

const [, , command, ...rest] = process.argv;

async function main() {
  switch (command) {
    case "init": {
      await init(rest);
      break;
    }
    case "dev":
      await dev(rest);
      break;
    case "build":
      await build();
      break;
    case "update":
      await update(rest);
      break;
    default:
      console.log(`liatir — develop and build .lia plugins & custom tools

Usage:
  liatir init [name]          Scaffold a .lia plugin or WASM plugin interactively
  liatir init <name> --yes    Use recommended defaults without prompts
  liatir init <name> --wasm   Scaffold a WASM Rust .lia tool
  liatir init <name> --python Scaffold a Python .lia plugin
  liatir init <name> --js     Scaffold a JavaScript Node .lia plugin
  liatir dev                  Watch mode: rebuild on save, run against live Liatir app
  liatir dev --input '{"text":"hello"}'
  liatir dev --input-file inputs.json
  liatir build                Bundle and package as <name>.lia
  liatir update               Update @liatir/cli and @liatir/api in a Node .lia plugin project
`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
