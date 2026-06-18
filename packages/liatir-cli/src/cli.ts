#!/usr/bin/env node
import { init } from "./commands/init.js";
import { dev } from "./commands/dev.js";
import { build } from "./commands/build.js";

const [, , command, ...rest] = process.argv;

async function main() {
  switch (command) {
    case "init": {
      const name = rest[0];
      if (!name) {
        console.error("Usage: liatir init <name>");
        process.exit(1);
      }
      await init(name);
      break;
    }
    case "dev":
      await dev();
      break;
    case "build":
      await build();
      break;
    default:
      console.log(`liatir-cli — develop and build .lia scripts

Usage:
  liatir init <name>   Scaffold a new .lia project
  liatir dev           Watch mode: rebuild on save, run against live Liatir app
  liatir build         Bundle and package as <name>.lia
`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
